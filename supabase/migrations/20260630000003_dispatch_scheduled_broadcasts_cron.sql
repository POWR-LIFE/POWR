-- Scheduled-broadcast dispatcher heartbeat: every 15 min, invoke
-- dispatch-scheduled-broadcasts to fan due scheduled rows out across the
-- user-base timezones whose local target instant has passed. 15 min covers
-- every real UTC offset (incl. the :30/:45 zones). Mirrors the
-- resolve-shared-challenges / terra-poll cron pattern; reuses the shared
-- x-resolve-token cron secret from Vault (never hardcoded here).
create extension if not exists pg_cron;

do $job$
begin
  perform cron.unschedule('dispatch-scheduled-broadcasts');
exception when others then
  null; -- job did not exist yet
end
$job$;

select cron.schedule(
  'dispatch-scheduled-broadcasts',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/dispatch-scheduled-broadcasts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := '{}'::jsonb
  )
  $cron$
);
