-- Enforce one activity session per user per activity type per day.
-- Prevents duplicate geofence exits or race conditions from creating
-- multiple sessions of the same type on the same day.

-- 1. Remove duplicates (keep earliest per user/type/day)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, type, trust_score, date_trunc('day', started_at AT TIME ZONE 'UTC')
           ORDER BY created_at ASC
         ) AS rn
  FROM activity_sessions
)
DELETE FROM activity_sessions
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2. Add unique index (includes trust_score so that manual logs and
--    health-sync sessions for the same type can coexist on the same day)
CREATE UNIQUE INDEX idx_one_session_per_type_per_day
ON activity_sessions (user_id, type, trust_score, (date_trunc('day', started_at AT TIME ZONE 'UTC')));
