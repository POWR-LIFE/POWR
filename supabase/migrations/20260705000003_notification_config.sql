-- NOTIFICATION CONFIG
-- Per-type admin controls for the send-push-notification edge function.
-- enabled = false suppresses that notification type globally (applied before
-- any user-level preference check, so it acts as a hard kill-switch).
-- title_override / body_override, when set, replace the hardcoded copy in
-- the edge function — useful for minor wording tweaks without a redeploy.

create table if not exists public.notification_config (
  type            text        primary key,
  enabled         boolean     not null default true,
  title_override  text,
  body_override   text,
  category        text        not null default 'system',
  description     text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid        references auth.users (id)
);

-- Seed all push notification types defined in send-push-notification.
insert into public.notification_config (type, category, description) values
  ('daily_reminder',            'system',   'Sent daily to users who have not logged any activity yet'),
  ('streak_at_risk',            'system',   'Sent when a user''s streak will expire before midnight'),
  ('weekly_challenge_expiry',   'system',   'Sent 24h before a weekly challenge the user hasn''t completed expires'),
  ('check_in_reminder',         'activity', 'Sent when a user is detected at a gym but hasn''t logged a session'),
  ('inactivity_nudge',          'system',   'Sent after 3 or 7 days of no logged activity'),
  ('session_completed',         'activity', 'Sent immediately when a gym session is recorded and points are claimed'),
  ('session_upgraded',          'activity', 'Sent when a session reaches the 40-min tier and earns the bonus'),
  ('sleep_target_met',          'activity', 'Sent when a sleep session meets the daily sleep goal'),
  ('reward_unlocked',           'rewards',  'Sent when a user earns enough points to unlock a new reward'),
  ('points_milestone',          'rewards',  'Sent when a user hits a points milestone or gets close to a reward'),
  ('friend_request',            'social',   'Sent to the recipient of a new friend request'),
  ('friend_accepted',           'social',   'Sent when someone accepts your friend request'),
  ('challenge_invite',          'social',   'Sent when a friend invites you to a shared challenge'),
  ('challenge_accepted',        'social',   'Sent when someone accepts your shared challenge invite'),
  ('challenge_started',         'social',   'Sent to all participants when a shared challenge begins'),
  ('challenge_friend_finished', 'social',   'Sent when another participant completes their part of a challenge'),
  ('challenge_pool_milestone',  'social',   'Sent at 50% and 80% group progress milestones in a shared challenge'),
  ('challenge_completed',       'social',   'Sent to all participants when the shared challenge is fully completed'),
  ('challenge_expiring',        'social',   'Sent when a shared challenge is about to expire')
on conflict (type) do nothing;

-- RLS: admins only (via admin_roles).
alter table public.notification_config enable row level security;

create policy "Admins can manage notification config"
  on public.notification_config
  for all
  using  (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));
