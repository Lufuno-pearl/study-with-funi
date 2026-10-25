-- =====================================================================
--  Study with Funi — v2 database setup
--  Paste ALL of this into Supabase › SQL Editor › New query, then Run.
--  Safe to run more than once. It keeps your existing data.
--  Adds: study partners, feelings, live chat with files, notifications,
--        tasks & reminders, marks per module.
-- =====================================================================

-- ---------- 1. Study Circle tables (created only if missing) ----------
create table if not exists public.study_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  feeling text not null default 'Okay' check (feeling in ('Feeling great','Happy','Okay','Confused','Stressed','Need help')),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.study_profiles add column if not exists display_name text check (display_name is null or char_length(display_name) <= 30);
alter table public.study_profiles add column if not exists avatar text check (avatar is null or char_length(avatar) <= 300);

create table if not exists public.study_partners (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  check (requester_id <> addressee_id),
  unique (requester_id, addressee_id)
);

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  module_code text not null,
  feeling text not null check (feeling in ('Feeling great','Happy','Okay','Confused','Stressed','Need help')),
  activity text not null default 'Practice questions',
  share_with_partners boolean not null default true,
  is_active boolean not null default true,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
alter table public.study_sessions add column if not exists planned_minutes int;

create table if not exists public.study_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);
-- files in chat + "I need help" messages
alter table public.study_messages add column if not exists file_path text;
alter table public.study_messages add column if not exists file_name text;
alter table public.study_messages add column if not exists file_type text;
alter table public.study_messages add column if not exists file_size int;
alter table public.study_messages add column if not exists is_help boolean not null default false;
alter table public.study_messages alter column body set default '';
alter table public.study_messages drop constraint if exists study_messages_body_check;
alter table public.study_messages add constraint study_messages_body_check
  check (char_length(body) <= 4000 and (char_length(body) >= 1 or file_path is not null));

create table if not exists public.study_profile_modules (
  user_id uuid not null references auth.users(id) on delete cascade,
  module_code text not null check (length(trim(module_code)) between 1 and 30),
  updated_at timestamptz not null default now(),
  primary key (user_id, module_code)
);

create index if not exists study_partners_requester_idx on public.study_partners(requester_id, status);
create index if not exists study_partners_addressee_idx on public.study_partners(addressee_id, status);
create index if not exists study_sessions_user_active_idx on public.study_sessions(user_id, is_active, started_at desc);
create index if not exists study_messages_pair_idx on public.study_messages(sender_id, recipient_id, created_at);
create index if not exists study_messages_recipient_idx on public.study_messages(recipient_id, read_at);
create index if not exists study_profile_modules_code_idx on public.study_profile_modules(module_code);

-- ---------- 2. Marks per module ----------
alter table public.modules add column if not exists exam_weight numeric default 60;
alter table public.modules add column if not exists subminimum numeric default 40;

-- ---------- 3. Tasks & reminders ----------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  module text,
  due_date date not null default current_date,
  due_time time,
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tasks_user_date_idx on public.tasks(user_id, due_date);

-- ---------- 4. Notifications ----------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete cascade,
  kind text not null check (kind in ('invite','accepted','message','help','studying')),
  title text not null,
  body text,
  ref_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

-- ---------- 5. Row level security (each person only sees what they should) ----------
alter table public.study_profiles enable row level security;
alter table public.study_partners enable row level security;
alter table public.study_sessions enable row level security;
alter table public.study_messages enable row level security;
alter table public.study_profile_modules enable row level security;
alter table public.tasks enable row level security;
alter table public.notifications enable row level security;

create or replace function public.funi_are_partners(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.study_partners p
    where p.status = 'accepted'
      and ((p.requester_id = a and p.addressee_id = b) or (p.requester_id = b and p.addressee_id = a))
  );
$$;

drop policy if exists study_profiles_read_self_or_partners on public.study_profiles;
create policy study_profiles_read_self_or_partners on public.study_profiles for select to authenticated
using (id = auth.uid() or exists (
  select 1 from public.study_partners p
  where p.status in ('accepted','pending')
    and ((p.requester_id = auth.uid() and p.addressee_id = study_profiles.id)
      or (p.addressee_id = auth.uid() and p.requester_id = study_profiles.id))));
