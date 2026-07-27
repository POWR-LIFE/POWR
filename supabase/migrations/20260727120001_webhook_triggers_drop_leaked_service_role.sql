-- Take the leaked service_role JWT out of the two database-webhook triggers.
--
-- These were configured through the dashboard, never in a migration, so they
-- were invisible to every code-level audit of the leak. Both baked the
-- production service_role JWT — public in this repo since 2026-04-22
-- (GitGuardian 33021769) — into their trigger definitions as a bearer token:
--
--   public.profiles  new-users                → /functions/v1/notify-new-user
--   public.waitlist  notify-slack-on-waitlist → /functions/v1/notify-waitlist
--
-- They are the only places the leaked key is load-bearing at runtime, so they
-- block deactivating the legacy key: pull it and new-signup + waitlist Slack
-- alerts go silent with no error anyone would notice.
--
-- Both become ordinary plpgsql triggers calling net.http_post with their
-- credential read from Vault — the shape already used by the gym-claim and
-- vault-grant relays. supabase_functions.http_request() cannot be used here
-- because it takes its headers as a LITERAL argument: it cannot read Vault, so
-- keeping it would mean writing a secret into this file, and this file is in a
-- public repo. That is the whole trap this migration exists to get out of.
--
-- Credentials after this runs:
--   notify-waitlist  x-resolve-token   (Vault: shared_resolve_token) — the same
--                    shared cron secret the other jobs use. The function ran
--                    verify_jwt=true with NO in-code auth, so the platform JWT
--                    gate WAS its access control and the leaked bearer was the
--                    only thing satisfying it. It now carries an in-code gate
--                    and verify_jwt=false.
--   notify-new-user  x-webhook-secret  (Vault: db_webhook_secret) — unchanged
--                    in value; the function already checks it against its
--                    DB_WEBHOOK_SECRET env var and is already verify_jwt=false,
--                    which is why the bearer it also carried was decorative.
--                    The value moves from the trigger definition into Vault
--                    WITHOUT ever passing through this file (see the seed block).
--
-- Both trigger functions swallow dispatch errors. These fire on public.profiles
-- and public.waitlist INSERTs — the signup and waitlist-join paths — and a Slack
-- ping is never worth failing a user's signup for. net.http_post only queues the
-- request, but the Vault subselect is synchronous and would otherwise propagate.
--
-- ORDERING: notify-waitlist must be deployed with its new gate and
-- verify_jwt=false BEFORE this runs. Applied the other way round, the trigger
-- sends x-resolve-token to a still-JWT-gated function and every waitlist signup
-- 401s at the gateway — and unlike the cron jobs this one does not self-heal,
-- a missed signup ping is simply lost.

-- ── Seed db_webhook_secret into Vault ──────────────────────────────────────
-- Lifted out of the live trigger definition rather than written here, so the
-- value never enters git. On a fresh replay (no pre-existing trigger) there is
-- nothing to lift and this fails loudly with the command to run by hand — the
-- same manual-seed convention shared_resolve_token uses
-- (20260624000007_shared_challenges_resolve_token_verifier.sql).
do $seed$
declare
  v_secret text;
begin
  if exists (select 1 from vault.decrypted_secrets where name = 'db_webhook_secret') then
    return;
  end if;

  select (regexp_match(pg_get_triggerdef(t.oid), '"x-webhook-secret"\s*:\s*"([^"]+)"'))[1]
    into v_secret
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'profiles' and t.tgname = 'new-users';

  if v_secret is null or v_secret = '' then
    raise exception
      'db_webhook_secret is not in Vault and could not be recovered from the new-users trigger. Seed it from the notify-new-user function''s DB_WEBHOOK_SECRET env var: select vault.create_secret(''<value>'', ''db_webhook_secret'');';
  end if;

  perform vault.create_secret(v_secret, 'db_webhook_secret');
end
$seed$;

-- ── public.profiles → notify-new-user ──────────────────────────────────────
create or replace function public.notify_new_user_signup()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $fn$
begin
  begin
    perform net.http_post(
      url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/notify-new-user',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'db_webhook_secret')
      ),
      -- Mirrors the supabase_functions.http_request envelope; the function
      -- destructures { type, record } and early-returns unless type = 'INSERT'.
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'profiles',
        'schema', 'public',
        'record', to_jsonb(new)
      ),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning '[notify_new_user_signup] dispatch failed: %', sqlerrm;
  end;
  return new;
end;
$fn$;

revoke execute on function public.notify_new_user_signup() from public, anon, authenticated;

drop trigger if exists "new-users" on public.profiles;

create trigger "new-users"
  after insert on public.profiles
  for each row
  execute function public.notify_new_user_signup();

-- ── public.waitlist → notify-waitlist ──────────────────────────────────────
create or replace function public.notify_waitlist_signup()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $fn$
begin
  begin
    perform net.http_post(
      url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/notify-waitlist',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
      ),
      -- Same envelope; the function reads payload.record and nothing else.
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'waitlist',
        'schema', 'public',
        'record', to_jsonb(new)
      ),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning '[notify_waitlist_signup] dispatch failed: %', sqlerrm;
  end;
  return new;
end;
$fn$;

revoke execute on function public.notify_waitlist_signup() from public, anon, authenticated;

drop trigger if exists "notify-slack-on-waitlist" on public.waitlist;

create trigger "notify-slack-on-waitlist"
  after insert on public.waitlist
  for each row
  execute function public.notify_waitlist_signup();
