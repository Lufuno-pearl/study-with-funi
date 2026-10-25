-- Study with Funi v4: buzz the phone when a study timer ends, even if Funi is closed.
-- Safe to run again any time.
alter table public.study_sessions add column if not exists phase text not null default 'focus';
alter table public.study_sessions add column if not exists phase_ends_at timestamptz;
alter table public.study_sessions add column if not exists break_minutes int;
create index if not exists study_sessions_phase_due on public.study_sessions (phase_ends_at) where is_active and phase_ends_at is not null;
