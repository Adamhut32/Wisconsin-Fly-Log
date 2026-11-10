-- Release B: trips with friends, time on the water, places fished.
--  * the trip owner invites friends; invited friends join or decline.
--  * everyone in a trip sees the group's catches from the trip dates (never private or hidden catches;
--    exact spots only for catches shared with exact location) and the group's time on the water.
--  * outings: hours fished on a day and where, even with no fish. Own map shows them (switchable).

create table if not exists public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited','joined')),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
alter table public.trip_members enable row level security;
drop policy if exists "see own memberships" on public.trip_members;
create policy "see own memberships" on public.trip_members for select using (user_id = (select auth.uid())
  or exists (select 1 from public.trips t where t.id = trip_id and t.user_id = (select auth.uid())));
create index if not exists trip_members_user on public.trip_members (user_id);

create table if not exists public.outings (
  id uuid primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  trip_id uuid references public.trips(id) on delete set null,
  fished_on date not null,
  hours numeric(4,1) check (hours is null or (hours > 0 and hours <= 24)),
  water text check (char_length(water) <= 120),
  lat double precision, lng double precision, county text,
  notes text check (char_length(notes) <= 1000),
  on_map boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.outings enable row level security;
drop policy if exists "own outings" on public.outings;
create policy "own outings" on public.outings for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create index if not exists outings_user_day on public.outings (user_id, fished_on);
grant select, insert, update, delete on public.outings to authenticated;
grant select on public.trip_members to authenticated;

create or replace function private.in_trip(tid uuid, uid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trips t where t.id = tid and t.user_id = uid)
      or exists (select 1 from public.trip_members m where m.trip_id = tid and m.user_id = uid and m.status = 'joined');
$$;

-- owner invites friends
create or replace function public.trip_invite(tid uuid, uids uuid[]) returns int language plpgsql security definer set search_path = '' as $$
declare t public.trips; u uuid; n int := 0; nm text;
begin
  select * into t from public.trips where id = tid;
  if t.id is null or t.user_id <> (select auth.uid()) then raise exception 'Only the trip owner can invite.'; end if;
  select display_name into nm from public.profiles where id = t.user_id;
  foreach u in array coalesce(uids, '{}') loop
    continue when u = t.user_id or not private.is_friend(t.user_id, u) or private.blocked_between(t.user_id, u);
    insert into public.trip_members (trip_id, user_id, invited_by) values (tid, u, t.user_id) on conflict do nothing;
    if found then
      n := n + 1;
      perform private.push(u, 'trip_invite', coalesce(nm, 'A friend') || ' invited you on a trip', t.name || ' · ' || to_char(t.start_date, 'Mon FMDD') ||
        case when t.end_date <> t.start_date then ' to ' || to_char(t.end_date, 'Mon FMDD') else '' end, '#trips');
    end if;
  end loop;
  return n;
end $$;

-- invited friend joins or declines
create or replace function public.trip_respond(tid uuid, accept boolean) returns void language plpgsql security definer set search_path = '' as $$
declare t public.trips; nm text;
begin
  if accept then
    update public.trip_members set status = 'joined' where trip_id = tid and user_id = (select auth.uid()) and status = 'invited';
    if found then
      select * into t from public.trips where id = tid; select display_name into nm from public.profiles where id = (select auth.uid());
      perform private.push(t.user_id, 'trip_join', coalesce(nm, 'A friend') || ' joined your trip', t.name, '#trips');
    end if;
  else
    delete from public.trip_members where trip_id = tid and user_id = (select auth.uid());
  end if;
end $$;

-- a member leaves, or the owner removes someone
create or replace function public.trip_remove(tid uuid, uid uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if uid <> (select auth.uid()) and not exists (select 1 from public.trips t where t.id = tid and t.user_id = (select auth.uid())) then
    raise exception 'Only the trip owner can remove people.'; end if;
  delete from public.trip_members where trip_id = tid and user_id = uid;
end $$;

-- trips other people invited me on
create or replace function public.my_group_trips() returns table(id uuid, owner uuid, owner_name text, name text, start_date date, end_date date, base text, notes text, my_status text, people bigint)
language sql stable security definer set search_path = '' as $$
  select t.id, t.user_id, p.display_name, t.name, t.start_date, t.end_date, t.base, t.notes, m.status,
    1 + (select count(*) from public.trip_members x where x.trip_id = t.id and x.status = 'joined')
  from public.trip_members m join public.trips t on t.id = m.trip_id join public.profiles p on p.id = t.user_id
  where m.user_id = (select auth.uid()) and not private.blocked_between(m.user_id, t.user_id)
  order by t.start_date desc;
$$;

-- the group view of one trip: people, everyone's shareable catches in the dates, everyone's time on the water
create or replace function public.trip_group(tid uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t public.trips; me uuid := (select auth.uid()); members uuid[];
begin
  select * into t from public.trips where id = tid;
  if t.id is null then return null; end if;
  if not private.in_trip(tid, me) and not exists (select 1 from public.trip_members m where m.trip_id = tid and m.user_id = me) then return null; end if;
  members := array[t.user_id] || coalesce((select array_agg(user_id) from public.trip_members where trip_id = tid and status = 'joined'), '{}');
  return jsonb_build_object(
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'username', p.username, 'avatar', p.avatar_path,
                 'status', case when p.id = t.user_id then 'owner' else m.status end) order by (p.id = t.user_id) desc, p.display_name), '[]')
               from public.profiles p left join public.trip_members m on m.trip_id = tid and m.user_id = p.id
               where p.id = t.user_id or m.user_id is not null),
    'catches', case when not private.in_trip(tid, me) then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', c.id, 'user_id', c.user_id, 'display_name', p.display_name, 'species', c.species, 'length_in', c.length_in, 'weight_lb', c.weight_lb,
                 'count', c.count, 'fly', c.fly, 'method', c.method, 'caught_on', c.caught_on, 'county', c.county, 'photo_path', c.photo_path,
                 'more_photos', case when c.more_photos is not null then (select jsonb_agg(x->'p') from jsonb_array_elements(c.more_photos) x) end,
                 'lat', case when c.visibility = 'exact' or c.user_id = me then c.lat end, 'lng', case when c.visibility = 'exact' or c.user_id = me then c.lng end,
                 'water', case when c.visibility = 'exact' or c.user_id = me then c.water end, 'created_at', c.created_at) order by c.caught_on, c.created_at), '[]')
               from public.catches c join public.profiles p on p.id = c.user_id
               where c.user_id = any(members) and c.user_id <> me and c.visibility <> 'private' and not c.hidden
                 and (c.caught_on between t.start_date and t.end_date or (c.trip_id = tid))) end,
    'outings', case when not private.in_trip(tid, me) then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', o.id, 'user_id', o.user_id, 'display_name', p.display_name, 'fished_on', o.fished_on, 'hours', o.hours, 'water', o.water,
                 'county', o.county, 'notes', o.notes) order by o.fished_on, o.created_at), '[]')
               from public.outings o join public.profiles p on p.id = o.user_id
               where o.user_id = any(members) and o.user_id <> me and (o.fished_on between t.start_date and t.end_date or o.trip_id = tid)) end);
