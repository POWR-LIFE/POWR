-- The daily ceiling the trigger enforces must be the SAME ceiling the edge
-- functions enforce. Three ways it wasn't, all found 2026-08-14:
--
-- 1. IT DIDN'T COUNT STREAK ROWS. The day's tally summed `pt.type = 'earn'`
--    only, while claim-points (step 9) and terra-webhook (dailyHeadroom) both
--    sum ['earn','streak']. The bonus lives in its own row precisely so the
--    ledger can show it, so counting only 'earn' let a client-written session
--    ride past the cap by exactly the bonus already paid.
--
--    Field proof — georgiesaunders1@outlook.com, 2026-08-10, gym:
--      10:56  geofence check-in (claim-points, service role)  earn 20 + streak 10 = 30, AT CAP
--      18:04  wearable gym 53 min (health_sync, client JWT)   trigger saw earn-only = 20,
--                                                             allowed 10 more
--      day total 40 against a cap of 30.
--    This only became reachable on 2026-08-07, when idx_one_wearable_workout_per_start
--    let a day hold a second wearable strength session at all.
--
-- 2. IT DIDN'T BUCKET THE STRENGTH LANE. gym and hiit each got their own 30,
--    so the lane that is "one lane, one cap" by product decision (2026-08-05)
--    paid up to 60 a day if the sessions landed under both labels. claim-points
--    and terra-webhook bucket through dailyCapBucket() since 957a462; this is
--    the DB half of that change, which the migration in that PR missed.
--
-- 3. SWIMMING'S 9-POINT RUNG WAS UNREACHABLE — `v_distance >= 2000 OR v_mins >= 40`
--    sits below `v_distance >= 2000 OR v_mins >= 60`, so any 2 km swim already
--    took the 10. Same duplicated condition the JS ladders carried until 957a462
--    fixed them. Left as-is, the trigger would clamp a legitimate 45-min /
--    1.5 km swim to 7 while the merged client pays it 9.
--
-- Nothing else moves: bound 1 (a session may never pay more than the ladder says
-- it is worth), the service-role and admin exemptions, and the client-write
-- guards are all carried over verbatim from 20260807160000.
--
-- ⚠ Existing over-cap ledger rows are NOT reversed here. The ledger is
-- append-only and the affected volume is one real user and 10 points; clawing
-- points back off a user is a product call, not a migration.

create or replace function public.enforce_point_award_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_role         text;
  v_uid          uuid;
  v_sess_user    uuid;
  v_type         text;
  v_cap_bucket   text;
  v_started_at   timestamptz;
  v_duration     int;
  v_distance     double precision;
  v_steps        int;
  v_mins         int;
  v_hours        numeric;
  v_dwell_min    int;
  v_upgrade_min  int;
  v_session_max  int;
  v_sess_already int;
  v_sess_left    int;
  v_day_start    timestamptz;
  v_cap          int;
  v_already      int;
  v_remaining    int;
