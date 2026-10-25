-- =====================================================================
--  Study with Funi — v3 database setup
--  Run this AFTER funi-v2-setup.sql (which you already ran).
--  Paste ALL of it into Supabase › SQL Editor › New query, then Run.
--  Safe to run more than once. It keeps your existing data.
--  Adds: reminder alerts (e.g. 30 min before), task priority, focus time
--        for the dashboard graph, phone notifications when Funi is closed,
--        and profile photos.
-- =====================================================================

-- ---------- 1. Tasks & reminders: priority and "notify me before" ----------
alter table public.tasks add column if not exists priority text not null default 'Medium';
alter table public.tasks drop constraint if exists tasks_priority_check;
alter table public.tasks add constraint tasks_priority_check check (priority in ('High','Medium','Low'));
alter table public.tasks add column if not exists remind_offset int;           -- minutes before; null = no alert
alter table public.tasks add column if not exists remind_at timestamptz;       -- when to send the alert
alter table public.tasks add column if not exists reminded_at timestamptz;     -- when it was sent
create index if not exists tasks_remind_idx on public.tasks(remind_at) where reminded_at is null and done = false;
-- tasks done earlier this month are kept for the dashboard counts
create index if not exists tasks_user_done_idx on public.tasks(user_id, done_at);

-- ---------- 2. Focus time for the dashboard graph ----------
alter table public.study_sessions add column if not exists focus_seconds int not null default 0;

-- ---------- 3. Phone notifications when Funi is closed (Web Push) ----------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subs_own on public.push_subscriptions;
create policy push_subs_own on public.push_subscriptions for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;

alter table public.notifications add column if not exists pushed_at timestamptz;

-- app settings only the server can read (no policies = students can't see it)
create table if not exists public.funi_settings (
  name text primary key,
  value text not null
);
alter table public.funi_settings enable row level security;
revoke all on public.funi_settings from anon, authenticated;

-- ---------- 4. Profile photos ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('avatars', 'avatars', true, 3145728)
on conflict (id) do update set public = true, file_size_limit = 3145728;
drop policy if exists "funi avatar upload own folder" on storage.objects;
create policy "funi avatar upload own folder" on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "funi avatar delete own" on storage.objects;
create policy "funi avatar delete own" on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
alter table public.study_profiles drop constraint if exists study_profiles_avatar_check;
alter table public.study_profiles add constraint study_profiles_avatar_check check (avatar is null or char_length(avatar) <= 500);

-- ---------- 5. Every minute, ask Funi's server to send due alerts ----------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule(
  'funi-push',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://study-with-funi.vercel.app/api/push',
       body := '{}'::jsonb,
       headers := '{"Content-Type": "application/json"}'::jsonb
     ); $$
);

-- Done! You should see one row with a number (the job id), or "Success".
