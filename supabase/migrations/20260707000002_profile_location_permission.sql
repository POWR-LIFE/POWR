-- Accurate location-permission telemetry on profiles.
--
-- profiles.location_granted is a write-once flag set by the onboarding
-- location-bonus claim (award-bonus fn) — it never reflects later grants or
-- revokes and can't distinguish "While Using" from "Always". These columns
-- carry the real permission snapshot, reported by the client on every fresh
-- session and on app-foreground (see lib/locationPermission.ts). NULL means
-- the user's build predates the telemetry — admin UIs fall back to
-- location_granted for those.

alter table public.profiles
  add column if not exists location_permission text
    check (location_permission in ('always', 'while_using', 'denied', 'undetermined')),
  add column if not exists location_permission_checked_at timestamptz;

comment on column public.profiles.location_permission is
  'Live location-permission snapshot reported by the client: always (fg+bg, geofencing works) / while_using (fg only) / denied / undetermined (never asked). NULL = pre-telemetry build; fall back to location_granted.';
comment on column public.profiles.location_permission_checked_at is
  'When the client last reported location_permission.';
