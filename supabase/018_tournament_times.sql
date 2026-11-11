-- Tournaments with a time of day, and a window for sending in fish after the fishing ends.
--  * start_time / end_time (Wisconsin time) are optional: without them a tournament runs from the start of its first day
--    to the end of its last day, as before.
--  * submit_hours: how long after the fishing ends anglers can still enter or change fish (0 to 72, set by the creator).
--    After that the tournament is finished and its rules and entries are locked.
--  * "Finished" used to be worked out on the server's clock (UTC), which closed tournaments at 6 or 7 pm Wisconsin time
--    on their last day. Everything now uses Wisconsin time.
alter table public.tournaments add column if not exists start_time time, add column if not exists end_time time,
  add column if not exists submit_hours int not null default 24;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tournaments_submit_hours') then
    alter table public.tournaments add constraint tournaments_submit_hours check (submit_hours between 0 and 72); end if;
  if not exists (select 1 from pg_constraint where conname = 'tournaments_times_order') then
    alter table public.tournaments add constraint tournaments_times_order check (starts_on < ends_on or start_time is null or end_time is null or end_time > start_time); end if;
end $$;
-- the clock time stamped in the catch photo (the camera's own time), for tournaments with set hours
alter table public.catches add column if not exists photo_time time;

create or replace function private.tourney_start(t public.tournaments) returns timestamptz language sql stable set search_path = '' as $$
  select (t.starts_on + coalesce(t.start_time, time '00:00')) at time zone 'America/Chicago';
$$;
create or replace function private.tourney_fish_end(t public.tournaments) returns timestamptz language sql stable set search_path = '' as $$
  select case when t.end_time is null then ((t.ends_on + 1)::timestamp) else (t.ends_on + t.end_time) end at time zone 'America/Chicago';
$$;
create or replace function private.tourney_deadline(t public.tournaments) returns timestamptz language sql stable set search_path = '' as $$
  select private.tourney_fish_end(t) + make_interval(hours => coalesce(t.submit_hours, 0));
$$;
revoke all on function private.tourney_start(public.tournaments), private.tourney_fish_end(public.tournaments), private.tourney_deadline(public.tournaments) from public, anon, authenticated;

create or replace function private.entry_problem(t public.tournaments, c public.catches) returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if c.caught_on < t.starts_on or c.caught_on > t.ends_on then return 'The catch date is outside the tournament dates.'; end if;
  if c.count < 1 then return 'Log at least one fish to enter.'; end if;
  if c.visibility = 'private' then return 'Private catches can''t be entered. Change it to County only or Exact spot.'; end if;
  if t.require_photo and c.photo_path is null then return 'This tournament needs a photo of the fish.'; end if;
  if t.require_photo and (c.photo_taken_on is null or c.photo_taken_on < t.starts_on or c.photo_taken_on > t.ends_on)
    then return 'The photo has to be taken during the tournament. This one has no date, or a date outside it.'; end if;
  -- set hours: with photos, the photo's own clock time decides; without, the fish can't have been logged before the start
  if t.start_time is not null or t.end_time is not null then
    if t.require_photo then
      if c.photo_time is null then return 'This tournament has set hours, and this photo has no time stamp. Use a photo straight from your camera.'; end if;
      if t.start_time is not null and c.photo_taken_on = t.starts_on and c.photo_time < t.start_time
        then return 'The photo was taken before the tournament started (' || trim(to_char(t.start_time, 'FMHH12:MI am')) || ').'; end if;
      if t.end_time is not null and c.photo_taken_on = t.ends_on and c.photo_time > t.end_time
        then return 'The photo was taken after the tournament ended (' || trim(to_char(t.end_time, 'FMHH12:MI am')) || ').'; end if;
    elsif c.created_at < private.tourney_start(t) then return 'This fish was logged before the tournament started.';
    end if;
  end if;
  if t.counties is not null and (c.county is null or not (c.county = any(t.counties))) then return 'The catch is outside the tournament area.'; end if;
  if t.species is not null and (c.species is null or not exists (select 1 from unnest(t.species) s where lower(c.species) = lower(s)))
    then return 'That species doesn''t count in this tournament.'; end if;
  if t.methods is not null and not (c.method = any(t.methods)) then return 'This tournament only counts fish caught ' ||
    case when t.methods = array['fly'] then 'on a fly.' else 'with: ' || array_to_string(t.methods, ', ') || '.' end; end if;
  if t.scoring in ('biggest','top3') and c.length_in is null then return 'Add the fish''s length; this tournament is scored by length.'; end if;
  return null;
end $$;

create or replace function public.enter_catch(tid uuid, cid uuid) returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); t public.tournaments; c public.catches; why text;
begin
  select * into t from public.tournaments where id = tid;
  select * into c from public.catches where id = cid and user_id = me;
  if t.id is null or c.id is null then return 'Couldn''t find that tournament or catch.'; end if;
  if now() > private.tourney_deadline(t) then return 'This tournament is over. Only its creator can change it now.'; end if;
  if now() < private.tourney_start(t) then return 'This tournament hasn''t started yet.'; end if;
  if not exists (select 1 from public.tournament_members where tournament_id = tid and user_id = me and status = 'joined') then return 'Join the tournament first.'; end if;
  why := private.entry_problem(t, c);
  if why is not null then return why; end if;
  insert into public.tournament_entries (tournament_id, catch_id, user_id) values (tid, cid, me) on conflict do nothing;
  return null;
