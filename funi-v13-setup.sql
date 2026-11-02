-- Funi v13: stickers in chats
-- Your own sticker collection (up to 400), stickers you save from friends, and WhatsApp imports.
-- Safe to run more than once.

-- ---------- 1. My stickers ----------
create table if not exists public.stickers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  path text not null check (char_length(path) between 3 and 300),
  hash text not null check (char_length(hash) between 8 and 80),
  mime text not null default 'image/webp' check (mime in ('image/webp', 'image/png', 'image/gif', 'image/jpeg')),
  size int not null check (size between 1 and 1048576),
  created_at timestamptz not null default now(),
  unique (user_id, hash)
);
create index if not exists stickers_user_idx on public.stickers (user_id, created_at desc);
alter table public.stickers enable row level security;

drop policy if exists "stickers: see mine" on public.stickers;
create policy "stickers: see mine" on public.stickers for select to authenticated using (user_id = auth.uid());
drop policy if exists "stickers: add mine" on public.stickers;
create policy "stickers: add mine" on public.stickers for insert to authenticated
  with check (user_id = auth.uid() and path like auth.uid()::text || '/%');
drop policy if exists "stickers: remove mine" on public.stickers;
create policy "stickers: remove mine" on public.stickers for delete to authenticated using (user_id = auth.uid());

-- at most 400 stickers each, so the free storage never fills up
create or replace function public.funi_sticker_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select count(*) from public.stickers where user_id = new.user_id) >= 400 then
    raise exception 'You have 400 stickers already. Remove some first.';
  end if;
  return new;
end $$;
drop trigger if exists funi_sticker_limit on public.stickers;
create trigger funi_sticker_limit before insert on public.stickers for each row execute function public.funi_sticker_limit();

-- ---------- 2. Where the sticker pictures live ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stickers', 'stickers', false, 1048576, array['image/webp', 'image/png', 'image/gif', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/webp', 'image/png', 'image/gif', 'image/jpeg'];

-- anyone signed in to Funi can see a sticker (so the person you send it to sees it); only you can add or remove yours
drop policy if exists "stickers: signed-in can view" on storage.objects;
create policy "stickers: signed-in can view" on storage.objects for select to authenticated using (bucket_id = 'stickers');
drop policy if exists "stickers: upload to my folder" on storage.objects;
create policy "stickers: upload to my folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'stickers' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "stickers: delete my own" on storage.objects;
create policy "stickers: delete my own" on storage.objects for delete to authenticated
  using (bucket_id = 'stickers' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 3. Notifications say "Sent a sticker" ----------
create or replace function public.funi_notify_message()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare who text := coalesce(public.funi_name(new.sender_id), 'Your study partner');
begin
  insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
  values (new.recipient_id, new.sender_id,
          case when new.is_help then 'help' else 'message' end,
          case when new.is_help then who || ' needs help' else 'New message from ' || who end,
          case when coalesce(new.body, '') <> '' then left(new.body, 140)
               when coalesce(new.file_type, '') = 'funi/sticker' then 'Sent a sticker'
               when coalesce(new.file_type, '') like 'audio/%' then 'Sent a voice note'
               else 'Sent a file: ' || coalesce(new.file_name, 'attachment') end,
          new.id);
  return new;
end $$;
