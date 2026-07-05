-- =============================================================
-- REWARD PLACEMENTS → billing_status (beta-free vs billable)
-- =============================================================
-- Brand self-serve placements are forced paid=true so they carry the
-- "Sponsored" tag — but during the beta they publish FREE. Once payments are
-- wired we won't be able to tell a beta-free placement from a truly billable
-- one, because both are paid=true. This column records that distinction from
-- day one:
--   'beta'     : Sponsored, but not charged (beta / grandfathered)
--   'billable' : should be invoiced (set when payments go live)
--   'comped'   : first-party / house placement, never charged
--
-- Existing rows default to 'beta'. Brand-created rows stay locked to 'beta'
-- via RLS until we deliberately flip the model; only admins can mark a
-- placement 'billable' or 'comped'.
-- =============================================================

alter table public.reward_placements
  add column if not exists billing_status text not null default 'beta'
    check (billing_status in ('beta', 'billable', 'comped'));

-- Keep the brand self-serve shape locked, now including billing_status.
-- (Permissive policies OR together, so admins remain unrestricted.)
drop policy if exists "Brands insert own reward placements" on public.reward_placements;
create policy "Brands insert own reward placements"
  on public.reward_placements for insert
  to authenticated
  with check (
    public.user_owns_reward_brand(reward_id)
    and geo_mode       = 'grid'
    and visibility     = 'boost'
    and priority       = 0
    and paid           = true
    and partner_id    is null
    and billing_status = 'beta'
  );

drop policy if exists "Brands update own reward placements" on public.reward_placements;
create policy "Brands update own reward placements"
  on public.reward_placements for update
  to authenticated
  using (public.user_owns_reward_brand(reward_id))
  with check (
    public.user_owns_reward_brand(reward_id)
    and geo_mode       = 'grid'
    and visibility     = 'boost'
    and priority       = 0
    and paid           = true
    and partner_id    is null
    and billing_status = 'beta'
  );
