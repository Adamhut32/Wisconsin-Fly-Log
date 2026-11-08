-- the creek, river or lake a catch came from (filled in from its location; editable)
alter table public.catches add column if not exists water text check (char_length(water) <= 120);
-- gifts carry the water name along (same as 005 otherwise)
create or replace function public.accept_gift(gid uuid, new_photo_path text, vis text default 'county') returns uuid language plpgsql security definer set search_path = '' as $$
declare g public.catch_gifts; me uuid := (select auth.uid()); cid uuid := gen_random_uuid(); j jsonb;
begin
  select * into g from public.catch_gifts where id = gid and to_user = me and status = 'pending';
  if g.id is null then raise exception 'That fish was already handled or cancelled.'; end if;
  if new_photo_path is not null and (storage.foldername(new_photo_path))[1] <> me::text then raise exception 'bad photo path'; end if;
  if vis not in ('exact','county','private') then vis := 'county'; end if;
  j := g.catch;
  insert into public.catches (id, user_id, lat, lng, county, species, length_in, count, fly, method, caught_on, notes, photo_path, photo_taken_on, visibility, photo_hash, photo_meta, water)
  values (cid, me, (j->>'lat')::float8, (j->>'lng')::float8, j->>'county', j->>'species', (j->>'length_in')::numeric, coalesce((j->>'count')::int, 1),
          j->>'fly', coalesce(j->>'method', 'fly'), coalesce((j->>'caught_on')::date, current_date), j->>'notes', new_photo_path, (j->>'photo_taken_on')::date, vis,
          case when new_photo_path is not null and j->>'photo_hash' ~ '^[0-9a-f]{16}$' then j->>'photo_hash' end, case when new_photo_path is not null then j->'photo_meta' end,
          left(nullif(trim(j->>'water'), ''), 120));
  update public.catch_gifts set status = 'accepted' where id = gid;
  insert into public.notices (user_id, kind, title, body, ref)
  select g.from_user, 'gift_done', p.display_name || ' accepted the fish you logged', coalesce(j->>'species', 'Fish') || '.', gid from public.profiles p where p.id = me;
  return cid;
end $$;
