-- Share a spot with only some friends: spots.share_with lists who can see it (null = everyone who can see your shared spots)
alter table public.spots add column if not exists share_with uuid[];

create or replace function public.friend_spots()
returns table(id uuid, user_id uuid, display_name text, name text, county text, lat double precision, lng double precision, water text, trout_class text, status text, exact boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.user_id, p.display_name,
    case when s.visibility = 'exact' then s.name else coalesce(s.water, 'Spot') end,
    s.county,
    case when s.visibility = 'exact' then s.lat end, case when s.visibility = 'exact' then s.lng end,
    s.water, s.trout_class, s.status, s.visibility = 'exact'
  from public.spots s join public.profiles p on p.id = s.user_id
  where s.visibility <> 'private' and private.can_see((select auth.uid()), s.user_id)
    and (s.share_with is null or (select auth.uid()) = any(s.share_with));
$$;
