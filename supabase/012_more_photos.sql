-- Up to 2 photos per fish: photo_path stays the main photo (tournaments, map pin, date and place checks);
-- more_photos holds one extra photo as [{ "p": path, "h": fingerprint }].
alter table public.catches add column if not exists more_photos jsonb;
alter table public.catches drop constraint if exists more_photos_shape;
alter table public.catches add constraint more_photos_shape check (
  more_photos is null or (jsonb_typeof(more_photos) = 'array' and jsonb_array_length(more_photos) <= 1));

-- every photo path of a catch, and every fingerprint
create or replace function private.catch_paths(c public.catches) returns text[] language sql immutable set search_path = '' as $$
  select array_remove(array[c.photo_path] || coalesce(array(select x->>'p' from jsonb_array_elements(coalesce(c.more_photos, '[]'::jsonb)) x), '{}'), null);
$$;
create or replace function private.catch_hashes(c public.catches) returns text[] language sql immutable set search_path = '' as $$
  select array(select h from unnest(array[c.photo_hash] || coalesce(array(select x->>'h' from jsonb_array_elements(coalesce(c.more_photos, '[]'::jsonb)) x), '{}')) h
               where h ~ '^[0-9a-f]{16}$');
$$;

-- extra photos must live in the angler's own folder
create or replace function private.check_more_photos() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.more_photos is not null and exists (select 1 from jsonb_array_elements(new.more_photos) x
       where coalesce(x->>'p', '') = '' or (storage.foldername(x->>'p'))[1] <> new.user_id::text) then
    raise exception 'bad photo path';
  end if;
  if new.more_photos = '[]'::jsonb then new.more_photos := null; end if;
  return new;
end $$;
drop trigger if exists check_more_photos on public.catches;
create trigger check_more_photos before insert or update of more_photos on public.catches for each row execute function private.check_more_photos();

-- duplicate check covers every photo on both sides
create or replace function private.flag_catch() returns trigger language plpgsql security definer set search_path = '' as $$
declare m jsonb := new.photo_meta; dup record; km numeric; gap int; mine text[] := private.catch_hashes(new);
begin
  if new.photo_path is null and new.more_photos is null then
    delete from public.flags where catch_id = new.id and status = 'open';
    return new;
  end if;
  if tg_op = 'UPDATE' and new.photo_hash is not distinct from old.photo_hash and new.photo_meta is not distinct from old.photo_meta
     and new.more_photos is not distinct from old.more_photos
     and new.caught_on is not distinct from old.caught_on and new.lat is not distinct from old.lat then return new; end if;
  delete from public.flags where catch_id = new.id and status = 'open';
  if cardinality(mine) > 0 then
    select c.id, c.user_id, c.caught_on into dup from public.catches c
      where c.id <> new.id and (c.photo_hash is not null or c.more_photos is not null)
        and exists (select 1 from unnest(private.catch_hashes(c)) a, unnest(mine) b where private.hamming(a, b) <= 6)
      order by c.created_at limit 1;
    if dup.id is not null then
      insert into public.flags (catch_id, user_id, kind, detail, other_catch)
      values (new.id, new.user_id, 'duplicate', case when dup.user_id = new.user_id then 'Looks like the same photo as one of their own catches from ' || to_char(dup.caught_on, 'Mon FMDD, YYYY') || '.'
        else 'Looks like the same photo as another angler''s catch from ' || to_char(dup.caught_on, 'Mon FMDD, YYYY') || '.' end, dup.id)
      on conflict (catch_id, kind) do nothing;
    end if;
  end if;
  if m is not null and new.photo_path is not null then
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

-- finished tournament fish: extra photos are locked too
create or replace function private.lock_finished_entries() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.tournament_entries e join public.tournaments t on t.id = e.tournament_id
             where e.catch_id = old.id and t.ends_on < current_date) then
    if tg_op = 'DELETE' then raise exception 'This fish is in a finished tournament, so it can''t be deleted. Ask the tournament creator to remove it first.'; end if;
    if new.length_in is distinct from old.length_in or new.species is distinct from old.species or new.count is distinct from old.count
       or new.caught_on is distinct from old.caught_on or new.photo_path is distinct from old.photo_path or new.photo_taken_on is distinct from old.photo_taken_on
       or new.more_photos is distinct from old.more_photos
       or new.county is distinct from old.county or new.method is distinct from old.method or new.visibility is distinct from old.visibility then
      raise exception 'This fish is in a finished tournament, so its length, species, count, date, photos and sharing are locked.'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- friends see the extra photos (paths only; fingerprints stay private)
drop function if exists public.friend_catches();
create function public.friend_catches() returns table(id uuid, user_id uuid, display_name text, rel text, trip_id uuid, trip_name text, species text, length_in numeric, count integer, fly text, caught_on date, county text, lat double precision, lng double precision, notes text, photo_path text, exact boolean, created_at timestamptz, weight_lb numeric, method text, water text, before_join boolean, more_photos text[])
language sql stable security definer set search_path = '' as $$
  select c.id, c.user_id, p.display_name,
    case when private.is_friend((select auth.uid()), c.user_id) then 'friend' else 'following' end,
    c.trip_id, case when t.shared then t.name end, c.species, c.length_in,
    c.count, c.fly, c.caught_on, c.county,
    case when c.visibility = 'exact' then c.lat end, case when c.visibility = 'exact' then c.lng end,
    case when c.visibility = 'exact' then c.notes end,
    c.photo_path, c.visibility = 'exact', c.created_at,
    c.weight_lb, c.method, case when c.visibility = 'exact' then c.water end,
    c.caught_on < (p.created_at at time zone 'America/Chicago')::date,
    case when c.more_photos is not null then array(select x->>'p' from jsonb_array_elements(c.more_photos) x) end
  from public.catches c
  join public.profiles p on p.id = c.user_id
  left join public.trips t on t.id = c.trip_id
  where c.visibility <> 'private' and not c.hidden and private.can_see((select auth.uid()), c.user_id)
  order by c.caught_on desc, c.created_at desc
  limit 1000;
$$;
grant execute on function public.friend_catches() to authenticated;

-- photo viewing: any photo of a catch you can see
drop policy if exists "view own or shared photos" on storage.objects;
create policy "view own or shared photos" on storage.objects for select using (
  bucket_id = 'photos' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.catches c where (c.photo_path = objects.name or c.more_photos @> jsonb_build_array(jsonb_build_object('p', objects.name)))
               and c.visibility <> 'private' and not c.hidden and private.can_see((select auth.uid()), c.user_id))
    or exists (select 1 from public.catches c join public.tournament_entries e on e.catch_id = c.id
               where (c.photo_path = objects.name or c.more_photos @> jsonb_build_array(jsonb_build_object('p', objects.name)))
               and private.in_tournament(e.tournament_id, (select auth.uid())))
    or exists (select 1 from public.catch_gifts g where g.photo_path = objects.name and g.to_user = (select auth.uid()) and g.status = 'pending')));
create index if not exists catches_more_photos on public.catches using gin (more_photos jsonb_path_ops);
revoke all on function private.catch_paths(public.catches), private.catch_hashes(public.catches), private.check_more_photos() from public, anon, authenticated;
