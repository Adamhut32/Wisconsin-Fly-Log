-- Phase 1: account approval, roles (founder/admin/verified), age + agreements, profile pictures.
-- Additive only: existing accounts are approved, old app versions keep working.

alter table public.profiles
  add column if not exists status text not null default 'pending' check (status in ('pending','approved','declined')),
  add column if not exists verified boolean not null default false,
  add column if not exists birth_year int check (birth_year between 1900 and 2100),
  add column if not exists terms_version int not null default 0,
  add column if not exists terms_at timestamptz,
  add column if not exists avatar_path text;
update public.profiles set status = 'approved' where status = 'pending';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('angler','admin','creator'));

create or replace function private.is_approved(u uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = u and status = 'approved');
$$;
create or replace function private.is_staff(u uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = u and role in ('creator','admin') and status = 'approved');
$$;

-- people can't promote, verify or approve themselves; staff changes go through the functions below
create or replace function private.guard_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and coalesce(current_setting('coulee.trusted', true), '') <> '1' then
    if not private.is_creator((select auth.uid())) then
      new.role := old.role; new.featured := old.featured; new.status := old.status; new.verified := old.verified;
    end if;
  end if;
  if new.birth_year is distinct from old.birth_year and new.birth_year is not null
     and new.birth_year > extract(year from now())::int - 13 then
    raise exception 'Coulee is for people 13 and older.';
  end if;
  new.friend_code := old.friend_code; new.id := old.id;
  return new;
end $$;

-- new accounts: pending, with birth year and the agreement they accepted at signup
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
declare byr int := nullif(new.raw_user_meta_data->>'birth_year', '')::int; tv int := coalesce(nullif(new.raw_user_meta_data->>'terms_version', '')::int, 0);
begin
  if byr is not null and byr > extract(year from now())::int - 13 then raise exception 'Coulee is for people 13 and older.'; end if;
  if byr is not null and byr < 1900 then byr := null; end if;
  insert into public.profiles (id, display_name, birth_year, terms_version, terms_at, status)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1)),
          byr, tv, case when tv > 0 then now() end, 'pending');
  return new;
end $$;

-- pending accounts see nothing social
create or replace function private.can_see(viewer uuid, owner uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_approved(viewer) and (private.is_friend(viewer, owner)
    or exists (select 1 from public.follows f join public.profiles p on p.id = f.followee
               where f.follower = viewer and f.followee = owner and p.is_public));
$$;
drop policy if exists "profiles readable by signed-in" on public.profiles;
create policy "profiles readable by approved" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (private.is_approved((select auth.uid())) and status = 'approved'));
drop policy if exists "send request" on public.friendships;
create policy "send request" on public.friendships for insert to authenticated
  with check (requester = (select auth.uid()) and status = 'pending' and private.is_approved(requester) and private.is_approved(addressee));
drop policy if exists "follow public anglers" on public.follows;
create policy "follow public anglers" on public.follows for insert to authenticated
  with check (follower = (select auth.uid()) and private.is_approved(follower)
    and exists (select 1 from public.profiles p where p.id = follows.followee and p.is_public and p.status = 'approved'));
drop policy if exists "see my or open tournaments" on public.tournaments;
create policy "see my or open tournaments" on public.tournaments for select to authenticated
  using ((open and private.is_approved((select auth.uid()))) or owner = (select auth.uid()) or private.in_tournament(id, (select auth.uid())));

