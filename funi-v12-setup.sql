-- Study with Funi v12: My House, Study FC and call rooms.
-- My House: a private space for your inner circle. Files, notes and exam dates shared both ways.
-- Study FC: houses play each other every week; goals come from finished study sessions.
-- Call rooms: video calls, whiteboard and presenting files. Calls go straight between phones,
-- so they use no Supabase space at all.
-- Safe to run again any time.

-- ---------- 1. Notifications know the new kind ----------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('invite','accepted','message','help','studying','room','deck','battle','share','house'));

-- ---------- 2. Houses ----------
create table if not exists public.houses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  emoji text not null default '🏠' check (char_length(emoji) between 1 and 8),
  fc_on boolean not null default false,
  fc_name text check (fc_name is null or char_length(fc_name) between 1 and 30),
  fc_badge text not null default '🦁' check (char_length(fc_badge) between 1 and 8),
  created_at timestamptz not null default now()
);
create table if not exists public.house_members (
  house_id uuid not null references public.houses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  status text not null default 'invited' check (status in ('invited','joined')),
  invited_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  joined_at timestamptz,
  primary key (house_id, user_id)
);
create index if not exists house_members_user on public.house_members (user_id);
create table if not exists public.house_files (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  folder text not null default 'Shared stuff' check (char_length(folder) between 1 and 40),
  name text not null check (char_length(name) between 1 and 120),
  kind text not null default 'file' check (kind in ('file','link')),
  path text,
  url text check (url is null or (url ~* '^https?://' and char_length(url) <= 1000)),
  mime text,
  size bigint not null default 0 check (size >= 0 and size <= 10485760),
  version int not null default 1,
  added_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'file' and path is not null) or (kind = 'link' and url is not null))
);
create index if not exists house_files_house on public.house_files (house_id, updated_at desc);
create table if not exists public.house_notes (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  title text not null default 'Notes' check (char_length(title) between 1 and 60),
  body text not null default '' check (char_length(body) <= 20000),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists house_notes_house on public.house_notes (house_id, updated_at desc);
create table if not exists public.house_activity (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  what text not null check (char_length(what) between 1 and 200),
  created_at timestamptz not null default now()
);
create index if not exists house_activity_house on public.house_activity (house_id, created_at desc);

-- who is in which house (checked without looking through the policies, so nothing loops)
create or replace function public.funi_house_member(h uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.house_members m where m.house_id = h and m.user_id = auth.uid() and m.status = 'joined');
$$;
create or replace function public.funi_house_invited(h uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.house_members m where m.house_id = h and m.user_id = auth.uid());
$$;
create or replace function public.funi_house_member_path(p text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.funi_house_member(p::uuid) else false end;
$$;
create or replace function public.funi_shares_house(other uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.house_members a join public.house_members b on a.house_id = b.house_id
                 where a.user_id = auth.uid() and b.user_id = other);
$$;

-- the owner joins their own house straight away; at most 3 houses each, 12 people a house
create or replace function public.funi_house_created() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.house_members (house_id, user_id, role, status, invited_by, joined_at)
  values (new.id, new.owner_id, 'owner', 'joined', new.owner_id, now()) on conflict do nothing;
  insert into public.house_notes (house_id, title, body, updated_by) values (new.id, 'House notes', '', new.owner_id);
  return new;
end $$;
drop trigger if exists funi_house_created on public.houses;
create trigger funi_house_created after insert on public.houses for each row execute function public.funi_house_created();

create or replace function public.funi_house_limits() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'houses' then
    if (select count(*) from public.houses where owner_id = new.owner_id) >= 3 then
      raise exception 'You can have up to 3 houses.';
    end if;
  elsif tg_table_name = 'house_members' then
    if (select count(*) from public.house_members where house_id = new.house_id) >= 12 then
      raise exception 'A house can have up to 12 people.';
    end if;
  elsif tg_table_name = 'house_files' then
    if new.kind = 'file' and (select coalesce(sum(size), 0) from public.house_files where house_id = new.house_id and kind = 'file' and id <> new.id) + new.size > 157286400 then
      raise exception 'This house''s 150 MB is full. Delete some files or save a link instead.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists funi_house_limit on public.houses;
create trigger funi_house_limit before insert on public.houses for each row execute function public.funi_house_limits();
drop trigger if exists funi_house_member_limit on public.house_members;
create trigger funi_house_member_limit before insert on public.house_members for each row execute function public.funi_house_limits();
drop trigger if exists funi_house_file_limit on public.house_files;
create trigger funi_house_file_limit before insert or update of size on public.house_files for each row execute function public.funi_house_limits();

-- accepting an invite can only change your status
create or replace function public.funi_house_member_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.house_id := old.house_id; new.user_id := old.user_id; new.role := old.role; new.invited_by := old.invited_by;
  if new.status = 'joined' and old.status <> 'joined' then new.joined_at := now(); end if;
  return new;
end $$;
drop trigger if exists funi_house_member_guard on public.house_members;
create trigger funi_house_member_guard before update on public.house_members for each row execute function public.funi_house_member_guard();

create or replace function public.funi_house_file_touch() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now(); new.updated_by := auth.uid(); new.house_id := old.house_id;
  if new.path is distinct from old.path then new.version := old.version + 1; end if;
  return new;
end $$;
drop trigger if exists funi_house_file_touch on public.house_files;
create trigger funi_house_file_touch before update on public.house_files for each row execute function public.funi_house_file_touch();
create or replace function public.funi_house_note_touch() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); new.house_id := old.house_id; return new; end $$;
drop trigger if exists funi_house_note_touch on public.house_notes;
create trigger funi_house_note_touch before update on public.house_notes for each row execute function public.funi_house_note_touch();

alter table public.houses enable row level security;
alter table public.house_members enable row level security;
alter table public.house_files enable row level security;
alter table public.house_notes enable row level security;
alter table public.house_activity enable row level security;

drop policy if exists houses_read on public.houses;
drop policy if exists houses_add on public.houses;
drop policy if exists houses_change on public.houses;
drop policy if exists houses_remove on public.houses;
create policy houses_read on public.houses for select to authenticated using (owner_id = auth.uid() or public.funi_house_invited(id));
create policy houses_add on public.houses for insert to authenticated with check (owner_id = auth.uid());
create policy houses_change on public.houses for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy houses_remove on public.houses for delete to authenticated using (owner_id = auth.uid());

drop policy if exists house_members_read on public.house_members;
drop policy if exists house_members_invite on public.house_members;
drop policy if exists house_members_accept on public.house_members;
drop policy if exists house_members_remove on public.house_members;
create policy house_members_read on public.house_members for select to authenticated
  using (user_id = auth.uid() or public.funi_house_invited(house_id));
-- members can invite their own study partners
create policy house_members_invite on public.house_members for insert to authenticated
  with check (invited_by = auth.uid() and role = 'member' and status = 'invited'
              and public.funi_house_member(house_id) and public.funi_are_partners(auth.uid(), user_id));
create policy house_members_accept on public.house_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- leave, cancel an invite you sent, or (owner) remove someone
create policy house_members_remove on public.house_members for delete to authenticated
  using ((user_id = auth.uid() and role <> 'owner') or (invited_by = auth.uid() and status = 'invited')
         or exists (select 1 from public.houses h where h.id = house_id and h.owner_id = auth.uid() and user_id <> auth.uid()));

drop policy if exists house_files_all on public.house_files;
create policy house_files_all on public.house_files for all to authenticated
  using (public.funi_house_member(house_id))
  with check (public.funi_house_member(house_id) and (path is null or path like house_id::text || '/%'));
drop policy if exists house_notes_all on public.house_notes;
create policy house_notes_all on public.house_notes for all to authenticated
  using (public.funi_house_member(house_id)) with check (public.funi_house_member(house_id));
drop policy if exists house_activity_read on public.house_activity;
drop policy if exists house_activity_add on public.house_activity;
create policy house_activity_read on public.house_activity for select to authenticated using (public.funi_house_member(house_id));
create policy house_activity_add on public.house_activity for insert to authenticated with check (user_id = auth.uid() and public.funi_house_member(house_id));

-- people in the same house can see each other's name and avatar
drop policy if exists study_profiles_read_self_or_partners on public.study_profiles;
create policy study_profiles_read_self_or_partners on public.study_profiles for select to authenticated
using (id = auth.uid() or exists (
  select 1 from public.study_partners p
  where p.status in ('accepted','pending')
    and ((p.requester_id = auth.uid() and p.addressee_id = study_profiles.id)
      or (p.addressee_id = auth.uid() and p.requester_id = study_profiles.id)))
  or public.funi_shares_room(study_profiles.id)
  or public.funi_shares_house(study_profiles.id));

-- the house exam calendar: upcoming tests and exams of everyone who joined
create or replace function public.funi_house_exams(h uuid)
returns table (user_id uuid, module text, kind text, due_date date, start_time time, venue text)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.user_id, a.module, a.kind, a.due_date, a.start_time, a.venue
  from public.assessments a
  join public.house_members m on m.user_id = a.user_id and m.house_id = h and m.status = 'joined'
  where public.funi_house_member(h)
    and a.due_date >= (now() at time zone 'Africa/Johannesburg')::date
  order by a.due_date, a.start_time nulls last
  limit 60;
$$;
revoke all on function public.funi_house_exams(uuid) from public, anon;
grant execute on function public.funi_house_exams(uuid) to authenticated;

-- house files live in their own private bucket: <house id>/...
insert into storage.buckets (id, name, public, file_size_limit)
values ('house-files', 'house-files', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;
drop policy if exists "house files read" on storage.objects;
drop policy if exists "house files add" on storage.objects;
drop policy if exists "house files change" on storage.objects;
drop policy if exists "house files remove" on storage.objects;
create policy "house files read" on storage.objects for select to authenticated
  using (bucket_id = 'house-files' and public.funi_house_member_path((storage.foldername(name))[1]));
create policy "house files add" on storage.objects for insert to authenticated
  with check (bucket_id = 'house-files' and public.funi_house_member_path((storage.foldername(name))[1]));
create policy "house files change" on storage.objects for update to authenticated
  using (bucket_id = 'house-files' and public.funi_house_member_path((storage.foldername(name))[1]));
create policy "house files remove" on storage.objects for delete to authenticated
  using (bucket_id = 'house-files' and public.funi_house_member_path((storage.foldername(name))[1]));

-- notifications: invites and new files
create or replace function public.funi_notify_house() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare who text; hname text;
begin
  select h.emoji || ' ' || h.name into hname from public.houses h where h.id = new.house_id;
  if tg_table_name = 'house_members' then
    if new.status = 'invited' and new.role = 'member' then
      who := coalesce(public.funi_name(new.invited_by), 'A study partner');
      insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
      values (new.user_id, new.invited_by, 'house', who || ' invited you to ' || hname,
              'Files, notes and exam dates you put there are shared with everyone in the house.', new.house_id);
    end if;
  else
    who := coalesce(public.funi_name(new.added_by), 'Someone');
    insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
    select m.user_id, new.added_by, 'house', who || ' added to ' || hname, new.name, new.house_id
    from public.house_members m
    where m.house_id = new.house_id and m.status = 'joined' and m.user_id <> coalesce(new.added_by, '00000000-0000-0000-0000-000000000000'::uuid);
  end if;
  return new;
end $$;
drop trigger if exists funi_house_invite_notify on public.house_members;
create trigger funi_house_invite_notify after insert on public.house_members for each row execute function public.funi_notify_house();
drop trigger if exists funi_house_file_notify on public.house_files;
create trigger funi_house_file_notify after insert on public.house_files for each row execute function public.funi_notify_house();

-- ---------- 3. Study FC ----------
-- goals per house per week (only totals: no names or session details leave the house)
create or replace function public.funi_fc_weeks(weeks int default 6)
returns table (house_id uuid, name text, badge text, week_start date, goals int, players int)
language sql stable security definer set search_path = public, pg_temp as $$
  with teams as (
    select h.id, coalesce(h.fc_name, h.name) as name, h.fc_badge as badge from public.houses h where h.fc_on
  ),
  wk as (
    select (date_trunc('week', now() at time zone 'Africa/Johannesburg') - (g * interval '7 days'))::date as start
    from generate_series(0, least(greatest(weeks, 1), 12) - 1) g
  ),
  s as (
    select m.house_id, (ss.started_at at time zone 'Africa/Johannesburg') as local,
      case when coalesce(ss.focus_seconds, 0) >= 3600 then 2 when coalesce(ss.focus_seconds, 0) >= 1200 then 1 else 0 end as g
    from public.study_sessions ss
    join public.house_members m on m.user_id = ss.user_id and m.status = 'joined'
    join teams t on t.id = m.house_id
    where ss.started_at > now() - interval '90 days' and not ss.is_active
  )
  select t.id, t.name, t.badge, wk.start,
    coalesce((select sum(s.g) from s where s.house_id = t.id and s.local >= wk.start and s.local < wk.start + 7), 0)::int,
    (select count(*) from public.house_members m where m.house_id = t.id and m.status = 'joined')::int
  from teams t cross join wk
  where auth.uid() is not null;
$$;
revoke all on function public.funi_fc_weeks(int) from public, anon;
grant execute on function public.funi_fc_weeks(int) to authenticated;

-- your own team's scorers this week (only for houses you're in)
create or replace function public.funi_fc_scorers(h uuid)
returns table (user_id uuid, goals int, minutes int)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.user_id,
    coalesce(sum(case when coalesce(ss.focus_seconds, 0) >= 3600 then 2 when coalesce(ss.focus_seconds, 0) >= 1200 then 1 else 0 end), 0)::int,
    coalesce(sum(coalesce(ss.focus_seconds, 0)) / 60, 0)::int
  from public.house_members m
  left join public.study_sessions ss on ss.user_id = m.user_id and not ss.is_active
    and (ss.started_at at time zone 'Africa/Johannesburg') >= date_trunc('week', now() at time zone 'Africa/Johannesburg')
  where m.house_id = h and m.status = 'joined' and public.funi_house_member(h)
  group by m.user_id;
$$;
revoke all on function public.funi_fc_scorers(uuid) from public, anon;
grant execute on function public.funi_fc_scorers(uuid) to authenticated;

-- ---------- 4. Call rooms ----------
alter table public.study_rooms add column if not exists kind text not null default 'study';
alter table public.study_rooms drop constraint if exists study_rooms_kind_check;
alter table public.study_rooms add constraint study_rooms_kind_check check (kind in ('study','call','teach'));
alter table public.study_rooms add column if not exists meet_url text;
alter table public.study_rooms drop constraint if exists study_rooms_meet_url_check;
alter table public.study_rooms add constraint study_rooms_meet_url_check check (meet_url is null or (meet_url ~* '^https://' and char_length(meet_url) <= 500));

create or replace function public.funi_notify_room() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare who text := coalesce(public.funi_name(new.host_id), 'Your study partner');
        night boolean := new.name ilike 'cross night%';
begin
  insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
  select case when p.requester_id = new.host_id then p.addressee_id else p.requester_id end,
         new.host_id, 'room',
         case when new.kind = 'call' then who || ' started a video call 🎥'
              when new.kind = 'teach' then who || ' started a teach session ✏️'
              when night then who || ' is cross-nighting tonight 🌙' else who || ' opened a study room' end,
         case when new.kind in ('call','teach') then new.name || '. Tap to join: video, whiteboard and files.'
              when night then 'Join me cross-nighting! ' || new.focus_minutes || ' min rounds, ' || new.break_minutes || ' min breaks.'
              else new.name || ' · ' || new.focus_minutes || ' min rounds. Tap to join!' end,
         new.id
  from public.study_partners p
  where p.status = 'accepted' and (p.requester_id = new.host_id or p.addressee_id = new.host_id);
  return new;
end $$;

-- ---------- 5. Live updates ----------
do $$
declare t text;
begin
  foreach t in array array['house_files','house_notes','house_activity','house_members'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

grant select, insert, update, delete on public.houses, public.house_members, public.house_files, public.house_notes, public.house_activity to authenticated;
