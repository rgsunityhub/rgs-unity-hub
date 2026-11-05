create extension if not exists pgcrypto with schema extensions;

create type public.member_role as enum ('owner', 'admin', 'user');
create type public.publication_kind as enum ('text', 'file', 'youtube');
create type public.visibility as enum ('public', 'private');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 3 and 24),
  avatar_url text,
  bio text not null default '' check (char_length(bio) <= 240),
  role public.member_role not null default 'user',
  created_at timestamptz not null default now()
);
create unique index profiles_nickname_ci on public.profiles (lower(nickname));

create table public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  max_uses integer not null check (max_uses between 1 and 100),
  used_count integer not null default 0 check (used_count >= 0),
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.publications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind public.publication_kind not null default 'text',
  title text not null check (char_length(title) between 1 and 100),
  body text not null default '' check (char_length(body) <= 2000),
  visibility public.visibility not null default 'public',
  created_at timestamptz not null default now()
);
create index publications_feed on public.publications (created_at desc) where visibility = 'public';

create table public.publication_reactions (
  publication_id uuid not null references public.publications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (publication_id, user_id)
);

create table public.publication_comments (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.publications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index publication_comments_time on public.publication_comments (publication_id, created_at);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  mime_type text not null,
  visibility public.visibility not null default 'private',
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  constraint file_path_matches_owner check (storage_path like owner_id::text || '/%')
);

create table public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  is_public boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
insert into public.chat_rooms (id, name, is_public)
values ('00000000-0000-0000-0000-000000000001', 'general', true);

create table public.chat_room_members (
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index chat_messages_room_time on public.chat_messages (room_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  body text not null default '' check (char_length(body) <= 500),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_time on public.notifications (user_id, created_at desc);

create table public.password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  decision text check (decision in ('approved', 'rejected'))
);

create table public.auth_login_attempts (
  key_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 1,
  blocked_until timestamptz
);

create function public.is_owner()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'owner');
$$;

create function public.can_manage_invites()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('owner', 'admin'));
$$;

create function public.create_invite_code(p_max_uses integer)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  generated_code text;
begin
  if not public.can_manage_invites() then
    raise exception 'Permission denied';
  end if;
  if p_max_uses < 1 or p_max_uses > 100 then
    raise exception 'Usage limit must be between 1 and 100';
  end if;
  generated_code := upper(encode(extensions.gen_random_bytes(6), 'hex'));
  insert into public.invite_codes (code, created_by, max_uses)
  values (generated_code, (select auth.uid()), p_max_uses);
  return generated_code;
end;
$$;

