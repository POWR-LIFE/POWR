-- =============================================================
-- Gym portal: who can act for a gym
-- =============================================================
-- Every gym-facing control has lived behind admin_roles. The gym portal
-- (powr.life/venue) lets a gym's own people run their screens, and later
-- their events. This migration is only the identity layer:
--
--   gym_portal_settings  One row per gym with the portal switched on:
--                        enabled / suspended, trust (later phases: a
--                        trusted gym's events publish without review),
--                        limits and recap preferences. Admins only.
--   gym_staff            user ↔ gym, role owner | staff. A signed-in user
--                        can read their own rows; nothing else reads it
--                        directly.
--   gym_staff_invites    Single-use setup links. Only the sha256 of the
--                        token is stored. Only the manage-gym-staff edge
--                        function (service role) writes here.
--
-- The access rule for everything gym-scoped from here on: SECURITY DEFINER
-- functions that start with _gym_role() / _can_manage_gym(). No
-- staff-scoped RLS goes on any table the app reads, and staff are never
-- put in admin_roles. That keeps the old policies that read
-- profiles.is_admin out of reach, so a gym login can be the same account
-- someone uses in the app.

create table if not exists public.gym_portal_settings (
  partner_id         uuid primary key references public.partners(id) on delete cascade,
  enabled            boolean not null default true,
  trusted_at         timestamptz,
  trusted_by         uuid references auth.users(id) on delete set null,
  suspended_at       timestamptz,
  max_active_events  integer not null default 2 check (max_active_events between 0 and 10),
  recap_email        boolean not null default true,
  recap_member_push  boolean not null default false,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.gym_portal_settings is
  'Gym portal switch per partner. enabled=false or suspended_at set = staff lose access (admins keep it). trusted_at = later phases auto-publish this gym''s events.';

create table if not exists public.gym_staff (
  partner_id  uuid not null references public.partners(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'staff' check (role in ('owner', 'staff')),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (partner_id, user_id)
);

create index if not exists gym_staff_user_idx on public.gym_staff (user_id);

comment on table public.gym_staff is
  'Who can act for a gym in the portal. owner = manages the team and the screen link; staff = runs the screens (and, later, events).';

create table if not exists public.gym_staff_invites (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners(id) on delete cascade,
  token_hash  text not null unique,
  role        text not null default 'staff' check (role in ('owner', 'staff')),
  email       text,
  status      text not null default 'invited' check (status in ('invited', 'used', 'revoked')),
  expires_at  timestamptz not null default now() + interval '14 days',
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  used_by     uuid references auth.users(id) on delete set null,
  used_at     timestamptz
);

create index if not exists gym_staff_invites_partner_idx on public.gym_staff_invites (partner_id, status);

alter table public.gym_portal_settings enable row level security;
alter table public.gym_staff           enable row level security;
alter table public.gym_staff_invites   enable row level security;

drop policy if exists "Admins manage gym portal settings" on public.gym_portal_settings;
create policy "Admins manage gym portal settings" on public.gym_portal_settings
  for all to authenticated
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

drop policy if exists "Admins manage gym staff" on public.gym_staff;
create policy "Admins manage gym staff" on public.gym_staff
  for all to authenticated
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

drop policy if exists "Staff read their own gym links" on public.gym_staff;
create policy "Staff read their own gym links" on public.gym_staff
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Admins read gym staff invites" on public.gym_staff_invites;
create policy "Admins read gym staff invites" on public.gym_staff_invites
  for select to authenticated
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

-- ── The caller's role at a gym ──────────────────────────────────────────────
-- 'admin' for any admin, whatever the gym (their "view as gym" preview).
-- Otherwise the staff role, but only while the portal is on for that gym,
-- it isn't suspended, and the partner is active. Null = no access.
create or replace function public._gym_role(p_partner_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.admin_roles a where a.user_id = auth.uid()) then 'admin'
    else (
      select s.role
        from public.gym_staff s
        join public.gym_portal_settings g on g.partner_id = s.partner_id
        join public.partners p on p.id = s.partner_id
       where s.partner_id = p_partner_id
         and s.user_id = auth.uid()
         and g.enabled
         and g.suspended_at is null
         and p.active
    )
  end
$$;

create or replace function public._can_manage_gym(p_partner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._gym_role(p_partner_id) is not null
$$;

revoke all on function public._gym_role(uuid)       from public, anon, authenticated;
revoke all on function public._can_manage_gym(uuid) from public, anon, authenticated;

-- ── Audit trail for portal actions ──────────────────────────────────────────
-- Same log as admin actions (admin_id is the actor's auth user), tagged so
-- the Audit page can tell a gym's own change from POWR's.
create or replace function public._gym_audit(p_partner_id uuid, p_action text, p_metadata jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
  values (auth.uid(), p_action, 'partner', p_partner_id::text,
          coalesce(p_metadata, '{}'::jsonb)
            || jsonb_build_object('by', 'gym', 'role', public._gym_role(p_partner_id)))
$$;

revoke all on function public._gym_audit(uuid, text, jsonb) from public, anon, authenticated;

-- ── Which gyms the signed-in user belongs to (the portal's role check) ──────
create or replace function public.gym_my_memberships()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'partner_id', s.partner_id,
           'name',       p.name,
           'logo_url',   p.logo_url,
           'logo_bg',    p.logo_bg,
           'role',       s.role,
           'active',     coalesce(g.enabled, false) and g.suspended_at is null and p.active
         ) order by p.name), '[]'::jsonb)
    from public.gym_staff s
    join public.partners p on p.id = s.partner_id
    left join public.gym_portal_settings g on g.partner_id = s.partner_id
   where s.user_id = auth.uid()
$$;

revoke all on function public.gym_my_memberships() from public, anon;
grant execute on function public.gym_my_memberships() to authenticated;
