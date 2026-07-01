-- send-push-notification gates every push on a per-type column in
-- notification_preferences, and for session_completed / session_upgraded (which
-- rides the session_completed preference) that column never existed — the
-- select errored (42703) silently on every session push, so the gate was
-- skipped and session pushes could never be muted. sleep_target_met is in the
-- client NotificationPreferences type and the send-push type map but also had
-- no column. Defaults are true, matching every other push preference, so no
-- user's current behaviour changes.
alter table public.notification_preferences
  add column if not exists session_completed boolean not null default true,
  add column if not exists sleep_target_met boolean not null default true;
