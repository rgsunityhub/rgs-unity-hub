drop policy if exists "Owners read own or public member files" on storage.objects;

create policy "Owners read own or public member files" on storage.objects
  for select to authenticated using (
    bucket_id = 'member-files' and exists (
      select 1 from public.files f
      where f.storage_path = storage.objects.name
        and (f.owner_id = (select auth.uid()) or f.visibility = 'public')
    )
  );
