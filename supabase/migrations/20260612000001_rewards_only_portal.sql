-- =============================================================
-- REWARDS-ONLY PARTNER PORTAL
-- Partners = geofenced gym locations. Rewards = standalone brand
-- offers identified by rewards.brand_name. The portal must not
-- touch the partners table at all.
--
-- 1. Revert the 2026-06-11 backfill that linked rewards→partners
-- 2. reward_brand_users replaces partner_users (keyed by brand_name)
-- 3. reward_brand_invites replaces partner_portal_invites
-- 4. RLS on rewards / reward_submissions / redemptions matches by
--    brand_name (case-insensitive)
-- =============================================================

-- ── 1. Revert backfill ────────────────────────────────────────
-- Preserve brand identity on rewards that only knew it via partner
update public.rewards r
set brand_name = p.name
from public.partners p
where r.partner_id = p.id
  and (r.brand_name is null or r.brand_name = '');

-- Unlink all rewards from partners
update public.rewards set partner_id = null where partner_id is not null;

-- Remove the brand partner rows created by the backfill
delete from public.partners
where roles = array['reward_provider']
  and name in ('FRANk', 'HUEL', 'MAJIC', 'MATHAN', 'Notto', 'OMNITY', 'REP', 'SWT');

-- ── 2. Drop partner-linked portal tables & their dependent policies ──
drop policy if exists "Partners read own rewards" on public.rewards;
drop policy if exists "Partner reads own submissions" on public.reward_submissions;
drop policy if exists "Partner insert own submissions" on public.reward_submissions;
drop policy if exists "Partner update own pending submissions" on public.reward_submissions;
drop policy if exists "Partners read own redemptions" on public.redemptions;

drop table if exists public.partner_users;
drop table if exists public.partner_portal_invites;

-- ── 3. Brand-keyed portal tables ──────────────────────────────
create table public.reward_brand_users (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  brand_name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_reward_brand_users_brand on public.reward_brand_users (lower(brand_name));

alter table public.reward_brand_users enable row level security;

create policy "Brand users read own"
  on public.reward_brand_users for select
  to authenticated
  using (user_id = auth.uid());

create policy "Admins manage brand users"
  on public.reward_brand_users for all
  to authenticated
  using      (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));

create table public.reward_brand_invites (
  id           uuid primary key default gen_random_uuid(),
  invite_token text not null unique,
  brand_name   text not null,
  status       text not null default 'invited'
                 check (status in ('invited', 'used', 'revoked')),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  used_at      timestamptz,
  used_by      uuid references auth.users(id) on delete set null
);

create index idx_reward_brand_invites_brand on public.reward_brand_invites (lower(brand_name), status);

alter table public.reward_brand_invites enable row level security;

create policy "Admins manage brand invites"
  on public.reward_brand_invites for all
  to authenticated
  using      (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));

-- ── 4. Brand-based RLS ────────────────────────────────────────
-- Rewards: brand users see all their brand's rewards (incl. inactive)
create policy "Brand users read own rewards"
  on public.rewards for select
  to authenticated
  using (
    exists (
      select 1 from public.reward_brand_users u
      where u.user_id = auth.uid()
        and lower(u.brand_name) = lower(rewards.brand_name)
    )
  );

-- Submissions: read own brand's; insert for own brand; update while pending.
-- target_reward_id (listing edit requests) must point at the brand's own reward.
create policy "Brand users read own submissions"
  on public.reward_submissions for select
  to authenticated
  using (
    exists (
      select 1 from public.reward_brand_users u
      where u.user_id = auth.uid()
        and lower(u.brand_name) = lower(reward_submissions.brand_name)
    )
  );

create policy "Brand users insert own submissions"
  on public.reward_submissions for insert
  to authenticated
  with check (
    exists (
      select 1 from public.reward_brand_users u
      where u.user_id = auth.uid()
        and lower(u.brand_name) = lower(reward_submissions.brand_name)
    )
    and (
      target_reward_id is null
      or target_reward_id in (
        select r.id from public.rewards r
        join public.reward_brand_users u on lower(u.brand_name) = lower(r.brand_name)
        where u.user_id = auth.uid()
      )
    )
  );

create policy "Brand users update own pending submissions"
  on public.reward_submissions for update
  to authenticated
  using (
    status in ('invited', 'pending')
    and exists (
      select 1 from public.reward_brand_users u
      where u.user_id = auth.uid()
        and lower(u.brand_name) = lower(reward_submissions.brand_name)
    )
  )
  with check (
    status in ('invited', 'pending')
    and exists (
      select 1 from public.reward_brand_users u
      where u.user_id = auth.uid()
        and lower(u.brand_name) = lower(reward_submissions.brand_name)
    )
    and (
      target_reward_id is null
      or target_reward_id in (
        select r.id from public.rewards r
        join public.reward_brand_users u on lower(u.brand_name) = lower(r.brand_name)
        where u.user_id = auth.uid()
      )
    )
  );

-- Redemptions: brand users see redemptions of their brand's rewards
create policy "Brand users read own redemptions"
  on public.redemptions for select
  to authenticated
  using (
    reward_id in (
      select r.id from public.rewards r
      join public.reward_brand_users u on lower(u.brand_name) = lower(r.brand_name)
      where u.user_id = auth.uid()
    )
  );
