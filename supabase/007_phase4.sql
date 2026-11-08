-- Phase 4: push notifications, forums, private messages, reports, blocking, word filter. Additive only.
-- (VAPID keys and the push secret were stored separately with vault.create_secret: coulee_vapid_private, coulee_vapid_public, coulee_push_secret.)
create extension if not exists pg_net with schema extensions;

/* ---------- word filter ---------- */
create table if not exists private.bad_words (word text primary key);
insert into private.bad_words (word) values
 ('fuck'),('fucker'),('fucking'),('motherfucker'),('shit'),('bullshit'),('shitty'),('bitch'),('bastard'),('asshole'),('dickhead'),('cunt'),('pussy'),
 ('twat'),('wanker'),('prick'),('slut'),('whore'),('douche'),('douchebag'),('jackass'),('dumbass'),('goddamn'),
 ('nigger'),('nigga'),('faggot'),('fag'),('retard'),('retarded'),('spic'),('chink'),('kike'),('wetback'),('tranny'),('dyke'),('gook'),('beaner'),('raghead'),('towelhead')
on conflict do nothing;
-- keeps the first letter and stars the rest: "f***"
create or replace function private.mask_words(t text) returns text language plpgsql stable security definer set search_path = '' as $$
declare w text; out text := t;
begin
  if t is null or t = '' then return t; end if;
  for w in select word from private.bad_words order by length(word) desc loop
    out := regexp_replace(out, '\m(' || w || ')(s|es|ed|ing|er|ers)?\M',
      substr(w, 1, 1) || repeat('*', length(w) - 1) || '\2', 'gi');
  end loop;
  return out;
end $$;

/* ---------- push notifications ---------- */
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null, auth text not null, ua text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy "own subscriptions" on public.push_subscriptions for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter table public.profiles add column if not exists push_prefs jsonb not null default '{"friends":true,"tourneys":true,"fish":true,"messages":true,"forum":true,"staff":true}'::jsonb;

-- only the push function (service role) can read the keys
create or replace function public.push_config() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_object_agg(name, decrypted_secret) from vault.decrypted_secrets where name in ('coulee_vapid_private','coulee_vapid_public','coulee_push_secret');
$$;
revoke execute on function public.push_config() from public, anon, authenticated;
grant execute on function public.push_config() to service_role;

create or replace function private.push(uid uuid, kind text, title text, body text, url text default '') returns void language plpgsql security definer set search_path = '' as $$
declare cat text; prefs jsonb; sec text;
begin
  if uid is null or not exists (select 1 from public.push_subscriptions where user_id = uid) then return; end if;
  cat := case when kind in ('friend_request','friend_accept') then 'friends'
              when kind like 'tourney%' then 'tourneys'
              when kind in ('gift','gift_done','fairplay') then 'fish'
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
create or replace function private.push_staff(kind text, title text, body text, url text default '') returns void language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  for u in select id from public.profiles where role in ('creator','admin') and status = 'approved' loop perform private.push(u, kind, title, body, url); end loop;
end $$;
create or replace function public.push_test() returns void language plpgsql security definer set search_path = '' as $$
begin perform private.push((select auth.uid()), 'test', 'Coulee notifications are on', 'This is what alerts from Coulee will look like.', '#me'); end $$;
revoke execute on function public.push_test() from public, anon; grant execute on function public.push_test() to authenticated;

-- notices (gifts, tournament changes, fair play) go out as pushes too
create or replace function private.push_notice() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.push(new.user_id, new.kind, new.title, new.body,
    case when new.kind like 'tourney%' and new.ref is not null then '#tourney:' || new.ref when new.kind like 'gift%' then '#log' else '#log' end);
  return new;
end $$;
drop trigger if exists push_notice on public.notices;
create trigger push_notice after insert on public.notices for each row execute function private.push_notice();

create or replace function private.push_friendship() returns trigger language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    select display_name into nm from public.profiles where id = new.requester;
    perform private.push(new.addressee, 'friend_request', coalesce(nm, 'Someone') || ' wants to be fishing friends', 'Open Friends to accept.', '#friends');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    select display_name into nm from public.profiles where id = new.addressee;
    perform private.push(new.requester, 'friend_accept', coalesce(nm, 'Your friend') || ' accepted your friend request', 'You can see each other''s shared catches now.', '#friends');
  end if;
  return new;
end $$;
drop trigger if exists push_friendship on public.friendships;
create trigger push_friendship after insert or update on public.friendships for each row execute function private.push_friendship();

