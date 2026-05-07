-- ── 1. Revoke direct RPC access to trigger-only functions ─────────────────
-- These functions are called exclusively by database triggers (on_auth_user_created,
-- on_profile_created, etc.). They were never intended to be callable via the
-- REST API (/rest/v1/rpc/<name>). Revoking prevents accidental or malicious
-- direct invocation.
--
-- is_admin() is intentionally NOT revoked — it is called from within RLS
-- policies on partners, profiles, rewards, and waitlist. Revoking would
-- break policy evaluation for those tables.

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_profile() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_notification_prefs() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_admin_role() FROM anon, authenticated;

-- ── 2. Restrict athlete-applications bucket listing to admins only ─────────
-- The previous broad SELECT policy allowed any anonymous visitor to enumerate
-- all uploaded files in this bucket (athlete CVs, photos, gallery images).
-- Replaced with an admin-only policy. Files remain accessible via their
-- public URL if needed, but the directory listing is now locked down.

DROP POLICY IF EXISTS "public read athlete applications" ON storage.objects;

CREATE POLICY "Admin read athlete applications"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'athlete-applications'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );
