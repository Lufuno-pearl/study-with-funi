-- Study with Funi v16: quiz countdown reminders
-- Run this once in Supabase: SQL editor → New query → paste → Run (after funi-v15-setup.sql).
-- • 5 minutes before the quiz, 2 minutes before, and when it opens: a notification to everyone
--   in the house who hasn't played that night (tapping it opens the quiz)
-- • Owner setting: all reminders, or just one when the quiz opens
-- • A timer every minute sends them (free, like the message timer), straight to phones

alter table public.houses add column if not exists quiz_pings text not null default 'all';
alter table public.houses drop constraint if exists houses_quiz_pings_check;
alter table public.houses add constraint houses_quiz_pings_check check (quiz_pings in ('all', 'one'));

-- a new kind of notification that opens the quiz straight away
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('invite','accepted','message','help','studying','room','deck','battle','share','house','quiz'));

-- which reminders each house already got today (so nobody gets the same one twice)
create table if not exists public.house_quiz_pings (
  house_id uuid not null references public.houses(id) on delete cascade,
  day date not null,
  step text not null check (step in ('5min', '2min', 'open')),
  sent_at timestamptz not null default now(),
  primary key (house_id, day, step)
);
alter table public.house_quiz_pings enable row level security; -- only the timer uses it

create or replace function public.funi_quiz_pings() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d date := public.funi_jhb_today();
  r record; st timestamptz; stp text; ttl text; sent int := 0;
begin
  for r in select h.* from public.houses h
           where exists (select 1 from public.house_quiz_q q where q.house_id = h.id and q.day = d) loop
    st := public.funi_quiz_start(r.id, d);
    stp := case
      when now() >= st and now() < st + interval '15 minutes' then 'open'
      when r.quiz_pings = 'all' and now() >= st - interval '2 minutes' and now() < st then '2min'
      when r.quiz_pings = 'all' and now() >= st - interval '5 minutes' and now() < st - interval '2 minutes' then '5min'
    end;
    if stp is null then continue; end if;
    -- a late timer never sends an older reminder after a newer one
    if exists (select 1 from public.house_quiz_pings p where p.house_id = r.id and p.day = d
               and (p.step = stp or (stp = '5min' and p.step in ('2min', 'open')) or (stp = '2min' and p.step = 'open'))) then continue; end if;
    insert into public.house_quiz_pings (house_id, day, step) values (r.id, d, stp) on conflict do nothing;
    ttl := case stp when '5min' then '🧠 ' || r.name || ': quiz starts in 5 minutes!'
                     when '2min' then '⏰ ' || r.name || ': 2 minutes! Get ready'
                     else '🔔 ' || r.name || ': the quiz is open, go go go!' end;
    insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
    select m.user_id, null, 'quiz', ttl,
           n || case when n = 1 then ' question' else ' questions' end || ' waiting for you'
             || case when stp = 'open' then '. Tap to play.' else '.' end, r.id
    from public.house_members m
    cross join lateral (select count(*)::int as n from public.house_quiz_q q
                        where q.house_id = r.id and q.day = d and q.author <> m.user_id and public.funi_takes(m.user_id, q.module)) c(n)
    where m.house_id = r.id and m.status = 'joined' and c.n > 0
      and not exists (select 1 from public.house_quiz_a a where a.house_id = r.id and a.user_id = m.user_id and a.day = d);
    sent := sent + 1;
  end loop;
  -- send them to phones right away instead of waiting for the next minute
  if sent > 0 then
    begin
      perform net.http_post(url := 'https://study-with-funi.vercel.app/api/push', body := '{}'::jsonb, headers := '{"Content-Type": "application/json"}'::jsonb);
    exception when others then null;
    end;
  end if;
  delete from public.house_quiz_pings where day < d - 7;
end $$;
revoke all on function public.funi_quiz_pings() from public, anon, authenticated;

do $$
begin
  begin perform cron.unschedule('funi-quiz-pings'); exception when others then null; end;
  perform cron.schedule('funi-quiz-pings', '* * * * *', 'select public.funi_quiz_pings()');
exception when others then
  raise notice 'pg_cron is not switched on: run funi-v3-setup.sql first, then this again.';
end $$;

notify pgrst, 'reload schema';
