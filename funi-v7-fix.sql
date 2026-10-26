-- Fix: creating a flashcard deck or a study room said "new row violates row-level security policy".
-- The read rules now check the owner directly. Safe to run again any time.
drop policy if exists decks_read on public.flash_decks;
create policy decks_read on public.flash_decks for select to authenticated
  using (owner_id = auth.uid() or exists (select 1 from public.flash_shares s where s.deck_id = flash_decks.id and s.user_id = auth.uid()));
drop policy if exists rooms_read on public.study_rooms;
create policy rooms_read on public.study_rooms for select to authenticated
  using (host_id = auth.uid() or public.funi_are_partners(auth.uid(), host_id)
         or exists (select 1 from public.study_room_members m where m.room_id = study_rooms.id and m.user_id = auth.uid()));
