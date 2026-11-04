-- Study with Funi v15: house rules
-- • The quiz only gives you questions from modules you take (plus questions with no module)
-- • Up to 10 quiz questions each per day
-- • Only people who played that week can come last; the week is ranked by average points per question (fair for fewer modules)
-- • House rules: dares on/off, what happens if a dare isn't done (removed automatically or chicken badge), written rules, agree before joining
-- • A timer every 5 minutes: closes the week, removes people who didn't do their dare, sends quiz and dare reminders
-- Run after funi-v14-setup.sql. Safe to run more than once.

-- ---------- 1. House rules ----------
alter table public.houses add column if not exists dares_on boolean not null default true;
alter table public.houses add column if not exists dare_miss text not null default 'remove';
alter table public.houses drop constraint if exists houses_dare_miss_check;
alter table public.houses add constraint houses_dare_miss_check check (dare_miss in ('remove', 'chicken'));
alter table public.houses add column if not exists rules_text text;
alter table public.houses drop constraint if exists houses_rules_text_check;
alter table public.houses add constraint houses_rules_text_check check (rules_text is null or char_length(rules_text) <= 600);
alter table public.houses add column if not exists quiz_reminded_on date;
alter table public.house_members add column if not exists agreed_at timestamptz;

alter table public.house_dares add column if not exists reminded_at timestamptz;
alter table public.house_dares drop constraint if exists house_dares_status_check;
alter table public.house_dares add constraint house_dares_status_check check (status in ('choosing', 'active', 'done', 'none', 'removed'));

-- ---------- 2. Your modules decide which questions you get ----------
create or replace function public.funi_norm_module(m text) returns text
language sql immutable as $$ select nullif(upper(regexp_replace(coalesce(m, ''), '\s+', '', 'g')), '') $$;

