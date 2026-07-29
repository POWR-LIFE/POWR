-- =============================================================
-- LEADERBOARD VIEWS — penalty rows must subtract
-- =============================================================
-- The views summed only ('earn','adjustment'), so negative
-- 'penalty' rows — written when a session supersedes another
-- (claim-points/index.ts) or an admin rejects one in session
-- review (terra-webhook writes them too) — never reduced anyone's
-- board score. The points balance went down; the leaderboard rank
-- didn't. A user whose sessions were rejected for cheating kept
-- their full board total.
--
-- Harmless-ish on a bragging-rights board; not acceptable once
-- boards pay out prizes (live events). The event scoring RPC
-- (_live_event_scores, same-day migration) already counts penalty
-- rows; this brings the global views in line so the two can never
-- tell different stories about the same ledger.
--
-- 'streak' and 'bonus' remain deliberately excluded (post-#221
-- split: streak bonuses and referral rewards don't buy rank), as
-- do 'redeem' rows (spending is not negative earning).
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
    AND pt.type       IN ('earn', 'adjustment', 'penalty')
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
    AND pt.type    IN ('earn', 'adjustment', 'penalty')
  WHERE p.show_on_leaderboard = true
  GROUP BY p.id, p.display_name, p.username, p.avatar_url, p.level, p.is_pro;
