-- One daily-vitals row per user per provider-day.
--
-- terra-webhook's handleDaily (v41, 2026-08-27) stores a provider's daily
-- resting HR / HRV as a health_snapshots row with activity_type = 'daily' and
-- no session. Terra re-delivers a day's summary many times, and two deliveries
-- can land seconds apart (the 30-minute poll racing a backfill) — the handler's
-- find-then-insert produced 5 duplicate days within two minutes of the first
-- backfill. This index makes the second insert fail with 23505, which the
-- handler (v42) folds into the winning row.
--
-- The day key is the UTC date of recorded_at: the handler stamps the reading
-- at the provider's LOCAL noon, so every timezone within ±12h agrees on the
-- date. timezone('UTC', timestamptz) is immutable, so it can be indexed.
-- Fold the race duplicates first (identical values, keep the earliest row per day).
DELETE FROM public.health_snapshots hs
USING (
  SELECT id, row_number() OVER (
    PARTITION BY user_id, source, timezone('UTC', recorded_at)::date
    ORDER BY created_at, id
  ) AS rn
  FROM public.health_snapshots
  WHERE activity_type = 'daily' AND session_id IS NULL
) d
WHERE hs.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS health_snapshots_daily_vitals_day_uidx
  ON public.health_snapshots (user_id, source, (timezone('UTC', recorded_at)::date))
  WHERE activity_type = 'daily' AND session_id IS NULL;
