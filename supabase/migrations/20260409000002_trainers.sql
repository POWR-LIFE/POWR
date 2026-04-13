-- =============================================================
-- TRAINERS (PT profiles linked to partner gyms)
-- =============================================================
-- Personal trainer profiles displayed on the Discover page
-- when a user taps a gym partner. Managed via admin-partners.

create table public.trainers (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners(id) on delete cascade,
  name        text not null,
  photo_url   text,
  bio         text,
  specialties text[],
  experience  text,
  active      bool not null default true,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.trainers enable row level security;

-- Public read: only active trainers at active partners
create policy "Trainers readable when partner active"
  on public.trainers for select
  using (
    active = true
    and exists (
      select 1 from public.partners p
      where p.id = trainers.partner_id and p.active = true
    )
  );

-- Admin full access
create policy "Admins can manage trainers"
  on public.trainers for all
  using (
    (select is_admin from public.profiles where id = auth.uid()) = true
  );

-- Fast lookup by partner
create index idx_trainers_partner
  on public.trainers (partner_id)
  where active = true;

-- =============================================================
-- TRAINER PHOTOS STORAGE BUCKET
-- =============================================================

insert into storage.buckets (id, name, public)
values ('trainer-photos', 'trainer-photos', true)
on conflict (id) do nothing;

create policy "Public read access for trainer photos"
  on storage.objects for select
  using (bucket_id = 'trainer-photos');

create policy "Admins can upload trainer photos"
  on storage.objects for insert
  with check (
    bucket_id = 'trainer-photos'
    and (select is_admin from public.profiles where id = auth.uid()) = true
  );

create policy "Admins can update trainer photos"
  on storage.objects for update
  using (
    bucket_id = 'trainer-photos'
    and (select is_admin from public.profiles where id = auth.uid()) = true
  );

create policy "Admins can delete trainer photos"
  on storage.objects for delete
  using (
    bucket_id = 'trainer-photos'
    and (select is_admin from public.profiles where id = auth.uid()) = true
  );
