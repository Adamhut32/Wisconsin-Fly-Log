-- Phase 3: photo fingerprints and fair-play flags, founder analytics (counts only), suggestion triage. Additive only.

alter table public.catches add column if not exists photo_hash text check (photo_hash ~ '^[0-9a-f]{16}$');
alter table public.catches add column if not exists photo_meta jsonb;
alter table public.suggestions add column if not exists category text check (category in ('bug','idea','question','other'));
alter table public.suggestions add column if not exists triage_note text;

create table if not exists public.flags (
  id uuid primary key default gen_random_uuid(),
  catch_id uuid not null references public.catches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('duplicate','no_camera_data','location_mismatch','date_mismatch')),
  detail text,
  other_catch uuid references public.catches(id) on delete set null,
  status text not null default 'open' check (status in ('open','cleared','upheld')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (catch_id, kind)
);
alter table public.flags enable row level security;
create policy "staff read flags" on public.flags for select to authenticated using (private.is_staff((select auth.uid())));

-- 64-bit fingerprints: how many bits differ
create or replace function private.hamming(a text, b text) returns int language sql immutable set search_path = '' as $$
  select bit_count((('x' || a)::bit(64)) # (('x' || b)::bit(64)))::int;
$$;

-- raise flags when a photo arrives or changes (labels only; nothing is blocked or hidden)
create or replace function private.flag_catch() returns trigger language plpgsql security definer set search_path = '' as $$
declare m jsonb := new.photo_meta; dup record; km numeric; gap int;
begin
  if new.photo_path is null then
    delete from public.flags where catch_id = new.id and status = 'open';
    return new;
  end if;
  if tg_op = 'UPDATE' and new.photo_hash is not distinct from old.photo_hash and new.photo_meta is not distinct from old.photo_meta
     and new.caught_on is not distinct from old.caught_on and new.lat is not distinct from old.lat then return new; end if;
  delete from public.flags where catch_id = new.id and status = 'open';
  if new.photo_hash is not null then
    select c.id, c.user_id, c.caught_on into dup from public.catches c
      where c.id <> new.id and c.photo_hash is not null and private.hamming(c.photo_hash, new.photo_hash) <= 6
      order by c.created_at limit 1;
    if dup.id is not null then
      insert into public.flags (catch_id, user_id, kind, detail, other_catch)
      values (new.id, new.user_id, 'duplicate', case when dup.user_id = new.user_id then 'Looks like the same photo as one of their own catches from ' || to_char(dup.caught_on, 'Mon FMDD, YYYY') || '.'
        else 'Looks like the same photo as another angler''s catch from ' || to_char(dup.caught_on, 'Mon FMDD, YYYY') || '.' end, dup.id)
      on conflict (catch_id, kind) do nothing;
    end if;
  end if;
  if m is not null then
    if coalesce((m->>'has_exif')::boolean, false) = false then
      insert into public.flags (catch_id, user_id, kind, detail) values (new.id, new.user_id, 'no_camera_data',
        'The photo has no camera date or location. Screenshots, downloads and edited photos look like this.') on conflict do nothing;
    end if;
    km := nullif(m->>'km_from_entry', '')::numeric;
    if km is not null and km > 5 then
      insert into public.flags (catch_id, user_id, kind, detail) values (new.id, new.user_id, 'location_mismatch',
        'The photo was taken about ' || round(km * 0.621) || ' miles from where the catch is logged.') on conflict do nothing;
    end if;
    if m->>'photo_date' is not null then
      gap := abs((m->>'photo_date')::date - new.caught_on);
      if gap > 1 then
        insert into public.flags (catch_id, user_id, kind, detail) values (new.id, new.user_id, 'date_mismatch',
          'The photo is dated ' || to_char((m->>'photo_date')::date, 'Mon FMDD, YYYY') || ', ' || gap || ' days from the catch date.') on conflict do nothing;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists flag_catch on public.catches;
create trigger flag_catch after insert or update on public.catches for each row execute function private.flag_catch();

-- review queue for the founder and admins
create or replace function public.flag_queue(show text default 'open') returns table(id uuid, catch_id uuid, user_id uuid, display_name text, kind text, detail text, status text, created_at timestamptz,
  species text, length_in numeric, caught_on date, county text, photo_path text, hidden boolean, other_catch uuid, other_photo text, other_name text, tournaments text[])
language sql stable security definer set search_path = '' as $$
  select f.id, f.catch_id, f.user_id, p.display_name, f.kind, f.detail, f.status, f.created_at,
    c.species, c.length_in, c.caught_on, c.county, c.photo_path, c.hidden, f.other_catch, oc.photo_path, op.display_name,
    array(select t.name from public.tournament_entries e join public.tournaments t on t.id = e.tournament_id where e.catch_id = c.id)
  from public.flags f join public.catches c on c.id = f.catch_id join public.profiles p on p.id = f.user_id
  left join public.catches oc on oc.id = f.other_catch left join public.profiles op on op.id = oc.user_id
  where private.is_staff((select auth.uid())) and (show = 'all' or f.status = 'open')
  order by (f.status = 'open') desc, (select count(*) from public.tournament_entries e where e.catch_id = c.id) desc, f.created_at desc
  limit 200;
$$;
-- clear = honest; upheld = hide the catch from feeds and tournaments and tell the angler
create or replace function public.review_flag(fid uuid, verdict text, note text default null) returns void language plpgsql security definer set search_path = '' as $$
declare f public.flags; me uuid := (select auth.uid());
begin
  if not private.is_staff(me) then raise exception 'Only the founder and admins can review flags.'; end if;
  if verdict not in ('cleared','upheld','open') then raise exception 'bad verdict'; end if;
  select * into f from public.flags where id = fid;
  if f.id is null then raise exception 'Flag not found.'; end if;
  update public.flags set status = verdict, reviewed_by = me where catch_id = f.catch_id and (id = fid or verdict = 'cleared');
  if verdict = 'upheld' then
    update public.catches set hidden = true where id = f.catch_id;
    insert into public.notices (user_id, kind, title, body, ref) values (f.user_id, 'fairplay', 'One of your catches was hidden',
      'A reviewer hid this catch from feeds and tournaments' || coalesce(': ' || nullif(trim(note), ''), '.') || ' Send a suggestion if you think this is a mistake.', f.catch_id);
  elsif verdict = 'cleared' then
    update public.catches set hidden = false where id = f.catch_id and hidden;
  end if;
end $$;
-- tournament creators see flags on entries in their own tournaments
create or replace function public.tournament_flags(tid uuid) returns table(catch_id uuid, kind text, detail text, status text)
language sql stable security definer set search_path = '' as $$
  select f.catch_id, f.kind, f.detail, f.status from public.flags f join public.tournament_entries e on e.catch_id = f.catch_id
  join public.tournaments t on t.id = e.tournament_id
  where e.tournament_id = tid and f.status <> 'cleared' and (t.owner = (select auth.uid()) or private.is_staff((select auth.uid())));
$$;

-- gifts carry the fingerprint along
create or replace function public.accept_gift(gid uuid, new_photo_path text, vis text default 'county') returns uuid language plpgsql security definer set search_path = '' as $$
declare g public.catch_gifts; me uuid := (select auth.uid()); cid uuid := gen_random_uuid(); j jsonb;
begin
  select * into g from public.catch_gifts where id = gid and to_user = me and status = 'pending';
  if g.id is null then raise exception 'That fish was already handled or cancelled.'; end if;
  if new_photo_path is not null and (storage.foldername(new_photo_path))[1] <> me::text then raise exception 'bad photo path'; end if;
  if vis not in ('exact','county','private') then vis := 'county'; end if;
  j := g.catch;
  insert into public.catches (id, user_id, lat, lng, county, species, length_in, count, fly, method, caught_on, notes, photo_path, photo_taken_on, visibility, photo_hash, photo_meta)
  values (cid, me, (j->>'lat')::float8, (j->>'lng')::float8, j->>'county', j->>'species', (j->>'length_in')::numeric, coalesce((j->>'count')::int, 1),
          j->>'fly', coalesce(j->>'method', 'fly'), coalesce((j->>'caught_on')::date, current_date), j->>'notes', new_photo_path, (j->>'photo_taken_on')::date, vis,
          case when new_photo_path is not null and j->>'photo_hash' ~ '^[0-9a-f]{16}$' then j->>'photo_hash' end, case when new_photo_path is not null then j->'photo_meta' end);
  update public.catch_gifts set status = 'accepted' where id = gid;
  insert into public.notices (user_id, kind, title, body, ref)
  select g.from_user, 'gift_done', p.display_name || ' accepted the fish you logged', coalesce(j->>'species', 'Fish') || '.', gid from public.profiles p where p.id = me;
  return cid;
end $$;

-- app opens per day (who is only used to count people once a day; the founder only ever sees totals)
create table if not exists public.daily_active (day date not null, user_id uuid not null references public.profiles(id) on delete cascade, opens int not null default 1, primary key (day, user_id));
alter table public.daily_active enable row level security;
create or replace function public.touch_active() returns void language sql security definer set search_path = '' as $$
  insert into public.daily_active (day, user_id) select (now() at time zone 'America/Chicago')::date, (select auth.uid()) where (select auth.uid()) is not null
  on conflict (day, user_id) do update set opens = public.daily_active.opens + 1;
$$;

create or replace function public.founder_stats() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare tz text := 'America/Chicago'; out jsonb;
begin
  if not private.is_creator((select auth.uid())) then return null; end if;
  select jsonb_build_object(
    'accounts', (select jsonb_build_object('approved', count(*) filter (where status = 'approved'), 'pending', count(*) filter (where status = 'pending'),
        'public', count(*) filter (where is_public), 'with_picture', count(*) filter (where avatar_path is not null)) from public.profiles),
    'totals', (select jsonb_build_object('catches', count(*), 'fish', coalesce(sum(count), 0), 'photos', count(photo_path), 'outside_wi', count(*) filter (where county is null and lat is not null)) from public.catches),
    'trips', (select count(*) from public.trips), 'spots', (select count(*) from public.spots),
    'friendships', (select count(*) from public.friendships where status = 'accepted'),
    'tournaments', (select jsonb_build_object('total', count(*), 'live', count(*) filter (where current_date between starts_on and ends_on),
        'upcoming', count(*) filter (where starts_on > current_date), 'finished', count(*) filter (where ends_on < current_date), 'open', count(*) filter (where open),
        'entries', (select count(*) from public.tournament_entries)) from public.tournaments),
    'flags_open', (select count(*) from public.flags where status = 'open'),
    'active_days', (select coalesce(jsonb_agg(jsonb_build_array(d, n) order by d), '[]') from (
        select g::date d, (select count(*) from public.daily_active a where a.day = g::date) n
        from generate_series((now() at time zone tz)::date - 29, (now() at time zone tz)::date, '1 day') g) x),
    'active_7', (select count(distinct user_id) from public.daily_active where day > (now() at time zone tz)::date - 7),
    'active_30', (select count(distinct user_id) from public.daily_active where day > (now() at time zone tz)::date - 30),
    'catch_hours', (select coalesce(jsonb_agg(n order by h), '[]') from (select h, (select count(*) from public.catches c where extract(hour from c.created_at at time zone tz) = h) n from generate_series(0, 23) h) x),
    'catch_weekdays', (select coalesce(jsonb_agg(n order by d), '[]') from (select d, (select count(*) from public.catches c where extract(dow from c.created_at at time zone tz) = d) n from generate_series(0, 6) d) x),
    'signups_weeks', (select coalesce(jsonb_agg(jsonb_build_array(w, n) order by w), '[]') from (
        select date_trunc('week', g)::date w, (select count(*) from public.profiles p where date_trunc('week', p.created_at at time zone tz) = date_trunc('week', g)) n
        from generate_series(date_trunc('week', now() at time zone tz) - interval '11 weeks', date_trunc('week', now() at time zone tz), '1 week') g) x),
    'catches_months', (select coalesce(jsonb_agg(jsonb_build_array(m, n) order by m), '[]') from (
        select to_char(g, 'YYYY-MM') m, (select coalesce(sum(c.count), 0) from public.catches c where to_char(c.caught_on, 'YYYY-MM') = to_char(g, 'YYYY-MM')) n
        from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), '1 month') g) x),
    'species', (select coalesce(jsonb_agg(jsonb_build_array(s, n) order by n desc), '[]') from (select coalesce(nullif(initcap(trim(species)), ''), 'Not given') s, sum(count) n from public.catches group by 1 order by 2 desc limit 10) x),
    'methods', (select coalesce(jsonb_agg(jsonb_build_array(method, n) order by n desc), '[]') from (select method, sum(count) n from public.catches group by 1) x),
    'counties', (select coalesce(jsonb_agg(jsonb_build_array(county, n) order by n desc), '[]') from (select county, sum(count) n from public.catches where county is not null group by 1 order by 2 desc limit 10) x),
    'tournament_months', (select coalesce(jsonb_agg(jsonb_build_array(m, n) order by m), '[]') from (
        select to_char(g, 'YYYY-MM') m, (select count(*) from public.tournaments t where to_char(t.created_at, 'YYYY-MM') = to_char(g, 'YYYY-MM')) n
        from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), '1 month') g) x)
  ) into out;
  return out;