create or replace function public.find_anglers(q text default '') returns table(id uuid, display_name text, bio text, featured boolean, followers bigint, fish bigint, following boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.bio, p.featured,
    (select count(*) from public.follows f where f.followee = p.id),
    (select coalesce(sum(c.count), 0) from public.catches c where c.user_id = p.id and c.visibility <> 'private' and not c.hidden),
    exists (select 1 from public.follows f where f.followee = p.id and f.follower = (select auth.uid()))
  from public.profiles p
  where p.is_public and p.status = 'approved' and p.id <> (select auth.uid()) and private.is_approved((select auth.uid()))
    and (coalesce(q, '') = '' or p.display_name ilike '%' || q || '%')
  order by p.featured desc, (select count(*) from public.follows f where f.followee = p.id) desc, p.display_name
  limit 50;
$$;

create or replace function public.my_tournaments() returns table(id uuid, owner uuid, owner_name text, name text, description text, starts_on date, ends_on date, counties text[], area_label text, species text[], scoring text, require_photo boolean, open boolean, my_status text, members bigint, entries bigint)
language sql stable security definer set search_path = '' as $$
  select t.id, t.owner, p.display_name, t.name, t.description, t.starts_on, t.ends_on, t.counties, t.area_label, t.species, t.scoring, t.require_photo, t.open,
    (select m.status from public.tournament_members m where m.tournament_id = t.id and m.user_id = (select auth.uid())),
    (select count(*) from public.tournament_members m where m.tournament_id = t.id and m.status = 'joined'),
    (select count(*) from public.tournament_entries e where e.tournament_id = t.id)
  from public.tournaments t join public.profiles p on p.id = t.owner
  where (t.open and private.is_approved((select auth.uid()))) or private.in_tournament(t.id, (select auth.uid()))
  order by t.ends_on desc;
$$;

create or replace function public.create_tournament(p_name text, p_description text, p_starts date, p_ends date, p_counties text[], p_area_label text, p_species text[], p_scoring text, p_require_photo boolean, p_open boolean, p_invite uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare tid uuid; me uuid := (select auth.uid()); u uuid;
begin
  if me is null then raise exception 'sign in first'; end if;
  if not private.is_approved(me) then raise exception 'Your account is waiting for approval.'; end if;
  if p_open and not private.is_creator(me) then raise exception 'Only the founder can make open tournaments.'; end if;
  insert into public.tournaments (owner, name, description, starts_on, ends_on, counties, area_label, species, scoring, require_photo, open)
  values (me, p_name, p_description, p_starts, p_ends, nullif(p_counties, '{}'), p_area_label, nullif(p_species, '{}'), p_scoring, p_require_photo, coalesce(p_open, false))
  returning id into tid;
  insert into public.tournament_members (tournament_id, user_id, status, invited_by) values (tid, me, 'joined', me);
  foreach u in array coalesce(p_invite, '{}') loop
    if u <> me and private.is_friend(me, u) then
      insert into public.tournament_members (tournament_id, user_id, status, invited_by) values (tid, u, 'invited', me) on conflict do nothing;
    end if;
  end loop;
  return tid;
end $$;

-- admins read and answer suggestions too
create or replace function public.all_suggestions() returns table(id uuid, user_id uuid, display_name text, kind text, body text, status text, reply text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.user_id, p.display_name, s.kind, s.body, s.status, s.reply, s.created_at
  from public.suggestions s join public.profiles p on p.id = s.user_id
  where private.is_staff((select auth.uid()))
  order by s.created_at desc;
$$;
drop policy if exists "creator answers" on public.suggestions;
create policy "staff answers" on public.suggestions for update to authenticated
  using (private.is_staff((select auth.uid()))) with check (private.is_staff((select auth.uid())));
drop policy if exists "read own or all as creator" on public.suggestions;
create policy "read own or all as staff" on public.suggestions for select to authenticated
  using (user_id = (select auth.uid()) or private.is_staff((select auth.uid())));

-- staff: list accounts (email only for the founder), approve, set roles
create or replace function public.staff_people(q text default '') returns table(id uuid, display_name text, email text, status text, role text, verified boolean, created_at timestamptz, avatar_path text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, case when private.is_creator((select auth.uid())) then u.email::text end, p.status, p.role, p.verified, p.created_at, p.avatar_path
  from public.profiles p join auth.users u on u.id = p.id
  where private.is_staff((select auth.uid()))
    and (coalesce(q, '') = '' or p.display_name ilike '%' || q || '%' or (private.is_creator((select auth.uid())) and u.email ilike '%' || q || '%'))
  order by (p.status = 'pending') desc, p.created_at desc
  limit 200;
$$;
create or replace function public.set_account_status(uid uuid, new_status text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_staff((select auth.uid())) then raise exception 'Only the founder and admins can approve accounts.'; end if;
  if new_status not in ('pending','approved','declined') then raise exception 'bad status'; end if;
  if exists (select 1 from public.profiles where id = uid and role = 'creator') then raise exception 'The founder account can''t be changed.'; end if;
  if exists (select 1 from public.profiles where id = uid and role = 'admin') and not private.is_creator((select auth.uid())) then raise exception 'Only the founder can change an admin.'; end if;
  perform set_config('coulee.trusted', '1', true);
  update public.profiles set status = new_status where id = uid;
end $$;
create or replace function public.set_account_role(uid uuid, new_role text, is_verified boolean) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_creator((select auth.uid())) then raise exception 'Only the founder can change roles.'; end if;
  if new_role not in ('angler','admin') then raise exception 'bad role'; end if;
  if uid = (select auth.uid()) then raise exception 'You can''t change your own role.'; end if;
  perform set_config('coulee.trusted', '1', true);
  update public.profiles set role = new_role, verified = coalesce(is_verified, verified), status = case when new_role = 'admin' then 'approved' else status end where id = uid;
end $$;
revoke execute on function public.staff_people(text), public.set_account_status(uuid, text), public.set_account_role(uuid, text, boolean) from public, anon;
grant execute on function public.staff_people(text), public.set_account_status(uuid, text), public.set_account_role(uuid, text, boolean) to authenticated;

-- profile pictures: public bucket, each person writes only their own folder
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg','image/png','image/webp'];
drop policy if exists "upload own avatar" on storage.objects;
create policy "upload own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "replace own avatar" on storage.objects;
create policy "replace own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "delete own avatar" on storage.objects;
create policy "delete own avatar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "see own avatar files" on storage.objects;
create policy "see own avatar files" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
