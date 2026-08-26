-- pg_cron never purges cron.job_run_details. With two every-minute jobs it grows
-- ~1.9k rows/day (148k rows / 90 MB by 2026-08-26, pkey-only index, owner
-- supabase_admin so we cannot add one). Every reader is a full scan; the System
-- Health facts function blew the 8 s statement_timeout on it. Supabase's own
-- guidance is a daily purge. 30 days keeps incident history; the cron_silent
-- signal's longest allowance is 8 days. Nothing in the app reads this table.
-- Applied to prod 2026-08-26 as MCP migration cron_run_details_purge, after a
-- one-off delete of rows older than 30 days.
select cron.schedule(
  'purge-cron-run-details',
  '40 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '30 days'$$
);
