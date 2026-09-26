-- Studio packs: a set of posts made in one go from a shoot (a folder, a pile
-- of files or a ZIP), optionally for a live event. The admin Studio downloads
-- the pack as a ZIP AND saves it here, so there's always a reference to come
-- back to: the photos it was made from, every file it produced, and the plan
-- (which photo went with which template, the words, the look) to rework it.
--
-- Admin-only throughout. Event photos show members, so the bucket is PRIVATE
-- (read through signed URLs), unlike the public media buckets.

create table if not exists public.studio_packs (
    id uuid primary key default gen_random_uuid(),
    live_event_id uuid references public.live_events(id) on delete set null,
    title text not null,
    phase text not null check (phase in ('before', 'during', 'after', 'brand')),
    -- The pack as made: posts (template, photo, words, look, sizes), the
    -- carousel and the reels. Enough to open it again in the pack builder.
    plan jsonb not null default '{}'::jsonb,
    -- 'saving' until every file is up; a tab closed mid-save leaves it there.
    status text not null default 'saving' check (status in ('saving', 'saved', 'failed')),
    source_count integer not null default 0,
    output_count integer not null default 0,
    bytes bigint not null default 0,
    created_by uuid default auth.uid() references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists studio_packs_event_idx on public.studio_packs (live_event_id, created_at desc);
create index if not exists studio_packs_created_idx on public.studio_packs (created_at desc);

create table if not exists public.studio_pack_files (
    id uuid primary key default gen_random_uuid(),
    pack_id uuid not null references public.studio_packs(id) on delete cascade,
    -- source: a photo or clip it was made from; output: a file in the ZIP;
    -- thumb: a small preview of a post, for the saved-packs list.
    role text not null check (role in ('source', 'output', 'thumb')),
    path text not null,
    name text not null,
    mime text not null,
    bytes bigint not null default 0,
    width integer,
    height integer,
    -- source: the photo's analysis; output/thumb: which post and size.
    meta jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (pack_id, path)
);

create index if not exists studio_pack_files_pack_idx on public.studio_pack_files (pack_id, role);

alter table public.studio_packs enable row level security;
alter table public.studio_pack_files enable row level security;

drop policy if exists "Admins manage studio packs" on public.studio_packs;
create policy "Admins manage studio packs" on public.studio_packs
    for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Admins manage studio pack files" on public.studio_pack_files;
create policy "Admins manage studio pack files" on public.studio_pack_files
    for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Private bucket. 50 MB a file: photos are saved at ≤ 3200 px, reels are
-- short; an original clip bigger than this isn't kept (its posts are).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'studio-packs', 'studio-packs', false, 52428800,
    array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm', 'application/pdf', 'text/plain']
)
on conflict (id) do nothing;

-- Every operation needs its own policy — including SELECT, which Postgres
-- also checks for INSERT … RETURNING, which storage runs on upload.
drop policy if exists "Admins read studio packs" on storage.objects;
create policy "Admins read studio packs" on storage.objects
    for select to authenticated using (bucket_id = 'studio-packs' and (select public.is_admin()));

drop policy if exists "Admins upload studio packs" on storage.objects;
create policy "Admins upload studio packs" on storage.objects
    for insert to authenticated with check (bucket_id = 'studio-packs' and (select public.is_admin()));

drop policy if exists "Admins update studio packs" on storage.objects;
create policy "Admins update studio packs" on storage.objects
    for update to authenticated using (bucket_id = 'studio-packs' and (select public.is_admin()))
    with check (bucket_id = 'studio-packs' and (select public.is_admin()));

drop policy if exists "Admins delete studio packs" on storage.objects;
create policy "Admins delete studio packs" on storage.objects
    for delete to authenticated using (bucket_id = 'studio-packs' and (select public.is_admin()));