create or replace function private.push_tourney_invite() returns trigger language plpgsql security definer set search_path = '' as $$
declare t public.tournaments; nm text;
begin
  if new.status = 'invited' then
    select * into t from public.tournaments where id = new.tournament_id;
    select display_name into nm from public.profiles where id = new.invited_by;
    perform private.push(new.user_id, 'tourney_invite', coalesce(nm, 'A friend') || ' invited you to a tournament', t.name, '#tourney:' || t.id);
  end if;
  return new;
end $$;
drop trigger if exists push_tourney_invite on public.tournament_members;
create trigger push_tourney_invite after insert on public.tournament_members for each row execute function private.push_tourney_invite();

create or replace function private.push_new_account() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending' then perform private.push_staff('staff_pending', 'New account waiting', new.display_name || ' signed up and needs approval.', '#staff'); end if;
  return new;
end $$;
drop trigger if exists push_new_account on public.profiles;
create trigger push_new_account after insert on public.profiles for each row execute function private.push_new_account();

/* ---------- blocking ---------- */
create table if not exists public.user_blocks (blocker uuid not null references public.profiles(id) on delete cascade, blocked uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key (blocker, blocked));
alter table public.user_blocks enable row level security;
create policy "own blocks" on public.user_blocks for all to authenticated using (blocker = (select auth.uid())) with check (blocker = (select auth.uid()) and blocked <> blocker);
create or replace function private.blocked_between(a uuid, b uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a));
$$;

/* ---------- forums ---------- */
create table if not exists public.forum_threads (
  id uuid primary key default gen_random_uuid(),
  board text not null check (board in ('general','driftless','northwoods','central','southeast','lakemichigan','flies','gear','tourneys','help')),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(), last_post_at timestamptz not null default now(), edited_at timestamptz,
  reply_count int not null default 0, locked boolean not null default false, pinned boolean not null default false, hidden boolean not null default false
);
create index if not exists forum_threads_board_idx on public.forum_threads(board, pinned desc, last_post_at desc);
create table if not exists public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.forum_threads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(), edited_at timestamptz, hidden boolean not null default false
);
create index if not exists forum_posts_thread_idx on public.forum_posts(thread_id, created_at);
alter table public.forum_threads enable row level security;
alter table public.forum_posts enable row level security;
create policy "approved read threads" on public.forum_threads for select to authenticated
  using (private.is_approved((select auth.uid())) and (not hidden or user_id = (select auth.uid()) or private.is_staff((select auth.uid()))));
create policy "approved start threads" on public.forum_threads for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_approved(user_id) and not locked and not pinned and not hidden and reply_count = 0);
create policy "edit own thread" on public.forum_threads for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete own empty thread" on public.forum_threads for delete to authenticated using ((user_id = (select auth.uid()) and reply_count = 0) or private.is_staff((select auth.uid())));
create policy "approved read posts" on public.forum_posts for select to authenticated
  using (private.is_approved((select auth.uid())) and (not hidden or user_id = (select auth.uid()) or private.is_staff((select auth.uid())))
    and exists (select 1 from public.forum_threads t where t.id = thread_id and (not t.hidden or private.is_staff((select auth.uid())))));
create policy "approved reply" on public.forum_posts for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_approved(user_id) and not hidden
    and exists (select 1 from public.forum_threads t where t.id = thread_id and not t.locked and not t.hidden));
create policy "edit own post" on public.forum_posts for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete own post" on public.forum_posts for delete to authenticated using (user_id = (select auth.uid()) or private.is_staff((select auth.uid())));

-- clean words, protect moderator-only fields, keep counts right
create or replace function private.guard_thread() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.title := private.mask_words(new.title); new.body := private.mask_words(new.body);
  if tg_op = 'UPDATE' then
    if coalesce(current_setting('coulee.trusted', true), '') <> '1' then
      new.locked := old.locked; new.pinned := old.pinned; new.hidden := old.hidden; new.reply_count := old.reply_count;
      new.last_post_at := old.last_post_at; new.board := old.board; new.user_id := old.user_id; new.created_at := old.created_at;
      if new.title is distinct from old.title or new.body is distinct from old.body then new.edited_at := now(); end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_thread on public.forum_threads;
create trigger guard_thread before insert or update on public.forum_threads for each row execute function private.guard_thread();
create or replace function private.guard_post() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.body := private.mask_words(new.body);
  if tg_op = 'UPDATE' and coalesce(current_setting('coulee.trusted', true), '') <> '1' then
    new.hidden := old.hidden; new.thread_id := old.thread_id; new.user_id := old.user_id; new.created_at := old.created_at;
    if new.body is distinct from old.body then new.edited_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_post on public.forum_posts;
