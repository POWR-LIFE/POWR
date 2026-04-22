-- =============================================================
-- PER-USER REDEMPTION LIMIT
-- Adds max_redemptions_per_user to rewards.
-- null  = unlimited (default)
-- n > 0 = user may redeem this reward at most n times total
--         (counts active + used + expired, excluding refunded)
-- =============================================================

alter table public.rewards
  add column if not exists max_redemptions_per_user int
    check (max_redemptions_per_user is null or max_redemptions_per_user > 0);
