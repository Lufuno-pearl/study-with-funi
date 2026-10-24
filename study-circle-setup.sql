-- Study Circle schema for Study with Funi
-- Run this once in Supabase SQL Editor after deploying the Study Circle feature.
-- This adds new tables and policies only; it does not alter assessments or modules.

create table if not exists public.study_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  feeling text not null default 'Okay' check (feeling in ('Feeling great','Happy','Okay','Confused','Stressed','Need help')),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

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

create table if not exists public.study_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);

create index if not exists study_partners_requester_idx on public.study_partners(requester_id, status);
create index if not exists study_partners_addressee_idx on public.study_partners(addressee_id, status);
create index if not exists study_sessions_user_active_idx on public.study_sessions(user_id, is_active, started_at desc);
create index if not exists study_messages_pair_idx on public.study_messages(sender_id, recipient_id, created_at);

alter table public.study_profiles enable row level security;
alter table public.study_partners enable row level security;
alter table public.study_sessions enable row level security;
alter table public.study_messages enable row level security;

drop policy if exists "study_profiles_read_self_or_partners" on public.study_profiles;
create policy "study_profiles_read_self_or_partners" on public.study_profiles for select to authenticated
using (
  id = auth.uid() or exists (
    select 1 from public.study_partners p
    where p.status = 'accepted'
      and ((p.requester_id = auth.uid() and p.addressee_id = study_profiles.id)
        or (p.addressee_id = auth.uid() and p.requester_id = study_profiles.id))
  )
);

drop policy if exists "study_profiles_insert_self" on public.study_profiles;
create policy "study_profiles_insert_self" on public.study_profiles for insert to authenticated
with check (id = auth.uid());

drop policy if exists "study_profiles_update_self" on public.study_profiles;
create policy "study_profiles_update_self" on public.study_profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "study_partners_read_participant" on public.study_partners;
create policy "study_partners_read_participant" on public.study_partners for select to authenticated
using (requester_id = auth.uid() or addressee_id = auth.uid());

drop policy if exists "study_partners_invite_self" on public.study_partners;
create policy "study_partners_invite_self" on public.study_partners for insert to authenticated
with check (requester_id = auth.uid() and addressee_id <> auth.uid() and status = 'pending');

drop policy if exists "study_partners_update_participant" on public.study_partners;
create policy "study_partners_update_participant" on public.study_partners for update to authenticated
using (requester_id = auth.uid() or addressee_id = auth.uid())
with check (
  (requester_id = auth.uid() or addressee_id = auth.uid())
  and status in ('pending','accepted','rejected')
);

drop policy if exists "study_sessions_read_self_or_shared_partners" on public.study_sessions;
create policy "study_sessions_read_self_or_shared_partners" on public.study_sessions for select to authenticated
using (
  user_id = auth.uid() or (
    share_with_partners = true and exists (
      select 1 from public.study_partners p
      where p.status = 'accepted'
        and ((p.requester_id = auth.uid() and p.addressee_id = study_sessions.user_id)
          or (p.addressee_id = auth.uid() and p.requester_id = study_sessions.user_id))
    )
  )
);

drop policy if exists "study_sessions_insert_self" on public.study_sessions;
create policy "study_sessions_insert_self" on public.study_sessions for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "study_sessions_update_self" on public.study_sessions;
create policy "study_sessions_update_self" on public.study_sessions for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "study_messages_read_participants" on public.study_messages;
create policy "study_messages_read_participants" on public.study_messages for select to authenticated
using (
  sender_id = auth.uid() or recipient_id = auth.uid()
);

drop policy if exists "study_messages_send_to_partner" on public.study_messages;
create policy "study_messages_send_to_partner" on public.study_messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.study_partners p
    where p.status = 'accepted'
      and ((p.requester_id = auth.uid() and p.addressee_id = study_messages.recipient_id)
        or (p.addressee_id = auth.uid() and p.requester_id = study_messages.recipient_id))
  )
);

drop policy if exists "study_messages_mark_received" on public.study_messages;
create policy "study_messages_mark_received" on public.study_messages for update to authenticated
using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create or replace function public.search_study_users(search_text text)
returns table (id uuid, username text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.username
  from public.study_profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and p.username ilike left(trim(search_text), 20) || '%'
  order by p.username
  limit 10;
$$;

revoke all on function public.search_study_users(text) from public;
grant execute on function public.search_study_users(text) to authenticated;

grant select, insert, update on public.study_profiles to authenticated;
grant select, insert, update on public.study_partners to authenticated;
grant select, insert, update on public.study_sessions to authenticated;
grant select, insert, update on public.study_messages to authenticated;
