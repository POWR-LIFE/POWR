-- =============================================================
-- TERRA CONNECTION FRESHNESS (user-facing)
--
-- `last_event_at` already exists but is POLL-SCHEDULING state, not a freshness
-- clock: terra-webhook deliberately stamps it for 'activity'/'sleep'/'body'
-- only. 'daily' is excluded because terra-poll requests it unconditionally
-- every cycle, so letting it stamp would mark every connection permanently
-- fresh and starve the sleep/activity re-poll. That exclusion makes it wrong
-- for the UI: a Strava user (no sleep, no daily support) can be syncing
-- perfectly and still show a week-old `last_event_at`.
--
-- `last_upload_at` is the user-facing clock: stamped on EVERY data payload
-- (including 'daily'), preferring the provider's own
-- `data[].device_data.last_upload_date` — i.e. when the watch itself last
-- uploaded — and falling back to payload receipt time when a provider omits
-- device_data (Strava does).
--
-- `device_name` powers the chip subtitle ("Forerunner 265 · synced 2h ago").
-- =============================================================

alter table public.terra_connections
  add column if not exists last_upload_at timestamptz,
  add column if not exists device_name    text;

comment on column public.terra_connections.last_upload_at is
  'User-facing freshness clock: when the wearable last delivered data to us. Stamped on every data payload (incl. daily) from device_data.last_upload_date, else receipt time. Distinct from last_event_at, which is terra-poll scheduling state.';

comment on column public.terra_connections.device_name is
  'Provider-reported device model from device_data.name (e.g. "Forerunner 265"). Null when the provider omits device_data.';

-- Backfill so existing connections do not all read as "never synced" the moment
-- the chip ships. last_event_at is a lower bound on real delivery (it is only
-- ever stamped by genuine data payloads), which is the honest starting value.
update public.terra_connections
   set last_upload_at = last_event_at
 where last_upload_at is null
   and last_event_at is not null;

-- The client reads its own connections by user_id and filters on liveness; the
-- existing terra_connections_user_id_idx covers that lookup.
