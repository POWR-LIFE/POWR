-- Admin-read RLS policies for the Challenge Analytics suite (admin panel → Challenges → Insights).
--
-- These three tables previously had ONLY read-own / participant-scoped SELECT policies, so the
-- admin client could not aggregate challenge outcomes. We mirror the existing
-- "Admins can read all ..." policies on activity_sessions / point_transactions: role public,
-- inline admin_roles EXISTS check (anon has no auth.uid() → fails closed). Deliberately uses the
-- inline EXISTS form (not is_admin()) to match the existing admin-read policies and avoid adding
-- new is_admin()-in-RLS references flagged in the 0028/0029 lockdown.

CREATE POLICY "Admins can read all challenge completions"
  ON public.user_challenge_completions FOR SELECT
  USING (EXISTS (SELECT 1 FROM admin_roles WHERE admin_roles.user_id = auth.uid()));

CREATE POLICY "Admins can read all shared challenges"
  ON public.shared_challenges FOR SELECT
  USING (EXISTS (SELECT 1 FROM admin_roles WHERE admin_roles.user_id = auth.uid()));

CREATE POLICY "Admins can read all shared challenge participants"
  ON public.shared_challenge_participants FOR SELECT
  USING (EXISTS (SELECT 1 FROM admin_roles WHERE admin_roles.user_id = auth.uid()));
