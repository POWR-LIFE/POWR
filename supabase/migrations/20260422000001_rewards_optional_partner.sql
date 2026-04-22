-- Make partner_id optional on rewards.
-- Rewards can now be standalone (no brand attached), or linked to a reward_provider partner.
-- Location partners (earning_location role) are a separate concern and should not be
-- required to create a reward.

alter table public.rewards
  alter column partner_id drop not null;
