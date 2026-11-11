-- Sign in with a username, and never show an email (or a name made from one) to other people.

-- 1. Username sign-in. Only the "signin" edge function (service role) may call these; the app can't.
create table if not exists private.signin_attempts (username text not null, addr text, at timestamptz not null default now());
alter table private.signin_attempts enable row level security;
create index if not exists signin_attempts_user on private.signin_attempts (username, at);
create index if not exists signin_attempts_addr on private.signin_attempts (addr, at);

create or replace function public.signin_lookup(u text, addr text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v text := lower(trim(both '@ ' from coalesce(u, ''))); em text;
begin
  if (select count(*) from private.signin_attempts a where a.username = v and a.at > now() - interval '15 minutes') >= 8
     or (addr is not null and (select count(*) from private.signin_attempts a where a.addr = signin_lookup.addr and a.at > now() - interval '15 minutes') >= 40) then
    return jsonb_build_object('wait', true);
  end if;
  select au.email::text into em from public.profiles p join auth.users au on au.id = p.id where p.username = v;
  return jsonb_build_object('email', em);
end $$;
create or replace function public.signin_failed(u text, addr text default null) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into private.signin_attempts (username, addr) values (lower(trim(both '@ ' from coalesce(u, ''))), addr);
  -- misses older than a day no longer count toward anything: clear them out as new ones arrive
  delete from private.signin_attempts a where a.at < now() - interval '1 day';
end $$;
revoke all on function public.signin_lookup(text, text), public.signin_failed(text, text) from public, anon, authenticated;
grant execute on function public.signin_lookup(text, text), public.signin_failed(text, text) to service_role;

-- 2. A new account with no name typed in used to be named after the first half of its email address, which friends could then
--    see. It's now "New angler" until the person picks a name.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
declare byr int := nullif(new.raw_user_meta_data->>'birth_year', '')::int; tv int := coalesce(nullif(new.raw_user_meta_data->>'terms_version', '')::int, 0);
begin
  if byr is not null and byr > extract(year from now())::int - 13 then raise exception 'Coulee is for people 13 and older.'; end if;
  if byr is not null and byr < 1900 then byr := null; end if;
  insert into public.profiles (id, display_name, birth_year, terms_version, terms_at, status)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), 'New angler'),
          byr, tv, case when tv > 0 then now() end, 'pending');
  return new;
end $$;

-- 3. Staff list: show each person's @username. Emails stay founder-only, as before.
--    (A new function, so the one older versions of the app call keeps working unchanged.)
create or replace function public.staff_people_v2(q text default ''::text)
returns table(id uuid, display_name text, email text, status text, role text, verified boolean, created_at timestamptz, avatar_path text, username text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, case when private.is_creator((select auth.uid())) then u.email::text end, p.status, p.role, p.verified, p.created_at, p.avatar_path, p.username
  from public.profiles p join auth.users u on u.id = p.id
  where private.is_staff((select auth.uid()))
    and (coalesce(q, '') = '' or p.display_name ilike '%' || q || '%' or p.username ilike '%' || trim(both '@ ' from q) || '%'
         or (private.is_creator((select auth.uid())) and u.email ilike '%' || q || '%'))
  order by (p.status = 'pending') desc, p.created_at desc
  limit 200;
$$;
revoke all on function public.staff_people_v2(text) from public, anon;
grant execute on function public.staff_people_v2(text) to authenticated;
