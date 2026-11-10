-- Unique usernames (@name) alongside the display name. Lowercase letters, numbers, _ and . ; 3 to 20 long.
alter table public.profiles add column if not exists username text;
alter table public.profiles drop constraint if exists username_shape;
alter table public.profiles add constraint username_shape check (username is null or username ~ '^[a-z0-9][a-z0-9_.]{1,18}[a-z0-9_]$');
create unique index if not exists profiles_username_key on public.profiles (username);
-- usernames change only through set_username (checks + uniqueness message)
create or replace function private.guard_username() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.username is distinct from old.username and coalesce(current_setting('coulee.username_ok', true), '') <> '1' then
    new.username := old.username;
  end if;
  return new;
end $$;
drop trigger if exists guard_username on public.profiles;
create trigger guard_username before update of username on public.profiles for each row execute function private.guard_username();

create or replace function private.username_problem(u text) returns text language sql stable security definer set search_path = '' as $$
  select case
    when u is null or u = '' then 'Pick a username.'
    when char_length(u) < 3 then 'Use at least 3 characters.'
    when char_length(u) > 20 then 'Use 20 characters or fewer.'
    when u !~ '^[a-z0-9_.]+$' then 'Use only letters, numbers, _ and .'
    when u !~ '^[a-z0-9]' then 'Start with a letter or number.'
    when u ~ '\.$' then 'Don''t end with a period.'
    when u ~ '\.\.' then 'No two periods in a row.'
    when u = any(array['coulee','admin','founder','staff','support','help','moderator','mod','official','team','system','null','everyone']) then 'That username is reserved.'
    when exists (select 1 from public.profiles p where p.username = u and p.id <> (select auth.uid())) then 'That username is taken.'
    else null end;
$$;

create or replace function public.username_check(u text) returns text language sql stable security definer set search_path = '' as $$
  select private.username_problem(lower(trim(both '@ ' from coalesce(u, ''))));
$$;

create or replace function public.set_username(u text) returns text language plpgsql security definer set search_path = '' as $$
declare v text := lower(trim(both '@ ' from coalesce(u, ''))); prob text;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.'; end if;
  prob := private.username_problem(v);
  if prob is not null then raise exception '%', prob; end if;
  perform set_config('coulee.username_ok', '1', true);
  update public.profiles set username = v where id = (select auth.uid());
  perform set_config('coulee.username_ok', '', true);
  return v;
exception when unique_violation then raise exception 'That username is taken.';
end $$;
revoke all on function public.set_username(text), public.username_check(text) from public, anon;
grant execute on function public.set_username(text), public.username_check(text) to authenticated;
revoke all on function private.username_problem(text) from public, anon, authenticated;

-- search by name or @username
drop function if exists public.search_people(text);
create function public.search_people(q text) returns table(id uuid, display_name text, avatar_path text, title text, relation text, mutual bigint, username text)
language sql stable security definer set search_path = '' as $$
  with me as (select (select auth.uid()) id), s as (select trim(both '@ ' from trim(regexp_replace(coalesce(q, ''), '[%_\\]', '', 'g'))) t, lower(trim(both '@ ' from coalesce(q, ''))) u)
  select p.id, p.display_name, p.avatar_path, p.title,
    coalesce((select case when f.status = 'accepted' then 'friend' when f.requester = me.id then 'sent' else 'received' end
              from public.friendships f where (f.requester = me.id and f.addressee = p.id) or (f.requester = p.id and f.addressee = me.id) limit 1), 'none'),
    (select count(*) from public.profiles x where x.id <> p.id and x.id <> me.id and private.is_friend(me.id, x.id) and private.is_friend(p.id, x.id)),
    p.username
  from public.profiles p, me, s
  where private.is_approved(me.id) and greatest(char_length(s.t), char_length(s.u)) >= 2
    and p.id <> me.id and p.status = 'approved'
    and not private.blocked_between(me.id, p.id)
    and ((char_length(s.t) >= 2 and p.findable and p.display_name ilike '%' || s.t || '%') or p.username = s.u or (p.findable and left(p.username, char_length(s.u)) = s.u))
  order by (p.username = s.u) desc nulls last, (p.display_name ilike s.t || '%') desc, p.display_name
  limit 30;
$$;
revoke all on function public.search_people(text) from public, anon;
grant execute on function public.search_people(text) to authenticated;
