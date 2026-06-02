-- Backfill: relabel phone-sourced 'wearable' sessions as 'health'.
--
-- We have no per-row device provenance, so we use the user's active health
-- provider as the heuristic: if a user syncs via a native/phone aggregator
-- (Apple Health, Health Connect, Samsung Health) or has no provider set, their
-- 'wearable' sessions actually came from the phone and should be 'health'.
-- Users on a dedicated wearable provider (Fitbit, Whoop, Garmin) keep 'wearable'.
--
-- Sessions explicitly backed by a wearable-sourced health_snapshot are preserved
-- as 'wearable' even if the user's *current* provider is native (e.g. they
-- switched from Fitbit to Apple Health after the fact).
UPDATE public.activity_sessions s
SET verification = 'health'
WHERE s.verification = 'wearable'
  AND s.user_id IN (
    SELECT id FROM public.profiles
    WHERE active_health_provider IS NULL
       OR active_health_provider IN ('apple-health', 'health-connect', 'samsung-health')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.health_snapshots hs
    WHERE hs.session_id = s.id
      AND hs.source IN ('fitbit', 'whoop', 'garmin')
  );
