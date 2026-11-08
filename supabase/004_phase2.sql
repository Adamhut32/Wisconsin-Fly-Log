-- Phase 2: methods + all species, titles, trip plans, gifts (log a friend's fish),
-- in-app notices, verified open tournaments, and finished-tournament rules. Additive only.

alter table public.catches add column if not exists method text not null default 'fly'
  check (method in ('fly','spin','baitcast','ice','trolling','other'));
alter table public.profiles add column if not exists title text check (char_length(title) <= 40);
alter table public.trips add column if not exists waters jsonb not null default '[]'::jsonb;
alter table public.tournaments add column if not exists methods text[];

-- notices: a small in-app inbox, written only by the database
create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  ref uuid,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notices_user_idx on public.notices(user_id, created_at desc);
alter table public.notices enable row level security;
create policy "read own notices" on public.notices for select to authenticated using (user_id = (select auth.uid()));
create policy "mark own notices" on public.notices for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "clear own notices" on public.notices for delete to authenticated using (user_id = (select auth.uid()));

-- method rule in tournaments
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
  if t.methods is not null and not (c.method = any(t.methods)) then return 'This tournament only counts fish caught ' ||
    case when t.methods = array['fly'] then 'on a fly.' else 'with: ' || array_to_string(t.methods, ', ') || '.' end; end if;
  if t.scoring in ('biggest','top3') and c.length_in is null then return 'Add the fish''s length; this tournament is scored by length.'; end if;
  return null;
end $$;

-- open tournaments: founder or verified anglers; members can't enter or withdraw after the end
drop function if exists public.create_tournament(text, text, date, date, text[], text, text[], text, boolean, boolean, uuid[]);
create or replace function public.create_tournament(p_name text, p_description text, p_starts date, p_ends date, p_counties text[], p_area_label text, p_species text[], p_scoring text, p_require_photo boolean, p_open boolean, p_invite uuid[], p_methods text[] default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare tid uuid; me uuid := (select auth.uid()); u uuid;
begin
  if me is null then raise exception 'sign in first'; end if;
  if not private.is_approved(me) then raise exception 'Your account is waiting for approval.'; end if;
  if p_open and not (private.is_creator(me) or exists (select 1 from public.profiles where id = me and verified)) then
    raise exception 'Only the founder and verified anglers can make open tournaments.'; end if;
  insert into public.tournaments (owner, name, description, starts_on, ends_on, counties, area_label, species, scoring, require_photo, open, methods)
  values (me, p_name, p_description, p_starts, p_ends, nullif(p_counties, '{}'), p_area_label, nullif(p_species, '{}'), p_scoring, p_require_photo, coalesce(p_open, false), nullif(p_methods, '{}'))
  returning id into tid;
  insert into public.tournament_members (tournament_id, user_id, status, invited_by) values (tid, me, 'joined', me);
  foreach u in array coalesce(p_invite, '{}') loop
    if u <> me and private.is_friend(me, u) then
      insert into public.tournament_members (tournament_id, user_id, status, invited_by) values (tid, u, 'invited', me) on conflict do nothing;
    end if;
  end loop;
  return tid;
end $$;
drop policy if exists "owner edits" on public.tournaments;
create policy "owner edits" on public.tournaments for update to authenticated using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()) and ((not open) or private.is_creator((select auth.uid()))
    or exists (select 1 from public.profiles where id = (select auth.uid()) and verified)));

create or replace function public.enter_catch(tid uuid, cid uuid) returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); t public.tournaments; c public.catches; why text;
begin
  select * into t from public.tournaments where id = tid;
  select * into c from public.catches where id = cid and user_id = me;
  if t.id is null or c.id is null then return 'Couldn''t find that tournament or catch.'; end if;
  if t.ends_on < current_date then return 'This tournament is over. Only its creator can change it now.'; end if;
  if not exists (select 1 from public.tournament_members where tournament_id = tid and user_id = me and status = 'joined') then return 'Join the tournament first.'; end if;
  why := private.entry_problem(t, c);
  if why is not null then return why; end if;
  insert into public.tournament_entries (tournament_id, catch_id, user_id) values (tid, cid, me) on conflict do nothing;
  return null;
end $$;
drop function if exists public.withdraw_catch(uuid, uuid);
create or replace function public.withdraw_catch(tid uuid, cid uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.tournaments where id = tid and ends_on < current_date) then
    raise exception 'This tournament is over. Ask its creator to remove the entry.'; end if;
  delete from public.tournament_entries where tournament_id = tid and catch_id = cid and user_id = (select auth.uid());
end $$;
create or replace function public.auto_enter(cid uuid) returns text[] language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.catches; t public.tournaments; names text[] := '{}';
begin
  select * into c from public.catches where id = cid and user_id = me;
  if c.id is null then return names; end if;
  for t in select tt.* from public.tournaments tt join public.tournament_members m on m.tournament_id = tt.id
           where m.user_id = me and m.status = 'joined' and c.caught_on between tt.starts_on and tt.ends_on and tt.ends_on >= current_date loop
    if private.entry_problem(t, c) is null then
      insert into public.tournament_entries (tournament_id, catch_id, user_id) values (t.id, cid, me) on conflict do nothing;
      if found then names := names || t.name; end if;
    end if;
  end loop;
  return names;
