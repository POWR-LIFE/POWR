-- Add a free-text source label to health_snapshots for the admin "who is using
-- what" device overview.
--
-- `source` is the provider-level label (healthkit / health_connect / fitbit /
-- whoop / garmin). `source_detail` records the SPECIFIC app or device behind a
-- native sync — e.g. "Apple Watch", "Garmin", "iPhone", "Fitness band" — derived
-- from per-sample provenance (HealthKit sourceRevision/device, Health Connect
-- metadata.dataOrigin/device.type) via sourceLabel() / summarizeSources() in
-- lib/health/dataSource.ts.
--
-- Nullable: older rows and syncs with no readable provenance leave it null.
-- Admins can aggregate `distinct source_detail per user` to see who is on a
-- wearable vs phone-only and which devices are in use.
alter table public.health_snapshots
  add column if not exists source_detail text;
