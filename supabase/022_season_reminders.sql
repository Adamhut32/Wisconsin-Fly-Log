-- Trout season reminders: a push a week before and the day before the early catch-and-release opener
-- (first Saturday in January) and the regular opener (first Saturday in May). People can turn them off
-- under notifications ("Trout season reminders"). Runs once a day at 9 am Central from pg_cron.
create extension if not exists pg_cron;

create or replace function private.first_saturday(y int, m int) returns date
language sql immutable set search_path = '' as $$
  select d::date from generate_series(make_date(y, m, 1), make_date(y, m, 7), interval '1 day') d where extract(isodow from d) = 6 limit 1;
$$;

create or replace function private.season_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'America/Chicago')::date; y int := extract(year from today); m record; days int; t text; b text; n int := 0; u uuid;
begin
  for m in select * from (values (private.first_saturday(y, 1), 'early'), (private.first_saturday(y, 5), 'regular'), (private.first_saturday(y + 1, 1), 'early')) v(d, kind) loop
    days := m.d - today;
    continue when days not in (7, 1);
    t := case when m.kind = 'early' then 'Early trout season opens ' else 'Trout opener ' end || case when days = 1 then 'tomorrow' else 'in a week' end;
    b := case when m.kind = 'early' then 'Catch and release, artificial lures only on most streams. Check the rules on each creek''s card.'
              else 'Regular inland trout season starts ' || to_char(m.d, 'FMDay, Mon FMDD') || '. Check each creek''s card for its rules.' end;
    for u in select p.id from public.profiles p where p.status = 'approved' loop
      perform private.push(u, 'season', t, b, '#map'); n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

-- 'season' pushes follow the person's "season" setting (on unless turned off)
do $do$
declare d text;
begin
  d := pg_get_functiondef('private.push(uuid,text,text,text,text)'::regprocedure);
  if d not like '%''season''%' then
    d := replace(d, $a$when kind like 'staff%' then 'staff'$a$, $a$when kind like 'staff%' then 'staff' when kind = 'season' then 'season'$a$);
    execute d;
  end if;
end $do$;

select cron.schedule('coulee-season-reminders', '0 15 * * *', $$select private.season_reminders()$$);   -- 15:00 UTC = 9 am CST
