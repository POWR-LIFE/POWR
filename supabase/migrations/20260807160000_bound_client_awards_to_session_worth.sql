-- SECURITY: bound a client-written award to what its session is actually worth.
--
-- Regression introduced hours earlier by 20260807140000 and caught before merge.
-- That migration lifted the daily ceiling for cardio by returning NULL from the
-- CASE and then `RETURN NEW` unclamped. The ceiling, however, was doing TWO jobs:
-- it was the per-day limit AND the only bound on NEW.amount for client writes.
-- point_transactions is directly INSERT-able by `authenticated` under RLS
-- (WITH CHECK auth.uid() = user_id) and `amount` has no CHECK constraint, so with
-- the clamp gone an ordinary user could POST
--   {session_id: <any running session they own>, type: 'earn', amount: 1000000}
-- and it landed verbatim, immediately spendable. Verified against production and
-- rolled back. This is exactly the exposure the trigger was created to close
-- (20260529000002: "a crafted client could insert point_transactions with an
-- arbitrary amount and self-grant unlimited points").
--
-- The mistake was conflating "no daily ceiling" with "no ceiling". Those are
-- different limits and they need separate enforcement, so this splits them:
--
--   per SESSION  the total 'earn' against a session may never exceed what that
--                session scored on the ladder, recomputed here from the row's own
--                duration/distance/steps. This is the real invariant — you are
--                paid for what you did — and it does not care whether the type has
--                a daily ceiling, so uncapped cardio is bounded again without
--                reintroducing the cap that was deliberately removed.
--   per DAY      unchanged: gym/hiit 30, walking/sleep 5, cardio unlimited.
--
-- The ladder mirrors calculateBasePoints in _shared/points.ts and calcBasePoints
-- in claim-points, and reads the same admin-tunable strength thresholds, so an
-- admin retune moves this with them. It takes the better of the distance and
-- duration rungs, so it can never clamp a legitimate award: the client ladders
-- (hooks/useHealthSync.ts, app/manual-log.tsx) are duration-only subsets of it.
-- Where a pre-OTA client still computes the old FLAT rate, this correctly clamps
-- it to the ladder — the ladder becomes authoritative server-side immediately,
-- ahead of the client rollout.
--
-- service_role is still exempt (terra-webhook and claim-points do their own
-- arithmetic), as are admins.
--
-- ⚠ NOT fixed here, and pre-existing: activity_sessions is itself client-writable
-- with client-supplied started_at/duration/distance, so a determined user can
-- still mint by fabricating sessions. That was true before today (fabricate one
-- per day, collect the daily cap each time) and is bounded per session by this
-- change, but lifting the daily ceiling widens it. Closing it properly means
-- moving point writes behind a service-role function.

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
      CASE WHEN v_distance >= 2000 OR v_mins >= 60 THEN 10
           WHEN v_distance >= 2000 OR v_mins >= 40 THEN 9
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

  -- ── Bound 2: the type's daily ceiling, where it has one ────────────────────
  -- NULL = uncapped (cardio, 2026-08-07). Bound 1 still applies to those.
  v_cap := CASE v_type
    WHEN 'walking'  THEN 5
    WHEN 'gym'      THEN 30
    WHEN 'hiit'     THEN 30
    WHEN 'sleep'    THEN 5
    ELSE NULL
  END;

  IF v_cap IS NULL THEN
    RETURN NEW;
  END IF;

  v_day_start := date_trunc('day', v_started_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  SELECT coalesce(sum(pt.amount), 0)
    INTO v_already
  FROM point_transactions pt
  JOIN activity_sessions s ON s.id = pt.session_id
  WHERE pt.user_id = v_uid
    AND pt.type = 'earn'
    AND s.type::text = v_type
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
