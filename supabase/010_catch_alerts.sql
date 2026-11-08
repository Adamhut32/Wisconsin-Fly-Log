-- Catch notifications
--  * friends hear when you log a fish they can see, unless you turn off "Tell friends when I log a catch"
--    (profiles.push_prefs.tell_friends = false). Receivers can mute these with push_prefs.catches = false.
--  * tournament members always hear when a fish is entered in their tournament; the angler can't turn
--    that off (receivers can still mute the whole Tournaments category on their own phone).
--  * no repeats: one alert per friend per angler every 20 minutes, and nobody hears twice about one fish.

create table if not exists private.push_log (
  from_user uuid not null, to_user uuid not null, kind text not null, ref uuid, at timestamptz not null default now()
);
create index if not exists push_log_lookup on private.push_log (to_user, from_user, kind, at desc);
create index if not exists push_log_ref on private.push_log (to_user, ref);

-- category for the new kinds: 'catch' -> catches, 'tourney_catch' already falls under tourneys
create or replace function private.push(uid uuid, kind text, title text, body text, url text default '') returns void language plpgsql security definer set search_path = '' as $$
declare cat text; prefs jsonb; sec text;
begin
  if uid is null or not exists (select 1 from public.push_subscriptions where user_id = uid) then return; end if;
  cat := case when kind in ('friend_request','friend_accept') then 'friends'
              when kind like 'tourney%' then 'tourneys'
              when kind in ('gift','gift_done','fairplay') then 'fish'
              when kind = 'catch' then 'catches'
              when kind = 'message' then 'messages' when kind = 'forum' then 'forum'
              when kind like 'staff%' then 'staff' else null end;
  select push_prefs into prefs from public.profiles where id = uid;
  if cat is not null and coalesce((prefs->>cat)::boolean, true) = false then return; end if;
  select decrypted_secret into sec from vault.decrypted_secrets where name = 'coulee_push_secret';
  perform net.http_post(url := 'https://acufuumrjbzbiktodojz.supabase.co/functions/v1/push',
    body := jsonb_build_object('user_id', uid, 'kind', kind, 'title', left(title, 120), 'body', left(coalesce(body, ''), 240), 'url', coalesce(url, '')),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-coulee-secret', sec), timeout_milliseconds := 5000);
exception when others then null; -- a failed push must never block the change that caused it
end $$;

-- "Adam caught an 18-inch brown trout" / "Adam caught 3 brook trout" / "Adam caught a 3.5 lb largemouth bass"
create or replace function private.catch_line(nm text, c public.catches) returns text language sql immutable set search_path = '' as $$
  select coalesce(nm, 'A friend') || ' caught ' ||
    case when coalesce(c.count, 1) > 1 then c.count || ' ' || lower(coalesce(c.species, 'fish'))
         when c.length_in is not null then (case when trunc(c.length_in) in (8, 11, 18) or trunc(c.length_in) between 80 and 89 then 'an ' else 'a ' end)
              || (c.length_in::float8)::text || '-inch ' || lower(coalesce(c.species, 'fish'))
         when c.weight_lb is not null then (case when trunc(c.weight_lb) in (8, 11, 18) then 'an ' else 'a ' end)
              || (round(c.weight_lb, 2)::float8)::text || ' lb ' || lower(coalesce(c.species, 'fish'))
         else (case when lower(coalesce(c.species, 'fish')) ~ '^[aeiou]' then 'an ' else 'a ' end) || lower(coalesce(c.species, 'fish')) end;
$$;

create or replace function private.method_label(m text) returns text language sql immutable set search_path = '' as $$
  select case m when 'fly' then 'Fly' when 'spin' then 'Spinning' when 'baitcast' then 'Baitcasting'
                when 'ice' then 'Ice fishing' when 'trolling' then 'Trolling' else null end;
$$;

create or replace function private.catch_alert() returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.profiles; f uuid; body text;
begin
  if coalesce((select approved_build from public.release_gate limit 1), 0) < 18 then return new; end if;   -- starts when the founder releases the app build with the off switch
  if new.visibility = 'private' or new.hidden then return new; end if;
  if new.caught_on < current_date - 3 then return new; end if;                 -- catching up an old log: stay quiet
  select * into p from public.profiles where id = new.user_id;
  if p.id is null or p.status <> 'approved' then return new; end if;
  if new.caught_on < (p.created_at at time zone 'America/Chicago')::date then return new; end if;   -- Before Coulee
  if coalesce((p.push_prefs->>'tell_friends')::boolean, true) = false then return new; end if;
  body := concat_ws(' · ', case when new.visibility = 'exact' then new.water end, private.method_label(new.method),
                    case when new.caught_on < current_date then 'caught ' || to_char(new.caught_on, 'Mon FMDD') end);
  if body = '' then body := 'Open Friends to see it.'; end if;
  delete from private.push_log where at < now() - interval '2 days';
  for f in select case when fr.requester = new.user_id then fr.addressee else fr.requester end
           from public.friendships fr
           where fr.status = 'accepted' and (fr.requester = new.user_id or fr.addressee = new.user_id) loop
    continue when private.blocked_between(f, new.user_id);
    continue when exists (select 1 from public.profiles q where q.id = f and q.status <> 'approved');
    continue when exists (select 1 from private.push_log l where l.to_user = f and l.from_user = new.user_id and l.kind = 'catch' and l.at > now() - interval '20 minutes');
    insert into private.push_log (from_user, to_user, kind, ref) values (new.user_id, f, 'catch', new.id);
    perform private.push(f, 'catch', private.catch_line(p.display_name, new), body, '#feed');
  end loop;
  return new;
exception when others then return new;  -- an alert problem must never stop a catch from saving
end $$;
drop trigger if exists catch_alert on public.catches;
create trigger catch_alert after insert on public.catches for each row execute function private.catch_alert();

create or replace function private.tourney_catch_alert() returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.catches; t public.tournaments; nm text; m uuid;
begin
  if coalesce((select approved_build from public.release_gate limit 1), 0) < 18 then return new; end if;   -- starts when the founder releases the app build with the off switch
  select * into c from public.catches where id = new.catch_id;
  select * into t from public.tournaments where id = new.tournament_id;
  if c.id is null or t.id is null then return new; end if;
  select display_name into nm from public.profiles where id = c.user_id;
  for m in select tm.user_id from public.tournament_members tm
           where tm.tournament_id = t.id and tm.status = 'joined' and tm.user_id <> c.user_id loop
    continue when private.blocked_between(m, c.user_id);
    continue when exists (select 1 from private.push_log l where l.to_user = m and l.ref = c.id);   -- already heard about this fish
    continue when exists (select 1 from private.push_log l where l.to_user = m and l.from_user = c.user_id and l.kind = 'tourney_catch:' || t.id and l.at > now() - interval '10 minutes');
    insert into private.push_log (from_user, to_user, kind, ref) values (c.user_id, m, 'tourney_catch:' || t.id, c.id);
    perform private.push(m, 'tourney_catch', private.catch_line(nm, c), 'Entered in ' || t.name, '#tourney:' || t.id);
  end loop;
  return new;
exception when others then return new;
end $$;
drop trigger if exists tourney_catch_alert on public.tournament_entries;
create trigger tourney_catch_alert after insert on public.tournament_entries for each row execute function private.tourney_catch_alert();

revoke all on function private.catch_alert(), private.tourney_catch_alert(), private.catch_line(text, public.catches), private.method_label(text) from public, anon, authenticated;
