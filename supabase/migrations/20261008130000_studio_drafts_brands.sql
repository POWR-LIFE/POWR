-- Studio drafts for reward brands: the partner portal's Studio saves drafts
-- too. Brands have no table of their own (they're rewards.brand_name, linked
-- to their users by reward_brand_users), so a brand's draft carries its
-- brand_name, and its files live under brands/<brand slug>/drafts/<id>/ in
-- the private studio-packs bucket. That brand's users (and POWR admins) can
-- save, list, open and delete them; no other brand or gym can.
-- Gyms' drafts already work (20261006120000_studio_drafts.sql). POWR's own
-- are the rows with neither a partner_id nor a brand_name.

alter table public.studio_drafts
    add column if not exists brand_name text;

alter table public.studio_drafts drop constraint if exists studio_drafts_one_owner;
alter table public.studio_drafts
    add constraint studio_drafts_one_owner check (partner_id is null or brand_name is null);

create index if not exists studio_drafts_brand_idx
    on public.studio_drafts (lower(brand_name), updated_at desc) where brand_name is not null;

-- "Healthspan Elite" → "healthspan-elite": a brand's storage folder. The
-- portal makes the same slug (studio/drafts/store.js brandSlug); anything
-- outside a–z 0–9 becomes a dash however either side lowercases it.
create or replace function public.studio_brand_slug(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
    select trim(both '-' from regexp_replace(lower(btrim(coalesce(p_name, ''))), '[^a-z0-9]+', '-', 'g'));
$$;

-- Is the caller a user of this brand? Policies run as the caller, who can't
-- read other brands' links, so they ask through this yes/no wrapper.
create or replace function public.studio_brand_access(p_brand text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select p_brand is not null and exists (
        select 1 from public.reward_brand_users u
        where u.user_id = auth.uid() and lower(u.brand_name) = lower(p_brand)
    );
$$;

-- The same question for a storage path: brands/<slug>/…
create or replace function public.studio_brand_path_access(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_parts text[] := string_to_array(p_name, '/');
begin
    if coalesce(array_length(v_parts, 1), 0) < 3 or v_parts[1] <> 'brands' or coalesce(v_parts[2], '') = '' then
        return false;
    end if;
    return exists (
        select 1 from public.reward_brand_users u
        where u.user_id = auth.uid() and public.studio_brand_slug(u.brand_name) = v_parts[2]
    );
end;
$$;

revoke all on function public.studio_brand_access(text) from public, anon;
revoke all on function public.studio_brand_path_access(text) from public, anon;
grant execute on function public.studio_brand_access(text) to authenticated;
grant execute on function public.studio_brand_path_access(text) to authenticated;

drop policy if exists "Brand users manage their brand's studio drafts" on public.studio_drafts;
create policy "Brand users manage their brand's studio drafts" on public.studio_drafts
    for all to authenticated
    using (brand_name is not null and (select public.studio_brand_access(brand_name)))
    with check (brand_name is not null and partner_id is null and (select public.studio_brand_access(brand_name)));

-- Storage: every operation, SELECT included (uploads run INSERT … RETURNING).
drop policy if exists "Brand users read their studio files" on storage.objects;
create policy "Brand users read their studio files" on storage.objects
    for select to authenticated using (bucket_id = 'studio-packs' and public.studio_brand_path_access(name));

drop policy if exists "Brand users upload their studio files" on storage.objects;
create policy "Brand users upload their studio files" on storage.objects
    for insert to authenticated with check (bucket_id = 'studio-packs' and public.studio_brand_path_access(name));

drop policy if exists "Brand users update their studio files" on storage.objects;
create policy "Brand users update their studio files" on storage.objects
    for update to authenticated using (bucket_id = 'studio-packs' and public.studio_brand_path_access(name))
    with check (bucket_id = 'studio-packs' and public.studio_brand_path_access(name));

drop policy if exists "Brand users delete their studio files" on storage.objects;
create policy "Brand users delete their studio files" on storage.objects
    for delete to authenticated using (bucket_id = 'studio-packs' and public.studio_brand_path_access(name));
