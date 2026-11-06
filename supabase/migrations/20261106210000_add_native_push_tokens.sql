create table if not exists public.native_push_tokens (
  token text primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.native_push_tokens enable row level security;

create policy "Users read own native push tokens" on public.native_push_tokens
  for select to authenticated
  using (user_id = auth.uid());

create policy "Users insert own native push tokens" on public.native_push_tokens
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users update own native push tokens" on public.native_push_tokens
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users delete own native push tokens" on public.native_push_tokens
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.native_push_tokens to authenticated;
