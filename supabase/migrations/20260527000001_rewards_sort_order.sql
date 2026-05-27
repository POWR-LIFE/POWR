-- Add sort_order column to rewards for admin-controlled display ordering
ALTER TABLE public.rewards ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 9999;

-- Initialise existing rewards: preserve current admin view order (created_at DESC)
-- so newest reward = position 0, older rewards get incrementing positions
WITH ordered AS (
  SELECT id, (ROW_NUMBER() OVER (ORDER BY created_at DESC) - 1) AS rn
  FROM public.rewards
)
UPDATE public.rewards r
SET sort_order = o.rn
FROM ordered o
WHERE r.id = o.id;
