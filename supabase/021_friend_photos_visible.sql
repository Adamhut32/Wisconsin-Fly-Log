-- Friends' photos never loaded: the photo rule looked up the catch, but people may only read their own catches,
-- so the lookup always came back empty. The same checks now run in a function that can see the catch.
create or replace function private.can_view_photo(viewer uuid, path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    exists (select 1 from public.catches c
      where (c.photo_path = path or c.more_photos @> jsonb_build_array(jsonb_build_object('p', path)))
        and private.shown_to(viewer, c.visibility, c.share_with) and not c.hidden and private.can_see(viewer, c.user_id))
    or exists (select 1 from public.catches c join public.tournament_entries e on e.catch_id = c.id
      where (c.photo_path = path or c.more_photos @> jsonb_build_array(jsonb_build_object('p', path)))
        and private.in_tournament(e.tournament_id, viewer))
    or exists (select 1 from public.catch_gifts g where g.photo_path = path and g.to_user = viewer and g.status = 'pending')
    or exists (select 1 from public.trip_photos tp where tp.path = path and private.in_trip(tp.trip_id, viewer))
    or exists (select 1 from public.catches c, public.trips t
      where (c.photo_path = path or c.more_photos @> jsonb_build_array(jsonb_build_object('p', path)))
        and private.shown_to(viewer, c.visibility, c.share_with) and not c.hidden
        and private.in_trip(t.id, viewer) and private.in_trip(t.id, c.user_id)
        and ((c.caught_on between t.start_date and t.end_date) or c.trip_id = t.id));
$$;
revoke execute on function private.can_view_photo(uuid, text) from public, anon;
grant execute on function private.can_view_photo(uuid, text) to authenticated;
alter policy "view own or shared photos" on storage.objects using (
  bucket_id = 'photos' and (
    (storage.foldername(name))[1] = ((select auth.uid()))::text
    or private.can_view_photo((select auth.uid()), name)));
