-- Add an explicit brand_name field to rewards.
-- Used for standalone rewards (no partner_id) or as a display-name override.
-- e.g. "Tribe" on a reward that has no linked partner row.

alter table public.rewards
  add column if not exists brand_name text;
