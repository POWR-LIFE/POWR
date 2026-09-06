-- 2026-09-06 · Scaling plan Phase 2, items 8 and 9 — housekeeping and the telemetry diet.
--
-- Read on 6 Sep: the database had regrown from 188 MB (28 Aug vacuum) to 267 MB in
-- nine days. None of it was member data: cron.job_run_details 91 MB (three per-minute
-- jobs write ~5k rows a day against a 30-day purge), net._http_response 43 MB for
-- ~850 live rows / 395 KB of content (pg_net's 6-hour TTL deletes but never returns
-- the space), geofence_region_events 25 MB / 63k rows on a 90-day purge — 41% of
-- them from the two bench phones. Ceiling #1 of the plan is that last table.

-- ── item 8: indexes ───────────────────────────────────────────────────────
-- claim-points step 11c and the beacon's settle/complete passes look visits up by
-- their claimed session; the FK had no covering index (advisor: unindexed_foreign_keys).
create index if not exists gym_visits_claimed_session_idx
  on public.gym_visits (claimed_session_id)
  where claimed_session_id is not null;

-- referrals_referred_once duplicated the constraint-backed referrals_referred_id_key
-- (advisor: duplicate_index). The constraint index stays.
drop index if exists public.referrals_referred_once;

-- ── item 8: retention that returns its space ──────────────────────────────
-- cron run history: nothing in the app reads past the System Health 7-day window.
select cron.alter_job(
  job_id  := (select jobid from cron.job where jobname = 'purge-cron-run-details'),
  command := $job$delete from cron.job_run_details where end_time < now() - interval '7 days'$job$
);

-- pg_net keeps only 6 h of responses but its TTL delete never returns the space
-- (99 MB on 27 Aug, 43 MB again on 6 Sep). A daily VACUUM keeps the table flat;
-- VACUUM is a single statement, which is what pg_cron runs.
select cron.schedule('vacuum-pg-net-responses', '35 4 * * *', $job$VACUUM net._http_response$job$)
where not exists (select 1 from cron.job where jobname = 'vacuum-pg-net-responses');

-- ── item 9: telemetry diet ────────────────────────────────────────────────
-- Raw region events: 30 days is enough for every question the Live Ops drawer and
-- the field watcher ask (the journeys table is permanent and distils each visit
-- within 2 hours of its close). The low-volume, decision-carrying kinds keep the
-- 90 days they had, because a single row of them can be the whole finding.
select cron.alter_job(
  job_id  := (select jobid from cron.job where jobname = 'purge-geofence-region-events'),
  command := $job$delete from public.geofence_region_events
    where created_at < now() - interval '90 days'
       or (created_at < now() - interval '30 days'
           and event not in ('enter', 'exit', 'checked_in', 'check_in', 'location_revoked', 'auth_stale',
                             'stream_start_failed', 'stream_switch_deferred', 'active_patch_refused',
                             'exit_refuted', 'venue_nudge', 'visit_close_deferred', 'wake_step_hung',
                             'rebind_failed'))$job$
);

-- push_send_log: the two wake-ping kinds are the volume (fence_refresh alone was
-- 8,063 rows in 14 days) and the beacon's own rate limiter only reads them back over
-- a 4-hour window. Every visible push keeps its 90 days.
select cron.alter_job(
  job_id  := (select jobid from cron.job where jobname = 'purge-push-send-log'),
  command := $job$delete from public.push_send_log
    where created_at < now() - interval '90 days'
       or (created_at < now() - interval '30 days' and type in ('fence_refresh', 'gym_visit_check_presence'))$job$
);

-- ── proof ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'gym_visits_claimed_session_idx') then
    raise exception 'ops_housekeeping: gym_visits_claimed_session_idx missing';
  end if;
  if exists (select 1 from pg_indexes where indexname = 'referrals_referred_once') then
    raise exception 'ops_housekeeping: referrals_referred_once still present';
  end if;
  if not exists (select 1 from cron.job where jobname = 'vacuum-pg-net-responses') then
    raise exception 'ops_housekeeping: vacuum job not scheduled';
  end if;
  if not exists (select 1 from cron.job where jobname = 'purge-cron-run-details' and command like '%7 days%') then
    raise exception 'ops_housekeeping: run-details retention not updated';
  end if;
  if not exists (select 1 from cron.job where jobname = 'purge-geofence-region-events' and command like '%30 days%') then
    raise exception 'ops_housekeeping: region-events retention not updated';
  end if;
end $$;
