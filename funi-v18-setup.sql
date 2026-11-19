-- Study with Funi v18: marks for tests ("What do I need?" for tests) + private usage stats for the owner
-- Run this once in Supabase: SQL editor → New query → paste → Run (after funi-v17-setup.sql). Safe to run again.

-- 1. Your marks for a test, so Funi can work out the mark you need in it
alter table public.assessments add column if not exists so_far numeric;     -- your average so far (%)
alter table public.assessments add column if not exists done_pct numeric;   -- how much the work so far is worth (%)
alter table public.assessments add column if not exists worth_pct numeric;  -- how much this test is worth (%)
alter table public.assessments add column if not exists want_pct numeric;   -- the average you want (%)

-- 2. Usage stats that only the app owner can see
create table if not exists public.funi_admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.funi_admins enable row level security; -- nobody reads it directly

-- the owner is the first account ever made (yours). The result at the bottom shows who it is.
insert into public.funi_admins (user_id)
select id from auth.users order by created_at limit 1
on conflict do nothing;

create or replace function public.funi_is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.funi_admins where user_id = auth.uid());
$$;

-- counts a table's rows, or 0 if that part of Funi isn't set up yet
create or replace function public.funi_count(t text) returns bigint
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare n bigint := 0;
begin
  if to_regclass('public.' || t) is not null then execute format('select count(*) from public.%I', t) into n; end if;
  return n;
end $$;
revoke all on function public.funi_count(text) from public, anon, authenticated;

create or replace function public.funi_admin_stats() returns json
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare out json;
begin
  if not public.funi_is_admin() then raise exception 'Only the owner can see these numbers.'; end if;
  select json_build_object(
    'users', (select count(*) from auth.users),
    'new_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'active_7d', (select count(distinct u) from (
        select user_id u from public.study_sessions where started_at > now() - interval '7 days'
        union select sender_id from public.study_messages where created_at > now() - interval '7 days') a),
    'active_30d', (select count(distinct u) from (
        select user_id u from public.study_sessions where started_at > now() - interval '30 days'
        union select sender_id from public.study_messages where created_at > now() - interval '30 days') a),
    'study_hours', (select round(coalesce(sum(focus_seconds), 0) / 3600.0, 1) from public.study_sessions),
    'study_hours_7d', (select round(coalesce(sum(focus_seconds), 0) / 3600.0, 1) from public.study_sessions where started_at > now() - interval '7 days'),
    'sessions', (select count(*) from public.study_sessions where coalesce(focus_seconds, 0) >= 60),
    'messages', (select count(*) from public.study_messages),
    'tests', (select count(*) from public.assessments),
    'files', public.funi_count('module_files'),
    'houses', public.funi_count('houses'),
    'rooms', public.funi_count('study_rooms'),
    'decks', public.funi_count('flash_decks'),
    'weeks', (select coalesce(json_agg(w order by w.week), '[]'::json) from (
        select to_char(date_trunc('week', g), 'YYYY-MM-DD') as week,
               (select count(distinct s.user_id) from public.study_sessions s where s.started_at >= date_trunc('week', g) and s.started_at < date_trunc('week', g) + interval '7 days') as active,
               (select round(coalesce(sum(s.focus_seconds), 0) / 3600.0, 1) from public.study_sessions s where s.started_at >= date_trunc('week', g) and s.started_at < date_trunc('week', g) + interval '7 days') as hours
        from generate_series(now() - interval '7 weeks', now(), interval '1 week') g) w)
  ) into out;
  return out;
end $$;

revoke all on function public.funi_is_admin() from public, anon;
grant execute on function public.funi_is_admin() to authenticated;
revoke all on function public.funi_admin_stats() from public, anon;
grant execute on function public.funi_admin_stats() to authenticated;

notify pgrst, 'reload schema';

-- who can see the stats (should be you):
select u.email, u.raw_user_meta_data->>'username' as username, u.created_at
from public.funi_admins a join auth.users u on u.id = a.user_id;
