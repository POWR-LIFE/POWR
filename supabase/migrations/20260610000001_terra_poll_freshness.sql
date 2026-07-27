-- Terra freshness loop: guarantee wearable data arrives even when Terra's
-- auto-push doesn't fire (observed 2026-06-10: connections sat with data in
-- Terra that never reached terra-webhook; only auth events were delivered).
--
--   1. terra_connections.last_event_at — stamped by terra-webhook on every DATA
--      payload (activity/sleep/daily/body). Null or stale ⇒ Terra hasn't pushed
--      recently for that connection.
--   2. pg_cron job → terra-poll edge function every 30 minutes. The function
--      asks Terra to (re)send the recent window with to_webhook=true for stale
--      connections only. terra-webhook is idempotent (per-type-per-day unique
--      index + steps-delta merge), so re-delivery is free. When Terra's
--      auto-push works, last_event_at stays fresh and the loop no-ops.

create extension if not exists pg_cron;

alter table public.terra_connections
  add column if not exists last_event_at timestamptz;

comment on column public.terra_connections.last_event_at is
  'Last time terra-webhook received a data payload (activity/sleep/daily/body) for this connection. Drives the terra-poll freshness cron.';

-- Re-runnable: drop any previous schedule of the same job before creating it.
do $job$
begin
  perform cron.unschedule('terra-poll-freshness');
exception when others then
  null; -- job did not exist yet
end
$job$;

select cron.schedule(
  'terra-poll-freshness',
  '*/30 * * * *',
  $cron$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/terra-poll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Was a hardcoded x-poll-token literal, which leaked to the public repo
      -- (GitGuardian 33876862). Redacted here and superseded by
      -- 20260727120000_cron_tokens_to_vault.sql, which re-points this job at
      -- the Vault-backed shared token; on a fresh replay this line already
      -- creates the job in its final form.
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := '{}'::jsonb
  )
  $cron$
);
