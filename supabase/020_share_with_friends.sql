-- Share catches with only some friends (like spots already could), and let chosen friends see the exact place
-- of a catch or spot that everyone else only sees by county.
--   share_with: null = everyone who can see your catches; otherwise only these friends (followers don't)
--   exact_for:  friends who get the exact place even when the catch/spot is set to "County only"
alter table public.catches add column if not exists share_with uuid[];
alter table public.catches add column if not exists exact_for uuid[];
alter table public.spots add column if not exists exact_for uuid[];

create or replace function private.shown_to(viewer uuid, vis text, share uuid[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(vis, 'private') <> 'private' and (share is null or viewer = any(share));
$$;
create or replace function private.exact_to(viewer uuid, vis text, ex uuid[]) returns boolean
language sql immutable set search_path = '' as $$
  select vis = 'exact' or (coalesce(vis, 'private') <> 'private' and ex is not null and viewer = any(ex));
$$;
grant execute on function private.shown_to(uuid, text, uuid[]) to authenticated;
grant execute on function private.exact_to(uuid, text, uuid[]) to authenticated;

create or replace function public.friend_catches()
 returns table(id uuid, user_id uuid, display_name text, rel text, trip_id uuid, trip_name text, species text, length_in numeric, count integer, fly text, caught_on date, county text, lat double precision, lng double precision, notes text, photo_path text, exact boolean, created_at timestamp with time zone, weight_lb numeric, method text, water text, before_join boolean, more_photos text[])
 language sql stable security definer set search_path to '' as $function$
  select c.id, c.user_id, p.display_name,
    case when private.is_friend(v.me, c.user_id) then 'friend' else 'following' end,
    c.trip_id, case when t.shared then t.name end, c.species, c.length_in,
    c.count, c.fly, c.caught_on, c.county,
    case when x.ex then c.lat end, case when x.ex then c.lng end,
    case when x.ex then c.notes end,
    c.photo_path, x.ex, c.created_at,
    c.weight_lb, c.method, case when x.ex then c.water end,
    c.caught_on < (p.created_at at time zone 'America/Chicago')::date,
    case when c.more_photos is not null then array(select y->>'p' from jsonb_array_elements(c.more_photos) y) end
  from (select (select auth.uid()) as me) v
  cross join public.catches c
  join public.profiles p on p.id = c.user_id
  left join public.trips t on t.id = c.trip_id
  cross join lateral (select private.exact_to(v.me, c.visibility, c.exact_for) as ex) x
  where private.shown_to(v.me, c.visibility, c.share_with) and not c.hidden and private.can_see(v.me, c.user_id)
  order by c.caught_on desc, c.created_at desc
  limit 1000;
$function$;

create or replace function public.friend_spots()
 returns table(id uuid, user_id uuid, display_name text, name text, county text, lat double precision, lng double precision, water text, trout_class text, status text, exact boolean)
 language sql stable security definer set search_path to '' as $function$
  select s.id, s.user_id, p.display_name,
    case when x.ex then s.name else coalesce(s.water, 'Spot') end,
    s.county,
    case when x.ex then s.lat end, case when x.ex then s.lng end,
    s.water, s.trout_class, s.status, x.ex
  from (select (select auth.uid()) as me) v
  cross join public.spots s join public.profiles p on p.id = s.user_id
  cross join lateral (select private.exact_to(v.me, s.visibility, s.exact_for) as ex) x
  where private.shown_to(v.me, s.visibility, s.share_with) and private.can_see(v.me, s.user_id);
$function$;

-- photos follow the same sharing
alter policy "view own or shared photos" on storage.objects using (
  (bucket_id = 'photos') and (
    ((storage.foldername(name))[1] = ((select auth.uid()))::text)
    or exists (select 1 from public.catches c
      where (c.photo_path = objects.name or c.more_photos @> jsonb_build_array(jsonb_build_object('p', objects.name)))
        and private.shown_to((select auth.uid()), c.visibility, c.share_with) and not c.hidden and private.can_see((select auth.uid()), c.user_id))
    or exists (select 1 from public.catches c join public.tournament_entries e on e.catch_id = c.id
      where (c.photo_path = objects.name or c.more_photos @> jsonb_build_array(jsonb_build_object('p', objects.name)))
        and private.in_tournament(e.tournament_id, (select auth.uid())))
    or exists (select 1 from public.catch_gifts g where g.photo_path = objects.name and g.to_user = (select auth.uid()) and g.status = 'pending')
    or exists (select 1 from public.trip_photos tp where tp.path = objects.name and private.in_trip(tp.trip_id, (select auth.uid())))
    or exists (select 1 from public.catches c, public.trips t
      where (c.photo_path = objects.name or c.more_photos @> jsonb_build_array(jsonb_build_object('p', objects.name)))
        and private.shown_to((select auth.uid()), c.visibility, c.share_with) and not c.hidden
        and private.in_trip(t.id, (select auth.uid())) and private.in_trip(t.id, c.user_id)
        and ((c.caught_on between t.start_date and t.end_date) or c.trip_id = t.id))));

-- trips and new-catch notifications follow the same sharing (applied as 020b)
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.trip_group(uuid)'::regprocedure);
  d := replace(d, $a$c.visibility = 'exact'$a$, $a$private.exact_to(me, c.visibility, c.exact_for)$a$);
  d := replace(d, $a$c.visibility <> 'private'$a$, $a$private.shown_to(me, c.visibility, c.share_with)$a$);
  execute d;
  d := pg_get_functiondef('private.catch_alert()'::regprocedure);
  d := replace(d, $a$continue when private.blocked_between(f, new.user_id);$a$,
                  $a$continue when private.blocked_between(f, new.user_id);
    continue when new.share_with is not null and not (f = any(new.share_with));$a$);
  execute d;
end $do$;