create trigger guard_post before insert or update on public.forum_posts for each row execute function private.guard_post();
create or replace function private.after_post() returns trigger language plpgsql security definer set search_path = '' as $$
declare t public.forum_threads; nm text; u uuid;
begin
  perform set_config('coulee.trusted', '1', true);
  if tg_op = 'INSERT' then
    update public.forum_threads set reply_count = reply_count + 1, last_post_at = new.created_at where id = new.thread_id returning * into t;
    select display_name into nm from public.profiles where id = new.user_id;
    for u in select distinct x from (select t.user_id x union select p.user_id from public.forum_posts p where p.thread_id = new.thread_id) s
             where x <> new.user_id and not private.blocked_between(x, new.user_id) loop
      perform private.push(u, 'forum', coalesce(nm, 'Someone') || ' replied: ' || t.title, left(new.body, 140), '#forum:' || t.id);
    end loop;
  else
    update public.forum_threads set reply_count = greatest(reply_count - 1, 0) where id = old.thread_id;
  end if;
  perform set_config('coulee.trusted', '', true);
  return coalesce(new, old);
end $$;
drop trigger if exists after_post on public.forum_posts;
create trigger after_post after insert or delete on public.forum_posts for each row execute function private.after_post();

/* ---------- private messages: friends only, 16 and older, not blocked ---------- */
create or replace function private.age_ok(u uuid, min_age int) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = u and birth_year is not null and birth_year <= extract(year from now())::int - min_age);
$$;
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(), read_at timestamptz, hidden boolean not null default false
);
create index if not exists messages_pair_idx on public.messages(least(from_user, to_user), greatest(from_user, to_user), created_at desc);
create index if not exists messages_to_idx on public.messages(to_user, read_at);
alter table public.messages enable row level security;
create policy "read my messages" on public.messages for select to authenticated using ((from_user = (select auth.uid()) or to_user = (select auth.uid())) and not hidden);
create policy "message friends" on public.messages for insert to authenticated with check (
  from_user = (select auth.uid()) and to_user <> from_user and not hidden and read_at is null
  and private.is_approved(from_user) and private.is_approved(to_user) and private.is_friend(from_user, to_user)
  and private.age_ok(from_user, 16) and private.age_ok(to_user, 16) and not private.blocked_between(from_user, to_user));
create policy "mark read" on public.messages for update to authenticated using (to_user = (select auth.uid())) with check (to_user = (select auth.uid()));
create policy "unsend my message" on public.messages for delete to authenticated using (from_user = (select auth.uid()));
create or replace function private.guard_message() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.body := private.mask_words(new.body); new.created_at := now(); return new; end if;
  if coalesce(current_setting('coulee.trusted', true), '') <> '1' then
    new.body := old.body; new.from_user := old.from_user; new.to_user := old.to_user; new.created_at := old.created_at; new.hidden := old.hidden;
  end if;
  return new;
end $$;
drop trigger if exists guard_message on public.messages;
create trigger guard_message before insert or update on public.messages for each row execute function private.guard_message();
create or replace function private.push_message() returns trigger language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  select display_name into nm from public.profiles where id = new.from_user;
  perform private.push(new.to_user, 'message', coalesce(nm, 'A friend'), left(new.body, 160), '#messages:' || new.from_user);
  return new;
end $$;
drop trigger if exists push_message on public.messages;
create trigger push_message after insert on public.messages for each row execute function private.push_message();
create or replace function public.my_conversations() returns table(other uuid, display_name text, avatar_path text, last_body text, last_at timestamptz, last_from_me boolean, unread bigint, can_message boolean)
language sql stable security definer set search_path = '' as $$
  with me as (select (select auth.uid()) id), m as (
    select case when x.from_user = me.id then x.to_user else x.from_user end other, x.* from public.messages x, me
    where (x.from_user = me.id or x.to_user = me.id) and not x.hidden)
  select distinct on (m.other) m.other, p.display_name, p.avatar_path, m.body, m.created_at, m.from_user = (select id from me),
    (select count(*) from m m2 where m2.other = m.other and m2.to_user = (select id from me) and m2.read_at is null),
    private.is_friend((select id from me), m.other) and private.age_ok((select id from me), 16) and private.age_ok(m.other, 16) and not private.blocked_between((select id from me), m.other)
  from m join public.profiles p on p.id = m.other
  order by m.other, m.created_at desc;
$$;
create or replace function public.can_message(other uuid) returns text language sql stable security definer set search_path = '' as $$
  select case
    when not private.age_ok((select auth.uid()), 16) then 'Messages are for anglers 16 and older.'
    when not private.is_friend((select auth.uid()), other) then 'You can only message friends.'
    when not private.age_ok(other, 16) then 'This friend can''t receive messages.'
    when private.blocked_between((select auth.uid()), other) then 'Messaging is blocked between you two.'
    else null end;
