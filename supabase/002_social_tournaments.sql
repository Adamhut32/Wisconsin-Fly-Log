-- ===== profile additions =====
alter table public.profiles
  add column role text not null default 'angler' check (role in ('angler','creator')),
  add column is_public boolean not null default false,
  add column bio text check (bio is null or char_length(bio) <= 280),
  add column featured boolean not null default false,
  add column onboarded boolean not null default false;

create or replace function private.is_creator(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = u and role = 'creator');
$$;
grant execute on function private.is_creator(uuid) to authenticated;

-- people can't promote or feature themselves
create or replace function private.guard_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_creator((select auth.uid())) then
    new.role := old.role; new.featured := old.featured;
  end if;
  new.friend_code := old.friend_code; new.id := old.id;
  return new;
end $$;
create trigger guard_profile before update on public.profiles for each row execute function private.guard_profile();
create policy "creator updates profiles" on public.profiles for update to authenticated
  using (private.is_creator((select auth.uid()))) with check (private.is_creator((select auth.uid())));

-- ===== follows =====
create table public.follows (
  follower uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  followee uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index on public.follows (followee);
alter table public.follows enable row level security;
create policy "see follows involving me" on public.follows for select to authenticated using ((select auth.uid()) in (follower, followee));
create policy "follow public anglers" on public.follows for insert to authenticated
  with check (follower = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = followee and p.is_public));
create policy "unfollow" on public.follows for delete to authenticated using (follower = (select auth.uid()));

