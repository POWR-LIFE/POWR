-- Shared-challenge heartbeat: every 15 min, invoke resolve-shared-challenges to
-- start/cancel forming challenges past their accept window, run the completion
-- backstop for app-closed participants, settle the group bonus on ended
-- challenges, and fire "ends soon" nudges. Mirrors the terra-poll / weekly-summary
-- cron pattern; the x-resolve-token comes from Vault (never hardcoded here).
create extension if not exists pg_cron;

do $job$
begin
  perform cron.unschedule('resolve-shared-challenges');
exception when others then
  null; -- job did not exist yet
end
$job$;

select cron.schedule(
  'resolve-shared-challenges',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/resolve-shared-challenges',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := '{}'::jsonb
  )
  $cron$
);
