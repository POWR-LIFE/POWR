-- Switches on the partner setup reminder built in 20260926100000. Apply only
-- once the previews are approved. Daily 09:30 UTC, after reengagement-email.

select cron.unschedule('partner-setup-reminder')
where exists (select 1 from cron.job where jobname = 'partner-setup-reminder');

select cron.schedule(
  'partner-setup-reminder',
  '30 9 * * *',
  $$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-partner-setup-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $$
);
