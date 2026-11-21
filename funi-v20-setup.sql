-- Study with Funi v20: birthdays
-- Run this once in Supabase: SQL editor → New query → paste → Run (after funi-v19-setup.sql). Safe to run again.
-- • Your birthday (day and month only, never the year), who can see it, and a rest day
-- • Your partners and houses get a reminder the day before and a notification on the day
-- • They sign your birthday card; you can thank everyone at once

create table if not exists public.birthdays (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  day smallint not null check (day between 1 and 31),
  month smallint not null check (month between 1 and 12),
  visible boolean not null default true,  -- partners and houses can see it
  rest boolean not null default true,     -- no study blocks on the day
  updated_at timestamptz not null default now()
);
alter table public.birthdays enable row level security;

-- the people around you: study partners and people in your houses
create or replace function public.funi_circle(u uuid) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p.requester_id = u then p.addressee_id else p.requester_id end
  from public.study_partners p where p.status = 'accepted' and (p.requester_id = u or p.addressee_id = u)
  union
  select b.user_id from public.house_members a join public.house_members b on a.house_id = b.house_id
  where a.user_id = u and b.user_id <> u and a.status = 'joined' and b.status = 'joined';
$$;
revoke all on function public.funi_circle(uuid) from public, anon;
grant execute on function public.funi_circle(uuid) to authenticated;

drop policy if exists "birthday own" on public.birthdays;
drop policy if exists "birthday circle" on public.birthdays;
create policy "birthday own" on public.birthdays for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "birthday circle" on public.birthdays for select to authenticated
  using (visible and user_id in (select public.funi_circle(auth.uid())));

-- this year's birthday date (29 February becomes 28 February in other years)
create or replace function public.funi_bday(d smallint, m smallint, y int) returns date
language sql immutable as $$
  select case when m = 2 and d = 29 and not ((y % 4 = 0 and y % 100 <> 0) or y % 400 = 0) then make_date(y, 2, 28) else make_date(y, m, least(d, extract(day from (make_date(y, m, 1) + interval '1 month - 1 day'))::int)) end;
$$;

-- the birthday card
create table if not exists public.birthday_wishes (
  id uuid primary key default gen_random_uuid(),
  to_user uuid not null references auth.users(id) on delete cascade,
  from_user uuid not null default auth.uid() references auth.users(id) on delete cascade,
  year int not null,
  body text not null check (char_length(body) between 1 and 300),
  sticker text check (sticker is null or char_length(sticker) <= 16),
  created_at timestamptz not null default now(),
  unique (to_user, from_user, year)
);
alter table public.birthday_wishes enable row level security;
drop policy if exists "wish read" on public.birthday_wishes;
drop policy if exists "wish add" on public.birthday_wishes;
drop policy if exists "wish change" on public.birthday_wishes;
drop policy if exists "wish remove" on public.birthday_wishes;
create policy "wish read" on public.birthday_wishes for select to authenticated using (to_user = auth.uid() or from_user = auth.uid());
-- you can sign the card of someone in your circle, on the day or the day after (late wishes count)
create policy "wish add" on public.birthday_wishes for insert to authenticated with check (
  from_user = auth.uid() and to_user <> auth.uid()
  and exists (select 1 from public.birthdays b where b.user_id = to_user and b.visible
              and to_user in (select public.funi_circle(auth.uid()))
              and public.funi_jhb_today() between public.funi_bday(b.day, b.month, birthday_wishes.year) and public.funi_bday(b.day, b.month, birthday_wishes.year) + 1));
create policy "wish change" on public.birthday_wishes for update to authenticated using (from_user = auth.uid()) with check (from_user = auth.uid());
create policy "wish remove" on public.birthday_wishes for delete to authenticated using (from_user = auth.uid());

-- notifications
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('invite','accepted','message','help','studying','room','deck','battle','share','house','quiz','report','birthday'));

-- someone signed your card
create or replace function public.funi_wish_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
  values (new.to_user, new.from_user, 'birthday', '💌 ' || public.funi_name(new.from_user) || ' signed your birthday card', left(new.body, 140), new.to_user);
  return new;
end $$;
drop trigger if exists funi_wish_notify on public.birthday_wishes;
create trigger funi_wish_notify after insert on public.birthday_wishes for each row execute function public.funi_wish_notify();

-- thank everyone who signed your card this year
create or replace function public.funi_birthday_thanks(y int) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
  select w.from_user, auth.uid(), 'birthday', '💜 ' || public.funi_name(auth.uid()) || ' says thank you', 'Thank you so much for the birthday wishes! 💜', auth.uid()
  from public.birthday_wishes w where w.to_user = auth.uid() and w.year = y;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.funi_birthday_thanks(int) from public, anon;
grant execute on function public.funi_birthday_thanks(int) to authenticated;

-- the daily reminders: 18:00 the day before (to your circle), 07:00 on the day (to you and your circle)
create table if not exists public.birthday_sent (user_id uuid not null, day date not null, step text not null, primary key (user_id, day, step));
alter table public.birthday_sent enable row level security; -- only the timer uses it

create or replace function public.funi_birthday_tick() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d date := public.funi_jhb_today(); h int := extract(hour from (now() at time zone 'Africa/Johannesburg'))::int; r record;
begin
  -- on the day, from 07:00
  if h >= 7 then
    for r in select b.* from public.birthdays b where public.funi_bday(b.day, b.month, extract(year from d)::int) = d
             and not exists (select 1 from public.birthday_sent s where s.user_id = b.user_id and s.day = d and s.step = 'day') loop
      insert into public.birthday_sent values (r.user_id, d, 'day') on conflict do nothing;
      insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
      values (r.user_id, null, 'birthday', '🎂 Happy birthday, ' || public.funi_name(r.user_id) || '!', 'Funi is celebrating with you today. Open Funi to see your birthday card 💌', r.user_id);
      if r.visible then
        insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
        select c, r.user_id, 'birthday', '🎉 It''s ' || public.funi_name(r.user_id) || '''s birthday today!', 'Tap to sign the birthday card 💌', r.user_id
        from public.funi_circle(r.user_id) c;
      end if;
    end loop;
  end if;
  -- the day before, from 18:00
  if h >= 18 then
    for r in select b.* from public.birthdays b where b.visible and public.funi_bday(b.day, b.month, extract(year from d + 1)::int) = d + 1
             and not exists (select 1 from public.birthday_sent s where s.user_id = b.user_id and s.day = d and s.step = 'eve') loop
      insert into public.birthday_sent values (r.user_id, d, 'eve') on conflict do nothing;
      insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
      select c, r.user_id, 'birthday', '🎂 ' || public.funi_name(r.user_id) || '''s birthday is tomorrow', 'Get ready to sign the birthday card 💌', r.user_id
      from public.funi_circle(r.user_id) c;
    end loop;
  end if;
  delete from public.birthday_sent where day < d - 30;
end $$;
revoke all on function public.funi_birthday_tick() from public, anon, authenticated;

do $$
begin
  begin perform cron.unschedule('funi-birthdays'); exception when others then null; end;
  perform cron.schedule('funi-birthdays', '*/15 * * * *', 'select public.funi_birthday_tick()');
exception when others then
  raise notice 'pg_cron is not switched on: run funi-v3-setup.sql first, then this again.';
end $$;

-- live updates: new wishes appear on the card straight away
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'birthday_wishes') then
    alter publication supabase_realtime add table public.birthday_wishes;
  end if;
exception when others then null;
end $$;

notify pgrst, 'reload schema';
