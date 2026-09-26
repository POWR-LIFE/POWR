-- Studio packs for gyms: the venue portal's Studio makes and saves packs too.
-- A gym's pack carries its partner_id and lives under gyms/<partner_id>/ in
-- the private studio-packs bucket; that gym's staff (and POWR admins) can
-- save, list, open and delete it — no other gym can. POWR's own packs keep
-- partner_id null and stay admin-only (20260926170000_studio_packs.sql).

alter table public.studio_packs
    add column if not exists partner_id uuid references public.partners(id) on delete cascade;

create index if not exists studio_packs_partner_idx on public.studio_packs (partner_id, created_at desc);

-- _gym_role() is private (not executable by signed-in users), and policies run
-- as the caller, so they ask through this yes/no wrapper.
create or replace function public.studio_gym_access(p_partner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select p_partner_id is not null and public._gym_role(p_partner_id) is not null;
$$;

-- The same question for a storage path: gyms/<partner_id>/…
create or replace function public.studio_gym_path_access(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_parts text[] := string_to_array(p_name, '/');
begin
    if coalesce(array_length(v_parts, 1), 0) < 3 or v_parts[1] <> 'gyms'
       or v_parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return false;
    end if;
    return public._gym_role(v_parts[2]::uuid) is not null;
end;
$$;

revoke all on function public.studio_gym_access(uuid) from public, anon;
revoke all on function public.studio_gym_path_access(text) from public, anon;
grant execute on function public.studio_gym_access(uuid) to authenticated;
grant execute on function public.studio_gym_path_access(text) to authenticated;

drop policy if exists "Gym staff manage their gym's studio packs" on public.studio_packs;
create policy "Gym staff manage their gym's studio packs" on public.studio_packs
    for all to authenticated
    using (partner_id is not null and (select public.studio_gym_access(partner_id)))
    with check (partner_id is not null and (select public.studio_gym_access(partner_id)));

drop policy if exists "Gym staff manage their gym's studio pack files" on public.studio_pack_files;
create policy "Gym staff manage their gym's studio pack files" on public.studio_pack_files
    for all to authenticated
    using (exists (select 1 from public.studio_packs p where p.id = pack_id and p.partner_id is not null and public.studio_gym_access(p.partner_id)))
    with check (exists (select 1 from public.studio_packs p where p.id = pack_id and p.partner_id is not null and public.studio_gym_access(p.partner_id)));

-- Storage: every operation, SELECT included (uploads run INSERT … RETURNING).
drop policy if exists "Gym staff read their studio packs" on storage.objects;
create policy "Gym staff read their studio packs" on storage.objects
    for select to authenticated using (bucket_id = 'studio-packs' and public.studio_gym_path_access(name));

drop policy if exists "Gym staff upload their studio packs" on storage.objects;
create policy "Gym staff upload their studio packs" on storage.objects
    for insert to authenticated with check (bucket_id = 'studio-packs' and public.studio_gym_path_access(name));

drop policy if exists "Gym staff update their studio packs" on storage.objects;
create policy "Gym staff update their studio packs" on storage.objects
    for update to authenticated using (bucket_id = 'studio-packs' and public.studio_gym_path_access(name))
    with check (bucket_id = 'studio-packs' and public.studio_gym_path_access(name));

drop policy if exists "Gym staff delete their studio packs" on storage.objects;
create policy "Gym staff delete their studio packs" on storage.objects
    for delete to authenticated using (bucket_id = 'studio-packs' and public.studio_gym_path_access(name));