end $$;

revoke execute on function public.flag_queue(text), public.review_flag(uuid, text, text), public.tournament_flags(uuid), public.touch_active(), public.founder_stats(), public.accept_gift(uuid, text, text) from public, anon;
grant execute on function public.flag_queue(text), public.review_flag(uuid, text, text), public.tournament_flags(uuid), public.touch_active(), public.founder_stats(), public.accept_gift(uuid, text, text) to authenticated;
revoke execute on function private.hamming(text, text) from public, anon, authenticated;

-- review polish: tidy notice text; upholding or clearing one flag settles all flags on that catch
create or replace function public.review_flag(fid uuid, verdict text, note text default null) returns void language plpgsql security definer set search_path = '' as $$
declare f public.flags; me uuid := (select auth.uid()); n text := nullif(rtrim(trim(coalesce(note, '')), '.'), '');
begin
  if not private.is_staff(me) then raise exception 'Only the founder and admins can review flags.'; end if;
  if verdict not in ('cleared','upheld','open') then raise exception 'bad verdict'; end if;
  select * into f from public.flags where id = fid;
  if f.id is null then raise exception 'Flag not found.'; end if;
  update public.flags set status = verdict, reviewed_by = me where catch_id = f.catch_id and (id = fid or verdict <> 'open');
  if verdict = 'upheld' then
    update public.catches set hidden = true where id = f.catch_id;
    insert into public.notices (user_id, kind, title, body, ref) values (f.user_id, 'fairplay', 'One of your catches was hidden',
      'A reviewer hid this catch from feeds and tournaments' || coalesce(': ' || n, '') || '. Send a suggestion if you think this is a mistake.', f.catch_id);
  elsif verdict = 'cleared' then
    update public.catches set hidden = false where id = f.catch_id and hidden;
  end if;
end $$;

-- the suggestions inbox shows triage labels
drop function if exists public.all_suggestions();
create function public.all_suggestions() returns table(id uuid, user_id uuid, display_name text, kind text, body text, status text, reply text, created_at timestamptz, category text, triage_note text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.user_id, p.display_name, s.kind, s.body, s.status, s.reply, s.created_at, s.category, s.triage_note
  from public.suggestions s join public.profiles p on p.id = s.user_id
  where private.is_staff((select auth.uid()))
  order by s.created_at desc;
$$;
revoke execute on function public.all_suggestions() from public, anon;
grant execute on function public.all_suggestions() to authenticated;
