-- NOTIFICATION CLASSES + BUDGET KNOBS + NEW TYPE PREFS
--
-- Foundation for the anti-bombardment budget: every push type gets a class,
-- and send-push-notification enforces (a) a shared daily cap on the 'nudge'
-- class and (b) optional per-type daily caps — both admin-tunable without a
-- redeploy.
--
--   receipt — something the user did just paid off (session recorded, level
--             up, vault ready). Self-caused, so it rarely annoys; sent freely.
--   social  — a human is on the other end (friend requests, challenges).
--             Individually toggleable; exempt from the shared budget.
--   nudge   — WE want the user to do something (streak at risk, daily
--             reminder, inactivity). The only dangerous class: all nudge
--             types share ONE daily pool (system_config.nudge_daily_cap,
--             default 1) counted in the user's local day.
--
-- daily_cap is a per-type ceiling independent of class — e.g. the wearable
-- sync receipt caps at 1/day so a Terra backfill burst can't machine-gun.

alter table public.notification_config
  add column if not exists class text not null default 'receipt'
    check (class in ('receipt', 'social', 'nudge')),
  add column if not exists daily_cap int;

update public.notification_config set class = 'nudge'
 where type in ('daily_reminder', 'streak_at_risk', 'weekly_challenge_expiry',
                'check_in_reminder', 'inactivity_nudge', 'points_milestone');

update public.notification_config set class = 'social'
 where type in ('friend_request', 'friend_accepted', 'challenge_invite',
                'challenge_accepted', 'challenge_started', 'challenge_friend_finished',
                'challenge_pool_milestone', 'challenge_completed', 'challenge_expiring');

-- Sleep credit lands via Terra webhooks which can replay/backfill — cap 1/day.
update public.notification_config set daily_cap = 1 where type = 'sleep_target_met';

-- New types (send-push copy ships in the same change set). Seeded here so the
-- admin Notifications tab can see/disable/re-word them from day one.
insert into public.notification_config (type, category, description, class, daily_cap) values
  ('wearable_session_recorded', 'activity', 'Sent when a wearable workout syncs in and earns points (capped once per day; a multi-workout sync batches into one push)', 'receipt', 1),
  ('level_up',                  'rewards',  'Sent when lifetime earned POWR crosses a level threshold',                                                                    'receipt', null),
  ('streak_lost',               'activity', 'Sent the morning after a streak dies, offering the rescue challenge to win it back',                                          'receipt', 1),
  ('streak_rescued',            'activity', 'Sent when the rescue challenge is completed and the streak is restored',                                                      'receipt', null)
on conflict (type) do nothing;

-- Shared nudge pool size, counted per user per local day. 1 = at most one
-- nudge-class push per day, whichever fires first.
insert into public.system_config (key, value, description) values
  ('nudge_daily_cap', '1', 'Max nudge-class pushes (streak at risk, daily reminder, inactivity…) per user per local day'),
  ('streak_at_risk_min_streak', '3', 'Streak length below which the evening streak-at-risk push is not sent')
on conflict (key) do nothing;

-- Per-user toggles for the new types. wearable_session covers the Terra
-- workout receipt; streak_rescue covers both streak_lost and streak_rescued
-- (one story, one switch); step_goal_nudge is read by the CLIENT for its
-- locally-scheduled evening steps push; nearby_offer migrates the existing
-- client-only AsyncStorage pref into the DB so it syncs across devices.
alter table public.notification_preferences
  add column if not exists wearable_session boolean not null default true,
  add column if not exists level_up         boolean not null default true,
  add column if not exists streak_rescue    boolean not null default true,
  add column if not exists step_goal_nudge  boolean not null default true,
  add column if not exists nearby_offer     boolean not null default true;
