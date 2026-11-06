alter table public.notifications add column if not exists actor_id uuid references public.profiles(id) on delete set null;
alter table public.notifications add column if not exists source_key text;
create index if not exists notifications_source_key on public.notifications (source_key);

create or replace function public.notify_publication_reaction()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare recipient_id uuid;
begin
  select owner_id into recipient_id from public.publications where id = new.publication_id;
  if recipient_id is not null and recipient_id <> new.user_id then
    insert into public.notifications (user_id, actor_id, source_key, title, body)
    values (recipient_id, new.user_id, 'publication_reaction:' || new.publication_id || ':' || new.user_id, 'Publikasi diapresiasi', 'Seseorang memberi apresiasi pada publikasi Anda.');
  end if;
  return new;
end;
$$;

create or replace function public.remove_publication_reaction_notification()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.notifications where source_key = 'publication_reaction:' || old.publication_id || ':' || old.user_id;
  return old;
end;
$$;

create or replace function public.notify_publication_comment()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare recipient_id uuid;
begin
  select owner_id into recipient_id from public.publications where id = new.publication_id;
  if recipient_id is not null and recipient_id <> new.user_id then
    insert into public.notifications (user_id, actor_id, source_key, title, body)
    values (recipient_id, new.user_id, 'publication_comment:' || new.id, 'Komentar baru', 'Seseorang mengomentari publikasi Anda.');
  end if;
  return new;
end;
$$;

create or replace function public.remove_publication_comment_notification()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.notifications where source_key = 'publication_comment:' || old.id;
  return old;
end;
$$;

create or replace function public.notify_file_reaction()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare recipient_id uuid;
begin
  select owner_id into recipient_id from public.files where id = new.file_id;
  if recipient_id is not null and recipient_id <> new.user_id then
    insert into public.notifications (user_id, actor_id, source_key, title, body)
    values (recipient_id, new.user_id, 'file_reaction:' || new.file_id || ':' || new.user_id, 'File diapresiasi', 'Seseorang memberi apresiasi pada file Anda.');
  end if;
  return new;
end;
$$;

create or replace function public.remove_file_reaction_notification()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.notifications where source_key = 'file_reaction:' || old.file_id || ':' || old.user_id;
  return old;
end;
$$;

create or replace function public.notify_file_comment()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare recipient_id uuid;
begin
  select owner_id into recipient_id from public.files where id = new.file_id;
  if recipient_id is not null and recipient_id <> new.user_id then
    insert into public.notifications (user_id, actor_id, source_key, title, body)
    values (recipient_id, new.user_id, 'file_comment:' || new.id, 'Komentar file baru', 'Seseorang mengomentari file Anda.');
  end if;
  return new;
end;
$$;

create or replace function public.remove_file_comment_notification()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.notifications where source_key = 'file_comment:' || old.id;
  return old;
end;
$$;

drop trigger if exists publication_reaction_notification_removed on public.publication_reactions;
create trigger publication_reaction_notification_removed after delete on public.publication_reactions
  for each row execute function public.remove_publication_reaction_notification();
drop trigger if exists publication_comment_notification_removed on public.publication_comments;
create trigger publication_comment_notification_removed after delete on public.publication_comments
  for each row execute function public.remove_publication_comment_notification();
drop trigger if exists file_reaction_notification_removed on public.file_reactions;
create trigger file_reaction_notification_removed after delete on public.file_reactions
  for each row execute function public.remove_file_reaction_notification();
drop trigger if exists file_comment_notification_removed on public.file_comments;
create trigger file_comment_notification_removed after delete on public.file_comments
  for each row execute function public.remove_file_comment_notification();
