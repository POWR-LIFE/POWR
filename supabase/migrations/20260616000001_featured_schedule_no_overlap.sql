-- =============================================================
-- FEATURED REWARD SCHEDULE — prevent overlapping windows
-- =============================================================
-- Only one reward can occupy the featured hero card at a time, so two
-- schedule rows must never cover the same instant. The original
-- featured_reward_schedule migration promised this ("Overlapping windows
-- are prevented by a DB constraint") but never added it — this does.
--
-- Uses a GiST exclusion constraint over the [starts_at, ends_at) range.
-- Requires btree_gist. Windows are half-open: a slot ending at exactly
-- 16 Jun 00:00 does NOT conflict with one starting at 16 Jun 00:00.

create extension if not exists btree_gist;

alter table public.featured_reward_schedule
  add constraint featured_no_overlap
  exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&);
