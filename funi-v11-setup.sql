-- Study with Funi v11: delete chat messages ("Delete for me" / "Delete for everyone"). Safe to run again.
alter table public.study_messages add column if not exists deleted_at timestamptz;
alter table public.study_messages add column if not exists hidden_for uuid[] not null default '{}';

create or replace function public.funi_delete_message(p_id uuid, p_for_all boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.study_messages;
begin
  select * into m from public.study_messages where id = p_id;
  if not found or auth.uid() is null or auth.uid() not in (m.sender_id, m.recipient_id) then
    raise exception 'You can only delete messages in your own chats.';
  end if;
  if p_for_all then
    if m.sender_id <> auth.uid() then raise exception 'Only the person who sent it can delete it for everyone.'; end if;
    update public.study_messages
      set deleted_at = now(), body = 'This message was deleted', file_path = null, file_name = null, file_type = null, file_size = null, is_help = false
      where id = p_id;
    delete from public.notifications where ref_id = p_id and kind in ('message', 'help');
  else
    update public.study_messages set hidden_for = array_append(hidden_for, auth.uid())
      where id = p_id and not (auth.uid() = any (hidden_for));
  end if;
end $$;
revoke all on function public.funi_delete_message(uuid, boolean) from public, anon;
grant execute on function public.funi_delete_message(uuid, boolean) to authenticated;

-- replying to a message
alter table public.study_messages add column if not exists reply_to uuid references public.study_messages(id) on delete set null;