end $$;

-- a fish entered in a finished tournament keeps its scoring details
create or replace function private.lock_finished_entries() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.tournament_entries e join public.tournaments t on t.id = e.tournament_id
             where e.catch_id = old.id and t.ends_on < current_date) then
    if tg_op = 'DELETE' then raise exception 'This fish is in a finished tournament, so it can''t be deleted. Ask the tournament creator to remove it first.'; end if;
    if new.length_in is distinct from old.length_in or new.species is distinct from old.species or new.count is distinct from old.count
       or new.caught_on is distinct from old.caught_on or new.photo_path is distinct from old.photo_path or new.photo_taken_on is distinct from old.photo_taken_on
       or new.county is distinct from old.county or new.method is distinct from old.method or new.visibility is distinct from old.visibility then
      raise exception 'This fish is in a finished tournament, so its length, species, count, date, photo and sharing are locked.'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists lock_finished_entries on public.catches;
create trigger lock_finished_entries before update or delete on public.catches for each row execute function private.lock_finished_entries();

-- creator changes: members hear about them
create or replace function private.notify_tournament_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare what text[] := '{}';
begin
  if new.name is distinct from old.name then what := what || ('renamed it to "' || new.name || '"'); end if;
  if new.description is distinct from old.description then what := what || 'updated the description'::text; end if;
  if new.starts_on is distinct from old.starts_on or new.ends_on is distinct from old.ends_on then what := what || ('changed the dates to ' || to_char(new.starts_on, 'Mon FMDD') || '–' || to_char(new.ends_on, 'Mon FMDD')); end if;
  if array_length(what, 1) is null then return new; end if;
  insert into public.notices (user_id, kind, title, body, ref)
  select m.user_id, 'tourney_change', 'Tournament changed: ' || new.name, 'The creator ' || array_to_string(what, ', ') || '.', new.id
  from public.tournament_members m where m.tournament_id = new.id and m.status = 'joined' and m.user_id <> new.owner;
  return new;
end $$;
drop trigger if exists notify_tournament_change on public.tournaments;
create trigger notify_tournament_change after update on public.tournaments for each row execute function private.notify_tournament_change();

create or replace function public.owner_remove_entry(tid uuid, cid uuid, reason text default null) returns void language plpgsql security definer set search_path = '' as $$
declare t public.tournaments; who uuid;
begin
  select * into t from public.tournaments where id = tid;
  if t.owner is distinct from (select auth.uid()) then raise exception 'Only the tournament creator can remove entries.'; end if;
  delete from public.tournament_entries where tournament_id = tid and catch_id = cid returning user_id into who;
  if who is not null and who <> t.owner then
    insert into public.notices (user_id, kind, title, body, ref)
    values (who, 'tourney_change', 'Entry removed: ' || t.name, 'The creator removed one of your fish from this tournament' || coalesce('. Reason: ' || nullif(trim(reason), ''), '') || '.', tid);
  end if;
end $$;

create or replace function public.suggest_tournament_change(tid uuid, body text) returns void language plpgsql security definer set search_path = '' as $$
declare t public.tournaments; me uuid := (select auth.uid()); nm text;
begin
  select * into t from public.tournaments where id = tid;
  if t.id is null or not private.in_tournament(tid, me) then raise exception 'Only members can suggest changes.'; end if;
  if char_length(trim(coalesce(body, ''))) < 3 then raise exception 'Write a few words first.'; end if;
  select display_name into nm from public.profiles where id = me;
  insert into public.notices (user_id, kind, title, body, ref)
  values (t.owner, 'tourney_suggest', nm || ' suggested a change to ' || t.name, left(trim(body), 1000), tid);
end $$;

-- log a fish for a friend: they accept it onto their own log
create table if not exists public.catch_gifts (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  catch jsonb not null,
  photo_path text,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now()
);
create index if not exists catch_gifts_to_idx on public.catch_gifts(to_user, status);
alter table public.catch_gifts enable row level security;
create policy "send gifts to friends" on public.catch_gifts for insert to authenticated
  with check (from_user = (select auth.uid()) and status = 'pending' and private.is_approved(from_user) and private.is_friend(from_user, to_user)
    and (photo_path is null or (storage.foldername(photo_path))[1] = (select auth.uid())::text));
create policy "see my gifts" on public.catch_gifts for select to authenticated using (from_user = (select auth.uid()) or to_user = (select auth.uid()));
create policy "cancel or clear gifts" on public.catch_gifts for delete to authenticated using (from_user = (select auth.uid()) or to_user = (select auth.uid()));

