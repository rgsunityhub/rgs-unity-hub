create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "Users insert own push subscriptions" on public.push_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users delete own push subscriptions" on public.push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on public.push_subscriptions to authenticated;

create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function public.enqueue_push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trigger_secret text;
begin
  select decrypted_secret into trigger_secret
  from vault.decrypted_secrets
  where name = 'rgs_push_trigger_secret'
  limit 1;
  if trigger_secret is null then
    raise warning 'Push trigger secret is not configured in Supabase Vault; skipping push delivery.';
    return new;
  end if;

  perform extensions.http_post(
    url := 'https://stdxeimphibosmhkhzvr.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-rgs-push-secret', trigger_secret
    ),
    body := jsonb_build_object(
      'id', new.id,
      'user_id', new.user_id,
      'source_key', new.source_key,
      'title', new.title,
      'body', new.body
    )
  );
  return new;
end;
$$;

drop trigger if exists notifications_enqueue_push on public.notifications;
create trigger notifications_enqueue_push
  after insert on public.notifications
  for each row execute function public.enqueue_push_notification();
