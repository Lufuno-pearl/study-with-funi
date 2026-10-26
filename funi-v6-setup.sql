-- Study with Funi v6: accounts with a username AND a verified email, limited to 200 people.
-- - One account per email (Supabase already enforces this; the email link proves it's really theirs).
-- - Log in with your username or your email.
-- - At most 200 accounts. To change the limit, edit the number in funi_max_accounts() and run this again.
-- Safe to run again any time.

create or replace function public.funi_max_accounts() returns int language sql immutable as $$ select 200 $$;

-- accounts that count: verified ones, plus sign-ups from the last day still waiting for their email link
create or replace function public.funi_accounts_used() returns int
language sql stable security definer set search_path = public, auth, pg_temp as $$
  select count(*)::int from auth.users
  where email_confirmed_at is not null or created_at > now() - interval '1 day'
$$;
revoke all on function public.funi_accounts_used() from public, anon, authenticated;

-- shown on the sign-up screen: spots left, and whether a username is free
create or replace function public.funi_signup_status(p_username text default null) returns json
language sql stable security definer set search_path = public, pg_temp as $$
  select json_build_object(
    'spots_left', greatest(0, public.funi_max_accounts() - public.funi_accounts_used()),
    'max', public.funi_max_accounts(),
    'username_free', p_username is null
      or not exists (select 1 from public.study_profiles where username = lower(trim(p_username))))
$$;
revoke all on function public.funi_signup_status(text) from public;
grant execute on function public.funi_signup_status(text) to anon, authenticated;

-- block new accounts when Funi is full or the username is taken
create or replace function public.funi_before_new_user() returns trigger
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare uname text := lower(coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1)));
begin
  if public.funi_accounts_used() >= public.funi_max_accounts() then
    raise exception 'FUNI_FULL: Funi is full (% accounts).', public.funi_max_accounts();
  end if;
  if exists (select 1 from public.study_profiles where username = uname) then
    raise exception 'FUNI_USERNAME_TAKEN';
  end if;
  return new;
end $$;
drop trigger if exists funi_before_auth_user_created on auth.users;
create trigger funi_before_auth_user_created before insert on auth.users
for each row execute function public.funi_before_new_user();

-- the profile now takes the username typed at sign-up (old accounts: the part before the @)
create or replace function public.funi_new_user_profile()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare uname text := lower(coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1)));
begin
  if uname ~ '^[a-z0-9_.]{3,20}$' then
    insert into public.study_profiles (id, username) values (new.id, uname) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists funi_on_auth_user_created on auth.users;
create trigger funi_on_auth_user_created after insert on auth.users
for each row execute function public.funi_new_user_profile();

-- log in with a username: checks the password inside the database and only then gives back the email,
-- so nobody can look up someone else's email. 8 wrong tries locks that username for 15 minutes.
create table if not exists public.funi_login_fails (
  username text not null,
  at timestamptz not null default now()
);
create index if not exists funi_login_fails_user on public.funi_login_fails (username, at);
alter table public.funi_login_fails enable row level security;
revoke all on public.funi_login_fails from anon, authenticated;

create or replace function public.funi_login_email(p_username text, p_password text) returns text
language plpgsql volatile security definer set search_path = public, auth, extensions, pg_temp as $$
declare uname text := lower(trim(coalesce(p_username, ''))); fails int; mail text; hash text;
begin
  delete from public.funi_login_fails where at < now() - interval '1 day';
  select count(*) into fails from public.funi_login_fails where username = uname and at > now() - interval '15 minutes';
  if fails >= 8 then raise exception 'FUNI_TOO_MANY'; end if;
  select a.email, a.encrypted_password into mail, hash
  from public.study_profiles p join auth.users a on a.id = p.id where p.username = uname;
  if mail is null or hash is null or hash = '' or extensions.crypt(coalesce(p_password, ''), hash) <> hash then
    insert into public.funi_login_fails (username) values (uname);
    return null;
  end if;
  delete from public.funi_login_fails where username = uname;
  return mail;
end $$;
revoke all on function public.funi_login_email(text, text) from public;
grant execute on function public.funi_login_email(text, text) to anon, authenticated;
