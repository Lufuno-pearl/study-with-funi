-- Study with Funi v17: one study session on all your devices, study history, test end times
-- Run this once in Supabase: SQL editor → New query → paste → Run (after funi-v16-setup.sql). Safe to run again.
-- • Tests and exams get an end time, so they move to "Written" as soon as you finish
-- • A study session started on your phone carries on on your laptop (pause, resume and end stay in step)

alter table public.assessments add column if not exists end_time time;
alter table public.study_sessions add column if not exists paused_left int;   -- seconds left while paused
alter table public.study_sessions add column if not exists synced_at timestamptz; -- when focus_seconds was last saved

-- make sure session changes reach your other devices straight away
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'study_sessions') then
    alter publication supabase_realtime add table public.study_sessions;
  end if;
end $$;

notify pgrst, 'reload schema';