drop policy if exists study_profiles_insert_self on public.study_profiles;
create policy study_profiles_insert_self on public.study_profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists study_profiles_update_self on public.study_profiles;
create policy study_profiles_update_self on public.study_profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists study_partners_read_participant on public.study_partners;
create policy study_partners_read_participant on public.study_partners for select to authenticated
using (requester_id = auth.uid() or addressee_id = auth.uid());
drop policy if exists study_partners_invite_self on public.study_partners;
create policy study_partners_invite_self on public.study_partners for insert to authenticated
with check (requester_id = auth.uid() and addressee_id <> auth.uid() and status = 'pending');
drop policy if exists study_partners_update_participant on public.study_partners;
create policy study_partners_update_participant on public.study_partners for update to authenticated
using (addressee_id = auth.uid() or (requester_id = auth.uid() and status = 'pending'))
with check ((requester_id = auth.uid() or addressee_id = auth.uid()) and status in ('pending','accepted','rejected'));
drop policy if exists study_partners_delete_participant on public.study_partners;
create policy study_partners_delete_participant on public.study_partners for delete to authenticated
using (requester_id = auth.uid() or addressee_id = auth.uid());

drop policy if exists study_sessions_read_self_or_shared_partners on public.study_sessions;
create policy study_sessions_read_self_or_shared_partners on public.study_sessions for select to authenticated
using (user_id = auth.uid() or (share_with_partners and public.funi_are_partners(auth.uid(), user_id)));
drop policy if exists study_sessions_insert_self on public.study_sessions;
create policy study_sessions_insert_self on public.study_sessions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists study_sessions_update_self on public.study_sessions;
create policy study_sessions_update_self on public.study_sessions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists study_messages_read_participants on public.study_messages;
create policy study_messages_read_participants on public.study_messages for select to authenticated
using (sender_id = auth.uid() or recipient_id = auth.uid());
drop policy if exists study_messages_send_to_partner on public.study_messages;
create policy study_messages_send_to_partner on public.study_messages for insert to authenticated
with check (sender_id = auth.uid() and public.funi_are_partners(auth.uid(), recipient_id));
drop policy if exists study_messages_mark_received on public.study_messages;
create policy study_messages_mark_received on public.study_messages for update to authenticated
using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

drop policy if exists study_modules_read_self_or_partner on public.study_profile_modules;
create policy study_modules_read_self_or_partner on public.study_profile_modules for select to authenticated
using (user_id = auth.uid() or public.funi_are_partners(auth.uid(), user_id));
drop policy if exists study_modules_insert_self on public.study_profile_modules;
create policy study_modules_insert_self on public.study_profile_modules for insert to authenticated with check (user_id = auth.uid());
drop policy if exists study_modules_update_self on public.study_profile_modules;
create policy study_modules_update_self on public.study_profile_modules for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists study_modules_delete_self on public.study_profile_modules;
create policy study_modules_delete_self on public.study_profile_modules for delete to authenticated using (user_id = auth.uid());

drop policy if exists tasks_own on public.tasks;
create policy tasks_own on public.tasks for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications for delete to authenticated using (user_id = auth.uid());

grant select, insert, update on public.study_profiles to authenticated;
grant select, insert, update, delete on public.study_partners to authenticated;
grant select, insert, update on public.study_sessions to authenticated;
grant select, insert, update on public.study_messages to authenticated;
grant select, insert, update, delete on public.study_profile_modules to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, update, delete on public.notifications to authenticated;

-- ---------- 6. Profiles are made automatically for every account ----------
create or replace function public.funi_new_user_profile()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare uname text := lower(split_part(new.email, '@', 1));
begin
  if uname ~ '^[a-z0-9_.]{3,20}$' then
    insert into public.study_profiles (id, username) values (new.id, uname) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists funi_on_auth_user_created on auth.users;
create trigger funi_on_auth_user_created after insert on auth.users
for each row execute function public.funi_new_user_profile();

-- existing accounts get a profile too
insert into public.study_profiles (id, username)
select u.id, lower(split_part(u.email, '@', 1)) from auth.users u
where lower(split_part(u.email, '@', 1)) ~ '^[a-z0-9_.]{3,20}$'
on conflict do nothing;