create or replace function private.can_see(viewer uuid, owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_friend(viewer, owner)
    or exists (select 1 from public.follows f join public.profiles p on p.id = f.followee
               where f.follower = viewer and f.followee = owner and p.is_public);
$$;
grant execute on function private.can_see(uuid, uuid) to authenticated;

alter table public.catches
  add column photo_taken_on date,
  add column hidden boolean not null default false;

drop function public.friend_catches();
create function public.friend_catches()
returns table (id uuid, user_id uuid, display_name text, rel text, trip_id uuid, trip_name text, species text, length_in numeric,
  count int, fly text, caught_on date, county text, lat double precision, lng double precision, notes text,
  photo_path text, exact boolean, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.user_id, p.display_name,
    case when private.is_friend((select auth.uid()), c.user_id) then 'friend' else 'following' end,
    c.trip_id, case when t.shared then t.name end, c.species, c.length_in,
    c.count, c.fly, c.caught_on, c.county,
    case when c.visibility = 'exact' then c.lat end, case when c.visibility = 'exact' then c.lng end,
    case when c.visibility = 'exact' then c.notes end,
    c.photo_path, c.visibility = 'exact', c.created_at
  from public.catches c
  join public.profiles p on p.id = c.user_id
  left join public.trips t on t.id = c.trip_id
  where c.visibility <> 'private' and not c.hidden and private.can_see((select auth.uid()), c.user_id)
  order by c.caught_on desc, c.created_at desc
  limit 1000;
$$;
create or replace function public.friend_spots()
returns table (id uuid, user_id uuid, display_name text, name text, county text, lat double precision, lng double precision,
  water text, trout_class text, status text, exact boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.user_id, p.display_name,
    case when s.visibility = 'exact' then s.name else coalesce(s.water, 'Spot') end,
    s.county,
    case when s.visibility = 'exact' then s.lat end, case when s.visibility = 'exact' then s.lng end,
    s.water, s.trout_class, s.status, s.visibility = 'exact'
  from public.spots s join public.profiles p on p.id = s.user_id
  where s.visibility <> 'private' and private.can_see((select auth.uid()), s.user_id);
$$;
create or replace function public.friend_trips()
returns table (id uuid, user_id uuid, display_name text, name text, start_date date, end_date date)
language sql stable security definer set search_path = '' as $$
  select t.id, t.user_id, p.display_name, t.name, t.start_date, t.end_date
  from public.trips t join public.profiles p on p.id = t.user_id
  where t.shared and private.can_see((select auth.uid()), t.user_id);
$$;

create or replace function public.find_anglers(q text default '')
returns table (id uuid, display_name text, bio text, featured boolean, followers bigint, fish bigint, following boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.bio, p.featured,
    (select count(*) from public.follows f where f.followee = p.id),
    (select coalesce(sum(c.count), 0) from public.catches c where c.user_id = p.id and c.visibility <> 'private' and not c.hidden),
    exists (select 1 from public.follows f where f.followee = p.id and f.follower = (select auth.uid()))
  from public.profiles p
  where p.is_public and p.id <> (select auth.uid())
    and (coalesce(q, '') = '' or p.display_name ilike '%' || q || '%')
  order by p.featured desc, (select count(*) from public.follows f where f.followee = p.id) desc, p.display_name
  limit 50;
$$;
create or replace function public.my_follows()
returns table (user_id uuid, display_name text, direction text)
language sql stable security definer set search_path = '' as $$
  select f.followee, p.display_name, 'following' from public.follows f join public.profiles p on p.id = f.followee where f.follower = (select auth.uid())
  union all
  select f.follower, p.display_name, 'follower' from public.follows f join public.profiles p on p.id = f.follower where f.followee = (select auth.uid());
$$;

-- ===== suggestions =====
create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  kind text not null default 'idea' check (kind in ('idea','problem','other')),
  body text not null check (char_length(body) between 3 and 2000),
  status text not null default 'new' check (status in ('new','planned','done','declined')),
  reply text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.suggestions (user_id);
alter table public.suggestions enable row level security;
create policy "send suggestions" on public.suggestions for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'new' and reply is null);
create policy "read own or all as creator" on public.suggestions for select to authenticated
  using (user_id = (select auth.uid()) or private.is_creator((select auth.uid())));
create policy "creator answers" on public.suggestions for update to authenticated
  using (private.is_creator((select auth.uid()))) with check (private.is_creator((select auth.uid())));
create policy "delete own or creator" on public.suggestions for delete to authenticated
  using (user_id = (select auth.uid()) or private.is_creator((select auth.uid())));
create or replace function public.all_suggestions()
returns table (id uuid, user_id uuid, display_name text, kind text, body text, status text, reply text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.user_id, p.display_name, s.kind, s.body, s.status, s.reply, s.created_at
  from public.suggestions s join public.profiles p on p.id = s.user_id
  where private.is_creator((select auth.uid()))
  order by s.created_at desc;
$$;

-- ===== announcements =====
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(body) between 2 and 1000),
  created_by uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.announcements enable row level security;
create policy "everyone reads announcements" on public.announcements for select to authenticated using (true);
create policy "creator posts" on public.announcements for insert to authenticated with check (private.is_creator((select auth.uid())) and created_by = (select auth.uid()));
create policy "creator removes" on public.announcements for delete to authenticated using (private.is_creator((select auth.uid())));

create or replace function public.creator_hide_catch(catch_id uuid, hide boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_creator((select auth.uid())) then raise exception 'creator only'; end if;
  update public.catches set hidden = hide where id = catch_id;
end $$;
-- ===== tournaments =====
create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 2 and 80),
  description text check (description is null or char_length(description) <= 1000),
  starts_on date not null,
  ends_on date not null,
  counties text[],                       -- null means anywhere in Wisconsin
  area_label text,
  species text[],                        -- null means any species
  scoring text not null default 'biggest' check (scoring in ('biggest','most','species','top3')),
  require_photo boolean not null default true,
  open boolean not null default false,   -- open tournaments: anyone can join (creator only)
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on and ends_on - starts_on <= 120)
);
create table public.tournament_members (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited','joined')),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);
create index on public.tournament_members (user_id);
create table public.tournament_entries (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  catch_id uuid not null references public.catches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tournament_id, catch_id)
);
create index on public.tournament_entries (catch_id);
alter table public.tournaments enable row level security;
alter table public.tournament_members enable row level security;
alter table public.tournament_entries enable row level security;

create or replace function private.in_tournament(tid uuid, u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tournament_members m where m.tournament_id = tid and m.user_id = u);
$$;
grant execute on function private.in_tournament(uuid, uuid) to authenticated;

create policy "see my or open tournaments" on public.tournaments for select to authenticated
  using (open or owner = (select auth.uid()) or private.in_tournament(id, (select auth.uid())));
create policy "owner edits" on public.tournaments for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()) and (not open or private.is_creator((select auth.uid()))));
create policy "owner or creator deletes" on public.tournaments for delete to authenticated
  using (owner = (select auth.uid()) or private.is_creator((select auth.uid())));
create policy "members see members" on public.tournament_members for select to authenticated
  using (private.in_tournament(tournament_id, (select auth.uid())) or exists (select 1 from public.tournaments t where t.id = tournament_id and (t.open or t.owner = (select auth.uid()))));
create policy "members see entries" on public.tournament_entries for select to authenticated
  using (private.in_tournament(tournament_id, (select auth.uid())) or exists (select 1 from public.tournaments t where t.id = tournament_id and t.open));
-- writes to members and entries go through the functions below, which check the rules

