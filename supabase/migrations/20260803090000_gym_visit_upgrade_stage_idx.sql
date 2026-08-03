-- Supporting index for the upgrade-stage scan in gym-visit-beacon.
--
-- After PR #297 the upgrade branch of dueVisits() no longer filters by
-- ended_at IS NULL, so the existing partial index gym_visits_due_idx
-- (status, started_at) WHERE ended_at IS NULL can't be used for that leg.
-- Without a dedicated index the upgrade scan degrades to a sequential scan
-- every minute on the full gym_visits table.
--
-- The upgrade query predicates on:
--   claimed_session_id IS NOT NULL  (visit has a session linked)
--   upgraded_at IS NULL             (bonus not yet awarded)
--   started_at >= now() - 24h       (within the retry window)
-- so a partial index on those two boolean conditions keeps the scan cheap.
create index gym_visits_upgrade_due_idx on public.gym_visits (started_at)
  where claimed_session_id is not null and upgraded_at is null;
