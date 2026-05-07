ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS sleep_target_met BOOLEAN NOT NULL DEFAULT TRUE;
