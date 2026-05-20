-- =============================================================
-- partner_api_keys is accessed exclusively via Edge Functions
-- (service role), which bypass RLS. This explicit deny policy
-- satisfies the linter and makes the intent clear: no JWT-
-- authenticated user should ever read or write this table
-- directly.
-- =============================================================

CREATE POLICY "No direct client access — service role only"
  ON public.partner_api_keys
  FOR ALL
  USING (false);
