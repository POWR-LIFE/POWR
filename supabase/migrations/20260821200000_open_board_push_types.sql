-- Two new push types for the open board, plus the staged-off flag and the
-- one-shot marker the fan-out needs.
--
-- WHY a code change was unavoidable: notification_config carries
-- title_override/body_override, so copy alone CAN be set from the database. But
-- buildMessage's copy switch has no `default` case — an unmatched type makes the
-- IIFE return undefined, and `{ to, ...undefined }` spreads to nothing. The push
-- would go out with overridden title/body and NO `data` at all, meaning no
-- `route` and no `type`: untappable, and invisible to the in-app feed. So the
-- types have to exist in code; these rows are the gate and the admin controls.

-- ── The marker: one board-post announcement per challenge, ever ──────────────
-- Without this the 15-minute cron would re-announce every live post on every
-- tick. It is set the moment the fan-out runs, before any send, so a mid-run
-- failure loses one announcement rather than repeating it forever.
alter table public.shared_challenges
  add column if not exists board_notified boolean not null default false;

comment on column public.shared_challenges.board_notified is
  'Open-board posts only: the "new challenge on the board" fan-out has already run for this row.';

-- ── The types ────────────────────────────────────────────────────────────────
-- class drives _shared/nudgeBudget:
--   receipt — a payoff/state change on the user's OWN thing; sent freely
--   nudge   — WE want something from them; shares ONE daily pool across every
--             nudge type (system_config.nudge_daily_cap), counted in the user's
--             local day. Registering a nudge therefore cannot increase anyone's
--             notification volume — it only competes for the slot that exists.
insert into public.notification_config (type, enabled, category, class, daily_cap, description)
values
  (
    'challenge_open_unclaimed', true, 'social', 'receipt', null,
    'Sent to the creator when their open-board challenge went untaken and converted to a solo run'
  ),
  (
    -- NOT nudge-class. The nudge pool holds ONE slot per user per day that
    -- streak_at_risk and daily_reminder already compete for; a board post must
    -- never suppress a streak warning. daily_cap is enforced independently of
    -- class (see _shared/nudgeBudget), so this is a hard 1/user/day ceiling
    -- that leaves that pool alone.
    'challenge_open_posted', true, 'social', 'social', 1,
    'Sent to opted-in members when a new challenge lands on the open board. Capped at 1/user/day; gated by system_config.open_board_post_push'
  )
on conflict (type) do update
  set enabled     = excluded.enabled,
      category    = excluded.category,
      class       = excluded.class,
      daily_cap   = excluded.daily_cap,
      description = excluded.description;

-- ── The staged-off flag ──────────────────────────────────────────────────────
-- Mirrors visible_push_transport / location_close_mode: the fan-out ships
-- DEPLOYED BUT INERT, and turning it on is a one-line UPDATE with no deploy —
-- and rollback is the same statement in reverse.
--
--   update system_config set value = 'on' where key = 'open_board_post_push';
--
-- Flip it only once open_board_stats() shows posts_went_solo outpacing
-- posts_taken; before that there is nothing to announce and nobody to announce
-- it to, and a fan-out over an empty board is pure noise.
insert into public.system_config (key, value)
values ('open_board_post_push', 'off')
on conflict (key) do nothing;