-- true when this person takes the module (or hasn't set up any modules yet, then they get everything)
create or replace function public.funi_takes(uid uuid, m text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.funi_norm_module(m) is null
      or not exists (select 1 from public.study_profile_modules p where p.user_id = uid)
      or exists (select 1 from public.study_profile_modules p where p.user_id = uid and public.funi_norm_module(p.module_code) = public.funi_norm_module(m));
$$;

-- up to 10 questions each per quiz (was 3)
create or replace function public.funi_quiz_q_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if now() >= public.funi_quiz_start(new.house_id, new.day) then
    raise exception 'That quiz has already started. Your question goes into the next one.';
  end if;
  if (select count(*) from public.house_quiz_q where house_id = new.house_id and day = new.day and author = new.author) >= 10 then
    raise exception 'You''ve added 10 questions for this quiz already.';
  end if;
  new.module := public.funi_norm_module(new.module);
  return new;
end $$;

-- the crown: best average per question in the first hour (ties: more questions, then who finished first)
create or replace function public.funi_quiz_winner(h uuid, d date) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select a.user_id from public.house_quiz_a a
  where a.house_id = h and a.day = d and a.at < public.funi_quiz_start(h, d) + interval '1 hour'
  group by a.user_id having sum(a.points) > 0
  order by avg(a.points) desc, count(*) desc, max(a.at) asc limit 1;
$$;

create or replace function public.funi_quiz_state(h uuid) returns json
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  d date := public.funi_jhb_today();
  st timestamptz := public.funi_quiz_start(h, d);
  en timestamptz := public.funi_day_end(d);
  mon date := public.funi_week_monday(d);
  hr public.houses;
  res json;
begin
  if not public.funi_house_member(h) then raise exception 'Not in this house'; end if;
  select * into hr from public.houses where id = h;
  select json_build_object(
    'today', d, 'start', st, 'end', en, 'open', now() >= st and now() < en, 'crown_until', st + interval '1 hour',
    'quiz_time', to_char(hr.quiz_time, 'HH24:MI'), 'max_drops', 10,
    'dares_on', hr.dares_on, 'dare_miss', hr.dare_miss, 'rules_text', hr.rules_text, 'owner', hr.owner_id,
    'drop_day', public.funi_quiz_drop_day(h),
    'my_drops', (select count(*) from public.house_quiz_q q where q.house_id = h and q.day = public.funi_quiz_drop_day(h) and q.author = auth.uid()),
    'drops_total', (select count(*) from public.house_quiz_q q where q.house_id = h and q.day = public.funi_quiz_drop_day(h)),
    'crown', public.funi_house_crown(h),
    'skipped', case when now() >= st then (select count(*) from public.house_quiz_q q where q.house_id = h and q.day = d and q.author <> auth.uid() and not public.funi_takes(auth.uid(), q.module)) else 0 end,
    'questions', case when now() >= st then coalesce((
      select json_agg(json_build_object(
        'id', q.id, 'author', q.author, 'module', q.module, 'question', q.question, 'options', q.options, 'mine', q.author = auth.uid(),
        'answered', a.q_id is not null, 'choice', a.choice, 'points', a.points,
        'right', case when a.q_id is not null or q.author = auth.uid() or now() >= en then q.correct end,
        'tip', case when a.q_id is not null or q.author = auth.uid() or now() >= en then q.tip end
      ) order by q.created_at)
      from public.house_quiz_q q left join public.house_quiz_a a on a.q_id = q.id and a.user_id = auth.uid()
      where q.house_id = h and q.day = d and (q.author = auth.uid() or public.funi_takes(auth.uid(), q.module))), '[]'::json) else '[]'::json end,
    'tonight', coalesce((
      select json_agg(json_build_object('user_id', m.user_id, 'points', coalesce(t.p, 0), 'answered', coalesce(t.n, 0), 'avg', coalesce(t.av, 0), 'on_time', coalesce(t.ok, false)) order by coalesce(t.av, 0) desc, coalesce(t.n, 0) desc)
      from public.house_members m
      left join (select a.user_id, sum(a.points) p, count(*) n, round(avg(a.points)) av, bool_and(a.at < st + interval '1 hour') ok
                 from public.house_quiz_a a where a.house_id = h and a.day = d group by a.user_id) t on t.user_id = m.user_id
      where m.house_id = h and m.status = 'joined'), '[]'::json),
    'week_start', mon,
    'week', coalesce((
      select json_agg(json_build_object('user_id', m.user_id, 'points', coalesce(t.p, 0), 'answered', coalesce(t.n, 0), 'avg', coalesce(t.av, 0), 'played', coalesce(t.days, 0)) order by (t.n is null), coalesce(t.av, 0) desc, coalesce(t.n, 0) desc)
      from public.house_members m
      left join (select a.user_id, sum(a.points) p, count(*) n, round(avg(a.points)) av, count(distinct a.day) days
                 from public.house_quiz_a a where a.house_id = h and a.day between mon and mon + 6 group by a.user_id) t on t.user_id = m.user_id
      where m.house_id = h and m.status = 'joined'), '[]'::json)
  ) into res;
  return res;
end $$;

-- ---------- 3. Closing the week: only players, ranked by average ----------
create or replace function public.funi_house_close_week_core(h uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  mon date := public.funi_week_monday(public.funi_jhb_today());
  last_mon date; wk_end timestamptz; lose uuid; pick uuid; rnd int; n int; did uuid; hname text; hr public.houses;
begin
  select * into hr from public.houses where id = h; if not found then return null; end if;
  if now() >= public.funi_quiz_start(h, mon + 6) + interval '1 hour' then last_mon := mon; else last_mon := mon - 7; end if;
  wk_end := public.funi_quiz_start(h, last_mon + 6) + interval '1 hour';
  if exists (select 1 from public.house_dares where house_id = h and week_start = last_mon) then return null; end if;
  perform pg_advisory_xact_lock(hashtext(h::text || last_mon::text));
  if exists (select 1 from public.house_dares where house_id = h and week_start = last_mon) then return null; end if;

  -- players: people in the house who answered at least one question that week
  select count(distinct a.user_id) into n from public.house_quiz_a a
  join public.house_members m on m.house_id = a.house_id and m.user_id = a.user_id and m.status = 'joined'
  where a.house_id = h and a.day between last_mon and last_mon + 6;
  if not hr.dares_on or n < 2 then
    insert into public.house_dares (house_id, week_start, status) values (h, last_mon, 'none') on conflict do nothing;
    return null;
  end if;

  -- the player with the lowest average per question (ties: fewer questions answered, then random)
  select a.user_id into lose from public.house_quiz_a a
  join public.house_members m on m.house_id = a.house_id and m.user_id = a.user_id and m.status = 'joined'
  where a.house_id = h and a.day between last_mon and last_mon + 6
  group by a.user_id order by avg(a.points) asc, count(*) asc, random() limit 1;

  -- fair turns: pick from those who haven't chosen this round; when everyone has, a new round starts
  select coalesce(max(round), 1) into rnd from public.house_dares where house_id = h and status not in ('none');
  select m.user_id into pick from public.house_members m
  where m.house_id = h and m.status = 'joined' and m.user_id <> lose
    and m.user_id not in (select d.picker from public.house_dares d where d.house_id = h and d.round = rnd and d.picker is not null)
  order by random() limit 1;
  if pick is null then
    rnd := rnd + 1;
    select m.user_id into pick from public.house_members m where m.house_id = h and m.status = 'joined' and m.user_id <> lose order by random() limit 1;
  end if;

  insert into public.house_dares (house_id, week_start, loser, picker, round, status)
  values (h, last_mon, lose, pick, rnd, 'choosing') on conflict do nothing returning id into did;
  if did is null then return null; end if;
  hname := hr.emoji || ' ' || hr.name;
  insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
  values (pick, lose, 'house', '🎲 You were picked to choose ' || coalesce(public.funi_name(lose), 'someone') || '''s dare', 'Open ' || hname || ' and pick a dare. It must be something the house can see in Funi.', h);
  perform public.funi_tell_house(h, pick, pick, '⏳ ' || coalesce(public.funi_name(lose), 'Someone') || ' came last this week',
    coalesce(public.funi_name(pick), 'Someone') || ' is choosing the dare.');
  return did;
end $$;
revoke all on function public.funi_house_close_week_core(uuid) from public, anon, authenticated;

create or replace function public.funi_house_close_week(h uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.funi_house_member(h) then return null; end if;
  return public.funi_house_close_week_core(h);
end $$;

-- the dare message now carries the house rule
create or replace function public.funi_dare_set(d uuid, txt text, kind text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.house_dares; hr public.houses; warn text;
begin
  select * into r from public.house_dares where id = d;
  if not found or not public.funi_house_member(r.house_id) then raise exception 'Dare not found'; end if;
  if r.status <> 'choosing' then raise exception 'This dare has been chosen already.'; end if;
  if not (r.picker = auth.uid() or (r.created_at < now() - interval '1 day' and r.loser <> auth.uid())) then
    raise exception 'Only the person Funi picked can choose this dare.';
  end if;
  if txt is null or char_length(trim(txt)) < 3 then raise exception 'Write the dare first.'; end if;
  select * into hr from public.houses where id = r.house_id;
  update public.house_dares set body = left(trim(txt), 200), proof_kind = coalesce(kind, 'photo'), status = 'active',
    due_at = now() + interval '1 day', picker = auth.uid() where id = d;
  warn := case when hr.dare_miss = 'remove' and r.loser <> hr.owner_id then ' ⚠️ If you don''t post the proof within 1 day, you''ll be removed from the house automatically.' else ' You have 1 day.' end;
  insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
  values (r.loser, auth.uid(), 'house', '😅 You have a dare from ' || coalesce(public.funi_name(auth.uid()), 'your house'),
          left(trim(txt), 200) || warn, r.house_id);
end $$;

-- ---------- 4. Joining: you agree to the house rules ----------
create or replace function public.funi_house_join(h uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.house_members set status = 'joined', agreed_at = now()
  where house_id = h and user_id = auth.uid() and status = 'invited';
  if not found then raise exception 'That invite isn''t there any more.'; end if;
end $$;

-- ---------- 5. The timer (every 5 minutes) ----------
create or replace function public.funi_house_tick() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; hr public.houses; st timestamptz; d date := public.funi_jhb_today();
begin
  -- close last week in every house that has dares on
  for r in select id from public.houses where dares_on loop
    perform public.funi_house_close_week_core(r.id);
  end loop;

  -- 3 hours left on a dare: remind the person doing it
  for r in select x.* from public.house_dares x where x.status = 'active' and x.reminded_at is null and x.due_at - now() < interval '3 hours' and x.due_at > now() loop
    select * into hr from public.houses where id = r.house_id;
    insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
    values (r.loser, r.picker, 'house', '⏰ 3 hours left for your dare',
            r.body || case when hr.dare_miss = 'remove' and r.loser <> hr.owner_id then ' · Post the proof or you''ll be removed from ' || hr.name || '.' else '' end, r.house_id);
    update public.house_dares set reminded_at = now() where id = r.id;
  end loop;

  -- time ran out: remove the person (house rule), except the owner, who gets the chicken badge instead
  for r in select x.* from public.house_dares x join public.houses h on h.id = x.house_id
           where x.status = 'active' and x.due_at <= now() and h.dare_miss = 'remove' and x.loser <> h.owner_id loop
    select * into hr from public.houses where id = r.house_id;
    delete from public.house_members where house_id = r.house_id and user_id = r.loser and role <> 'owner';
    update public.house_dares set status = 'removed' where id = r.id;
    insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
    values (r.loser, null, 'house', '🚪 You were removed from ' || hr.emoji || ' ' || hr.name,
            'The dare wasn''t done in time (that''s the house rule). Ask someone in the house to invite you again if you''d like to come back.', null);
    perform public.funi_tell_house(r.house_id, r.loser, null, '🚪 ' || coalesce(public.funi_name(r.loser), 'Someone') || ' was removed from the house', 'The dare wasn''t done in time.');
  end loop;

  -- 30 minutes before the quiz: remind people who haven't played this week
  for r in select id from public.houses where quiz_reminded_on is distinct from d loop
    st := public.funi_quiz_start(r.id, d);
    if now() >= st - interval '30 minutes' and now() < st then
      select * into hr from public.houses where id = r.id;
      if exists (select 1 from public.house_quiz_q q where q.house_id = r.id and q.day = d) then
        insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
        select m.user_id, null, 'house', '🧠 ' || hr.name || ': the quiz starts at ' || to_char(hr.quiz_time, 'HH24:MI'),
               case when hr.dares_on then 'You haven''t played this week, so you''re not in the dare draw yet. Play once to join!' else 'You haven''t played this week. Come and play!' end, r.id
        from public.house_members m
        where m.house_id = r.id and m.status = 'joined'
          and not exists (select 1 from public.house_quiz_a a where a.house_id = r.id and a.user_id = m.user_id and a.day between public.funi_week_monday(d) and d);
      end if;
      update public.houses set quiz_reminded_on = d where id = r.id;
    end if;
  end loop;
end $$;
revoke all on function public.funi_house_tick() from public, anon, authenticated;

do $$
begin
  begin perform cron.unschedule('funi-house-tick'); exception when others then null; end;
  perform cron.schedule('funi-house-tick', '*/5 * * * *', 'select public.funi_house_tick()');
exception when others then
  raise notice 'pg_cron is not switched on: run funi-v3-setup.sql first, then this again.';
end $$;

do $$
declare f text;
begin
  foreach f in array array['funi_quiz_state(uuid)', 'funi_house_close_week(uuid)', 'funi_dare_set(uuid,text,text)', 'funi_house_join(uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

notify pgrst, 'reload schema';
