-- weight, fishing preferences, What's new audience + builds, the release approval gate, friend catches with weight/water/before-join
alter table public.catches add column if not exists weight_lb numeric(6,2) check (weight_lb > 0 and weight_lb < 300);
alter table public.profiles add column if not exists fishing_prefs jsonb not null default '{}'::jsonb;
alter table public.releases add column if not exists audience text not null default 'all' check (audience in ('all','staff'));
alter table public.releases add column if not exists build int;
drop policy if exists "everyone reads releases" on public.releases;
create policy "read releases for my audience" on public.releases for select to authenticated using (audience = 'all' or private.is_staff((select auth.uid())));
create table if not exists public.release_gate (id int primary key default 1 check (id = 1), approved_build int not null default 0, approved_at timestamptz, approved_by uuid references public.profiles(id));
insert into public.release_gate (id) values (1) on conflict do nothing;
alter table public.release_gate enable row level security;
create policy "anyone reads the gate" on public.release_gate for select to anon, authenticated using (true);
create or replace function public.approve_build(b int) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_creator((select auth.uid())) then raise exception 'Only the founder can release updates.'; end if;
  update public.release_gate set approved_build = greatest(approved_build, b), approved_at = now(), approved_by = (select auth.uid()) where id = 1;
end $$;
revoke execute on function public.approve_build(int) from public, anon;
grant execute on function public.approve_build(int) to authenticated;

drop function if exists public.friend_catches();
create function public.friend_catches() returns table(id uuid, user_id uuid, display_name text, rel text, trip_id uuid, trip_name text, species text, length_in numeric, count integer, fly text, caught_on date, county text, lat double precision, lng double precision, notes text, photo_path text, exact boolean, created_at timestamptz,
  weight_lb numeric, method text, water text, before_join boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.user_id, p.display_name,
    case when private.is_friend((select auth.uid()), c.user_id) then 'friend' else 'following' end,
    c.trip_id, case when t.shared then t.name end, c.species, c.length_in,
    c.count, c.fly, c.caught_on, c.county,
    case when c.visibility = 'exact' then c.lat end, case when c.visibility = 'exact' then c.lng end,
    case when c.visibility = 'exact' then c.notes end,
    c.photo_path, c.visibility = 'exact', c.created_at,
    c.weight_lb, c.method, case when c.visibility = 'exact' then c.water end,
    c.caught_on < (p.created_at at time zone 'America/Chicago')::date
  from public.catches c
  join public.profiles p on p.id = c.user_id
  left join public.trips t on t.id = c.trip_id
  where c.visibility <> 'private' and not c.hidden and private.can_see((select auth.uid()), c.user_id)
  order by c.caught_on desc, c.created_at desc
  limit 1000;
$$;
revoke execute on function public.friend_catches() from public, anon;
grant execute on function public.friend_catches() to authenticated;
