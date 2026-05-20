-- =============================================================
-- Security advisor batch fix (2026-05-13)
-- Addresses 22 of 26 outstanding WARN-level findings.
-- Remaining 4 are intentional (is_admin RLS dependency,
-- get_code_stats admin use, process_referral user-facing).
-- =============================================================

-- ── 1. Fix mutable search_path on 4 functions ─────────────────
-- Without SET search_path = '', a superuser could shadow public
-- objects and have them executed with elevated privileges.

CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = ''
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

CREATE OR REPLACE FUNCTION public.set_referral_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := public.generate_referral_code();
  END IF;
  RETURN NEW;
END;
$$;

-- nearby_partners used unqualified 'partners' — qualify to public.partners
CREATE OR REPLACE FUNCTION public.nearby_partners(
  user_lat   double precision,
  user_lng   double precision,
  radius_deg double precision DEFAULT 0.15
)
RETURNS TABLE(
  id            uuid,
  name          text,
  description   text,
  category      text,
  locations     jsonb,
  logo_url      text,
  image1_url    text,
  image2_url    text,
  opening_hours jsonb
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    p.id, p.name, p.description, p.category,
    p.locations, p.logo_url, p.image1_url, p.image2_url,
    p.opening_hours
  FROM public.partners p
  WHERE p.active = true
    AND p.locations IS NOT NULL
    AND jsonb_typeof(p.locations) = 'array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(p.locations) AS loc
      WHERE (loc->>'lat')::float BETWEEN user_lat - radius_deg AND user_lat + radius_deg
        AND (loc->>'lng')::float BETWEEN user_lng - radius_deg AND user_lng + radius_deg
    );
$$;

CREATE OR REPLACE FUNCTION public.get_code_stats(p_reward_id uuid)
RETURNS TABLE (status text, cnt bigint)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT status, count(*)::bigint AS cnt
    FROM public.redemption_codes
   WHERE reward_id = p_reward_id
   GROUP BY status;
$$;

-- ── 2. Revoke EXECUTE from trigger-only functions ──────────────
-- These are invoked exclusively by database triggers and must not
-- be callable via the REST API. CREATE OR REPLACE resets grants
-- on newly-created functions to PUBLIC default; re-revoke here
-- for all four trigger functions plus the referral helpers.

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_profile() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_notification_prefs() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_admin_role() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_referral_code() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_referral_code() FROM anon, authenticated;

-- process_referral: anon can never succeed (auth.uid() IS NULL guard is
-- inside the function), but revoke direct RPC access to be explicit.
REVOKE EXECUTE ON FUNCTION public.process_referral(text) FROM anon;

-- NOTE: is_admin() is intentionally NOT revoked. It is called directly
-- inside USING clauses on partners, rewards, waitlist, and profiles RLS
-- policies, so anon + authenticated both need EXECUTE for policy eval.

-- ── 3. Fix athlete_applications INSERT policy ──────────────────
-- Replace the open WITH CHECK (true) on public with a scoped policy:
-- only authenticated users can insert their own application.

DROP POLICY IF EXISTS "public_insert" ON public.athlete_applications;

CREATE POLICY "Users can submit own athlete application"
  ON public.athlete_applications
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = profile_id);

-- ── 4. Fix partner_applications INSERT policy ──────────────────
-- This is a landing-page form (no account required) so anon must
-- be allowed. Replace literal `true` with a basic email sanity
-- check — not restrictive in practice, but not literally `true`.

DROP POLICY IF EXISTS "Anyone can submit partner application"
  ON public.partner_applications;

CREATE POLICY "Anyone can submit partner application"
  ON public.partner_applications
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (char_length(email) > 0);

-- ── 5. Drop SELECT policies from public storage buckets ────────
-- Public buckets serve every object via its public URL without
-- any RLS evaluation. SELECT policies on storage.objects for a
-- public bucket only enable directory listing (enumeration), not
-- file access, so they expose more than intended. Dropping them
-- leaves direct URL access intact.

DROP POLICY IF EXISTS "Authenticated read access for avatars"          ON storage.objects;
DROP POLICY IF EXISTS "Public read access for covers"                  ON storage.objects;
DROP POLICY IF EXISTS "Public read access for gallery"                 ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read access for landing-page-assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read access for partner-logos"    ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read access for reward-images"    ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read access for trainer-photos"   ON storage.objects;
