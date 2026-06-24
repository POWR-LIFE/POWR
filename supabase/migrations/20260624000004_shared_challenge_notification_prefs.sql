-- ============================================================================
-- Per-user opt-outs for the "together" notifications. Default true (opted in);
-- send-push-notification already skips when prefs[type] === false. Matches the
-- new NotificationType values added to the edge function + client.
-- ============================================================================
alter table public.notification_preferences
  add column if not exists friend_request            boolean not null default true,
  add column if not exists friend_accepted           boolean not null default true,
  add column if not exists challenge_invite          boolean not null default true,
  add column if not exists challenge_started         boolean not null default true,
  add column if not exists challenge_friend_finished boolean not null default true,
  add column if not exists challenge_completed       boolean not null default true,
  add column if not exists challenge_expiring        boolean not null default true;
