-- Add email notification preference columns to existing notification_preferences table
alter table public.notification_preferences
  add column if not exists email_streak_at_risk          boolean not null default true,
  add column if not exists email_weekly_challenge_expiry boolean not null default true,
  add column if not exists email_reward_unlocked         boolean not null default true,
  add column if not exists email_points_milestone        boolean not null default true,
  add column if not exists email_inactivity_nudge        boolean not null default true;