create function public.consume_invite(p_code text, p_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  selected_invite public.invite_codes%rowtype;
begin
  select * into selected_invite
  from public.invite_codes
  where code = upper(trim(p_code))
  for update;
  if not found or not selected_invite.active
     or selected_invite.used_count >= selected_invite.max_uses
     or (selected_invite.expires_at is not null and selected_invite.expires_at <= now()) then
    raise exception 'Invite code is invalid, expired, or fully used';
  end if;
  update public.invite_codes set used_count = used_count + 1 where id = selected_invite.id;
  if selected_invite.created_by is not null then
    insert into public.notifications (user_id, title, body)
    values (selected_invite.created_by, 'Invite code digunakan', 'Kode ' || selected_invite.code || ' berhasil digunakan.');
  end if;
end;
$$;

create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  requested_nickname text := trim(coalesce(new.raw_user_meta_data ->> 'nickname', ''));
  supplied_invite text := trim(coalesce(new.raw_user_meta_data ->> 'invite_code', ''));
begin
  if requested_nickname !~ '^[[:alnum:]_ .-]{3,24}$' then
    raise exception 'Nickname must be 3-24 valid characters';
  end if;
  perform public.consume_invite(supplied_invite, new.id);
  insert into public.profiles (id, nickname) values (new.id, requested_nickname);
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.id <> old.id or new.created_at <> old.created_at then
    raise exception 'Profile identity fields cannot be changed';
  end if;
  if new.role is distinct from old.role and auth.uid() = old.id then
    raise exception 'Owners cannot change their own role';
  end if;
  if new.role is distinct from old.role and (auth.uid() is not null and not public.is_owner()) then
    raise exception 'Only the owner can change member roles';
  end if;
  if new.nickname is distinct from old.nickname
     and (auth.uid() is not null and not public.is_owner())
     and (char_length(new.nickname) not between 3 and 24 or new.nickname !~ '^[[:alnum:]_ .-]+$') then
    raise exception 'Invalid nickname';
  end if;
  return new;
end;
$$;
create trigger protect_profiles before update on public.profiles
  for each row execute function public.protect_profile_fields();

create function public.check_login_rate(p_key_hash text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  attempts public.auth_login_attempts%rowtype;
begin
  if length(p_key_hash) <> 64 then raise exception 'Invalid rate key'; end if;
  insert into public.auth_login_attempts (key_hash) values (p_key_hash)
  on conflict (key_hash) do nothing;
  select * into attempts from public.auth_login_attempts where key_hash = p_key_hash for update;
  if attempts.blocked_until is not null and attempts.blocked_until > now() then
    return false;
  end if;
  if attempts.window_started_at < now() - interval '15 minutes' then
    update public.auth_login_attempts set window_started_at = now(), attempt_count = 1, blocked_until = null where key_hash = p_key_hash;
    return true;
  end if;
  if attempts.attempt_count >= 10 then
    update public.auth_login_attempts set blocked_until = now() + interval '15 minutes' where key_hash = p_key_hash;
    return false;
  end if;
  update public.auth_login_attempts set attempt_count = attempt_count + 1 where key_hash = p_key_hash;
  return true;
end;
$$;

alter table public.profiles enable row level security;
alter table public.invite_codes enable row level security;
alter table public.publications enable row level security;
alter table public.publication_reactions enable row level security;
alter table public.publication_comments enable row level security;
alter table public.files enable row level security;
alter table public.chat_rooms enable row level security;
alter table public.chat_room_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.notifications enable row level security;
alter table public.password_reset_requests enable row level security;
alter table public.auth_login_attempts enable row level security;

create policy "Profiles visible to members" on public.profiles
  for select to authenticated using (true);
create policy "Members update own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid()) or (select public.is_owner()))
  with check (id = (select auth.uid()) or (select public.is_owner()));

create policy "Admins view invites" on public.invite_codes
  for select to authenticated using ((select public.can_manage_invites()));
create policy "Owner updates invites" on public.invite_codes
  for update to authenticated using ((select public.is_owner()))
  with check ((select public.is_owner()));
create policy "Owner deletes invites" on public.invite_codes
  for delete to authenticated using ((select public.is_owner()));

create policy "Public publications and own private publications" on public.publications
  for select to authenticated using (visibility = 'public' or owner_id = (select auth.uid()));
create policy "Members publish as themselves" on public.publications
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Owners edit own publications" on public.publications
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "Owners delete own publications" on public.publications
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "Members read reactions on visible publications" on public.publication_reactions
  for select to authenticated using (exists (
    select 1 from public.publications p
    where p.id = publication_id and (p.visibility = 'public' or p.owner_id = (select auth.uid()))
  ));
create policy "Members react to visible publications" on public.publication_reactions
  for insert to authenticated with check (
    user_id = (select auth.uid()) and exists (
      select 1 from public.publications p
      where p.id = publication_id and (p.visibility = 'public' or p.owner_id = (select auth.uid()))
    )
  );
create policy "Members remove own reactions" on public.publication_reactions
  for delete to authenticated using (user_id = (select auth.uid()));
create policy "Members read comments on visible publications" on public.publication_comments
  for select to authenticated using (exists (
    select 1 from public.publications p
    where p.id = publication_id and (p.visibility = 'public' or p.owner_id = (select auth.uid()))
  ));
create policy "Members comment on visible publications" on public.publication_comments
  for insert to authenticated with check (
    user_id = (select auth.uid()) and exists (
      select 1 from public.publications p
      where p.id = publication_id and (p.visibility = 'public' or p.owner_id = (select auth.uid()))
    )
  );
create policy "Members delete own comments" on public.publication_comments
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "Public and own file metadata" on public.files
  for select to authenticated using (visibility = 'public' or owner_id = (select auth.uid()));
create policy "Members add own file metadata" on public.files
  for insert to authenticated with check (owner_id = (select auth.uid()) and storage_path like (select auth.uid())::text || '/%');
create policy "Members update own file metadata" on public.files
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and storage_path like (select auth.uid())::text || '/%');
create policy "Members delete own file metadata" on public.files
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "Members see public or joined rooms" on public.chat_rooms
  for select to authenticated using (
    is_public or exists (
      select 1 from public.chat_room_members
      where room_id = chat_rooms.id and user_id = (select auth.uid())
    )
  );
create policy "Members see own room memberships" on public.chat_room_members
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Room participants read messages" on public.chat_messages
  for select to authenticated using (
    exists (select 1 from public.chat_rooms r where r.id = room_id and (
      r.is_public or exists (select 1 from public.chat_room_members m where m.room_id = r.id and m.user_id = (select auth.uid()))
    ))
  );
create policy "Room participants send messages" on public.chat_messages
  for insert to authenticated with check (
    sender_id = (select auth.uid()) and exists (
      select 1 from public.chat_rooms r where r.id = room_id and (
        r.is_public or exists (select 1 from public.chat_room_members m where m.room_id = r.id and m.user_id = (select auth.uid()))
      )
    )
  );
create policy "Members delete own messages" on public.chat_messages
  for delete to authenticated using (sender_id = (select auth.uid()));

create policy "Users read own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users mark own notifications read" on public.notifications
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users request own password reset" on public.password_reset_requests
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Owner reviews reset requests" on public.password_reset_requests
  for select to authenticated using ((select public.is_owner()));
create policy "Owner decides reset requests" on public.password_reset_requests
  for update to authenticated using ((select public.is_owner()))
  with check ((select public.is_owner()));

insert into storage.buckets (id, name, public, file_size_limit)
values ('member-files', 'member-files', false, 26214400), ('avatars', 'avatars', true, 3145728)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;
update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'application/pdf', 'text/plain', 'application/zip']
where id = 'member-files';
update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
where id = 'avatars';

