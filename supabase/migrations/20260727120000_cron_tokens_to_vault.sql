-- Move the last two cron jobs off bespoke hardcoded shared secrets and onto the
-- Vault-backed x-resolve-token that the other eight already use.
--
-- Both tokens were hardcoded in TWO places each — the cron job's headers and
-- the edge function's source — and both files are in a public repo, so both
-- values are burned permanently (GitGuardian 33876862 x-poll-token, 34903903
-- x-vault-token). Neither function verifies a JWT, so the shared secret was the
-- ONLY thing standing in front of them:
--
--   terra-poll             — a { debug_user_id } passthrough returned another
--                            user's RAW Terra sleep/activity payloads to the
--                            caller. That passthrough is deleted in the same
--                            change; the token move closes the door it sat behind.
--   release-vault-deposits — forces the vault sweep on demand, crediting
--                            deposits ahead of the grace window and firing real
--                            vault_ready / vault_unlocked pushes.
--
-- Why Vault rather than another constant (or Deno.env.get): both sides read it
-- live — the cron job through this subselect at execution time, the function
-- through verify_resolve_token at request time. Neither caches, so rotating is
-- `select vault.update_secret(...)` alone: no redeploy, no 403 window. A
-- hardcoded constant cannot be rotated without a deploy, which is exactly how
-- these two ended up never being rotated.
--
--   ROTATE:  select vault.update_secret(
--              (select id from vault.secrets where name = 'shared_resolve_token'),
--              '<new 48-char value>');
--            Takes effect on the next cron tick and the next request — no
--            redeploy, no window. Note this re-keys the TOKEN path only:
--            callers that authenticate with a service-role bearer instead
--            (send-push-notification, notify-waitlist) rotate with the platform
--            service_role key, which is tracked separately.
--
-- After this runs, shared_resolve_token gates 10 cron jobs, 10 DB functions and
-- ~16 edge functions, and it has never been rotated (created 2026-06-24). That
-- concentration is worth a scheduled rotation drill — which this change is what
-- makes cheap. It is still strictly better than what it replaces: two constants
-- published in a public repo.
--
-- ORDERING: the edge functions must be deployed with the x-resolve-token gate
-- BEFORE this migration runs. Between deploy and migration the cron still sends
-- the old header and gets a 403 — that costs at most one tick, and both jobs are
-- self-healing (terra-poll re-polls within ~60 min by design; the vault sweep
-- retries in 15).

create extension if not exists pg_cron;

-- ── terra-poll-freshness (was x-poll-token) ────────────────────────────────
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
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- ── vault-release-sweep (was x-vault-token) ────────────────────────────────
do $job$
begin
  perform cron.unschedule('vault-release-sweep');
exception when others then
  null; -- job did not exist yet
end
$job$;

select cron.schedule(
  'vault-release-sweep',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/release-vault-deposits',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := '{}'::jsonb
  )
  $cron$
);
