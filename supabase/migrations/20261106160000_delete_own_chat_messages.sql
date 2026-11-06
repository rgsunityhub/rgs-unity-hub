drop policy if exists "Members delete own messages" on public.chat_messages;
create policy "Members delete own messages" on public.chat_messages
  for delete to authenticated
  using (sender_id = (select auth.uid()));

grant select, insert, delete on public.chat_messages to authenticated;