BEGIN
  v_role := nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role';
  IF v_role IS NULL OR v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  v_uid := auth.uid();

  IF v_uid IS NOT NULL AND EXISTS (SELECT 1 FROM admin_roles WHERE user_id = v_uid) THEN
    RETURN NEW;
  END IF;

  IF NEW.type <> 'earn' THEN
    RAISE EXCEPTION 'point award rejected: clients may not insert % rows', NEW.type;
  END IF;
  IF NEW.session_id IS NULL THEN
    RAISE EXCEPTION 'point award rejected: earn must reference an activity session';
  END IF;

  SELECT user_id, type, started_at, duration_sec, distance_m, steps
    INTO v_sess_user, v_type, v_started_at, v_duration, v_distance, v_steps
  FROM activity_sessions
  WHERE id = NEW.session_id;

  IF v_sess_user IS NULL THEN
    RAISE EXCEPTION 'point award rejected: session % not found', NEW.session_id;
  END IF;
  IF v_sess_user <> v_uid OR NEW.user_id <> v_uid THEN
    RAISE EXCEPTION 'point award rejected: session does not belong to caller';
  END IF;

  IF NEW.amount <= 0 THEN
    RETURN NULL;
  END IF;

  -- ── Bound 1: what this session is worth ────────────────────────────────────
  v_mins     := floor(coalesce(v_duration, 0) / 60.0);
  v_hours    := coalesce(v_duration, 0) / 3600.0;
  v_distance := coalesce(v_distance, 0);
  v_steps    := coalesce(v_steps, 0);

  SELECT coalesce(max(nullif(value, '')::int) filter (where key = 'min_gym_dwell_minutes'), 30),
         coalesce(max(nullif(value, '')::int) filter (where key = 'gym_upgrade_minutes'),  40)
    INTO v_dwell_min, v_upgrade_min
  FROM system_config
  WHERE key IN ('min_gym_dwell_minutes', 'gym_upgrade_minutes');

  v_session_max := CASE v_type
    WHEN 'running' THEN
      CASE WHEN v_distance >= 10000 OR v_mins >= 60 THEN 10
           WHEN v_distance >=  5000 OR v_mins >= 30 THEN 8
           WHEN v_distance >=  3000 OR v_mins >= 20 THEN 6
           WHEN v_distance >=  2000 OR v_mins >= 15 THEN 5
           ELSE 0 END
    WHEN 'cycling' THEN
      CASE WHEN v_distance >= 50000 OR v_mins >= 90 THEN 10
           WHEN v_distance >= 25000 OR v_mins >= 60 THEN 8
           WHEN v_distance >= 12000 OR v_mins >= 30 THEN 6
           WHEN v_distance >=  6000 OR v_mins >= 20 THEN 4
           ELSE 0 END
    WHEN 'swimming' THEN
      -- The 9 rung is duration-only: a 2 km swim already took the 10 above, so
      -- repeating the distance test here made 9 unreachable (fixed 2026-08-14,
      -- matching calculateBasePoints in _shared/points.ts).
      CASE WHEN v_distance >= 2000 OR v_mins >= 60 THEN 10
           WHEN                        v_mins >= 40 THEN 9
           WHEN v_distance >= 1000 OR v_mins >= 20 THEN 7
           WHEN v_distance >=  500 OR v_mins >= 15 THEN 5
           ELSE 0 END
    WHEN 'sports' THEN
      CASE WHEN v_mins >= 90 THEN 10
           WHEN v_mins >= 60 THEN 8
           WHEN v_mins >= 30 THEN 6
           ELSE 0 END
    WHEN 'yoga' THEN
      CASE WHEN v_mins >= 60 THEN 6
           WHEN v_mins >= 45 THEN 5
           WHEN v_mins >= 30 THEN 4
           WHEN v_mins >= 20 THEN 3
           ELSE 0 END
    WHEN 'dance' THEN
      CASE WHEN v_mins >= 60 THEN 8
           WHEN v_mins >= 45 THEN 7
           WHEN v_mins >= 30 THEN 6
           WHEN v_mins >= 20 THEN 5
           ELSE 0 END
    WHEN 'gym' THEN
      CASE WHEN v_mins >= v_upgrade_min AND v_mins >= v_dwell_min THEN 20
           WHEN v_mins >= v_dwell_min THEN 15
           ELSE 0 END
    WHEN 'hiit' THEN
      -- HIIT's entry gate is a fixed 20 minutes; the upgrade rung is shared.
      CASE WHEN v_mins >= v_upgrade_min AND v_mins >= 20 THEN 20
           WHEN v_mins >= 20 THEN 15
           ELSE 0 END
    WHEN 'walking' THEN
      CASE WHEN v_steps >= 10000 THEN 5
           WHEN v_steps >=  8000 THEN 4
           WHEN v_steps >=  6000 THEN 3
           WHEN v_steps >=  4000 THEN 2
           ELSE 0 END
    WHEN 'sleep' THEN
      -- The restorative multiplier can only REDUCE the duration tier, so the
      -- tier alone is a safe ceiling.
      CASE WHEN v_hours >= 8 THEN 5
           WHEN v_hours >= 7 THEN 4
           WHEN v_hours >= 6 THEN 3
           WHEN v_hours >= 5 THEN 2
           WHEN v_hours >= 3 THEN 1
           ELSE 0 END
    ELSE 0
  END;

  SELECT coalesce(sum(amount), 0)
    INTO v_sess_already
  FROM point_transactions
  WHERE session_id = NEW.session_id
    AND type = 'earn';

  v_sess_left := v_session_max - v_sess_already;
  IF v_sess_left <= 0 THEN
    RETURN NULL;
  END IF;
  IF NEW.amount > v_sess_left THEN
    NEW.amount := v_sess_left;
  END IF;

  -- ── Bound 2: the daily ceiling of this type's CAP BUCKET, where it has one ──
  -- gym and hiit are one lane with one 30 (product decision 2026-08-05), so
  -- they share a bucket here exactly as dailyCapBucket() does in claim-points
  -- and terra-webhook. NULL = uncapped (cardio, 2026-08-07); bound 1 still
  -- applies to those.
  v_cap_bucket := CASE WHEN v_type IN ('gym', 'hiit') THEN 'gym' ELSE v_type END;

  v_cap := CASE v_cap_bucket
    WHEN 'walking'  THEN 5
    WHEN 'gym'      THEN 30
    WHEN 'sleep'    THEN 5
    ELSE NULL
  END;

  IF v_cap IS NULL THEN
    RETURN NEW;
  END IF;

  v_day_start := date_trunc('day', v_started_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  -- Counts 'earn' AND 'streak'. The cap applies to a day's TOTAL award and the
  -- bonus is its own ledger row, so summing 'earn' alone let the bonus ride past
  -- the ceiling uncounted — see the header for the 2026-08-10 case.
  SELECT coalesce(sum(pt.amount), 0)
    INTO v_already
  FROM point_transactions pt
  JOIN activity_sessions s ON s.id = pt.session_id
  WHERE pt.user_id = v_uid
    AND pt.type IN ('earn', 'streak')
    AND (CASE WHEN s.type::text IN ('gym', 'hiit') THEN 'gym' ELSE s.type::text END) = v_cap_bucket
    AND s.started_at >= v_day_start
    AND s.started_at <  v_day_start + interval '1 day';

  v_remaining := v_cap - v_already;

  IF v_remaining <= 0 THEN
    RETURN NULL;
  END IF;

  IF NEW.amount > v_remaining THEN
    NEW.amount := v_remaining;
  END IF;

  RETURN NEW;
END;
$function$;

comment on function public.enforce_point_award_cap() is
  'Bounds client-written point_transactions two ways: per session (never more '
  'than the ladder says the session is worth) and per day (the type''s cap '
  'bucket ceiling, counting earn + streak rows). gym and hiit share one bucket. '
  'service_role and admins are exempt — claim-points, upgrade-gym-tier and '
  'terra-webhook do their own arithmetic and must keep the same three rules.';