end $$;

revoke all on function public.trip_invite(uuid, uuid[]), public.trip_respond(uuid, boolean), public.trip_remove(uuid, uuid), public.my_group_trips(), public.trip_group(uuid) from public, anon;
grant execute on function public.trip_invite(uuid, uuid[]), public.trip_respond(uuid, boolean), public.trip_remove(uuid, uuid), public.my_group_trips(), public.trip_group(uuid) to authenticated;
revoke all on function private.in_trip(uuid, uuid) from public, anon, authenticated;

-- push category: trip invites and joins go under "Friends"
create or replace function private.push(uid uuid, kind text, title text, body text, url text default '') returns void language plpgsql security definer set search_path = '' as $$
declare cat text; prefs jsonb; sec text;
begin
  if uid is null or not exists (select 1 from public.push_subscriptions where user_id = uid) then return; end if;
  cat := case when kind in ('friend_request','friend_accept','trip_invite','trip_join') then 'friends'
              when kind like 'tourney%' then 'tourneys'
              when kind in ('gift','gift_done','fairplay') then 'fish'
              when kind = 'catch' then 'catches'
              when kind = 'message' then 'messages' when kind = 'forum' then 'forum'
              when kind like 'staff%' then 'staff' else null end;
  select push_prefs into prefs from public.profiles where id = uid;
  if cat is not null and coalesce((prefs->>cat)::boolean, true) = false then return; end if;
  select decrypted_secret into sec from vault.decrypted_secrets where name = 'coulee_push_secret';
  perform net.http_post(url := 'https://acufuumrjbzbiktodojz.supabase.co/functions/v1/push',
    body := jsonb_build_object('user_id', uid, 'kind', kind, 'title', left(title, 120), 'body', left(coalesce(body, ''), 240), 'url', coalesce(url, '')),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-coulee-secret', sec), timeout_milliseconds := 5000);
exception when others then null;
end $$;

-- (applied separately as migration "trip_photos": trip_photos table with 3-per-person-per-day limit,
--  photo viewing for trip members, and trip_group returning everyone's trip photos)
