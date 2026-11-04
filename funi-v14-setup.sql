-- Study with Funi v14: My House for exam season
-- Daily House Quiz with a crown, weekly results and dares (fair turns), morning goals,
-- the exam war room ("All the best"), past paper sprints with scanned answers,
-- explain it back (voice answers) and the mistake bank. Houses can now have 20 people.
-- Run after funi-v12-setup.sql. Safe to run more than once.

-- ---------- 0. Helpers ----------
alter table public.houses add column if not exists quiz_time time not null default time '19:00';
create or replace function public.funi_jhb_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Johannesburg')::date $$;

-- when a day's quiz starts for a house (its quiz time, Johannesburg time)
create or replace function public.funi_quiz_start(h uuid, d date) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select ((d + coalesce((select quiz_time from public.houses where id = h), time '19:00'))::timestamp at time zone 'Africa/Johannesburg');
$$;
create or replace function public.funi_day_end(d date) returns timestamptz
language sql stable as $$ select ((d + 1)::timestamp at time zone 'Africa/Johannesburg') $$;
-- Monday of the week a day is in
create or replace function public.funi_week_monday(d date) returns date
language sql immutable as $$ select d - (extract(isodow from d)::int - 1) $$;


-- houses can now have up to 20 people
create or replace function public.funi_house_limits() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'houses' then
    if (select count(*) from public.houses where owner_id = new.owner_id) >= 3 then
      raise exception 'You can have up to 3 houses.';
    end if;
  elsif tg_table_name = 'house_members' then
    if (select count(*) from public.house_members where house_id = new.house_id) >= 20 then
      raise exception 'A house can have up to 20 people.';
    end if;
  elsif tg_table_name = 'house_files' then
    if new.kind = 'file' and (select coalesce(sum(size), 0) from public.house_files where house_id = new.house_id and kind = 'file' and id <> new.id) + new.size > 157286400 then
      raise exception 'This house''s 150 MB is full. Delete some files or save a link instead.';
    end if;
  end if;
  return new;
end $$;

-- a small helper to tell everyone in a house (except someone)
create or replace function public.funi_tell_house(h uuid, actor uuid, skip uuid, t text, b text) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
  select m.user_id, actor, 'house', left(t, 140), left(coalesce(b, ''), 280), h
  from public.house_members m
  where m.house_id = h and m.status = 'joined' and m.user_id <> coalesce(skip, '00000000-0000-0000-0000-000000000000'::uuid);
$$;
revoke all on function public.funi_tell_house(uuid, uuid, uuid, text, text) from public, anon, authenticated;

