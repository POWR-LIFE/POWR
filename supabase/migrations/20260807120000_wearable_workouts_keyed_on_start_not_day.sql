-- A split workout no longer destroys its other half.
--
-- 2026-08-06: Sorine ran ~10 km, stopped mid-run to take a call, then started a
-- fresh activity when she carried on. Garmin uploaded two activities. POWR kept
-- ONE — 5.85 km, 34 min — so a finished 10 k read as a run she gave up on. The
-- lost half is not recoverable from our tables: it was overwritten in place.
--
-- The cause is this index, added 2026-04-10 to stop duplicate geofence exits
-- racing each other into two rows. It buckets on the UTC DAY, which cannot tell
-- "the same workout delivered twice" apart from "two workouts of the same kind
-- today". The second delivery raised 23505 and landed in terra-webhook's
-- upgradeTruncatedSession, whose rule is "keep whichever telling is longer" —
-- correct for a mid-workout fragment, catastrophic for a second segment, which
-- overwrote the first. Nothing recorded that a workout had been dropped, which
-- is precisely what suppressed_workouts exists to make impossible.
--
-- So split the rule by who actually needs it:
--
--   geofence (0.94)  one gym visit per day IS the product rule (confirm_gym_visit_v2,
--                    open_gym_visit reuse, 20260801100000_*) — keep the day bucket.
--   walking  (0.90)  one steps row per day that each sync tops up — keep it.
--   manual   (0.55)  one manual log per type per day is the anti-farm gate — keep it.
--   sleep    (0.85)  providers restate a night's window after the fact, so the day
--                    bucket is what makes re-delivery idempotent — keep it.
--   workouts (0.85)  a wearable can legitimately record two runs, two swims, or one
--                    interrupted run in a day. Key these on the activity's own start
--                    instant instead: a re-delivery or a mid-workout fragment carries
--                    the SAME start_time, so it still collides and still heals, while
--                    a genuinely different activity carries a different one and gets
--                    its own row.
--
-- This does NOT loosen points. The per-type daily ceiling is enforced by
-- enforce_point_award_cap for client writes and, because that trigger exempts the
-- service role, by terra-webhook's own headroom check for webhook writes: running
-- still pays 10 a day however many rows the day ends up holding.
--
-- Callers that read "the day's wearable session of type X" must stop assuming one
-- row exists (maybeSingle now raises on two). The only one was terra-webhook, fixed
-- alongside this migration.

drop index if exists idx_one_session_per_type_per_day;

create unique index idx_one_session_per_type_per_day
on activity_sessions (
  user_id, type, trust_score, (date_trunc('day', started_at at time zone 'UTC'))
)
where (trust_score is distinct from 0.85) or (type = 'sleep');

create unique index idx_one_wearable_workout_per_start
on activity_sessions (user_id, type, started_at)
where (trust_score = 0.85) and (type <> 'sleep');

comment on index idx_one_wearable_workout_per_start is
  'Wearable workouts are identified by the instant they started, not by the day '
  'they fall in. Two runs in a day are two rows; a re-delivery or a mid-workout '
  'fragment of the SAME run shares its start_time, collides here, and is healed '
  'in place by terra-webhook. Replaces the day bucket that silently overwrote '
  'the first half of any split workout (2026-08-06).';
