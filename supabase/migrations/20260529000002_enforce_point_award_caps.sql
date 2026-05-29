-- =============================================================
-- SERVER-SIDE POINT-AWARD GUARD
--
-- point_transactions has an RLS policy ("Users can insert their own
-- transactions", WITH CHECK auth.uid() = user_id) plus a user_id DEFAULT of
-- auth.uid(). The walking/sleep/manual sync paths rely on this to write points
-- directly from the client (lib/api/activity.ts, lib/health/walkingSync.ts),
-- bypassing the server-side checks in claim-points. The side effect is that a
-- crafted client could insert point_transactions with an arbitrary amount and
-- self-grant unlimited points.
--
-- This BEFORE INSERT trigger enforces the per-activity daily caps server-side on
-- every client-originated insert, so the worst a client can do is reach the same
-- daily ceiling a legitimate heavy user could. Trusted server functions
-- (claim-points, upgrade-gym-tier, award-bonus, redeem-reward) run with the
-- service role and are passed through unchanged, as are admin actions and direct
-- DB/migration access. Full anti-cheat (recomputing amounts from verified sensor
-- data) is a larger follow-up; this removes the unbounded exposure.
-- =============================================================

CREATE OR REPLACE FUNCTION public.enforce_point_award_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  -- Role from the request JWT. NULL/'' means a direct DB / migration connection
  -- (no PostgREST request context); the service role is our trusted backend.
  v_role := nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role';
  IF v_role IS NULL OR v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  v_uid := auth.uid();

  -- Admins manage transactions directly via their own policy — leave them alone.
  IF v_uid IS NOT NULL AND EXISTS (SELECT 1 FROM admin_roles WHERE user_id = v_uid) THEN
    RETURN NEW;
  END IF;

  -- From here down: an ordinary authenticated client insert.

  -- Clients only ever legitimately write session-backed 'earn' rows. Anything
  -- else (bonus/streak/redeem/adjustment, or an earn with no session) is abuse.
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
  v_cap := CASE v_type
    WHEN 'walking'  THEN 5
    WHEN 'running'  THEN 10
    WHEN 'cycling'  THEN 10
    WHEN 'swimming' THEN 10
    WHEN 'gym'      THEN 30
    WHEN 'hiit'     THEN 10
    WHEN 'sports'   THEN 10
    WHEN 'yoga'     THEN 6
    WHEN 'dance'    THEN 8
    WHEN 'sleep'    THEN 5
    ELSE 10
  END;

  -- Points already earned today for this user and this activity type (UTC day of
  -- the session being claimed), resolved via the session join.
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

  -- Nothing left in the cap, or a non-positive amount → drop the row silently
  -- (BEFORE-INSERT returning NULL cancels just this insert, no error surfaced).
  IF v_remaining <= 0 OR NEW.amount <= 0 THEN
    RETURN NULL;
  END IF;

  -- Clamp to the remaining cap.
  IF NEW.amount > v_remaining THEN
    NEW.amount := v_remaining;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_point_award_cap ON public.point_transactions;
CREATE TRIGGER trg_enforce_point_award_cap
  BEFORE INSERT ON public.point_transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_point_award_cap();