-- ---------- 1. Daily House Quiz ----------
create table if not exists public.house_quiz_q (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  author uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  module text check (module is null or char_length(module) <= 30),
  question text not null check (char_length(question) between 3 and 300),
  options text[] not null check (array_length(options, 1) between 2 and 4),
  correct smallint not null check (correct >= 0 and correct < 4),
  tip text check (tip is null or char_length(tip) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists house_quiz_q_day on public.house_quiz_q (house_id, day);
create table if not exists public.house_quiz_a (
  q_id uuid not null references public.house_quiz_q(id) on delete cascade,
  house_id uuid not null references public.houses(id) on delete cascade,
  day date not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  choice smallint not null,
  ms int not null default 0,
  correct boolean not null,
  points int not null default 0,
  at timestamptz not null default now(),
  primary key (q_id, user_id)
);
create index if not exists house_quiz_a_day on public.house_quiz_a (house_id, day);

-- questions: you only ever read your own (everyone else's come through funi_quiz_state, without the answers)
alter table public.house_quiz_q enable row level security;
drop policy if exists quiz_q_mine on public.house_quiz_q;
create policy quiz_q_mine on public.house_quiz_q for select to authenticated using (author = auth.uid());
drop policy if exists quiz_q_add on public.house_quiz_q;
create policy quiz_q_add on public.house_quiz_q for insert to authenticated
  with check (author = auth.uid() and public.funi_house_member(house_id) and day >= public.funi_jhb_today() and correct < array_length(options, 1));
drop policy if exists quiz_q_remove on public.house_quiz_q;
create policy quiz_q_remove on public.house_quiz_q for delete to authenticated
  using (author = auth.uid() and now() < public.funi_quiz_start(house_id, day));
alter table public.house_quiz_a enable row level security;
drop policy if exists quiz_a_read on public.house_quiz_a;
create policy quiz_a_read on public.house_quiz_a for select to authenticated using (public.funi_house_member(house_id));

-- up to 3 questions each per quiz, and only before that quiz starts
create or replace function public.funi_quiz_q_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if now() >= public.funi_quiz_start(new.house_id, new.day) then
    raise exception 'That quiz has already started. Your question goes into the next one.';
  end if;
  if (select count(*) from public.house_quiz_q where house_id = new.house_id and day = new.day and author = new.author) >= 3 then
    raise exception 'You''ve added 3 questions for this quiz already.';
  end if;
  return new;
end $$;
drop trigger if exists funi_quiz_q_guard on public.house_quiz_q;
create trigger funi_quiz_q_guard before insert on public.house_quiz_q for each row execute function public.funi_quiz_q_guard();

-- which day new questions go to: today's quiz until it starts, then tomorrow's
create or replace function public.funi_quiz_drop_day(h uuid) returns date
language sql stable security definer set search_path = public, pg_temp as $$
  select case when now() < public.funi_quiz_start(h, public.funi_jhb_today()) then public.funi_jhb_today() else public.funi_jhb_today() + 1 end;
$$;

-- the winner of a day's quiz: most points answered within the first hour (ties: who finished first)
create or replace function public.funi_quiz_winner(h uuid, d date) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select a.user_id from public.house_quiz_a a
  where a.house_id = h and a.day = d and a.at < public.funi_quiz_start(h, d) + interval '1 hour'
  group by a.user_id having sum(a.points) > 0
  order by sum(a.points) desc, max(a.at) asc limit 1;
$$;

-- who wears the crown right now (the latest quiz whose first hour is over)
create or replace function public.funi_house_crown(h uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select case when now() >= public.funi_quiz_start(h, public.funi_jhb_today()) + interval '1 hour'
              then public.funi_quiz_winner(h, public.funi_jhb_today())
              else public.funi_quiz_winner(h, public.funi_jhb_today() - 1) end;
$$;

-- crowns for every house I'm in (so chats and lists can show them)
create or replace function public.funi_my_crowns() returns table (house_id uuid, user_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.house_id, public.funi_house_crown(m.house_id) from public.house_members m
  where m.user_id = auth.uid() and m.status = 'joined' and public.funi_house_crown(m.house_id) is not null;
$$;

-- everything the quiz screen needs, without giving away answers you haven't given
create or replace function public.funi_quiz_state(h uuid) returns json
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  d date := public.funi_jhb_today();
  st timestamptz := public.funi_quiz_start(h, d);
  en timestamptz := public.funi_day_end(d);
  mon date := public.funi_week_monday(d);
  res json;
begin
  if not public.funi_house_member(h) then raise exception 'Not in this house'; end if;
  select json_build_object(
    'today', d, 'start', st, 'end', en, 'open', now() >= st and now() < en, 'crown_until', st + interval '1 hour',
    'quiz_time', (select to_char(quiz_time, 'HH24:MI') from public.houses where id = h),
    'drop_day', public.funi_quiz_drop_day(h),
    'my_drops', (select count(*) from public.house_quiz_q q where q.house_id = h and q.day = public.funi_quiz_drop_day(h) and q.author = auth.uid()),
    'drops_total', (select count(*) from public.house_quiz_q q where q.house_id = h and q.day = public.funi_quiz_drop_day(h)),
    'crown', public.funi_house_crown(h),
    'questions', case when now() >= st then coalesce((
      select json_agg(json_build_object(
        'id', q.id, 'author', q.author, 'module', q.module, 'question', q.question, 'options', q.options, 'mine', q.author = auth.uid(),
        'answered', a.q_id is not null, 'choice', a.choice, 'points', a.points,
        'right', case when a.q_id is not null or q.author = auth.uid() or now() >= en then q.correct end,
        'tip', case when a.q_id is not null or q.author = auth.uid() or now() >= en then q.tip end
      ) order by q.created_at)
      from public.house_quiz_q q left join public.house_quiz_a a on a.q_id = q.id and a.user_id = auth.uid()
      where q.house_id = h and q.day = d), '[]'::json) else '[]'::json end,
    'tonight', coalesce((
      select json_agg(json_build_object('user_id', m.user_id, 'points', coalesce(t.p, 0), 'answered', coalesce(t.n, 0), 'on_time', coalesce(t.ok, false)) order by coalesce(t.p, 0) desc)
      from public.house_members m
      left join (select a.user_id, sum(a.points) p, count(*) n, bool_and(a.at < st + interval '1 hour') ok
                 from public.house_quiz_a a where a.house_id = h and a.day = d group by a.user_id) t on t.user_id = m.user_id
      where m.house_id = h and m.status = 'joined'), '[]'::json),
    'week_start', mon,
    'week', coalesce((
      select json_agg(json_build_object('user_id', m.user_id, 'points', coalesce(t.p, 0), 'played', coalesce(t.days, 0)) order by coalesce(t.p, 0) desc)
      from public.house_members m
      left join (select a.user_id, sum(a.points) p, count(distinct a.day) days
                 from public.house_quiz_a a where a.house_id = h and a.day between mon and mon + 6 group by a.user_id) t on t.user_id = m.user_id
      where m.house_id = h and m.status = 'joined'), '[]'::json)
  ) into res;
  return res;
end $$;

-- answering: checked here, so the right answer is only shown after you pick
create or replace function public.funi_quiz_answer(q uuid, pick int, took int) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.house_quiz_q; ok boolean; pts int;
begin
  select * into r from public.house_quiz_q where id = q;
  if not found or not public.funi_house_member(r.house_id) then raise exception 'Question not found'; end if;
  if r.author = auth.uid() then raise exception 'That''s your own question.'; end if;
  if now() < public.funi_quiz_start(r.house_id, r.day) then raise exception 'The quiz hasn''t started yet.'; end if;
  if now() >= public.funi_day_end(r.day) then raise exception 'This quiz has closed.'; end if;
  ok := pick = r.correct;
  pts := case when ok then 100 + greatest(0, 50 - least(greatest(coalesce(took, 0), 0), 20000) / 400) else 0 end;
  insert into public.house_quiz_a (q_id, house_id, day, user_id, choice, ms, correct, points)
  values (q, r.house_id, r.day, auth.uid(), pick, greatest(coalesce(took, 0), 0), ok, pts)
  on conflict (q_id, user_id) do nothing;
  if not found then raise exception 'You''ve answered this one already.'; end if;
  return json_build_object('correct', ok, 'points', pts, 'right', r.correct, 'tip', r.tip);
end $$;

-- ---------- 2. Weekly results and dares (fair turns) ----------
create table if not exists public.house_dares (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  week_start date not null,
  loser uuid references auth.users(id) on delete set null,
  picker uuid references auth.users(id) on delete set null,
  round int not null default 1,
  status text not null default 'choosing' check (status in ('choosing', 'active', 'done', 'none')),
  body text check (body is null or char_length(body) between 3 and 200),
  proof_kind text check (proof_kind is null or proof_kind in ('photo', 'voice', 'video')),
  due_at timestamptz,
  proof_path text,
  proof_mime text,
  proof_at timestamptz,
  created_at timestamptz not null default now(),
  unique (house_id, week_start)
);
create table if not exists public.house_dare_reacts (
  dare_id uuid not null references public.house_dares(id) on delete cascade,
  house_id uuid not null references public.houses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  emoji text not null check (emoji in ('😂', '💀', '🔥', '👏')),
  primary key (dare_id, user_id, emoji)
);
alter table public.house_dares enable row level security;
drop policy if exists dares_read on public.house_dares;
create policy dares_read on public.house_dares for select to authenticated using (public.funi_house_member(house_id));
alter table public.house_dare_reacts enable row level security;
drop policy if exists dare_reacts_read on public.house_dare_reacts;
create policy dare_reacts_read on public.house_dare_reacts for select to authenticated using (public.funi_house_member(house_id));
drop policy if exists dare_reacts_add on public.house_dare_reacts;
create policy dare_reacts_add on public.house_dare_reacts for insert to authenticated
  with check (user_id = auth.uid() and public.funi_house_member(house_id) and exists (select 1 from public.house_dares d where d.id = dare_id and d.house_id = house_dare_reacts.house_id));
drop policy if exists dare_reacts_remove on public.house_dare_reacts;
create policy dare_reacts_remove on public.house_dare_reacts for delete to authenticated using (user_id = auth.uid());

-- closes last week (after Sunday's quiz hour) the first time anyone in the house opens it:
-- whoever has the fewest points gets a dare, and Funi picks at random who chooses it,
-- only from people who haven't had a turn this round
create or replace function public.funi_house_close_week(h uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  mon date := public.funi_week_monday(public.funi_jhb_today());
  last_mon date; wk_end timestamptz; lose uuid; pick uuid; rnd int; n int; did uuid; hname text;
begin
  if not public.funi_house_member(h) then return null; end if;
  -- the week that has finished most recently
  if now() >= public.funi_quiz_start(h, mon + 6) + interval '1 hour' then last_mon := mon; else last_mon := mon - 7; end if;
  wk_end := public.funi_quiz_start(h, last_mon + 6) + interval '1 hour';
  if exists (select 1 from public.house_dares where house_id = h and week_start = last_mon) then return null; end if;
  perform pg_advisory_xact_lock(hashtext(h::text || last_mon::text));
  if exists (select 1 from public.house_dares where house_id = h and week_start = last_mon) then return null; end if;

  select count(*) into n from public.house_members where house_id = h and status = 'joined' and coalesce(joined_at, created_at) < wk_end;
  if n < 2 or not exists (select 1 from public.house_quiz_a where house_id = h and day between last_mon and last_mon + 6) then
    insert into public.house_dares (house_id, week_start, status) values (h, last_mon, 'none') on conflict do nothing;
    return null;
  end if;

  -- last place (everyone in the house all week counts, even with 0 points); ties are broken at random
  select m.user_id into lose
  from public.house_members m
  left join (select user_id, sum(points) p from public.house_quiz_a where house_id = h and day between last_mon and last_mon + 6 group by user_id) t on t.user_id = m.user_id
  where m.house_id = h and m.status = 'joined' and coalesce(m.joined_at, m.created_at) < wk_end
  order by coalesce(t.p, 0) asc, random() limit 1;

  -- fair turns: pick from those who haven't chosen this round; when everyone has, a new round starts
  select coalesce(max(round), 1) into rnd from public.house_dares where house_id = h and status <> 'none';
  select m.user_id into pick from public.house_members m
  where m.house_id = h and m.status = 'joined' and m.user_id <> lose
    and m.user_id not in (select d.picker from public.house_dares d where d.house_id = h and d.round = rnd and d.picker is not null)
  order by random() limit 1;
  if pick is null then
    rnd := rnd + 1;
    select m.user_id into pick from public.house_members m
    where m.house_id = h and m.status = 'joined' and m.user_id <> lose order by random() limit 1;
  end if;

  insert into public.house_dares (house_id, week_start, loser, picker, round, status)
  values (h, last_mon, lose, pick, rnd, 'choosing') on conflict do nothing returning id into did;
  if did is null then return null; end if;
  select emoji || ' ' || name into hname from public.houses where id = h;
  insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
  values (pick, lose, 'house', '🎲 You were picked to choose ' || coalesce(public.funi_name(lose), 'someone') || '''s dare', 'Open ' || hname || ' and pick a dare. It must be something the house can see in Funi.', h);
  perform public.funi_tell_house(h, pick, pick, '⏳ ' || coalesce(public.funi_name(lose), 'Someone') || ' came last this week',
    coalesce(public.funi_name(pick), 'Someone') || ' is choosing the dare.');
  return did;
end $$;

-- the picked person sets the dare; the person doing it then has 1 day
create or replace function public.funi_dare_set(d uuid, txt text, kind text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.house_dares;
begin
  select * into r from public.house_dares where id = d;
  if not found or not public.funi_house_member(r.house_id) then raise exception 'Dare not found'; end if;
  if r.status <> 'choosing' then raise exception 'This dare has been chosen already.'; end if;
  -- the picked person chooses; if they haven't within a day, anyone else in the house can
  if not (r.picker = auth.uid() or (r.created_at < now() - interval '1 day' and r.loser <> auth.uid())) then
    raise exception 'Only the person Funi picked can choose this dare.';
  end if;
  if txt is null or char_length(trim(txt)) < 3 then raise exception 'Write the dare first.'; end if;
  update public.house_dares set body = left(trim(txt), 200), proof_kind = coalesce(kind, 'photo'), status = 'active',
    due_at = now() + interval '1 day', picker = auth.uid() where id = d;
  insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
  values (r.loser, auth.uid(), 'house', '😅 You have a dare from ' || coalesce(public.funi_name(auth.uid()), 'your house'),
          left(trim(txt), 200) || ' · You have 1 day.', r.house_id);
end $$;

-- the person doing the dare posts the proof (late is fine too: it takes the chicken badge off)
create or replace function public.funi_dare_proof(d uuid, p text, mime text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.house_dares;
begin
  select * into r from public.house_dares where id = d;
  if not found or r.loser <> auth.uid() then raise exception 'Only the person doing the dare can post the proof.'; end if;
  if r.status <> 'active' then raise exception 'This dare isn''t waiting for proof.'; end if;
  if p is null or split_part(p, '/', 1) <> r.house_id::text then raise exception 'Upload the proof to the house first.'; end if;
  update public.house_dares set status = 'done', proof_path = p, proof_mime = left(mime, 80), proof_at = now() where id = d;
  perform public.funi_tell_house(r.house_id, auth.uid(), auth.uid(), '✅ ' || coalesce(public.funi_name(auth.uid()), 'Someone') || ' did the dare!', r.body);
end $$;

-- ---------- 3. Morning goals ----------
create table if not exists public.member_goals (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  items text[] not null default '{}' check (array_length(items, 1) is null or array_length(items, 1) <= 3),
  done boolean[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.member_goals enable row level security;
drop policy if exists goals_mine on public.member_goals;
create policy goals_mine on public.member_goals for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists goals_house on public.member_goals;
create policy goals_house on public.member_goals for select to authenticated using (public.funi_shares_house(user_id));

-- ---------- 4. Exam war room: "All the best" and how it went ----------
create table if not exists public.house_wishes (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  from_user uuid not null default auth.uid() references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  module text not null check (char_length(module) between 1 and 30),
  exam_date date not null,
  body text not null check (char_length(body) between 1 and 280),
  created_at timestamptz not null default now()
);
create index if not exists house_wishes_to on public.house_wishes (house_id, to_user, exam_date);
create table if not exists public.house_moods (
  house_id uuid not null references public.houses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  module text not null check (char_length(module) between 1 and 30),
  exam_date date not null,
  mood smallint not null check (mood between 1 and 4),
  primary key (house_id, user_id, module, exam_date)
);
alter table public.house_wishes enable row level security;
drop policy if exists wishes_read on public.house_wishes;
create policy wishes_read on public.house_wishes for select to authenticated using (public.funi_house_member(house_id));
drop policy if exists wishes_add on public.house_wishes;
create policy wishes_add on public.house_wishes for insert to authenticated
  with check (from_user = auth.uid() and to_user <> auth.uid() and public.funi_house_member(house_id)
    and exists (select 1 from public.house_members m where m.house_id = house_wishes.house_id and m.user_id = to_user and m.status = 'joined'));
drop policy if exists wishes_remove on public.house_wishes;
create policy wishes_remove on public.house_wishes for delete to authenticated using (from_user = auth.uid());
alter table public.house_moods enable row level security;
drop policy if exists moods_read on public.house_moods;
create policy moods_read on public.house_moods for select to authenticated using (public.funi_house_member(house_id));
drop policy if exists moods_mine on public.house_moods;
create policy moods_mine on public.house_moods for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.funi_house_member(house_id));

create or replace function public.funi_notify_wish() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
  values (new.to_user, new.from_user, 'house', '💜 ' || coalesce(public.funi_name(new.from_user), 'Someone') || ' sent you All the best for ' || new.module, new.body, new.house_id);
  return new;
end $$;
drop trigger if exists funi_wish_notify on public.house_wishes;
create trigger funi_wish_notify after insert on public.house_wishes for each row execute function public.funi_notify_wish();

-- ---------- 5. Past paper sprints ----------
create table if not exists public.house_sprints (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  file_id uuid references public.house_files(id) on delete set null,
  starts_at timestamptz not null,
  minutes int not null default 180 check (minutes between 10 and 300),
  questions int not null default 6 check (questions between 1 and 30),
  created_at timestamptz not null default now()
);
create index if not exists house_sprints_house on public.house_sprints (house_id, starts_at desc);
create table if not exists public.house_sprint_people (
  sprint_id uuid not null references public.house_sprints(id) on delete cascade,
  house_id uuid not null references public.houses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status text not null default 'in' check (status in ('in', 'maybe', 'out')),
  submitted_at timestamptz,
  primary key (sprint_id, user_id)
);
create table if not exists public.house_sprint_pages (
  id uuid primary key default gen_random_uuid(),
  sprint_id uuid not null references public.house_sprints(id) on delete cascade,
  house_id uuid not null references public.houses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  page_no int not null check (page_no between 1 and 60),
  path text not null,
  questions int[] not null default '{}',
  size int not null default 0 check (size between 0 and 3145728),
  created_at timestamptz not null default now()
);
create index if not exists house_sprint_pages_s on public.house_sprint_pages (sprint_id, user_id, page_no);
create table if not exists public.house_sprint_votes (
  sprint_id uuid not null references public.house_sprints(id) on delete cascade,
  house_id uuid not null references public.houses(id) on delete cascade,
  q int not null check (q between 1 and 30),
  author uuid not null references auth.users(id) on delete cascade,
  voter uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (sprint_id, q, author, voter)
);
alter table public.house_sprints enable row level security;
drop policy if exists sprints_read on public.house_sprints;
create policy sprints_read on public.house_sprints for select to authenticated using (public.funi_house_member(house_id));
drop policy if exists sprints_add on public.house_sprints;
create policy sprints_add on public.house_sprints for insert to authenticated with check (created_by = auth.uid() and public.funi_house_member(house_id));
drop policy if exists sprints_remove on public.house_sprints;
create policy sprints_remove on public.house_sprints for delete to authenticated using (created_by = auth.uid());
alter table public.house_sprint_people enable row level security;
drop policy if exists sprint_people_read on public.house_sprint_people;
create policy sprint_people_read on public.house_sprint_people for select to authenticated using (public.funi_house_member(house_id));
drop policy if exists sprint_people_mine on public.house_sprint_people;
create policy sprint_people_mine on public.house_sprint_people for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.funi_house_member(house_id) and exists (select 1 from public.house_sprints s where s.id = sprint_id and s.house_id = house_sprint_people.house_id));
alter table public.house_sprint_pages enable row level security;
drop policy if exists sprint_pages_read on public.house_sprint_pages;
create policy sprint_pages_read on public.house_sprint_pages for select to authenticated using (public.funi_house_member(house_id));
drop policy if exists sprint_pages_mine on public.house_sprint_pages;
create policy sprint_pages_mine on public.house_sprint_pages for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.funi_house_member(house_id) and split_part(path, '/', 1) = house_id::text
    and exists (select 1 from public.house_sprints s where s.id = sprint_id and s.house_id = house_sprint_pages.house_id));
alter table public.house_sprint_votes enable row level security;
drop policy if exists sprint_votes_read on public.house_sprint_votes;
create policy sprint_votes_read on public.house_sprint_votes for select to authenticated using (public.funi_house_member(house_id));
drop policy if exists sprint_votes_mine on public.house_sprint_votes;
create policy sprint_votes_mine on public.house_sprint_votes for all to authenticated
  using (voter = auth.uid())
  with check (voter = auth.uid() and public.funi_house_member(house_id) and exists (select 1 from public.house_sprints s where s.id = sprint_id and s.house_id = house_sprint_votes.house_id));

create or replace function public.funi_notify_sprint() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.funi_tell_house(new.house_id, new.created_by, new.created_by,
    '⚔️ ' || coalesce(public.funi_name(new.created_by), 'Someone') || ' set up a past paper sprint',
    new.title || ' · ' || to_char(new.starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI') || ' · ' || new.minutes || ' min');
  return new;
end $$;
drop trigger if exists funi_sprint_notify on public.house_sprints;
create trigger funi_sprint_notify after insert on public.house_sprints for each row execute function public.funi_notify_sprint();

-- ---------- 6. Explain it back and the mistake bank ----------
create table if not exists public.house_explain_q (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  author uuid not null default auth.uid() references auth.users(id) on delete cascade,
  module text check (module is null or char_length(module) <= 30),
  body text not null check (char_length(body) between 3 and 300),
  created_at timestamptz not null default now()
);
create table if not exists public.house_explain_a (
  id uuid primary key default gen_random_uuid(),
  q_id uuid not null references public.house_explain_q(id) on delete cascade,
  house_id uuid not null references public.houses(id) on delete cascade,
  author uuid not null default auth.uid() references auth.users(id) on delete cascade,
  path text not null,
  mime text,
  secs int not null default 0 check (secs between 0 and 185),
  keep boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.house_explain_rate (
  a_id uuid not null references public.house_explain_a(id) on delete cascade,
  house_id uuid not null references public.houses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  primary key (a_id, user_id)
);
create table if not exists public.house_mistakes (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  author uuid not null default auth.uid() references auth.users(id) on delete cascade,
  module text check (module is null or char_length(module) <= 30),
  source text check (source is null or char_length(source) <= 60),
  mistake text not null check (char_length(mistake) between 3 and 300),
  fix text not null check (char_length(fix) between 3 and 300),
  created_at timestamptz not null default now()
);
create table if not exists public.house_mistake_saves (
  m_id uuid not null references public.house_mistakes(id) on delete cascade,
  house_id uuid not null references public.houses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (m_id, user_id)
);
alter table public.house_explain_q enable row level security;
alter table public.house_explain_a enable row level security;
alter table public.house_explain_rate enable row level security;
alter table public.house_mistakes enable row level security;
alter table public.house_mistake_saves enable row level security;
drop policy if exists explain_q_read on public.house_explain_q;
create policy explain_q_read on public.house_explain_q for select to authenticated using (public.funi_house_member(house_id));
drop policy if exists explain_q_add on public.house_explain_q;
create policy explain_q_add on public.house_explain_q for insert to authenticated with check (author = auth.uid() and public.funi_house_member(house_id));
drop policy if exists explain_q_remove on public.house_explain_q;
create policy explain_q_remove on public.house_explain_q for delete to authenticated using (author = auth.uid());
drop policy if exists explain_a_read on public.house_explain_a;
create policy explain_a_read on public.house_explain_a for select to authenticated using (public.funi_house_member(house_id));
drop policy if exists explain_a_add on public.house_explain_a;
create policy explain_a_add on public.house_explain_a for insert to authenticated
  with check (author = auth.uid() and public.funi_house_member(house_id) and split_part(path, '/', 1) = house_id::text
    and exists (select 1 from public.house_explain_q q where q.id = q_id and q.house_id = house_explain_a.house_id));
drop policy if exists explain_a_remove on public.house_explain_a;
create policy explain_a_remove on public.house_explain_a for delete to authenticated using (author = auth.uid());
drop policy if exists explain_rate_read on public.house_explain_rate;
create policy explain_rate_read on public.house_explain_rate for select to authenticated using (public.funi_house_member(house_id));
drop policy if exists explain_rate_mine on public.house_explain_rate;
create policy explain_rate_mine on public.house_explain_rate for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.funi_house_member(house_id) and exists (select 1 from public.house_explain_a a where a.id = a_id and a.house_id = house_explain_rate.house_id));
drop policy if exists mistakes_read on public.house_mistakes;
create policy mistakes_read on public.house_mistakes for select to authenticated using (public.funi_house_member(house_id));
drop policy if exists mistakes_add on public.house_mistakes;
create policy mistakes_add on public.house_mistakes for insert to authenticated with check (author = auth.uid() and public.funi_house_member(house_id));
drop policy if exists mistakes_remove on public.house_mistakes;
create policy mistakes_remove on public.house_mistakes for delete to authenticated using (author = auth.uid());
drop policy if exists mistake_saves_read on public.house_mistake_saves;
create policy mistake_saves_read on public.house_mistake_saves for select to authenticated using (public.funi_house_member(house_id));
drop policy if exists mistake_saves_mine on public.house_mistake_saves;
create policy mistake_saves_mine on public.house_mistake_saves for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.funi_house_member(house_id) and exists (select 1 from public.house_mistakes m where m.id = m_id and m.house_id = house_mistake_saves.house_id));

-- anyone in the house can tap ⭐ Keep on an answer (otherwise answers clear after 7 days)
create or replace function public.funi_explain_keep(a uuid, k boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare h uuid;
begin
  select house_id into h from public.house_explain_a where id = a;
  if h is null or not public.funi_house_member(h) then raise exception 'Answer not found'; end if;
  update public.house_explain_a set keep = coalesce(k, true) where id = a;
end $$;

create or replace function public.funi_notify_explain() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'house_explain_q' then
    perform public.funi_tell_house(new.house_id, new.author, new.author, '🎙️ ' || coalesce(public.funi_name(new.author), 'Someone') || ' asks: explain it back', new.body);
  else
    insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
    select q.author, new.author, 'house', '🎙️ ' || coalesce(public.funi_name(new.author), 'Someone') || ' explained it for you', q.body, new.house_id
    from public.house_explain_q q where q.id = new.q_id and q.author <> new.author;
  end if;
  return new;
end $$;
drop trigger if exists funi_explain_q_notify on public.house_explain_q;
create trigger funi_explain_q_notify after insert on public.house_explain_q for each row execute function public.funi_notify_explain();
drop trigger if exists funi_explain_a_notify on public.house_explain_a;
create trigger funi_explain_a_notify after insert on public.house_explain_a for each row execute function public.funi_notify_explain();

-- ---------- 7. Who can call what ----------
do $$
declare f text;
begin
  foreach f in array array['funi_quiz_state(uuid)', 'funi_quiz_answer(uuid,int,int)', 'funi_house_close_week(uuid)', 'funi_dare_set(uuid,text,text)',
                           'funi_dare_proof(uuid,text,text)', 'funi_explain_keep(uuid,boolean)', 'funi_my_crowns()', 'funi_house_crown(uuid)', 'funi_quiz_drop_day(uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

-- ---------- 7b. Editing a message you sent (within 15 minutes, like WhatsApp) ----------
alter table public.study_messages add column if not exists edited_at timestamptz;
create or replace function public.funi_edit_message(p_id uuid, p_body text) returns public.study_messages
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.study_messages;
begin
  select * into r from public.study_messages where id = p_id;
  if not found or r.sender_id <> auth.uid() then raise exception 'You can only edit your own messages.'; end if;
  if r.deleted_at is not null then raise exception 'That message was deleted.'; end if;
  if coalesce(r.file_type, '') = 'funi/sticker' or coalesce(r.file_type, '') like 'audio/%' then raise exception 'Only text can be edited.'; end if;
  if r.created_at < now() - interval '15 minutes' then raise exception 'Messages can only be edited for 15 minutes after you send them.'; end if;
  if p_body is null or char_length(trim(p_body)) < 1 then raise exception 'The message can''t be empty.'; end if;
  update public.study_messages set body = left(trim(p_body), 4000), edited_at = now() where id = p_id returning * into r;
  return r;
end $$;
revoke all on function public.funi_edit_message(uuid, text) from public, anon;
grant execute on function public.funi_edit_message(uuid, text) to authenticated;

-- ---------- 8. Live updates ----------
do $$
declare t text;
begin
  foreach t in array array['house_quiz_a', 'house_dares', 'house_dare_reacts', 'house_wishes', 'house_sprint_people', 'house_sprint_pages', 'house_explain_q', 'house_explain_a', 'house_mistakes'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      begin execute 'alter publication supabase_realtime add table public.' || t; exception when others then null; end;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