create policy "Users upload own member files" on storage.objects
  for insert to authenticated with check (bucket_id = 'member-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Owners read own or public member files" on storage.objects
  for select to authenticated using (
    bucket_id = 'member-files' and exists (
      select 1 from public.files f
      where f.storage_path = name and (f.owner_id = (select auth.uid()) or f.visibility = 'public')
    )
  );
create policy "Owners update own member files" on storage.objects
  for update to authenticated using (bucket_id = 'member-files' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'member-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Owners delete own member files" on storage.objects
  for delete to authenticated using (bucket_id = 'member-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Anyone reads avatars" on storage.objects for select using (bucket_id = 'avatars');
create policy "Members upload own avatars" on storage.objects
  for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Members update own avatars" on storage.objects
  for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

grant execute on function public.create_invite_code(integer) to authenticated;
revoke all on function public.consume_invite(text, uuid) from public, anon, authenticated;
revoke all on function public.check_login_rate(text) from public, anon, authenticated;
grant execute on function public.consume_invite(text, uuid) to service_role;
grant execute on function public.check_login_rate(text) to service_role;
grant select, update on public.profiles to authenticated;
grant select, update, delete on public.invite_codes to authenticated;
grant select, insert, update, delete on public.publications to authenticated;
grant select, insert, delete on public.publication_reactions to authenticated;
grant select, insert, delete on public.publication_comments to authenticated;
grant select, insert, update, delete on public.files to authenticated;
grant select on public.chat_rooms, public.chat_room_members to authenticated;
grant select, insert, delete on public.chat_messages to authenticated;
grant select, update on public.notifications to authenticated;
grant select, insert, update on public.password_reset_requests to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;
