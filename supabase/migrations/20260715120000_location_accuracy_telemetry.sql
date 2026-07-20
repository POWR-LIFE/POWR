-- Location-accuracy telemetry: the iOS "Precise Location" toggle is invisible
-- to expo-location's permission response (scope only), so a user can report
-- 'always' while every fix is coarsened to ~1-5 km — silently killing 25 m
-- geofence check-ins (root cause of the ONE LDN support case, 2026-07-15).
-- Clients now sample one fix alongside the permission snapshot and report its
-- accuracy radius; consistently large values with a granted permission mean
-- reduced/coarse accuracy. NULL = build predates the telemetry or no fix
-- was available at snapshot time.
alter table public.profiles
  add column if not exists location_accuracy_m integer;

comment on column public.profiles.location_accuracy_m is
  'Accuracy radius (m) of the last location fix sampled with the permission snapshot. >500 with permission granted ⇒ reduced accuracy (iOS Precise Location off / Android coarse-only). NULL = not reported.';
