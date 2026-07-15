-- Background gym claims/upgrades: relay through PostgREST + pg_net instead of a
-- client functions.invoke.
--
-- WHY: six field captures on Android (2026-07-14) show the same shape — while
-- the app is backgrounded, REST/RPC requests reach the server (dwell heartbeats,
-- presence confirms and the session INSERT all land) but a client call to
-- /functions/v1/* NEVER arrives, so the 30-min claim and 40-min upgrade only
-- ever completed on app-open. These RPCs give the client a claim/upgrade trigger
-- that rides the SAME proven REST path: one round-trip that hands the actual
-- work to pg_net, which invokes the edge function server-to-server (immune to
-- Doze). Same net.http_post + vault resolve-token pattern as the cron jobs.
--
-- TRUST MODEL UNCHANGED: these relays award nothing. claim-points /
-- upgrade-gym-tier keep every gate (eligibility, caps, rate limits,
-- idempotency); the relay only carries the request, and only for sessions the
-- caller owns.

create or replace function public.relay_gym_claim(p_session_id uuid, p_visit_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_req bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  if not exists (
    select 1 from activity_sessions where id = p_session_id and user_id = v_user
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Points already exist → nothing to relay; a retrying client resolves instantly.
  if exists (
    select 1 from point_transactions where session_id = p_session_id and type = 'earn'
  ) then
    return jsonb_build_object('status', 'already_claimed');
  end if;

  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/claim-points',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := jsonb_build_object(
      'session_id', p_session_id,
      'user_id', v_user,
      'visit_id', p_visit_id
    )
  ) into v_req;

  return jsonb_build_object('status', 'accepted', 'request_id', v_req);
end;
$$;

revoke all on function public.relay_gym_claim(uuid, uuid) from public, anon;
grant execute on function public.relay_gym_claim(uuid, uuid) to authenticated;

create or replace function public.relay_gym_upgrade(p_session_id uuid, p_visit_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_req bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  if not exists (
    select 1 from activity_sessions where id = p_session_id and user_id = v_user
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Upgrade row already exists → resolve instantly. (Deliberately NO check that a
  -- base claim exists: upgrade-gym-tier tops up from zero for ≥threshold sessions
  -- whose base claim was lost — the exit path depends on that.)
  if exists (
    select 1 from point_transactions
    where session_id = p_session_id and type = 'earn' and description like 'gym session upgrade%'
  ) then
    return jsonb_build_object('status', 'already_done');
  end if;

  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/upgrade-gym-tier',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := jsonb_build_object(
      'session_id', p_session_id,
      'user_id', v_user,
      'visit_id', p_visit_id
    )
  ) into v_req;

  return jsonb_build_object('status', 'accepted', 'request_id', v_req);
end;
$$;

revoke all on function public.relay_gym_upgrade(uuid, uuid) from public, anon;
grant execute on function public.relay_gym_upgrade(uuid, uuid) to authenticated;
