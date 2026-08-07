-- Cardio is uncapped. A second run is a second run.
--
-- Product decision 2026-08-07. The per-type daily ceiling meant the day's later
-- effort earned nothing and said nothing about it — and worse, only geofence
-- check-in claims banked the clamped points into the Vault. A run that hit the
-- ceiling had its points silently discarded by this trigger (RETURN NULL) or by
-- terra-webhook. 98% of every cap_overflow deposit the Vault has ever taken came
-- from gym, so almost nothing was being rescued.
--
-- Uncapping is only safe because the scoring ladder moved with it: until today
-- the wearable paths paid a FLAT 10 for any run over 15 minutes, so lifting the
-- ceiling alone would have made three 15-minute jogs worth 30 while a 10 k stayed
-- at 10 — paying people to chop one workout into several. calculateBasePoints
-- (_shared/points.ts + the hooks/useHealthSync.ts mirror) now scores on the same
-- distance/duration ladder claim-points has always used, so points follow effort
-- and splitting a workout gains nothing.
--
-- Still capped, deliberately:
--   gym + hiit  a check-in measures verified PRESENCE, not work, so the strength
--               lane keeps 30 — and keeps it TOGETHER, or a wearable-labelled
--               class would out-earn the check-in it is scored identically to
--               (decision 2026-08-05).
--   walking     a daily step aggregate; 5 is what the top tier pays anyway.
--   sleep       one night per day; 5 is what the top tier pays anyway.
--
-- NULL from the CASE now means "uncapped" and returns NEW unclamped. Mirrored by
-- DAILY_CAPS in claim-points and _shared/points.ts — keep the three in step.

create or replace function public.enforce_point_award_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_role       text;
  v_uid        uuid;
  v_sess_user  uuid;
  v_type       text;
  v_started_at timestamptz;
  v_day_start  timestamptz;
  v_cap        int;
  v_already    int;
  v_remaining  int;
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

  SELECT user_id, type, started_at
    INTO v_sess_user, v_type, v_started_at
  FROM activity_sessions
  WHERE id = NEW.session_id;

  IF v_sess_user IS NULL THEN
    RAISE EXCEPTION 'point award rejected: session % not found', NEW.session_id;
  END IF;
  IF v_sess_user <> v_uid OR NEW.user_id <> v_uid THEN
    RAISE EXCEPTION 'point award rejected: session does not belong to caller';
  END IF;

  -- NULL = uncapped. The ownership and row-type checks above still apply: this
  -- trigger is the client write gate, not only a ceiling.
  v_cap := CASE v_type
    WHEN 'walking'  THEN 5
    WHEN 'gym'      THEN 30
    WHEN 'hiit'     THEN 30
    WHEN 'sleep'    THEN 5
    ELSE NULL
  END;

  IF v_cap IS NULL THEN
    IF NEW.amount <= 0 THEN
      RETURN NULL;
    END IF;
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

  IF v_remaining <= 0 OR NEW.amount <= 0 THEN
    RETURN NULL;
  END IF;

  IF NEW.amount > v_remaining THEN
    NEW.amount := v_remaining;
  END IF;

  RETURN NEW;
END;
$function$;
