-- =============================================================
-- REFERRAL REWARD: 200 -> 20 POWR
-- Lowers the referral payout to 20 POWR for BOTH the referrer
-- and the referred user. Only the reward amount changes; all
-- guards (self-referral, already-referred, invalid-code) stay.
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

  INSERT INTO public.point_transactions (user_id, amount, source)
    VALUES (v_referred_id, v_reward, 'referral_received');

  INSERT INTO public.point_transactions (user_id, amount, source)
    VALUES (v_referrer_id, v_reward, 'referral_sent');

  RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id, 'reward', v_reward);
END;
$$;
