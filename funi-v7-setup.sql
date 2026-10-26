-- Study with Funi v7: fun with friends.
-- Study rooms (shared timer + cheers), leaderboard + streaks + study garden, flashcards you can share,
-- quiz battles, and nicer notifications for voice notes. Everything here is text, so it uses almost no space.
-- Safe to run again any time.

-- ---------- 1. Notifications know the new kinds ----------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('invite','accepted','message','help','studying','room','deck','battle'));

-- ---------- 2. Study rooms ----------
create table if not exists public.study_rooms (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  module_code text check (module_code is null or char_length(module_code) <= 40),
  focus_minutes int not null default 25 check (focus_minutes between 1 and 240),
  break_minutes int not null default 5 check (break_minutes between 1 and 60),
  round int not null default 0 check (round >= 0),
  phase text not null default 'waiting' check (phase in ('waiting','focus','break')),
  phase_ends_at timestamptz,
  is_open boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists study_rooms_open on public.study_rooms (is_open, created_at desc);

create table if not exists public.study_room_members (
  room_id uuid not null references public.study_rooms(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task text check (task is null or char_length(task) <= 60),
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  left_at timestamptz,
  primary key (room_id, user_id)
);

create table if not exists public.study_room_cheers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.study_rooms(id) on delete cascade,
  from_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null check (label in ('You got this!','Proud of you','Almost there','Drink water','Let''s go!')),
  created_at timestamptz not null default now()
);

create or replace function public.funi_can_see_room(rid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.study_rooms r
                 where r.id = rid and (r.host_id = auth.uid() or public.funi_are_partners(auth.uid(), r.host_id)))
      or exists (select 1 from public.study_room_members m where m.room_id = rid and m.user_id = auth.uid());
$$;
create or replace function public.funi_in_room(rid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.study_room_members m where m.room_id = rid and m.user_id = auth.uid() and m.left_at is null)
      or exists (select 1 from public.study_rooms r where r.id = rid and r.host_id = auth.uid());
$$;

alter table public.study_rooms enable row level security;
alter table public.study_room_members enable row level security;
alter table public.study_room_cheers enable row level security;
drop policy if exists rooms_read on public.study_rooms;
drop policy if exists rooms_add on public.study_rooms;
drop policy if exists rooms_change on public.study_rooms;
drop policy if exists rooms_remove on public.study_rooms;
create policy rooms_read on public.study_rooms for select to authenticated using (public.funi_can_see_room(id));
create policy rooms_add on public.study_rooms for insert to authenticated with check (host_id = auth.uid());
create policy rooms_change on public.study_rooms for update to authenticated using (public.funi_in_room(id)) with check (public.funi_in_room(id));
create policy rooms_remove on public.study_rooms for delete to authenticated using (host_id = auth.uid());
drop policy if exists room_members_read on public.study_room_members;
drop policy if exists room_members_join on public.study_room_members;
drop policy if exists room_members_change on public.study_room_members;
drop policy if exists room_members_leave on public.study_room_members;
create policy room_members_read on public.study_room_members for select to authenticated using (public.funi_can_see_room(room_id));
create policy room_members_join on public.study_room_members for insert to authenticated
  with check (user_id = auth.uid() and public.funi_can_see_room(room_id)
              and exists (select 1 from public.study_rooms r where r.id = room_id and r.is_open));
create policy room_members_change on public.study_room_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy room_members_leave on public.study_room_members for delete to authenticated using (user_id = auth.uid());
drop policy if exists room_cheers_read on public.study_room_cheers;
drop policy if exists room_cheers_send on public.study_room_cheers;
create policy room_cheers_read on public.study_room_cheers for select to authenticated using (public.funi_can_see_room(room_id));
create policy room_cheers_send on public.study_room_cheers for insert to authenticated with check (from_id = auth.uid() and public.funi_in_room(room_id));

-- people in the same room can see each other's name and avatar, even if they aren't partners yet
create or replace function public.funi_shares_room(other uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.study_room_members a join public.study_room_members b on a.room_id = b.room_id
                 join public.study_rooms r on r.id = a.room_id
                 where a.user_id = auth.uid() and b.user_id = other and r.is_open);
$$;
drop policy if exists study_profiles_read_self_or_partners on public.study_profiles;
create policy study_profiles_read_self_or_partners on public.study_profiles for select to authenticated
using (id = auth.uid() or exists (
  select 1 from public.study_partners p
  where p.status in ('accepted','pending')
    and ((p.requester_id = auth.uid() and p.addressee_id = study_profiles.id)
      or (p.addressee_id = auth.uid() and p.requester_id = study_profiles.id)))
  or public.funi_shares_room(study_profiles.id));

alter table public.study_sessions add column if not exists room_id uuid references public.study_rooms(id) on delete set null;

create or replace function public.funi_notify_room() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare who text := coalesce(public.funi_name(new.host_id), 'Your study partner');
begin
  insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
  select case when p.requester_id = new.host_id then p.addressee_id else p.requester_id end,
         new.host_id, 'room', who || ' opened a study room',
         new.name || ' · ' || new.focus_minutes || ' min rounds. Tap to join!', new.id
  from public.study_partners p
  where p.status = 'accepted' and (p.requester_id = new.host_id or p.addressee_id = new.host_id);
  return new;
end $$;
drop trigger if exists funi_room_notify on public.study_rooms;
create trigger funi_room_notify after insert on public.study_rooms for each row execute function public.funi_notify_room();

-- ---------- 3. Leaderboard, streaks and the garden (only totals, never session details) ----------
create or replace function public.funi_circle_stats()
returns table (user_id uuid, week_seconds int, last_week_seconds int, week_rounds int, study_days date[], last_study date)
language sql stable security definer set search_path = public, pg_temp as $$
  with circle as (
    select auth.uid() as uid where auth.uid() is not null
    union
    select case when p.requester_id = auth.uid() then p.addressee_id else p.requester_id end
    from public.study_partners p
    where p.status = 'accepted' and (p.requester_id = auth.uid() or p.addressee_id = auth.uid())
  ),
  wk as (select date_trunc('week', now() at time zone 'Africa/Johannesburg') as start),
  s as (
    select ss.user_id, (ss.started_at at time zone 'Africa/Johannesburg') as local, coalesce(ss.focus_seconds, 0) as fs
    from public.study_sessions ss join circle c on c.uid = ss.user_id
    where ss.started_at > now() - interval '70 days'
      and (ss.user_id = auth.uid() or ss.share_with_partners)
  )
  select c.uid,
    coalesce(sum(s.fs) filter (where s.local >= wk.start), 0)::int,
    coalesce(sum(s.fs) filter (where s.local >= wk.start - interval '7 days' and s.local < wk.start), 0)::int,
    (count(*) filter (where s.local >= wk.start and s.fs >= 600))::int,
    coalesce((select array_agg(d order by d) from (
       select s2.local::date as d from s s2 where s2.user_id = c.uid group by 1 having sum(s2.fs) >= 900) x), '{}'),
    (select max(s3.local::date) from s s3 where s3.user_id = c.uid and s3.fs >= 60)
  from circle c cross join wk left join s on s.user_id = c.uid
  group by c.uid, wk.start;
$$;
revoke all on function public.funi_circle_stats() from public, anon;
grant execute on function public.funi_circle_stats() to authenticated;

-- ---------- 4. Flashcards ----------
create table if not exists public.flash_decks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  module_code text check (module_code is null or char_length(module_code) <= 40),
  title text not null check (char_length(title) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.flash_cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.flash_decks(id) on delete cascade,
  front text not null check (char_length(front) between 1 and 300),
  back text not null check (char_length(back) between 1 and 300),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists flash_cards_deck on public.flash_cards (deck_id, position);
create table if not exists public.flash_shares (
  deck_id uuid not null references public.flash_decks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  shared_at timestamptz not null default now(),
  primary key (deck_id, user_id)
);
create table if not exists public.flash_progress (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  card_id uuid not null references public.flash_cards(id) on delete cascade,
  known boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

create or replace function public.funi_owns_deck(did uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.flash_decks d where d.id = did and d.owner_id = auth.uid());
$$;
create or replace function public.funi_can_see_deck(did uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.funi_owns_deck(did)
      or exists (select 1 from public.flash_shares s where s.deck_id = did and s.user_id = auth.uid());
$$;
-- at most 300 cards in a deck
create or replace function public.funi_card_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select count(*) from public.flash_cards where deck_id = new.deck_id) >= 300 then
    raise exception 'This deck is full (300 cards). Start a new deck.';
  end if;
  return new;
end $$;
drop trigger if exists funi_card_limit on public.flash_cards;
create trigger funi_card_limit before insert on public.flash_cards for each row execute function public.funi_card_limit();

alter table public.flash_decks enable row level security;
alter table public.flash_cards enable row level security;
alter table public.flash_shares enable row level security;
alter table public.flash_progress enable row level security;
drop policy if exists decks_read on public.flash_decks;
drop policy if exists decks_add on public.flash_decks;
drop policy if exists decks_change on public.flash_decks;
drop policy if exists decks_remove on public.flash_decks;
create policy decks_read on public.flash_decks for select to authenticated using (public.funi_can_see_deck(id));
create policy decks_add on public.flash_decks for insert to authenticated with check (owner_id = auth.uid());
create policy decks_change on public.flash_decks for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy decks_remove on public.flash_decks for delete to authenticated using (owner_id = auth.uid());
drop policy if exists cards_read on public.flash_cards;
drop policy if exists cards_add on public.flash_cards;
drop policy if exists cards_change on public.flash_cards;
drop policy if exists cards_remove on public.flash_cards;
create policy cards_read on public.flash_cards for select to authenticated using (public.funi_can_see_deck(deck_id));
create policy cards_add on public.flash_cards for insert to authenticated with check (public.funi_owns_deck(deck_id));
create policy cards_change on public.flash_cards for update to authenticated using (public.funi_owns_deck(deck_id)) with check (public.funi_owns_deck(deck_id));
create policy cards_remove on public.flash_cards for delete to authenticated using (public.funi_owns_deck(deck_id));
drop policy if exists shares_read on public.flash_shares;
drop policy if exists shares_add on public.flash_shares;
drop policy if exists shares_remove on public.flash_shares;
create policy shares_read on public.flash_shares for select to authenticated using (user_id = auth.uid() or public.funi_owns_deck(deck_id));
create policy shares_add on public.flash_shares for insert to authenticated
  with check (public.funi_owns_deck(deck_id) and public.funi_are_partners(auth.uid(), user_id));
create policy shares_remove on public.flash_shares for delete to authenticated using (user_id = auth.uid() or public.funi_owns_deck(deck_id));
drop policy if exists progress_own on public.flash_progress;
create policy progress_own on public.flash_progress for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.funi_notify_deck_share() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare d record;
begin
  select owner_id, title into d from public.flash_decks where id = new.deck_id;
  insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
  values (new.user_id, d.owner_id, 'deck', coalesce(public.funi_name(d.owner_id), 'Your study partner') || ' shared flashcards with you',
          d.title, new.deck_id);
  return new;
end $$;
drop trigger if exists funi_deck_share_notify on public.flash_shares;
create trigger funi_deck_share_notify after insert on public.flash_shares for each row execute function public.funi_notify_deck_share();

-- ---------- 5. Quiz battles ----------
create table if not exists public.quiz_battles (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid references public.flash_decks(id) on delete set null,
  deck_title text not null check (char_length(deck_title) between 1 and 60),
  challenger_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  opponent_id uuid not null references auth.users(id) on delete cascade,
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) between 1 and 10 and pg_column_size(questions) < 40000),
  created_at timestamptz not null default now(),
  check (challenger_id <> opponent_id)
);
create table if not exists public.quiz_answers (
  battle_id uuid not null references public.quiz_battles(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  q int not null check (q between 0 and 9),
  choice int not null check (choice between -1 and 3),
  correct boolean not null,
  ms int not null check (ms between 0 and 600000),
  created_at timestamptz not null default now(),
  primary key (battle_id, user_id, q)
);
create or replace function public.funi_in_battle(bid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.quiz_battles b where b.id = bid and auth.uid() in (b.challenger_id, b.opponent_id));
$$;
alter table public.quiz_battles enable row level security;
alter table public.quiz_answers enable row level security;
drop policy if exists battles_read on public.quiz_battles;
drop policy if exists battles_add on public.quiz_battles;
drop policy if exists battles_remove on public.quiz_battles;
create policy battles_read on public.quiz_battles for select to authenticated using (auth.uid() in (challenger_id, opponent_id));
create policy battles_add on public.quiz_battles for insert to authenticated
  with check (challenger_id = auth.uid() and public.funi_are_partners(auth.uid(), opponent_id));
create policy battles_remove on public.quiz_battles for delete to authenticated using (auth.uid() in (challenger_id, opponent_id));
drop policy if exists answers_read on public.quiz_answers;
drop policy if exists answers_add on public.quiz_answers;
create policy answers_read on public.quiz_answers for select to authenticated using (public.funi_in_battle(battle_id));
create policy answers_add on public.quiz_answers for insert to authenticated with check (user_id = auth.uid() and public.funi_in_battle(battle_id));

create or replace function public.funi_notify_battle() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
  values (new.opponent_id, new.challenger_id, 'battle',
          coalesce(public.funi_name(new.challenger_id), 'Your study partner') || ' challenged you to a quiz battle',
          new.deck_title || ' · ' || jsonb_array_length(new.questions) || ' questions', new.id);
  return new;
end $$;
drop trigger if exists funi_battle_notify on public.quiz_battles;
create trigger funi_battle_notify after insert on public.quiz_battles for each row execute function public.funi_notify_battle();

-- ---------- 6. Voice notes say "Sent a voice note" ----------
create or replace function public.funi_notify_message()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare who text := coalesce(public.funi_name(new.sender_id), 'Your study partner');
begin
  insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
  values (new.recipient_id, new.sender_id,
          case when new.is_help then 'help' else 'message' end,
          case when new.is_help then who || ' needs help' else 'New message from ' || who end,
          case when coalesce(new.body, '') <> '' then left(new.body, 140)
               when coalesce(new.file_type, '') like 'audio/%' then 'Sent a voice note'
               else 'Sent a file: ' || coalesce(new.file_name, 'attachment') end,
          new.id);
  return new;
end $$;

-- ---------- 7. Live updates for the new things ----------
do $$
declare t text;
begin
  foreach t in array array['study_rooms','study_room_members','study_room_cheers','flash_shares','quiz_battles','quiz_answers'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
