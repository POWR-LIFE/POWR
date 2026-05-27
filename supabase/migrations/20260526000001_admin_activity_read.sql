-- =============================================================
-- ADMIN READ ACCESS FOR ACTIVITY & RELATED TABLES
-- Mirrors the pattern in 20260424000004_admin_point_transactions.sql.
-- The admin portal (UserProfile page) fetches activity_sessions,
-- user_streaks, redemptions and health_snapshots for any user.
-- Without these policies, RLS silently returns empty rows for
-- any user other than the admin themselves.
-- =============================================================

-- ── activity_sessions ─────────────────────────────────────────
CREATE POLICY "Admins can read all activity sessions"
  ON public.activity_sessions FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
  );

-- ── user_streaks ──────────────────────────────────────────────
CREATE POLICY "Admins can read all user streaks"
  ON public.user_streaks FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
  );

-- ── redemptions ───────────────────────────────────────────────
CREATE POLICY "Admins can read all redemptions"
  ON public.redemptions FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
  );

-- ── health_snapshots ──────────────────────────────────────────
CREATE POLICY "Admins can read all health snapshots"
  ON public.health_snapshots FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
  );
