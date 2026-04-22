-- Brand partner applications submitted via landing-page /partners
create table if not exists public.partner_applications (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  brand       text not null,
  category    text not null
              check (category in ('eat','move','mind','sleep')),
  name        text not null,
  email       text not null,
  offer       text,
  status      text not null default 'new'
              check (status in ('new','contacted','approved','declined'))
);

create index if not exists idx_partner_applications_status
  on public.partner_applications (status, created_at desc);

alter table public.partner_applications enable row level security;

-- Anonymous submissions from the landing page
drop policy if exists "Anyone can submit partner application"
  on public.partner_applications;
create policy "Anyone can submit partner application"
  on public.partner_applications
  for insert
  to anon, authenticated
  with check (true);

-- Admin read + manage (mirrors waitlist policy)
drop policy if exists "Admins can manage partner applications"
  on public.partner_applications;
create policy "Admins can manage partner applications"
  on public.partner_applications
  for all
  using (
    (select is_admin from public.profiles where id = auth.uid()) = true
  );