end $$;

create or replace function public.auto_enter(cid uuid) returns text[] language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.catches; t public.tournaments; names text[] := '{}';
begin
  select * into c from public.catches where id = cid and user_id = me;
  if c.id is null then return names; end if;
  for t in select tt.* from public.tournaments tt join public.tournament_members m on m.tournament_id = tt.id
           where m.user_id = me and m.status = 'joined' and c.caught_on between tt.starts_on and tt.ends_on
             and now() <= private.tourney_deadline(tt) and now() >= private.tourney_start(tt) loop
    if private.entry_problem(t, c) is null then
      insert into public.tournament_entries (tournament_id, catch_id, user_id) values (t.id, cid, me) on conflict do nothing;
      if found then names := names || t.name; end if;
    end if;
  end loop;
  return names;
end $$;

create or replace function public.withdraw_catch(tid uuid, cid uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.tournaments t where t.id = tid and now() > private.tourney_deadline(t)) then
    raise exception 'This tournament is over. Ask its creator to remove the entry.'; end if;
  delete from public.tournament_entries where tournament_id = tid and catch_id = cid and user_id = (select auth.uid());
end $$;

create or replace function private.lock_finished_entries() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.tournament_entries e join public.tournaments t on t.id = e.tournament_id
             where e.catch_id = old.id and now() > private.tourney_deadline(t)) then
    if tg_op = 'DELETE' then raise exception 'This fish is in a finished tournament, so it can''t be deleted. Ask the tournament creator to remove it first.'; end if;
    if new.length_in is distinct from old.length_in or new.species is distinct from old.species or new.count is distinct from old.count
       or new.caught_on is distinct from old.caught_on or new.photo_path is distinct from old.photo_path or new.photo_taken_on is distinct from old.photo_taken_on
       or new.photo_time is distinct from old.photo_time or new.more_photos is distinct from old.more_photos
       or new.county is distinct from old.county or new.method is distinct from old.method or new.visibility is distinct from old.visibility then
      raise exception 'This fish is in a finished tournament, so its length, species, count, date, photos and sharing are locked.'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- once a tournament is finished its rules can't be rewritten (the name and description still can)
create or replace function private.lock_finished_rules() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('coulee.tourney_setup', true), '') = '1' then return new; end if;   -- still being created
  if now() > private.tourney_deadline(old) and (new.starts_on is distinct from old.starts_on or new.ends_on is distinct from old.ends_on
     or new.start_time is distinct from old.start_time or new.end_time is distinct from old.end_time or new.submit_hours is distinct from old.submit_hours
     or new.counties is distinct from old.counties or new.species is distinct from old.species or new.methods is distinct from old.methods
     or new.scoring is distinct from old.scoring or new.require_photo is distinct from old.require_photo) then
    raise exception 'This tournament is finished, so its dates and rules are locked.';
  end if;
  return new;
end $$;
create or replace trigger lock_finished_rules before update on public.tournaments for each row execute function private.lock_finished_rules();

