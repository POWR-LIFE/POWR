-- =============================================================
-- PRO ACHIEVEMENTS
-- Up to 4 achievement pills displayed on a pro athlete's profile.
-- Example: { title: "Women's Pro Solo", value: "01:09:30", context: "Toulouse" }
-- =============================================================

CREATE TABLE IF NOT EXISTS public.pro_achievements (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title         TEXT        NOT NULL,
  value         TEXT        NOT NULL,
  context       TEXT,
  display_order INT         NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pro_achievements_user_id_idx
  ON public.pro_achievements (user_id, display_order);

ALTER TABLE public.pro_achievements ENABLE ROW LEVEL SECURITY;

-- Public read
CREATE POLICY "Achievements are publicly readable"
  ON public.pro_achievements FOR SELECT
  USING (true);

-- Users can insert their own, max 4
CREATE POLICY "Users can insert own achievement (max 4)"
  ON public.pro_achievements FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (SELECT COUNT(*) FROM public.pro_achievements WHERE user_id = auth.uid()) < 4
  );

CREATE POLICY "Users can update own achievement"
  ON public.pro_achievements FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own achievement"
  ON public.pro_achievements FOR DELETE
  USING (auth.uid() = user_id);

-- Admins can manage any
CREATE POLICY "Admins can insert any achievement"
  ON public.pro_achievements FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid())
    AND (SELECT COUNT(*) FROM public.pro_achievements pa WHERE pa.user_id = pro_achievements.user_id) < 4
  );

CREATE POLICY "Admins can update any achievement"
  ON public.pro_achievements FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid()));

CREATE POLICY "Admins can delete any achievement"
  ON public.pro_achievements FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid()));
