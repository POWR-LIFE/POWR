-- Studio drafts: a post (or a carousel) saved to finish later. The editor
-- saves its whole state — every slide's template, words, look, crop and clip
-- range, the size and the style — and the photos, clips and logos it uses, so
-- opening a draft puts the editor back exactly where it was left.
--
-- The files go in the private studio-packs bucket under drafts/<id>/ (a gym's
-- under gyms/<partner_id>/drafts/<id>/), whose storage policies already cover
-- both: admins anywhere in the bucket, gym staff under their own gyms/<id>/
-- (20260926170000_studio_packs.sql, 20260926190000_studio_packs_gyms.sql).
-- POWR's own drafts keep partner_id null and are admin-only, like packs.

create table if not exists public.studio_drafts (
    id uuid primary key default gen_random_uuid(),
    partner_id uuid references public.partners(id) on delete cascade,
    title text not null check (length(btrim(title)) between 1 and 120),
    -- The editor's state, version-tagged ({ v: 1, format, style, current,
    -- media[], assets[], slides[] }); media and assets point at storage paths.
    state jsonb not null,
    -- For the list, without reading state: the size, how many slides, whether
    -- any slide is a clip, the first slide's template, and its preview image.
    format text not null,
    slide_count integer not null default 1 check (slide_count >= 1),
    has_video boolean not null default false,
    template_id text,
    thumb_path text,
    bytes bigint not null default 0,
    created_by uuid default auth.uid() references auth.users(id) on delete set null,
    updated_by uuid default auth.uid() references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists studio_drafts_updated_idx on public.studio_drafts (updated_at desc) where partner_id is null;
create index if not exists studio_drafts_partner_idx on public.studio_drafts (partner_id, updated_at desc);

-- Every save or rename stamps who and when, so the list can say "Edited
-- 5 min ago by Sorine" without the client being trusted to say so.
create or replace function public.studio_drafts_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    return new;
end;
$$;

drop trigger if exists studio_drafts_touch on public.studio_drafts;
create trigger studio_drafts_touch before update on public.studio_drafts
    for each row execute function public.studio_drafts_touch();

alter table public.studio_drafts enable row level security;

drop policy if exists "Admins manage studio drafts" on public.studio_drafts;
create policy "Admins manage studio drafts" on public.studio_drafts
    for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Gym staff manage their gym's studio drafts" on public.studio_drafts;
create policy "Gym staff manage their gym's studio drafts" on public.studio_drafts
    for all to authenticated
    using (partner_id is not null and (select public.studio_gym_access(partner_id)))
    with check (partner_id is not null and (select public.studio_gym_access(partner_id)));
