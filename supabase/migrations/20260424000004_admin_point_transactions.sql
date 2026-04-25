-- =============================================================
-- ADMIN ACCESS TO point_transactions
-- Lets admins read any user's ledger and insert adjustments
-- on behalf of any user (needed by the admin dashboard).
-- =============================================================

CREATE POLICY "Admins can read all point transactions"
  ON public.point_transactions FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can insert point transactions"
  ON public.point_transactions FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
  );
