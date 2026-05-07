-- =============================================================
-- REFERRAL SYSTEM
-- Adds referral codes to profiles, tracks referrals, and awards
-- 200 POWR to both referrer and referred user on sign-up.
-- =============================================================

-- ── 1. Referral code generator ────────────────────────────────
-- 8-char uppercase alphanumeric, avoiding ambiguous chars (0, 1, I, O)

CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  chars  TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code   TEXT;
  i      INT;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..8 LOOP
      code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = code);
  END LOOP;
  RETURN code;
END;
$$;

-- ── 2. Add referral_code to profiles ─────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

-- Back-fill existing users
UPDATE public.profiles
  SET referral_code = public.generate_referral_code()
  WHERE referral_code IS NULL;

-- Enforce NOT NULL after back-fill
ALTER TABLE public.profiles
  ALTER COLUMN referral_code SET NOT NULL;

-- Auto-assign code to new profiles
CREATE OR REPLACE FUNCTION public.set_referral_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := public.generate_referral_code();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_referral_code
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_referral_code();

-- ── 3. Referrals table ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.referrals (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id  UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_id  UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (referred_id)  -- each user can only be referred once
);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own referral records"
  ON public.referrals FOR SELECT
  USING (auth.uid() = referrer_id OR auth.uid() = referred_id);

-- ── 4. process_referral RPC ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.process_referral(p_referral_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_referrer_id  UUID;
  v_referred_id  UUID := auth.uid();
  v_reward       INT  := 200;
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

  RETURN jsonb_build_object('success', true, 'referrer_id', v_referrer_id);
END;
$$;
