-- Preserve the provider-reported activity name before it is bucketed into our
-- activity_type enum (e.g. "Padel Tennis" from Terra, "Strength Training" from
-- HealthKit, "boot_camp" from Health Connect). Null for manual logs, geofence
-- check-ins, and daily aggregates (walking/sleep). Used for feed subtitles and
-- for measuring which raw activities have enough volume to earn a first-class
-- activity type later.
alter table public.activity_sessions
  add column if not exists raw_activity_name text;
