-- =============================================================
-- FEATURED REWARD ON HOME SCREEN
-- =============================================================
-- Marks a single reward to display in the WeeklyRewardTeaser
-- card on the app home screen. Enforced to one at a time via
-- a partial unique index.

alter table public.rewards
  add column featured_on_home boolean not null default false;

-- Only one reward may be featured at a time.
create unique index rewards_one_featured_on_home
  on public.rewards (featured_on_home)
  where featured_on_home = true;
