-- =============================================================
-- LEADERBOARD VIEWS — include 'adjustment' rows alongside 'earn'
-- so admin point adjustments affect rank and totals. 'spend'
-- rows remain excluded (those track reward redemptions).
-- =============================================================

CREATE OR REPLACE VIEW public.leaderboard_weekly AS
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

CREATE OR REPLACE VIEW public.leaderboard_alltime AS
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
