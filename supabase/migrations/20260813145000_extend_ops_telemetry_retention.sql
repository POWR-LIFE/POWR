-- Ops telemetry retention: 30 days -> 90 (2026-08-13).
--
-- geofence_region_events and push_send_log are the entire forensic record of the
-- geofence + notification chain, and a 30-day purge meant that history could
-- never become more valuable than one month: every question of the form "is this
-- getting better?" was structurally unanswerable past the horizon.
--
-- 90 days rather than forever, because raw rows are for drilling into a specific
-- incident. The permanent trend record is gym_visit_journeys (20260813150000) —
-- one distilled row per visit, computed while the raw evidence is still alive.
-- That split is what makes both cheap: ~1 row per gym visit kept forever, ~100
-- rows per device per day kept for a quarter.
--
-- Sizing at the time of the change: geofence_region_events 26.7k rows / 8.4 MB
-- over 10 days; push_send_log 5.5k rows / 2.8 MB over 30. 82% of the geofence
-- rows were arm-burst `exit` noise, which the client stops writing as of the
-- same day's suppression change — so the tripled window lands at roughly HALF
-- today's row count once that reaches devices.

select cron.alter_job(
  (select jobid from cron.job where jobname = 'purge-geofence-region-events'),
  command := $cmd$delete from public.geofence_region_events where created_at < now() - interval '90 days'$cmd$
);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'purge-push-send-log'),
  command := $cmd$delete from public.push_send_log where created_at < now() - interval '90 days'$cmd$
);