create or replace function private.notify_gift() returns trigger language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  select display_name into nm from public.profiles where id = new.from_user;
  insert into public.notices (user_id, kind, title, body, ref)
  values (new.to_user, 'gift', nm || ' logged a fish for you', coalesce(new.catch->>'species', 'A fish') || coalesce(' · ' || (new.catch->>'length_in') || ' in', '') || '. Accept it to add it to your log.', new.id);
  return new;
end $$;
drop trigger if exists notify_gift on public.catch_gifts;
create trigger notify_gift after insert on public.catch_gifts for each row execute function private.notify_gift();

create or replace function public.accept_gift(gid uuid, new_photo_path text, vis text default 'county') returns uuid language plpgsql security definer set search_path = '' as $$
declare g public.catch_gifts; me uuid := (select auth.uid()); cid uuid := gen_random_uuid(); j jsonb;
begin
  select * into g from public.catch_gifts where id = gid and to_user = me and status = 'pending';
  if g.id is null then raise exception 'That fish was already handled or cancelled.'; end if;
  if new_photo_path is not null and (storage.foldername(new_photo_path))[1] <> me::text then raise exception 'bad photo path'; end if;
  if vis not in ('exact','county','private') then vis := 'county'; end if;
  j := g.catch;
  insert into public.catches (id, user_id, lat, lng, county, species, length_in, count, fly, method, caught_on, notes, photo_path, photo_taken_on, visibility)
  values (cid, me, (j->>'lat')::float8, (j->>'lng')::float8, j->>'county', j->>'species', (j->>'length_in')::numeric, coalesce((j->>'count')::int, 1),
          j->>'fly', coalesce(j->>'method', 'fly'), coalesce((j->>'caught_on')::date, current_date), j->>'notes', new_photo_path, (j->>'photo_taken_on')::date, vis);
  update public.catch_gifts set status = 'accepted' where id = gid;
  insert into public.notices (user_id, kind, title, body, ref)
  select g.from_user, 'gift_done', p.display_name || ' accepted the fish you logged', coalesce(j->>'species', 'Fish') || '.', gid from public.profiles p where p.id = me;
  return cid;
end $$;
create or replace function public.decline_gift(gid uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.catch_gifts set status = 'declined' where id = gid and to_user = (select auth.uid()) and status = 'pending';
end $$;
revoke execute on function public.owner_remove_entry(uuid, uuid, text), public.suggest_tournament_change(uuid, text), public.accept_gift(uuid, text, text), public.decline_gift(uuid) from public, anon;
grant execute on function public.owner_remove_entry(uuid, uuid, text), public.suggest_tournament_change(uuid, text), public.accept_gift(uuid, text, text), public.decline_gift(uuid) to authenticated;

-- the friend can see the gift photo before accepting it (then copies it to their own folder)
drop policy if exists "view own or shared photos" on storage.objects;
create policy "view own or shared photos" on storage.objects for select to authenticated using (
  bucket_id = 'photos' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.catches c where c.photo_path = objects.name and c.visibility <> 'private' and not c.hidden and private.can_see((select auth.uid()), c.user_id))
    or exists (select 1 from public.catches c join public.tournament_entries e on e.catch_id = c.id where c.photo_path = objects.name and private.in_tournament(e.tournament_id, (select auth.uid())))
    or exists (select 1 from public.catch_gifts g where g.photo_path = objects.name and g.to_user = (select auth.uid()) and g.status = 'pending')));

-- my_tournaments also returns the method rule
drop function if exists public.my_tournaments();
create function public.my_tournaments() returns table(id uuid, owner uuid, owner_name text, name text, description text, starts_on date, ends_on date, counties text[], area_label text, species text[], scoring text, require_photo boolean, open boolean, my_status text, members bigint, entries bigint, methods text[])
language sql stable security definer set search_path = '' as $$
  select t.id, t.owner, p.display_name, t.name, t.description, t.starts_on, t.ends_on, t.counties, t.area_label, t.species, t.scoring, t.require_photo, t.open,
    (select m.status from public.tournament_members m where m.tournament_id = t.id and m.user_id = (select auth.uid())),
    (select count(*) from public.tournament_members m where m.tournament_id = t.id and m.status = 'joined'),
    (select count(*) from public.tournament_entries e where e.tournament_id = t.id),
    t.methods
  from public.tournaments t join public.profiles p on p.id = t.owner
  where (t.open and private.is_approved((select auth.uid()))) or private.in_tournament(t.id, (select auth.uid()))
  order by t.ends_on desc;
$$;
revoke execute on function public.my_tournaments() from public, anon;
grant execute on function public.my_tournaments() to authenticated;

revoke execute on function public.create_tournament(text, text, date, date, text[], text, text[], text, boolean, boolean, uuid[], text[]), public.withdraw_catch(uuid, uuid) from public, anon;
grant execute on function public.create_tournament(text, text, date, date, text[], text, text[], text, boolean, boolean, uuid[], text[]), public.withdraw_catch(uuid, uuid) to authenticated;
