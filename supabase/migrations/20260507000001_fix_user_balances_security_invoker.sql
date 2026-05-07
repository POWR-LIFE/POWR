-- Recreate user_balances with security_invoker=true so queries run as the
-- calling user, meaning the point_transactions RLS policy kicks in and users
-- can only see their own balance.
CREATE OR REPLACE VIEW public.user_balances
  WITH (security_invoker = true)
AS
  SELECT
    user_id,
    COALESCE(SUM(amount), 0)::INT AS balance
  FROM public.point_transactions
  GROUP BY user_id;
