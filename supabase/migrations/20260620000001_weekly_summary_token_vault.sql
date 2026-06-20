-- Rotate the weekly-summary cron trigger off a hardcoded shared secret.
--
-- The original migration (20260618000001) baked the x-weekly-token literal into
-- both the cron job and the edge function. This re-points the live cron job at
-- Vault so the token never lives in source or migrations again.
--
-- Operator steps (do these before the next Monday 08:00 UTC run, or weekly email
-- delivery will 403 until they're done):
--   1. Mint a NEW token (the old one is burned — it's in git history).
--   2. select vault.create_secret('<new-token>', 'weekly_token');
--   3. supabase secrets set WEEKLY_TOKEN=<new-token>   (then redeploy the fn)
--
-- The subselect returns NULL when 'weekly_token' is absent, so this migration is
-- safe to apply before the Vault secret exists — the cron just sends a null token
-- (which the function rejects) until step 2 is done.

do $job$
begin
  perform cron.unschedule('weekly-summary-email');
exception when others then
  null; -- job did not exist yet
end
$job$;

select cron.schedule(
  'weekly-summary-email',
  '0 8 * * 1',
  $cron$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-weekly-summary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-weekly-token', (select decrypted_secret from vault.decrypted_secrets where name = 'weekly_token')
    ),
    body := '{}'::jsonb
  )
  $cron$
);
