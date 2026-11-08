-- find anglers by name to send a friend request (approved accounts only; anyone can opt out with findable = false)
alter table public.profiles add column if not exists findable boolean not null default true;
create or replace function public.search_people(q text) returns table(id uuid, display_name text, avatar_path text, title text, relation text, mutual bigint)
language sql stable security definer set search_path = '' as $$
  with me as (select (select auth.uid()) id)
  select p.id, p.display_name, p.avatar_path, p.title,
    coalesce((select case when f.status = 'accepted' then 'friend' when f.requester = me.id then 'sent' else 'received' end
              from public.friendships f where (f.requester = me.id and f.addressee = p.id) or (f.requester = p.id and f.addressee = me.id) limit 1), 'none'),
    (select count(*) from public.profiles x where x.id <> p.id and x.id <> me.id and private.is_friend(me.id, x.id) and private.is_friend(p.id, x.id))
  from public.profiles p, me
  where private.is_approved(me.id) and char_length(trim(coalesce(q, ''))) >= 2
    and p.id <> me.id and p.status = 'approved' and p.findable
    and not private.blocked_between(me.id, p.id)
    and p.display_name ilike '%' || replace(replace(trim(q), '%', ''), '_', '') || '%'
  order by (p.display_name ilike trim(q) || '%') desc, p.display_name
  limit 30;
$$;
revoke execute on function public.search_people(text) from public, anon;
grant execute on function public.search_people(text) to authenticated;

-- strip LIKE wildcards so a search can't list everyone
create or replace function public.search_people(q text) returns table(id uuid, display_name text, avatar_path text, title text, relation text, mutual bigint)
language sql stable security definer set search_path = '' as $$
  with me as (select (select auth.uid()) id), s as (select trim(regexp_replace(coalesce(q, ''), '[%_\\]', '', 'g')) t)
  select p.id, p.display_name, p.avatar_path, p.title,
    coalesce((select case when f.status = 'accepted' then 'friend' when f.requester = me.id then 'sent' else 'received' end
              from public.friendships f where (f.requester = me.id and f.addressee = p.id) or (f.requester = p.id and f.addressee = me.id) limit 1), 'none'),
    (select count(*) from public.profiles x where x.id <> p.id and x.id <> me.id and private.is_friend(me.id, x.id) and private.is_friend(p.id, x.id))
  from public.profiles p, me, s
  where private.is_approved(me.id) and char_length(s.t) >= 2
    and p.id <> me.id and p.status = 'approved' and p.findable
    and not private.blocked_between(me.id, p.id)
    and p.display_name ilike '%' || s.t || '%'
  order by (p.display_name ilike s.t || '%') desc, p.display_name
  limit 30;
$$;
