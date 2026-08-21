-- A second sleep in one UTC day no longer disappears.
--
-- 2026-08-21: jamiemasonwright had no sleep for the night of 08-20→08-21. Terra
-- was delivering it — ~30-60 webhook POSTs an hour, all 200, connection fresh.
-- The row was being thrown away by this index.
--
-- 20260807120000 took wearable WORKOUTS out of the day bucket and keyed them on
-- their own start instant, because the bucket could not tell "the same workout
-- delivered twice" from "two workouts of the same kind today". It deliberately
-- left sleep behind, reasoning that "providers restate a night's window after
-- the fact, so the day bucket is what makes re-delivery idempotent".
--
-- That reasoning holds for re-delivery and fails for everything else. The bucket
-- keys on the BEDTIME day, so it holds one sleep per user per UTC day, and
-- whichever sleep lands FIRST owns the day:
--
--   * a 1.49h fragment landed at 01:25 on 08-21 carrying start_time 08-20 03:21.
--     It took the 2026-08-20 bucket. The real night began ~21:30 UTC on 08-20 —
--     same bucket — so it raised 23505 and was dropped.
--   * a 2.33h daytime nap (08-15 11:30 UTC) took the 2026-08-15 bucket and ate
--     the night of 08-15→08-16 the same way.
--
-- terra-webhook's handleSleep treated the 23505 as "already have it" and moved
-- on silently — no merge, no log — while the workout path beside it merged. And
-- terra-poll re-requests a rolling 2-day window, so a blocked night was
-- re-delivered and re-dropped every cycle. It never self-heals.
--
-- So finish the 08-07 change: wearable sleep is identified by the instant it
-- started, exactly like a wearable workout.
--
--   geofence (0.94)  one gym visit per day IS the product rule — keeps the day bucket.
--   walking  (0.90)  one steps row per day that each sync tops up — keeps it.
--   manual   (0.55)  one manual log per type per day is the anti-farm gate — keeps it.
--   wearable (0.85)  workouts AND sleep key on started_at. A nap and a night are two
--                    rows; a restatement or a fragment of the SAME night shares its
--                    start instant, collides here, and is healed in place.
--
-- Idempotency for re-delivery no longer rests on the bucket. terra-webhook now
-- runs sleep through the same findMergeTarget/relateWorkouts overlap test the
-- workout path uses: overlapping windows are one night told twice (take the
-- fuller telling), a gap under CONTIGUOUS_GAP_MIN is one night the provider
-- split (sum), and anything further apart is a genuinely separate sleep. That
-- test does not care what start instant a restatement carries, which is
-- strictly more robust than the bucket it replaces.
--
-- This does NOT loosen points. sleep's DAILY_CAPS entry (5) was previously
-- enforced only by there being one row a day; handleSleep now applies the same
-- dailyHeadroom check the workout path uses, so a nap plus a night still pays
-- at most 5 for the day.

drop index if exists idx_one_session_per_type_per_day;

create unique index idx_one_session_per_type_per_day
on activity_sessions (
  user_id, type, trust_score, (date_trunc('day', started_at at time zone 'UTC'))
)
where trust_score is distinct from 0.85;

comment on index idx_one_session_per_type_per_day is
  'One row per user per type per UTC day for the sources whose product rule IS '
  'one-a-day: geofence check-ins (0.94), the walking aggregate each sync tops up '
  '(0.90), and manual logs (0.55). Wearable rows (0.85) are excluded — they key '
  'on started_at instead, see idx_one_wearable_session_per_start.';

-- Replaces idx_one_wearable_workout_per_start, whose predicate excluded sleep.
drop index if exists idx_one_wearable_workout_per_start;

create unique index idx_one_wearable_session_per_start
on activity_sessions (user_id, type, started_at)
where trust_score = 0.85;

comment on index idx_one_wearable_session_per_start is
  'Wearable sessions — workouts and sleep alike — are identified by the instant '
  'they started, not by the day they fall in. Two runs in a day are two rows, and '
  'so are a nap and that night''s sleep; a re-delivery or a fragment of the SAME '
  'session shares its start_time, collides here, and is healed in place by '
  'terra-webhook. Replaces the day bucket that overwrote the first half of any '
  'split workout (2026-08-06) and silently dropped a second sleep (2026-08-21).';
