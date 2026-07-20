-- Vault vesting window: 30 → 60 days.
--
-- Product decision (2026-07-17): the Vault should feel like a savings
-- account — slow to build, worth the wait — not a short escrow. Applies to
-- NEW deposits only (vests_at is stamped at insert); existing deposits keep
-- the window they were created with.
update public.system_config
   set value = '60'
 where key = 'vault_vest_days';

-- Let the app read this one key so the Vault explainer can state the real
-- window instead of hardcoded copy (same per-key pattern as
-- min_gym_dwell_minutes; system_config SELECT is otherwise admin-only).
create policy "Authenticated can read vault vest days"
  on public.system_config for select
  to authenticated
  using (key = 'vault_vest_days');
