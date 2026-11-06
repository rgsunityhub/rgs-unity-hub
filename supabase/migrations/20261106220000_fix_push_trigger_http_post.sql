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

  perform net.http_post(
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
