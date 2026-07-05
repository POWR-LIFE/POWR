-- =============================================================
-- REWARD PLACEMENTS → 'notified' funnel event (zone-entry push)
-- =============================================================
-- Zone-entry push notifications need their own funnel step, distinct from
-- in-app 'surfaced', for two reasons:
--   1. Attribution: measure push → open → redeem separately from in-app.
--   2. Isolation: the resolver's per-user frequency cap counts 'surfaced'
--      events; if a push logged 'surfaced' it would consume a placement's
--      daily impression and SUPPRESS the in-app hero swap when the user opens
--      the app. A separate 'notified' type keeps push and in-app independent.
-- Push send-rate is throttled client-side by a per-placement cooldown.
-- =============================================================

alter table public.reward_placement_events
  drop constraint reward_placement_events_event_type_check;

alter table public.reward_placement_events
  add constraint reward_placement_events_event_type_check
  check (event_type in ('surfaced', 'presence_confirmed', 'redeemed', 'notified'));
