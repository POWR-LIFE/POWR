-- =============================================================
-- REFERRAL FIX: point_transactions.type is NOT NULL (enum) with
-- no default, but process_referral inserted reward rows without
-- setting `type` -> every insert failed and the whole referral
-- rolled back. No referral has ever succeeded.
-- Fix: set type='earn' (counts toward balance, total, today/weekly
-- earned and shows in history) + a friendly description.
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

  INSERT INTO public.point_transactions (user_id, amount, type, source, description)
    VALUES (v_referred_id, v_reward, 'earn', 'referral_received', 'Invite code reward');

  INSERT INTO public.point_transactions (user_id, amount, type, source, description)
    VALUES (v_referrer_id, v_reward, 'earn', 'referral_sent', 'A friend joined with your code');

  RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id, 'reward', v_reward);
END;
$$;
