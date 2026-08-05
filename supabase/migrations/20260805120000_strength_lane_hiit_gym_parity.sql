-- Strength lane: HIIT/classes score like a gym session.
--
-- Product decision 2026-08-05 — a hard session shouldn't pay less because the
-- wearable (or the studio) labelled it a class rather than a gym visit. `gym`
-- and `hiit` now share one base tier table (15 / 20), one streak ladder
-- (×1.2 / 1.5 / 2 / 3) and one daily cap (30). Only the entry gate differs:
-- HIIT keeps its 20-minute floor so a short class still earns, while gym keeps
-- the admin-tunable min_gym_dwell_minutes.
--
-- This migration is the DB half: the per-type daily cap inside
-- enforce_point_award_cap, which clamps the CLIENT-authenticated write paths
-- (manual log, native health sync, walking sync). The server-side halves live in
-- supabase/functions/claim-points (DAILY_CAPS / calcBasePoints / calcStreakBonus)
-- and the client mirror in constants/activities.ts + app/manual-log.tsx.
--
-- The body below is the live 2026-08-05 definition, verbatim, with a single
-- change: `WHEN 'hiit' THEN 10` → `THEN 30`. Everything else — the service_role
-- opt-out, the admin bypass, the client-authz RAISEs, the earn-only sum — is
-- preserved deliberately. (Note the sum still counts only `type='earn'`: streak
-- rows are written by the service-role edge paths, which return early above and
-- enforce the earn+streak cap themselves inside claim-points.)

CREATE OR REPLACE FUNCTION public.enforce_point_award_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Per-activity-type daily cap (mirrors claim-points DAILY_CAPS).
  -- gym + hiit are the strength lane and share the 30 cap.
  v_cap := CASE v_type
    WHEN 'walking'  THEN 5
    WHEN 'running'  THEN 10
    WHEN 'cycling'  THEN 10
    WHEN 'swimming' THEN 10
    WHEN 'gym'      THEN 30
    WHEN 'hiit'     THEN 30
    WHEN 'sports'   THEN 10
    WHEN 'yoga'     THEN 6
    WHEN 'dance'    THEN 8
    WHEN 'sleep'    THEN 5
    ELSE 10
  END;

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
