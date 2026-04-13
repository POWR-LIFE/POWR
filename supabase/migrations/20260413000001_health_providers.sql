-- Health provider abstraction.
-- Lets a user have multiple health-data integrations connected (Apple Health,
-- Health Connect, Fitbit, Whoop, Garmin, ...) while exactly one is "active"
-- as the source of truth for sync. Provider id is freeform text, validated
-- in app code so new providers can be added without a migration.

alter table public.profiles
  add column if not exists active_health_provider text,
  add column if not exists health_provider_connections jsonb not null default '{}'::jsonb;

-- Shape of health_provider_connections (per provider id key):
--   {
--     "fitbit": {
--       "connected_at": "2026-04-13T10:00:00Z",
--       "last_sync_at": "2026-04-13T10:05:00Z",
--       "scopes": ["activity", "sleep", "heartrate"]
--     }
--   }
-- Tokens are NOT stored here — they live in SecureStore on device (and, for
-- OAuth providers, server-side via an edge function).
