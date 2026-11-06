create or replace function public.notify_publication_reaction()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  recipient_id uuid;
begin
  select owner_id into recipient_id from public.publications where id = new.publication_id;
  if recipient_id is not null and recipient_id <> new.user_id then
    insert into public.notifications (user_id, title, body)
    values (recipient_id, 'Publikasi diapresiasi', 'Seseorang memberi apresiasi pada publikasi Anda.');
  end if;
  return new;
end;
$$;

create or replace function public.notify_publication_comment()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  recipient_id uuid;
begin
  select owner_id into recipient_id from public.publications where id = new.publication_id;
  if recipient_id is not null and recipient_id <> new.user_id then
    insert into public.notifications (user_id, title, body)
    values (recipient_id, 'Komentar baru', 'Seseorang mengomentari publikasi Anda.');
  end if;
  return new;
end;
$$;

create or replace function public.notify_file_reaction()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  recipient_id uuid;
begin
  select owner_id into recipient_id from public.files where id = new.file_id;
  if recipient_id is not null and recipient_id <> new.user_id then
    insert into public.notifications (user_id, title, body)
    values (recipient_id, 'File diapresiasi', 'Seseorang memberi apresiasi pada file Anda.');
  end if;
  return new;
end;
$$;

create or replace function public.notify_file_comment()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  recipient_id uuid;
begin
  select owner_id into recipient_id from public.files where id = new.file_id;
  if recipient_id is not null and recipient_id <> new.user_id then
    insert into public.notifications (user_id, title, body)
    values (recipient_id, 'Komentar file baru', 'Seseorang mengomentari file Anda.');
  end if;
  return new;
end;
$$;

drop trigger if exists publication_reaction_notification on public.publication_reactions;
create trigger publication_reaction_notification after insert on public.publication_reactions
  for each row execute function public.notify_publication_reaction();

drop trigger if exists publication_comment_notification on public.publication_comments;
create trigger publication_comment_notification after insert on public.publication_comments
  for each row execute function public.notify_publication_comment();

drop trigger if exists file_reaction_notification on public.file_reactions;
create trigger file_reaction_notification after insert on public.file_reactions
  for each row execute function public.notify_file_reaction();

drop trigger if exists file_comment_notification on public.file_comments;
create trigger file_comment_notification after insert on public.file_comments
  for each row execute function public.notify_file_comment();
