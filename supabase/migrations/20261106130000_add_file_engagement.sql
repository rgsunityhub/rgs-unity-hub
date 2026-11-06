create table if not exists public.file_reactions (
  file_id uuid not null references public.files(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (file_id, user_id)
);

create table if not exists public.file_comments (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.files(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists file_comments_time on public.file_comments (file_id, created_at);

alter table public.file_reactions enable row level security;
alter table public.file_comments enable row level security;

drop policy if exists "Members read engagement on visible files" on public.file_reactions;
create policy "Members read engagement on visible files" on public.file_reactions
  for select to authenticated using (exists (
    select 1 from public.files f
    where f.id = file_id and (f.visibility = 'public' or f.owner_id = (select auth.uid()))
  ));
drop policy if exists "Members react to visible files" on public.file_reactions;
create policy "Members react to visible files" on public.file_reactions
  for insert to authenticated with check (
    user_id = (select auth.uid()) and exists (
      select 1 from public.files f
      where f.id = file_id and (f.visibility = 'public' or f.owner_id = (select auth.uid()))
    )
  );
drop policy if exists "Members remove own file reactions" on public.file_reactions;
create policy "Members remove own file reactions" on public.file_reactions
  for delete to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Members read comments on visible files" on public.file_comments;
create policy "Members read comments on visible files" on public.file_comments
  for select to authenticated using (exists (
    select 1 from public.files f
    where f.id = file_id and (f.visibility = 'public' or f.owner_id = (select auth.uid()))
  ));
drop policy if exists "Members comment on visible files" on public.file_comments;
create policy "Members comment on visible files" on public.file_comments
  for insert to authenticated with check (
    user_id = (select auth.uid()) and exists (
      select 1 from public.files f
      where f.id = file_id and (f.visibility = 'public' or f.owner_id = (select auth.uid()))
    )
  );
drop policy if exists "Members delete own file comments" on public.file_comments;
create policy "Members delete own file comments" on public.file_comments
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, delete on public.file_reactions to authenticated;
grant select, insert, delete on public.file_comments to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'file_reactions'
  ) then
    alter publication supabase_realtime add table public.file_reactions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'file_comments'
  ) then
    alter publication supabase_realtime add table public.file_comments;
  end if;
end $$;