-- ---------- 7. Find friends by username + suggested partners ----------
drop function if exists public.search_study_users(text);
create function public.search_study_users(search_text text)
returns table (id uuid, username text, display_name text, avatar text, feeling text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.username, p.display_name, p.avatar, p.feeling
  from public.study_profiles p
  where auth.uid() is not null and p.id <> auth.uid()
    and length(trim(search_text)) >= 2
    and (p.username ilike left(lower(trim(search_text)), 20) || '%'
      or p.display_name ilike '%' || left(trim(search_text), 20) || '%')
  order by p.username limit 10;
$$;

drop function if exists public.find_study_matches();
create function public.find_study_matches()
returns table (user_id uuid, username text, display_name text, avatar text, feeling text, shared_modules text[], match_score integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.username, p.display_name, p.avatar, p.feeling,
         array_agg(distinct upper(mine.module_code) order by upper(mine.module_code)),
         count(distinct upper(mine.module_code))::integer
  from public.study_profiles p
  join public.study_profile_modules theirs on theirs.user_id = p.id
  join public.study_profile_modules mine on upper(trim(mine.module_code)) = upper(trim(theirs.module_code)) and mine.user_id = auth.uid()
  where auth.uid() is not null and p.id <> auth.uid()
    and not exists (select 1 from public.study_partners sp
      where (sp.requester_id = auth.uid() and sp.addressee_id = p.id) or (sp.addressee_id = auth.uid() and sp.requester_id = p.id))
  group by p.id, p.username, p.display_name, p.avatar, p.feeling
  order by 7 desc, p.username limit 20;
$$;
revoke all on function public.search_study_users(text) from public;
revoke all on function public.find_study_matches() from public;
grant execute on function public.search_study_users(text) to authenticated;
grant execute on function public.find_study_matches() to authenticated;

-- ---------- 8. Notifications are created automatically ----------
create or replace function public.funi_name(uid uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(display_name, ''), username, 'Your study partner') from public.study_profiles where id = uid;
$$;

create or replace function public.funi_notify_partner_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
    values (new.addressee_id, new.requester_id, 'invite',
            coalesce(public.funi_name(new.requester_id), 'Someone') || ' wants to be your study partner',
            'Open Partners › Invitations to accept.', new.id);
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status is distinct from 'accepted' then
    insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
    values (new.requester_id, new.addressee_id, 'accepted',
            coalesce(public.funi_name(new.addressee_id), 'Your friend') || ' accepted your invite',
            'You can now chat and see each other''s study sessions.', new.id);
  end if;
  return new;
end $$;
drop trigger if exists funi_partner_notify on public.study_partners;
create trigger funi_partner_notify after insert or update on public.study_partners
for each row execute function public.funi_notify_partner_change();

create or replace function public.funi_notify_message()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare who text := coalesce(public.funi_name(new.sender_id), 'Your study partner');
begin
  insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
  values (new.recipient_id, new.sender_id,
          case when new.is_help then 'help' else 'message' end,
          case when new.is_help then who || ' needs help' else 'New message from ' || who end,
          case when coalesce(new.body, '') <> '' then left(new.body, 140) else 'Sent a file: ' || coalesce(new.file_name, 'attachment') end,
          new.id);
  return new;
end $$;
drop trigger if exists funi_message_notify on public.study_messages;
create trigger funi_message_notify after insert on public.study_messages
for each row execute function public.funi_notify_message();

create or replace function public.funi_notify_session()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare who text := coalesce(public.funi_name(new.user_id), 'Your study partner');
begin
  if new.share_with_partners then
    insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
    select case when p.requester_id = new.user_id then p.addressee_id else p.requester_id end,
           new.user_id, 'studying', who || ' started studying',
           new.module_code || ' · Feeling: ' || new.feeling, new.id
    from public.study_partners p
    where p.status = 'accepted' and (p.requester_id = new.user_id or p.addressee_id = new.user_id);
  end if;
  return new;
end $$;
drop trigger if exists funi_session_notify on public.study_sessions;
create trigger funi_session_notify after insert on public.study_sessions
for each row execute function public.funi_notify_session();

create or replace function public.funi_notify_feeling()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare who text := coalesce(nullif(new.display_name, ''), new.username);
begin
  if new.feeling = 'Need help' and old.feeling is distinct from 'Need help' then
    insert into public.notifications (user_id, actor_id, kind, title, body)
    select case when p.requester_id = new.id then p.addressee_id else p.requester_id end,
           new.id, 'help', who || ' needs help', 'They set their feeling to "Need help". Send them a message 💜'
    from public.study_partners p
    where p.status = 'accepted' and (p.requester_id = new.id or p.addressee_id = new.id);
  end if;
  return new;
end $$;
drop trigger if exists funi_feeling_notify on public.study_profiles;
create trigger funi_feeling_notify after update of feeling on public.study_profiles
for each row execute function public.funi_notify_feeling();

-- ---------- 9. Files in chat (private storage) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-files', 'chat-files', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

drop policy if exists "funi chat upload own folder" on storage.objects;
create policy "funi chat upload own folder" on storage.objects for insert to authenticated
with check (bucket_id = 'chat-files' and (storage.foldername(name))[1] = auth.uid()::text
            and public.funi_are_partners(auth.uid(), ((storage.foldername(name))[2])::uuid));
drop policy if exists "funi chat read sender or recipient" on storage.objects;
create policy "funi chat read sender or recipient" on storage.objects for select to authenticated
using (bucket_id = 'chat-files' and auth.uid()::text in ((storage.foldername(name))[1], (storage.foldername(name))[2]));
drop policy if exists "funi chat delete own" on storage.objects;
create policy "funi chat delete own" on storage.objects for delete to authenticated
using (bucket_id = 'chat-files' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 10. Live updates (messages pop up without refreshing) ----------
do $$
declare t text;
begin
  foreach t in array array['study_messages','notifications','study_sessions','study_profiles','study_partners'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Done! You should see "Success. No rows returned".