create or replace function private.notify_tournament_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare what text[] := '{}';
begin
  if new.name is distinct from old.name then what := what || ('renamed it to "' || new.name || '"'); end if;
  if new.description is distinct from old.description then what := what || 'updated the description'::text; end if;
  if new.starts_on is distinct from old.starts_on or new.ends_on is distinct from old.ends_on then what := what || ('changed the dates to ' || to_char(new.starts_on, 'Mon FMDD') || '–' || to_char(new.ends_on, 'Mon FMDD')); end if;
  if new.start_time is distinct from old.start_time or new.end_time is distinct from old.end_time then what := what || ('changed the hours to ' ||
    coalesce(trim(to_char(new.start_time, 'FMHH12:MI am')), 'the start of the first day') || ' – ' || coalesce(trim(to_char(new.end_time, 'FMHH12:MI am')), 'the end of the last day')); end if;
  if new.submit_hours is distinct from old.submit_hours then what := what || ('changed how long fish can be sent in afterward to ' || new.submit_hours || ' hours'); end if;
  if array_length(what, 1) is null then return new; end if;
  insert into public.notices (user_id, kind, title, body, ref)
  select m.user_id, 'tourney_change', 'Tournament changed: ' || new.name, 'The creator ' || array_to_string(what, ', ') || '.', new.id
  from public.tournament_members m where m.tournament_id = new.id and m.status = 'joined' and m.user_id <> new.owner;
  return new;
end $$;

-- new versions of the two calls the app makes (the old ones stay for older versions of the app)
create or replace function public.my_tournaments_v2()
returns table(id uuid, owner uuid, owner_name text, name text, description text, starts_on date, ends_on date, counties text[], area_label text, species text[], scoring text,
  require_photo boolean, open boolean, my_status text, members bigint, entries bigint, methods text[], start_time time, end_time time, submit_hours int,
  starts_at timestamptz, fish_ends_at timestamptz, closes_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.id, t.owner, p.display_name, t.name, t.description, t.starts_on, t.ends_on, t.counties, t.area_label, t.species, t.scoring, t.require_photo, t.open,
    (select m.status from public.tournament_members m where m.tournament_id = t.id and m.user_id = (select auth.uid())),
    (select count(*) from public.tournament_members m where m.tournament_id = t.id and m.status = 'joined'),
    (select count(*) from public.tournament_entries e where e.tournament_id = t.id),
    t.methods, t.start_time, t.end_time, t.submit_hours, private.tourney_start(t), private.tourney_fish_end(t), private.tourney_deadline(t)
  from public.tournaments t join public.profiles p on p.id = t.owner
  where (t.open and private.is_approved((select auth.uid()))) or private.in_tournament(t.id, (select auth.uid()))
  order by t.ends_on desc;
$$;
revoke all on function public.my_tournaments_v2() from public, anon;
grant execute on function public.my_tournaments_v2() to authenticated;

create or replace function public.create_tournament_v2(p_name text, p_description text, p_starts date, p_ends date, p_counties text[], p_area_label text, p_species text[], p_scoring text,
  p_require_photo boolean, p_open boolean, p_invite uuid[], p_methods text[], p_start_time time, p_end_time time, p_submit_hours int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare tid uuid;
begin
  if p_starts = p_ends and p_start_time is not null and p_end_time is not null and p_end_time <= p_start_time then raise exception 'The end time has to be after the start time.'; end if;
  tid := public.create_tournament(p_name, p_description, p_starts, p_ends, p_counties, p_area_label, p_species, p_scoring, p_require_photo, p_open, p_invite, p_methods);
  perform set_config('coulee.tourney_setup', '1', true);
  update public.tournaments set start_time = p_start_time, end_time = p_end_time, submit_hours = least(72, greatest(0, coalesce(p_submit_hours, 24))) where id = tid;
  perform set_config('coulee.tourney_setup', '', true);
  return tid;
end $$;
revoke all on function public.create_tournament_v2(text, text, date, date, text[], text, text[], text, boolean, boolean, uuid[], text[], time, time, int) from public, anon;
grant execute on function public.create_tournament_v2(text, text, date, date, text[], text, text[], text, boolean, boolean, uuid[], text[], time, time, int) to authenticated;
