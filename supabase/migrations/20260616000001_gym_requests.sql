-- =============================================================
-- GYM REQUESTS
-- During onboarding (and later from discover) a user can request a
-- gym we don't list yet. Each row is a lightweight intake tied to the
-- requesting user; admins triage them alongside partner management and,
-- on action, add the gym to public.partners.
-- =============================================================

create table if not exists public.gym_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  location_text text,                 -- free-text city / address the user typed
  note          text,
  status        text not null default 'pending'
                  check (status in ('pending','added','rejected')),
  reviewed_by   uuid references public.profiles(id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists idx_gym_requests_status
  on public.gym_requests (status, created_at desc);

alter table public.gym_requests enable row level security;

-- Authenticated users create their own requests
drop policy if exists "Users create own gym requests" on public.gym_requests;
create policy "Users create own gym requests"
  on public.gym_requests for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Users can read their own requests (e.g. to show pending state)
drop policy if exists "Users read own gym requests" on public.gym_requests;
create policy "Users read own gym requests"
  on public.gym_requests for select
  to authenticated
  using (auth.uid() = user_id);

-- Admins (admin_roles) have full access for triage
drop policy if exists "Admins manage gym requests" on public.gym_requests;
create policy "Admins manage gym requests"
  on public.gym_requests for all
  using      (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));
