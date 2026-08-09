-- Kill switch + observe mode for the location-off session close (PR #366).
--
-- That change closes an open gym visit when location can no longer verify the
-- user is there (Services off, permission revoked, or downgraded to "While
-- Using"). It is the right behaviour — an unverifiable session otherwise stays
-- open until the 12 h reaper, which on Android duplicates the visit — but it is
-- also the first thing in the geofence that ENDS a session on evidence the user
-- never sees. A false positive reads as "the app randomly stopped my workout",
-- which is the one outcome we will not ship blind.
--
-- So the close is staged behind this flag rather than shipped live:
--
--   off      the detector never runs. Pure kill switch.
--   observe  the detector runs and logs its verdict to geofence_region_events
--            ('location_revoked', would_close: true) but CLOSES NOTHING.
--            Behaviour is identical to before PR #366.
--   on       the detector closes the session.
--
-- Seeded to 'observe'. Read the rows it produces before flipping to 'on':
--
--   select detail->>'reason', count(*),
--          avg((detail->>'session_age_min')::int)
--     from geofence_region_events
--    where event = 'location_revoked'
--    group by 1;
--
-- What makes staging cheap here: detection latency costs the user NOTHING. The
-- close is truncated to the last proven-inside tick, so a verdict reached ten
-- minutes late records exactly the same duration as one reached instantly. We
-- can afford to watch it be right before letting it act.
--
-- Plain text value (not JSON) so it is editable from admin → System Config
-- alongside min_gym_dwell_minutes / gym_upgrade_minutes, and readable by the
-- same client fetch. Anything unrecognised falls back to 'observe' client-side,
-- so a typo in the box degrades to "log, don't act" rather than to a live close.

insert into public.system_config (key, value, description)
values (
  'location_close_mode',
  'observe',
  'Location-off session close: off = detector disabled, observe = log the verdict but never close, on = close the session. Staged rollout for PR #366; read geofence_region_events (event = ''location_revoked'') before switching to on. Unrecognised values fall back to observe.'
)
on conflict (key) do nothing;
