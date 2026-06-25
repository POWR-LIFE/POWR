-- ============================================================================
-- Two new "together" pushes:
--   challenge_accepted        — someone accepted an invite (sent to everyone
--                               already in, while the challenge is still forming).
--   challenge_pool_milestone  — a pooled challenge's combined total crossed a
--                               50% / 80% milestone (sent to the whole group).
-- Per-user opt-out columns, default true (opted in) — send-push-notification
-- skips when prefs[type] === false. Mirrors 20260624000004.
-- ============================================================================
alter table public.notification_preferences
  add column if not exists challenge_accepted       boolean not null default true,
  add column if not exists challenge_pool_milestone boolean not null default true;

-- One-shot guard so the pooled milestone push fires at most once per threshold,
-- even with a client trigger + cron tick racing. Stores the highest pct
-- milestone already notified (0 → 50 → 80); the firing site claims a milestone
-- with a conditional `< milestone` bump. Mirrors expiring_notified.
alter table public.shared_challenges
  add column if not exists pool_milestone_notified smallint not null default 0;
