-- =============================================================
-- Fix SECURITY DEFINER on leaderboard views.
-- Default Postgres view behaviour is SECURITY DEFINER (runs as
-- the view owner, bypassing the querying user's RLS). Setting
-- security_invoker = true makes the view execute under the
-- caller's identity so RLS on profiles and point_transactions
-- is respected normally.
-- =============================================================

CREATE OR REPLACE VIEW public.leaderboard_weekly WITH (security_invoker = true) AS
  SELECT
    p.id            AS user_id,
    p.display_name,
    p.username,
    p.avatar_url,
    p.level,
    p.is_pro,
    COALESCE(SUM(pt.amount), 0)::INT AS weekly_points
  FROM public.profiles p
  LEFT JOIN public.point_transactions pt
    ON  pt.user_id    = p.id
    AND pt.type       IN ('earn', 'adjustment')
    AND pt.created_at >= date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
  WHERE p.show_on_leaderboard = true
  GROUP BY p.id, p.display_name, p.username, p.avatar_url, p.level, p.is_pro;

CREATE OR REPLACE VIEW public.leaderboard_alltime WITH (security_invoker = true) AS
  SELECT
    p.id            AS user_id,
    p.display_name,
    p.username,
    p.avatar_url,
    p.level,
    p.is_pro,
    COALESCE(SUM(pt.amount), 0)::INT AS total_points
  FROM public.profiles p
  LEFT JOIN public.point_transactions pt
    ON  pt.user_id = p.id
    AND pt.type    IN ('earn', 'adjustment')
  WHERE p.show_on_leaderboard = true
  GROUP BY p.id, p.display_name, p.username, p.avatar_url, p.level, p.is_pro;
