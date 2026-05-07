-- =============================================================
-- USER ACHIEVEMENTS
-- Persisted earned achievement IDs per user. Computed client-side
-- after each session and stored here so queries/notifications are
-- efficient and the "first unlock" event can be detected.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.user_achievements (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  achievement_id TEXT        NOT NULL,
  earned_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (user, achievement)
CREATE UNIQUE INDEX IF NOT EXISTS user_achievements_user_achievement_uidx
  ON public.user_achievements (user_id, achievement_id);

CREATE INDEX IF NOT EXISTS user_achievements_user_id_idx
  ON public.user_achievements (user_id, earned_at DESC);

ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;

-- Users can read their own rows
CREATE POLICY "Users can read own achievements"
  ON public.user_achievements FOR SELECT
  USING (auth.uid() = user_id);

-- Public read for profile sheets (earn count shown to other users)
CREATE POLICY "Achievements are publicly readable"
  ON public.user_achievements FOR SELECT
  USING (true);

-- Users can insert their own
CREATE POLICY "Users can insert own achievements"
  ON public.user_achievements FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- No updates — achievements are immutable once earned
-- Admins can delete if needed (e.g. data correction)
CREATE POLICY "Admins can delete any achievement"
  ON public.user_achievements FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid()));
