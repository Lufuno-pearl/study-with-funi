-- Study with Funi v9: repeating reminders (every day, weekdays, every week, or chosen days). Safe to run again.
alter table public.tasks add column if not exists repeat_days smallint[];
alter table public.tasks drop constraint if exists tasks_repeat_days_check;
alter table public.tasks add constraint tasks_repeat_days_check
  check (repeat_days is null or (array_length(repeat_days, 1) between 1 and 7 and repeat_days <@ array[0,1,2,3,4,5,6]::smallint[]));
create index if not exists tasks_repeat_due on public.tasks (due_date) where repeat_days is not null;
