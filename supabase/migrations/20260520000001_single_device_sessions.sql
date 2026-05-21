-- =============================================================
-- SINGLE-DEVICE SESSION ENFORCEMENT
-- Stores one authoritative auth session_id per user.
-- When a user signs in on a new device, this row is overwritten.
-- The old device subscribes via Realtime and detects the change
-- instantly, forcing an immediate local sign-out.
-- =============================================================

CREATE TABLE public.user_active_sessions (
    user_id    uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id text        NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_active_sessions ENABLE ROW LEVEL SECURITY;

-- Each user manages only their own row
CREATE POLICY "user_active_sessions_select"
    ON public.user_active_sessions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "user_active_sessions_insert"
    ON public.user_active_sessions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_active_sessions_update"
    ON public.user_active_sessions FOR UPDATE
    USING (auth.uid() = user_id);

-- Enable Realtime so clients receive instant change notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_active_sessions;
