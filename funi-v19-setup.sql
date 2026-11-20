-- Study with Funi v19: marks book, more test types, privacy (delete my account), problem reports
-- Run this once in Supabase: SQL editor → New query → paste → Run (after funi-v18-setup.sql). Safe to run again.

/* ---------- 1. Marks book: everything that counts in a module ---------- */
create table if not exists public.grade_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  module_code text not null check (char_length(module_code) between 1 and 30),
  name text not null check (char_length(name) between 1 and 60),
  kind text not null default 'Test',
  weight numeric check (weight is null or (weight >= 0 and weight <= 100)),   -- % of the final mark (null inside a group)
  mark numeric check (mark is null or (mark >= 0 and mark <= 100)),           -- your mark in %
  is_group boolean not null default false,                                    -- e.g. "Tutorials: best 4 of 10"
  best_n int check (best_n is null or best_n between 1 and 50),
  group_id uuid references public.grade_items(id) on delete cascade,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists grade_items_user_module on public.grade_items (user_id, module_code);
alter table public.grade_items enable row level security;
drop policy if exists "own grades" on public.grade_items;
create policy "own grades" on public.grade_items for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- per module: the DP minimum (to be allowed to write the exam) and the final mark you're aiming for
alter table public.modules add column if not exists dp_min numeric;
alter table public.modules add column if not exists target numeric;

/* ---------- 2. Problem reports ("Report a problem") ---------- */
create table if not exists public.funi_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  page text, device text, shot_path text,
  status text not null default 'new' check (status in ('new', 'seen', 'fixed')),
  created_at timestamptz not null default now()
);
alter table public.funi_reports enable row level security;
drop policy if exists "report add" on public.funi_reports;
drop policy if exists "report read" on public.funi_reports;
drop policy if exists "report change" on public.funi_reports;
create policy "report add" on public.funi_reports for insert to authenticated with check (user_id = auth.uid());
create policy "report read" on public.funi_reports for select to authenticated using (user_id = auth.uid() or public.funi_is_admin());
create policy "report change" on public.funi_reports for update to authenticated using (public.funi_is_admin()) with check (public.funi_is_admin());

-- screenshots for reports: you upload your own, only the owner of Funi can read them
insert into storage.buckets (id, name, public, file_size_limit) values ('reports', 'reports', false, 5242880) on conflict (id) do nothing;
drop policy if exists "report shots add" on storage.objects;
drop policy if exists "report shots read" on storage.objects;
create policy "report shots add" on storage.objects for insert to authenticated
  with check (bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "report shots read" on storage.objects for select to authenticated
  using (bucket_id = 'reports' and ((storage.foldername(name))[1] = auth.uid()::text or public.funi_is_admin()));

-- tell the owner when a report comes in
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('invite','accepted','message','help','studying','room','deck','battle','share','house','quiz','report'));
create or replace function public.funi_report_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
  select a.user_id, new.user_id, 'report', '🐞 New problem report', left(new.body, 140), new.id from public.funi_admins a;
  return new;
end $$;
drop trigger if exists funi_report_notify on public.funi_reports;
create trigger funi_report_notify after insert on public.funi_reports for each row execute function public.funi_report_notify();

/* ---------- 3. Delete my account ---------- */
-- Removes your account and everything that belongs to you. Houses you own pass to the longest-standing member.
create or replace function public.funi_delete_me() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); r record; t text;
begin
  if me is null then raise exception 'Not logged in.'; end if;
  -- houses you own: hand them over instead of deleting them for everyone
  if to_regclass('public.houses') is not null then
    for r in select h.id, (select m.user_id from public.house_members m where m.house_id = h.id and m.user_id <> me and m.status = 'joined' order by m.joined_at nulls last limit 1) as heir
             from public.houses h where h.owner_id = me loop
      if r.heir is not null then
        update public.houses set owner_id = r.heir where id = r.id;
        update public.house_members set role = 'owner' where house_id = r.id and user_id = r.heir;
      else delete from public.houses where id = r.id; end if;
    end loop;
  end if;
  -- your own rows in tables that aren't tied to your account directly
  foreach t in array array['assessments', 'modules', 'tasks'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'user_id') then
      execute format('delete from public.%I where user_id = $1', t) using me;
    end if;
  end loop;
  delete from auth.users where id = me; -- everything else is removed with the account
end $$;
revoke all on function public.funi_delete_me() from public, anon;
grant execute on function public.funi_delete_me() to authenticated;

notify pgrst, 'reload schema';
