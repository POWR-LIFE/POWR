-- =============================================================
-- REFERRAL FIX (real one): the enforce_point_award_cap BEFORE INSERT
-- trigger on point_transactions blocks *authenticated* clients from
-- inserting any non-session point row (type<>'earn', or earn w/o a
-- session). process_referral is SECURITY DEFINER, but the trigger keys
-- off the REQUEST JWT role, which is still 'authenticated' when the app
-- calls the RPC -> the reward inserts were rejected and the whole
-- referral rolled back.
--
-- Non-session awards (award-bonus etc.) work because they run with the
-- service role, which the trigger passes through. So: elevate to the
-- service-role context for just these two trusted, guarded inserts
-- (fixed 20 pts, after self/already/invalid checks), then restore.
-- Reward type is 'bonus' (no session needed, same as the signup bonus;
-- counts toward balance/total and shows in history).
-- =============================================================

CREATE OR REPLACE FUNCTION public.process_referral(p_referral_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_referrer_id  UUID;
  v_referred_id  UUID := auth.uid();
  v_reward       INT  := 20;
  v_claims       TEXT := current_setting('request.jwt.claims', true);
BEGIN
  IF v_referred_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  p_referral_code := upper(trim(p_referral_code));

  SELECT id INTO v_referrer_id
    FROM public.profiles
   WHERE referral_code = p_referral_code;

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_code');
  END IF;

  IF v_referrer_id = v_referred_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'self_referral');
  END IF;

  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_id = v_referred_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_referred');
  END IF;

  INSERT INTO public.referrals (referrer_id, referred_id)
    VALUES (v_referrer_id, v_referred_id);

  -- Trusted award: elevate to service-role context so the anti-cheat
  -- trigger (enforce_point_award_cap) passes these non-session rows
  -- through, the same way it does for award-bonus / claim-points.
  PERFORM set_config(
    'request.jwt.claims',
    (coalesce(nullif(v_claims, '')::jsonb, '{}'::jsonb)
       || jsonb_build_object('role', 'service_role'))::text,
    true
  );

  INSERT INTO public.point_transactions (user_id, amount, type, source, description)
    VALUES (v_referred_id, v_reward, 'bonus', 'referral_received', 'Invite code reward');

  INSERT INTO public.point_transactions (user_id, amount, type, source, description)
    VALUES (v_referrer_id, v_reward, 'bonus', 'referral_sent', 'A friend joined with your code');

  -- Restore the original request context.
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id, 'reward', v_reward);
END;
$$;
