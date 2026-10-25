-- Study with Funi v5: files for each module (notes, past papers, photos, links).
-- Private: only you can see your own files. 10 MB per file, 50 MB per person, so Funi stays free.
-- Safe to run again any time.

create table if not exists public.module_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  module_code text not null check (char_length(module_code) between 1 and 40),
  folder text not null default 'Notes' check (folder in ('Notes','Past papers','Photos','Other')),
  name text not null check (char_length(name) between 1 and 120),
  kind text not null default 'file' check (kind in ('file','link')),
  path text,
  url text check (url is null or (url ~* '^https?://' and char_length(url) <= 1000)),
  mime text,
  size bigint not null default 0 check (size >= 0 and size <= 10485760),
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  check ((kind = 'file' and path is not null) or (kind = 'link' and url is not null))
);
create index if not exists module_files_user on public.module_files (user_id, module_code);

alter table public.module_files enable row level security;
drop policy if exists "own files read" on public.module_files;
drop policy if exists "own files add" on public.module_files;
drop policy if exists "own files change" on public.module_files;
drop policy if exists "own files remove" on public.module_files;
create policy "own files read" on public.module_files for select to authenticated using (user_id = auth.uid());
create policy "own files add" on public.module_files for insert to authenticated with check (user_id = auth.uid() and (path is null or path like auth.uid()::text || '/%'));
create policy "own files change" on public.module_files for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own files remove" on public.module_files for delete to authenticated using (user_id = auth.uid());

-- 50 MB per person
create or replace function public.funi_check_file_space() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'file' and (select coalesce(sum(size), 0) from public.module_files where user_id = new.user_id and kind = 'file') + new.size > 52428800 then
    raise exception 'Your 50 MB of space is full. Delete some files or save a link instead.';
  end if;
  return new;
end $$;
drop trigger if exists funi_file_space on public.module_files;
create trigger funi_file_space before insert on public.module_files for each row execute function public.funi_check_file_space();

-- private storage bucket: files live under <your id>/...
insert into storage.buckets (id, name, public, file_size_limit)
values ('module-files', 'module-files', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

drop policy if exists "module files read own" on storage.objects;
drop policy if exists "module files add own" on storage.objects;
drop policy if exists "module files remove own" on storage.objects;
create policy "module files read own" on storage.objects for select to authenticated
  using (bucket_id = 'module-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "module files add own" on storage.objects for insert to authenticated
  with check (bucket_id = 'module-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "module files remove own" on storage.objects for delete to authenticated
  using (bucket_id = 'module-files' and (storage.foldername(name))[1] = auth.uid()::text);
