-- Study with Funi v10: share your exam timetable and modules with study partners.
-- Your marks are never shared. Friends choose what to add. Safe to run again.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('invite','accepted','message','help','studying','room','deck','battle','share'));

create table if not exists public.exam_shares (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  to_id uuid not null references auth.users(id) on delete cascade,
  exams jsonb not null default '[]' check (jsonb_typeof(exams) = 'array' and jsonb_array_length(exams) <= 60),
  modules jsonb not null default '[]' check (jsonb_typeof(modules) = 'array' and jsonb_array_length(modules) <= 30),
  created_at timestamptz not null default now(),
  imported_at timestamptz,
  check (from_id <> to_id),
  check (pg_column_size(exams) + pg_column_size(modules) < 40000)
);
create index if not exists exam_shares_to on public.exam_shares (to_id, created_at desc);
alter table public.exam_shares enable row level security;
drop policy if exists exam_shares_read on public.exam_shares;
drop policy if exists exam_shares_send on public.exam_shares;
drop policy if exists exam_shares_mark on public.exam_shares;
drop policy if exists exam_shares_remove on public.exam_shares;
create policy exam_shares_read on public.exam_shares for select to authenticated using (auth.uid() in (from_id, to_id));
create policy exam_shares_send on public.exam_shares for insert to authenticated
  with check (from_id = auth.uid() and public.funi_are_partners(auth.uid(), to_id));
create policy exam_shares_mark on public.exam_shares for update to authenticated using (to_id = auth.uid()) with check (to_id = auth.uid());
create policy exam_shares_remove on public.exam_shares for delete to authenticated using (auth.uid() in (from_id, to_id));

create or replace function public.funi_notify_exam_share() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int := jsonb_array_length(new.exams); m int := jsonb_array_length(new.modules);
begin
  insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
  values (new.to_id, new.from_id, 'share',
          coalesce(public.funi_name(new.from_id), 'Your study partner') || ' shared their exam timetable with you',
          n || case when n = 1 then ' test or exam' else ' tests & exams' end
            || case when m > 0 then ', ' || m || ' module' || case when m = 1 then '' else 's' end else '' end || '. Tap to choose what to add.',
          new.id);
  return new;
end $$;
drop trigger if exists funi_exam_share_notify on public.exam_shares;
create trigger funi_exam_share_notify after insert on public.exam_shares for each row execute function public.funi_notify_exam_share();