$$;

/* ---------- reports and moderation ---------- */
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('thread','post','message','user')),
  ref uuid not null,
  reason text check (char_length(reason) <= 500),
  status text not null default 'open' check (status in ('open','closed')),
  handled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (reporter, kind, ref)
);
alter table public.reports enable row level security;
create policy "file reports" on public.reports for insert to authenticated with check (reporter = (select auth.uid()) and status = 'open' and handled_by is null);
create policy "see own reports" on public.reports for select to authenticated using (reporter = (select auth.uid()) or private.is_staff((select auth.uid())));
create or replace function private.push_report() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.push_staff('staff_report', 'New report', 'Someone reported a ' || new.kind || '. Open Admin tools to review.', '#staff'); return new; end $$;
drop trigger if exists push_report on public.reports;
create trigger push_report after insert on public.reports for each row execute function private.push_report();
-- staff see what was reported, and only that (a reported message is the only private message staff ever see)
create or replace function public.report_queue() returns table(id uuid, kind text, ref uuid, reason text, status text, created_at timestamptz, reporter_name text,
  author uuid, author_name text, content text, context text, is_hidden boolean, reports bigint)
language sql stable security definer set search_path = '' as $$
  select r.id, r.kind, r.ref, r.reason, r.status, r.created_at, rp.display_name,
    coalesce(th.user_id, po.user_id, ms.from_user, r.ref), coalesce(pa.display_name, ''),
    coalesce(th.title || ' — ' || th.body, po.body, ms.body, ''), coalesce(pt.title, case when r.kind = 'message' then 'Private message' when r.kind = 'user' then 'Account' end, ''),
    coalesce(th.hidden, po.hidden, ms.hidden, false),
    (select count(*) from public.reports r2 where r2.kind = r.kind and r2.ref = r.ref)
  from public.reports r join public.profiles rp on rp.id = r.reporter
  left join public.forum_threads th on r.kind = 'thread' and th.id = r.ref
  left join public.forum_posts po on r.kind = 'post' and po.id = r.ref left join public.forum_threads pt on pt.id = po.thread_id
  left join public.messages ms on r.kind = 'message' and ms.id = r.ref
  left join public.profiles pa on pa.id = coalesce(th.user_id, po.user_id, ms.from_user, r.ref)
  where private.is_staff((select auth.uid()))
  order by (r.status = 'open') desc, r.created_at desc limit 200;
$$;
create or replace function public.moderate(kind text, ref uuid, action text) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if not private.is_staff(me) then raise exception 'Only the founder and admins can moderate.'; end if;
  perform set_config('coulee.trusted', '1', true);
  if kind = 'thread' then
    update public.forum_threads set hidden = case action when 'hide' then true when 'unhide' then false else hidden end,
      locked = case action when 'lock' then true when 'unlock' then false else locked end,
      pinned = case action when 'pin' then true when 'unpin' then false else pinned end where id = ref;
  elsif kind = 'post' then update public.forum_posts set hidden = (action = 'hide') where id = ref and action in ('hide','unhide');
  elsif kind = 'message' then update public.messages set hidden = (action = 'hide') where id = ref and action in ('hide','unhide');
  end if;
  if action in ('hide','close') then update public.reports r set status = 'closed', handled_by = me where r.kind = moderate.kind and r.ref = moderate.ref; end if;
  perform set_config('coulee.trusted', '', true);
end $$;

-- fair-play flags ping staff once per catch
create or replace function private.push_flag() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.flags f where f.catch_id = new.catch_id and f.id <> new.id) then
    perform private.push_staff('staff_flag', 'A catch photo was flagged', coalesce(new.detail, 'Open Founder tools to review.'), '#staff');
  end if;
  return new;
end $$;
drop trigger if exists push_flag on public.flags;
create trigger push_flag after insert on public.flags for each row execute function private.push_flag();

-- bios are public too, so they get the word filter
create or replace function private.clean_bio() returns trigger language plpgsql security definer set search_path = '' as $$
begin new.bio := private.mask_words(new.bio); return new; end $$;
drop trigger if exists clean_bio on public.profiles;
create trigger clean_bio before insert or update of bio on public.profiles for each row execute function private.clean_bio();

revoke execute on function public.my_conversations(), public.can_message(uuid), public.report_queue(), public.moderate(text, uuid, text) from public, anon;
grant execute on function public.my_conversations(), public.can_message(uuid), public.report_queue(), public.moderate(text, uuid, text) to authenticated;
