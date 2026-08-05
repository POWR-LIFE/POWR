-- Wake nonce: take AUTH out of the beacon wake path entirely.
--
-- Field-proven 2026-08-05: a wake whose token had expired froze awaiting the
-- refresh — the POST succeeded server-side in 276 ms while the client promise
-- never settled (RN frozen-response class + a Keystore session write, both of
-- which Android may freeze in a screen-off background process). Two fresh
-- processes, identical stall. The wake window fits ONE round-trip, and it must
-- be the confirm — never an auth call.
--
-- So the beacon now mints a short-lived, visit-scoped ticket into every nudge,
-- and the device answers with THAT: sha256 of the raw nonce is stored on the
-- visit row; the confirm/telemetry RPCs below validate it and act as the
-- visit's owner. No JWT, no refresh, no session persistence in the wake.
--
-- Scope of trust: a nonce only permits answering the server's own question
-- about one visit ("is this device still inside?") for ~15 minutes, and credit
-- still requires the device to present an inside fix. It is delivered over
-- platform push channels (TLS end-to-end). Cleared when the visit ends.

alter table public.gym_visits
  add column if not exists wake_nonce_hash text,
  add column if not exists wake_nonce_expires_at timestamptz;

-- Beacon-side helper: stamp a fresh nonce hash at nudge time (called with the
-- service role; not granted to clients).
create or replace function public.set_gym_visit_wake_nonce(
  p_visit_id uuid,
  p_nonce_hash text,
  p_ttl_seconds integer default 900
) returns void
language sql
security definer
set search_path = public
as $$
  update gym_visits
     set wake_nonce_hash = p_nonce_hash,
         wake_nonce_expires_at = now() + make_interval(secs => p_ttl_seconds)
   where id = p_visit_id;
$$;
revoke all on function public.set_gym_visit_wake_nonce(uuid, text, integer) from public;

-- Validates a raw nonce against the visit. NOT single-use within its window:
-- the same nudge's wake legitimately spends it on telemetry, then the confirm,
-- then possibly a retry — and the beacon re-mints on every nudge anyway.
create or replace function public._gym_visit_nonce_ok(p_visit_id uuid, p_nonce text)
returns uuid  -- the visit's user_id when valid, else null
language sql
security definer
set search_path = public
as $$
  select user_id from gym_visits
   where id = p_visit_id
     and wake_nonce_hash is not null
     and wake_nonce_expires_at > now()
     and wake_nonce_hash = encode(extensions.digest(p_nonce, 'sha256'), 'hex');
$$;
revoke all on function public._gym_visit_nonce_ok(uuid, text) from public;

-- Nonce-authenticated wake telemetry: same row log_gym_wake_received writes,
-- authenticated by the ticket instead of a JWT.
create or replace function public.log_gym_wake_received_v2(
  p_visit_id uuid,
  p_nonce text,
  p_stage text,
  p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  v_user := _gym_visit_nonce_ok(p_visit_id, p_nonce);
  if v_user is null then
    raise exception 'invalid or expired wake nonce';
  end if;
  insert into gym_visit_events (visit_id, user_id, event, detail)
  values (p_visit_id, v_user, 'wake_received', coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('stage', p_stage, 'auth', 'nonce'));
end;
$$;
revoke all on function public.log_gym_wake_received_v2(uuid, text, text, jsonb) from public;
grant execute on function public.log_gym_wake_received_v2(uuid, text, text, jsonb) to anon, authenticated;

-- Nonce-authenticated confirm: validates the ticket, then delegates to the
-- existing v2 logic by impersonating the visit's owner via the same body v2
-- uses. To avoid duplicating v2's credit machinery, this wraps it: v2 reads
-- auth.uid() — so we set the request claim for the transaction before calling.
create or replace function public.confirm_gym_visit_v3(
  p_visit_id uuid,
  p_nonce text,
  p_inside boolean,
  p_detail jsonb default '{}'::jsonb,
  p_request_credit boolean default false,
  p_entry_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_result jsonb;
begin
  v_user := _gym_visit_nonce_ok(p_visit_id, p_nonce);
  if v_user is null then
    raise exception 'invalid or expired wake nonce';
  end if;
  -- confirm_gym_visit_v2 authorises via auth.uid(); impersonate the visit's
  -- owner for this transaction only. SECURITY DEFINER + local scope keeps this
  -- contained; the nonce check above is the real gate.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_result := confirm_gym_visit_v2(p_visit_id, p_inside, coalesce(p_detail,'{}'::jsonb) || jsonb_build_object('auth','nonce'), p_request_credit, p_entry_at);
  return v_result;
end;
$$;
revoke all on function public.confirm_gym_visit_v3(uuid, text, boolean, jsonb, boolean, timestamptz) from public;
grant execute on function public.confirm_gym_visit_v3(uuid, text, boolean, jsonb, boolean, timestamptz) to anon, authenticated;

-- Hygiene: clear tickets when visits end (they are already time-bounded).
create or replace function public.clear_gym_visit_wake_nonce()
returns trigger language plpgsql as $$
begin
  if new.ended_at is not null and old.ended_at is null then
    new.wake_nonce_hash := null;
    new.wake_nonce_expires_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists gym_visits_clear_wake_nonce on public.gym_visits;
create trigger gym_visits_clear_wake_nonce
  before update on public.gym_visits
  for each row execute function public.clear_gym_visit_wake_nonce();