-- does this catch qualify for this tournament?
create or replace function private.entry_problem(t public.tournaments, c public.catches) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if c.caught_on < t.starts_on or c.caught_on > t.ends_on then return 'The catch date is outside the tournament dates.'; end if;
  if c.count < 1 then return 'Log at least one fish to enter.'; end if;
  if c.visibility = 'private' then return 'Private catches can''t be entered. Change it to County only or Exact spot.'; end if;
  if t.require_photo and c.photo_path is null then return 'This tournament needs a photo of the fish.'; end if;
  if t.require_photo and (c.photo_taken_on is null or c.photo_taken_on < t.starts_on or c.photo_taken_on > t.ends_on)
    then return 'The photo has to be taken during the tournament. This one has no date, or a date outside it.'; end if;
  if t.counties is not null and (c.county is null or not (c.county = any(t.counties))) then return 'The catch is outside the tournament area.'; end if;
  if t.species is not null and (c.species is null or not exists (select 1 from unnest(t.species) s where lower(c.species) = lower(s)))
    then return 'That species doesn''t count in this tournament.'; end if;
  if t.scoring in ('biggest','top3') and c.length_in is null then return 'Add the fish''s length; this tournament is scored by length.'; end if;
  return null;
end $$;

create or replace function public.create_tournament(p_name text, p_description text, p_starts date, p_ends date, p_counties text[], p_area_label text,
  p_species text[], p_scoring text, p_require_photo boolean, p_open boolean, p_invite uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare tid uuid; me uuid := (select auth.uid()); u uuid;
begin
  if me is null then raise exception 'sign in first'; end if;
  if p_open and not private.is_creator(me) then raise exception 'Only the creator can make open tournaments.'; end if;
  insert into public.tournaments (owner, name, description, starts_on, ends_on, counties, area_label, species, scoring, require_photo, open)
  values (me, p_name, p_description, p_starts, p_ends, nullif(p_counties, '{}'), p_area_label, nullif(p_species, '{}'), p_scoring, p_require_photo, coalesce(p_open, false))
  returning id into tid;
  insert into public.tournament_members (tournament_id, user_id, status, invited_by) values (tid, me, 'joined', me);
  foreach u in array coalesce(p_invite, '{}') loop
    if u <> me and (private.can_see(me, u) or private.is_friend(me, u)) then
      insert into public.tournament_members (tournament_id, user_id, status, invited_by) values (tid, u, 'invited', me) on conflict do nothing;
    end if;
  end loop;
  return tid;
end $$;

create or replace function public.invite_to_tournament(tid uuid, p_invite uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); u uuid; n int := 0;
begin
  if not exists (select 1 from public.tournament_members where tournament_id = tid and user_id = me and status = 'joined') then raise exception 'Join the tournament before inviting people.'; end if;
  foreach u in array coalesce(p_invite, '{}') loop
    if u <> me and private.is_friend(me, u) then
      insert into public.tournament_members (tournament_id, user_id, status, invited_by) values (tid, u, 'invited', me) on conflict do nothing;
      if found then n := n + 1; end if;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.respond_tournament(tid uuid, accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); t public.tournaments;
begin
  select * into t from public.tournaments where id = tid;
  if t.id is null then raise exception 'That tournament no longer exists.'; end if;
  if accept then
    if t.open then
      insert into public.tournament_members (tournament_id, user_id, status) values (tid, me, 'joined')
        on conflict (tournament_id, user_id) do update set status = 'joined';
    else
      update public.tournament_members set status = 'joined' where tournament_id = tid and user_id = me;
      if not found then raise exception 'You need an invite to join this tournament.'; end if;
    end if;
  else
    if t.owner = me then raise exception 'You made this tournament. Delete it instead of leaving.'; end if;
    delete from public.tournament_entries where tournament_id = tid and user_id = me;
    delete from public.tournament_members where tournament_id = tid and user_id = me;
  end if;
end $$;

create or replace function public.enter_catch(tid uuid, cid uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); t public.tournaments; c public.catches; why text;
begin
  select * into t from public.tournaments where id = tid;
  select * into c from public.catches where id = cid and user_id = me;
  if t.id is null or c.id is null then return 'Couldn''t find that tournament or catch.'; end if;
  if not exists (select 1 from public.tournament_members where tournament_id = tid and user_id = me and status = 'joined') then return 'Join the tournament first.'; end if;
  why := private.entry_problem(t, c);
  if why is not null then return why; end if;
  insert into public.tournament_entries (tournament_id, catch_id, user_id) values (tid, cid, me) on conflict do nothing;
  return null;
end $$;

-- enter a new catch into every tournament it qualifies for; returns the tournament names
create or replace function public.auto_enter(cid uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.catches; t public.tournaments; names text[] := '{}';
begin
  select * into c from public.catches where id = cid and user_id = me;
  if c.id is null then return names; end if;
  for t in select tt.* from public.tournaments tt join public.tournament_members m on m.tournament_id = tt.id
           where m.user_id = me and m.status = 'joined' and c.caught_on between tt.starts_on and tt.ends_on loop
    if private.entry_problem(t, c) is null then
      insert into public.tournament_entries (tournament_id, catch_id, user_id) values (t.id, cid, me) on conflict do nothing;
      names := names || t.name;
    end if;
  end loop;
  return names;
end $$;

create or replace function public.withdraw_catch(tid uuid, cid uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.tournament_entries where tournament_id = tid and catch_id = cid and user_id = (select auth.uid());
$$;

-- if a catch is edited so it no longer qualifies, take it out
create or replace function private.recheck_entries() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.tournaments;
begin
  for t in select tt.* from public.tournaments tt join public.tournament_entries e on e.tournament_id = tt.id where e.catch_id = new.id loop
    if private.entry_problem(t, new) is not null then delete from public.tournament_entries where tournament_id = t.id and catch_id = new.id; end if;
  end loop;
  return new;
end $$;
create trigger recheck_entries after update on public.catches for each row execute function private.recheck_entries();

create or replace function public.my_tournaments()
returns table (id uuid, owner uuid, owner_name text, name text, description text, starts_on date, ends_on date, counties text[], area_label text,
  species text[], scoring text, require_photo boolean, open boolean, my_status text, members bigint, entries bigint)
language sql stable security definer set search_path = '' as $$
  select t.id, t.owner, p.display_name, t.name, t.description, t.starts_on, t.ends_on, t.counties, t.area_label, t.species, t.scoring, t.require_photo, t.open,
    (select m.status from public.tournament_members m where m.tournament_id = t.id and m.user_id = (select auth.uid())),
    (select count(*) from public.tournament_members m where m.tournament_id = t.id and m.status = 'joined'),
    (select count(*) from public.tournament_entries e where e.tournament_id = t.id)
  from public.tournaments t join public.profiles p on p.id = t.owner
  where t.open or private.in_tournament(t.id, (select auth.uid()))
  order by t.ends_on desc;
$$;

create or replace function public.tournament_board(tid uuid)
returns table (catch_id uuid, user_id uuid, display_name text, species text, length_in numeric, count int, caught_on date, county text,
  lat double precision, lng double precision, photo_path text, entered_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.user_id, p.display_name, c.species, c.length_in, c.count, c.caught_on, c.county,
    case when c.visibility = 'exact' then c.lat end, case when c.visibility = 'exact' then c.lng end,
    c.photo_path, e.created_at
  from public.tournament_entries e join public.catches c on c.id = e.catch_id join public.profiles p on p.id = c.user_id
  join public.tournaments t on t.id = e.tournament_id
  where e.tournament_id = tid and not c.hidden
    and (t.open or private.in_tournament(tid, (select auth.uid())));
$$;

create or replace function public.tournament_people(tid uuid)
returns table (user_id uuid, display_name text, status text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, p.display_name, m.status from public.tournament_members m join public.profiles p on p.id = m.user_id
  join public.tournaments t on t.id = m.tournament_id
  where m.tournament_id = tid and (t.open or private.in_tournament(tid, (select auth.uid())));
$$;
create or replace function public.creator_overview()
returns table (anglers bigint, public_anglers bigint, catches bigint, fish bigint, trips bigint, tournaments bigint, open_suggestions bigint)
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.profiles), (select count(*) from public.profiles where is_public),
    (select count(*) from public.catches), (select coalesce(sum(count),0) from public.catches),
    (select count(*) from public.trips), (select count(*) from public.tournaments),
    (select count(*) from public.suggestions where status = 'new')
  where private.is_creator((select auth.uid()));
$$;

-- photos: visible to the owner, friends and followers (for shared catches), and tournament members (for entered catches)
drop policy "view own or shared friend photos" on storage.objects;
create policy "view own or shared photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.catches c
      where c.photo_path = storage.objects.name and c.visibility <> 'private' and not c.hidden
        and private.can_see((select auth.uid()), c.user_id))
    or exists (select 1 from public.catches c join public.tournament_entries e on e.catch_id = c.id
      where c.photo_path = storage.objects.name and private.in_tournament(e.tournament_id, (select auth.uid())))));

-- API exposure: signed-in only
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public','private') and p.proname in ('friend_catches','friend_spots','friend_trips','find_anglers','my_follows','all_suggestions',
             'creator_hide_catch','creator_overview','create_tournament','invite_to_tournament','respond_tournament','enter_catch','auto_enter','withdraw_catch',
             'my_tournaments','tournament_board','tournament_people','entry_problem','recheck_entries','guard_profile') loop
    execute format('revoke execute on function %s from anon, public', f.sig);
    if f.sig::text not like 'private.%' then execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
