-- =============================================================
-- PRO USERS
-- Adds pro athlete support: is_pro flag, bio, cover photo,
-- gallery, and leaderboard visibility moved to DB column.
-- =============================================================

-- ── 1. Extend profiles ────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_pro               BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bio                  TEXT,
  ADD COLUMN IF NOT EXISTS cover_url            TEXT,
  ADD COLUMN IF NOT EXISTS show_on_leaderboard  BOOLEAN     NOT NULL DEFAULT true;

-- ── 2. Pro gallery photos ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pro_gallery_photos (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  url           TEXT        NOT NULL,
  display_order INT         NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pro_gallery_photos ENABLE ROW LEVEL SECURITY;

-- Public read
CREATE POLICY "Gallery photos are publicly readable"
  ON public.pro_gallery_photos FOR SELECT
  USING (true);

-- Users manage their own gallery
CREATE POLICY "Users can insert own gallery photos"
  ON public.pro_gallery_photos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own gallery photos"
  ON public.pro_gallery_photos FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own gallery photos"
  ON public.pro_gallery_photos FOR DELETE
  USING (auth.uid() = user_id);

-- Admins can delete any gallery photo
CREATE POLICY "Admins can delete any gallery photo"
  ON public.pro_gallery_photos FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
  );

-- ── 3. Extend existing profiles RLS ──────────────────────────

-- Allow anyone to read public profile fields (needed for leaderboard)
CREATE POLICY "Profiles are publicly readable"
  ON public.profiles FOR SELECT
  USING (true);

-- Users can update their own bio / cover / leaderboard visibility
-- (is_pro is intentionally excluded — admin-only via separate policy)
CREATE POLICY "Users can update own extended profile fields"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- Prevent self-grant of is_pro and is_admin
    AND is_pro     = (SELECT is_pro     FROM public.profiles WHERE id = auth.uid())
    AND is_admin   = (SELECT is_admin   FROM public.profiles WHERE id = auth.uid())
  );

-- Admins can set is_pro on any profile
CREATE POLICY "Admins can update is_pro"
  ON public.profiles FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
  );

-- ── 4. Leaderboard helper view ────────────────────────────────
-- Returns ranked leaderboard rows for a given scope.
-- Clients call this by filtering on is_pro.

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
