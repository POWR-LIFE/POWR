-- Undelivered visible-push redelivery (2026-08-12).
--
-- A direct FCM banner that arrives while the app is mid app-state transition
-- can reach neither the headless task nor the foreground listener: FCM accepts
-- it, no delivered_at receipt is ever stamped, and the user sees nothing
-- (field 2026-08-12: "Session complete 💪" at 15:18:03, accepted, never drew —
-- the user was opening the app at that exact moment). Nothing retried, because
-- the log row carried no payload to retry FROM.
--
-- These columns give the beacon's redelivery pass what it needs:
--   payload        the exact FCM data map that was sent (n_-prefixed shape)
--   device_token   the native token the send used (expo_push_token is the Expo
--                  sibling, unusable for a raw FCM resend)
--   redelivered_at single-retry marker — a redelivery never redelivers
alter table push_send_log add column if not exists payload jsonb;
alter table push_send_log add column if not exists device_token text;
alter table push_send_log add column if not exists redelivered_at timestamptz;

-- The redelivery scan: recent, direct, accepted, undrawn, unretried.
create index if not exists push_send_log_redelivery_idx
  on push_send_log (created_at desc)
  where transport = 'fcm_direct' and status = 'accepted'
    and delivered_at is null and redelivered_at is null;
