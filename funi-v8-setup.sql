-- Study with Funi v8: "Cross night" rooms send "… is cross-nighting tonight. Join me!" Safe to run again.
create or replace function public.funi_notify_room() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare who text := coalesce(public.funi_name(new.host_id), 'Your study partner');
        night boolean := new.name ilike 'cross night%';
begin
  insert into public.notifications (user_id, actor_id, kind, title, body, ref_id)
  select case when p.requester_id = new.host_id then p.addressee_id else p.requester_id end,
         new.host_id, 'room',
         case when night then who || ' is cross-nighting tonight 🌙' else who || ' opened a study room' end,
         case when night then 'Join me cross-nighting! ' || new.focus_minutes || ' min rounds, ' || new.break_minutes || ' min breaks.'
              else new.name || ' · ' || new.focus_minutes || ' min rounds. Tap to join!' end,
         new.id
  from public.study_partners p
  where p.status = 'accepted' and (p.requester_id = new.host_id or p.addressee_id = new.host_id);
  return new;
end $$;
