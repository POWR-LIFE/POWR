-- =============================================================
-- DEVICE ID TRACKING (soft fraud signal)
-- =============================================================
-- Stores the device identifier alongside each activity session.
-- Used as a fraud-detection signal (flag, not gate) — multiple
-- distinct device_ids for the same user in a short window
-- indicates possible account sharing or device-farm abuse.

alter table public.activity_sessions
  add column device_id text;

comment on column public.activity_sessions.device_id is
  'Client-reported device identifier (IDFV on iOS, androidId on Android). Soft fraud signal — not used as a hard gate.';

-- Index for device-anomaly queries in claim-points Edge Function
create index idx_activity_sessions_user_device
  on public.activity_sessions (user_id, device_id)
  where device_id is not null;
