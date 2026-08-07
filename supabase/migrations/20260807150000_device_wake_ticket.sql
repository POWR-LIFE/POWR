-- Device-scoped wake ticket: a credential the wake path can actually hold.
--
-- THE HOLE THIS CLOSES. Every wake-path call that needs the USER's identity
-- authenticates with the persisted Supabase access token (lib/backgroundRest.ts).
-- That token is unusable in the two states a real gym visit is always in:
--
--   1. POCKETED FOR AN HOUR. Supabase access tokens live 60 minutes and a
--      background refresh is forbidden — rotating the refresh token from a
--      background runtime is exactly what trips GoTrue's reuse detection and
--      revokes the whole family (the silent-401 outage of 2026-08-05). So
--      backgroundRest declines, by design. Field, 2026-08-07, Android swiped
--      away since 08:50, at 09:46:
--        [bgRest] Persisted access token is spent — deferring to the auth path
--      Every call then fell back to supabase-js and timed out at 30 s.
--   2. LOCKED iPHONE. The token lives in the keychain, and a locked device
--      refuses the read outright (errSecInteractionNotAllowed — the same read
--      that pinned the app on its loading spinner on 2026-08-07). Since that
--      fix the read returns null rather than throwing, which is correct and
--      still leaves the wake with no credential.
--
-- What survived both mornings is everything riding the visit nonce — the
-- confirms — which is precisely why points still landed. This generalises that
-- design one step: instead of a ticket scoped to one visit and delivered by
-- push, a ticket scoped to one DEVICE, minted in the foreground (where auth
-- works by definition) and kept in AsyncStorage rather than the keychain, so
-- reading it needs neither a live token nor an unlocked phone.
--
-- SCOPE OF TRUST — deliberately smaller than a session, and this is the point.
-- A ticket permits exactly five things for one device: open a visit, close a
-- visit, and write three kinds of telemetry about it. It is enumerated below as
-- five wrapper functions and nothing else, so the blast radius is a property of
-- the schema rather than of the client's good behaviour.
--
--   ⚠ NOTHING HERE MAY EVER AWARD POINTS. There is deliberately no ticket
--   wrapper for confirm_gym_visit, claim-points, upgrade-gym-tier, or any
--   insert into activity_sessions/point_transactions. Credit continues to
--   require a GPS confirm carrying a server-minted, visit-scoped nonce
--   (confirm_gym_visit_v3), so the server never awards anything without device
--   proof it asked for itself. A stolen ticket can open and close visits for
--   its own device; it cannot manufacture a single point. Adding a crediting
--   wrapper here would silently convert this from a liveness fix into a
--   self-grant hole — do not do it.
--
-- WHY AsyncStorage IS ACCEPTABLE. It is weaker at rest than the keychain, which
-- is why the keychain keeps the session token and this ticket does not go
-- anywhere near one. The trade is deliberate: a credential worth less than a
-- session, stored somewhere a backgrounded, locked device can actually read.
-- Same shape as the wake nonce, which rides platform push and is likewise not
-- a session.

create table if not exists public.device_wake_tickets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- The same identifier the one-account-per-device lock uses (lib/deviceLock.ts),
  -- so a ticket row lines up 1:1 with the device_accounts row for the phone.
  device_id    text not null,
  -- sha256 of the raw secret, hex. The secret itself is returned to the client
  -- once, at mint, and never stored server-side.
  token_hash   text not null,
  platform     text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_used_at timestamptz,
  use_count    integer not null default 0,
  revoked_at   timestamptz
);

-- ONE live ticket per physical device, whoever owns it. Signing in as a second
-- account therefore takes the ticket over rather than leaving the previous
-- account's credential alive on a phone it no longer owns — the same rule the
-- device lock enforces for sessions, applied to this credential.
create unique index if not exists device_wake_tickets_device_key
  on public.device_wake_tickets (device_id);

create index if not exists device_wake_tickets_hash_idx
  on public.device_wake_tickets (token_hash);

create index if not exists device_wake_tickets_user_idx
  on public.device_wake_tickets (user_id, created_at desc);

alter table public.device_wake_tickets enable row level security;

-- No client writes this table — every write goes through the definer functions
-- below. Reads are admin-only, for the "does this phone hold a ticket, and when
-- did it last spend one?" question background triage always ends up asking; the
-- stored hash is not the credential.
--
-- Note the shape: `revoke all` clears Supabase's default grants, and SELECT is
-- then granted back explicitly. RLS filters rows but cannot grant access, so
-- without that grant the admin policy below would be unreachable — a dead policy
-- that reads like a working one.
revoke all on public.device_wake_tickets from anon, authenticated;
grant select on public.device_wake_tickets to authenticated;

drop policy if exists device_wake_tickets_select_admin on public.device_wake_tickets;
create policy device_wake_tickets_select_admin
  on public.device_wake_tickets for select
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Mint. FOREGROUND ONLY, and authenticated the ordinary way: this is the one
-- moment in the ticket's life when a live JWT is guaranteed, which is the whole
-- reason the wake path does not need one afterwards.
-- ---------------------------------------------------------------------------
create or replace function public.mint_device_wake_ticket(
  p_device_id text,
  p_platform  text default null,
  p_ttl_days  integer default 30
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_device  text := left(nullif(trim(coalesce(p_device_id, '')), ''), 200);
  v_ttl     integer := least(greatest(coalesce(p_ttl_days, 30), 1), 90);
  v_secret  text;
  v_expires timestamptz;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if v_device is null then raise exception 'device_id required'; end if;

  -- Cheap housekeeping on a naturally rare call; no cron to forget to deploy.
  delete from device_wake_tickets where expires_at < now() - interval '7 days';

  -- 256 bits from the CSPRNG. The client stores this; we keep only its hash.
  v_secret  := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + make_interval(days => v_ttl);

  insert into device_wake_tickets (user_id, device_id, token_hash, platform, expires_at)
  values (v_user, v_device, encode(extensions.digest(v_secret, 'sha256'), 'hex'), p_platform, v_expires)
  on conflict (device_id) do update
     set user_id      = excluded.user_id,
         token_hash   = excluded.token_hash,
         platform     = coalesce(excluded.platform, device_wake_tickets.platform),
         created_at   = now(),
         expires_at   = excluded.expires_at,
         last_used_at = null,
         use_count    = 0,
         revoked_at   = null;

  return jsonb_build_object('ticket', v_secret, 'device_id', v_device, 'expires_at', v_expires);
end;
$$;

revoke all on function public.mint_device_wake_ticket(text, text, integer) from public, anon;
grant execute on function public.mint_device_wake_ticket(text, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Verification. Returns the owning user for a valid (ticket, device) pair, else
-- null. Stamps usage in the same statement: a ticket that is being spent is the
-- only evidence the wake path leaves when everything else about it is silent,
-- and that silence is what hid a dead iOS wake path for 17 days.
--
-- Not single-use — one wake legitimately spends it on a region event, then the
-- open, then a tick — and not the last line of defence either: the wrappers
-- below can only reach functions that are themselves scoped to the owning user.
-- ---------------------------------------------------------------------------
create or replace function public._device_ticket_user(p_ticket text, p_device_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid;
begin
  if p_ticket is null or p_device_id is null then return null; end if;

  update device_wake_tickets
     set last_used_at = now(),
         use_count    = use_count + 1
   where device_id  = p_device_id
     and revoked_at is null
     and expires_at > now()
     and token_hash = encode(extensions.digest(p_ticket, 'sha256'), 'hex')
  returning user_id into v_user;

  return v_user;
end;
$$;

revoke all on function public._device_ticket_user(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The five wrappers. Each validates the ticket, then impersonates its owner for
-- the transaction and delegates to the EXISTING function — same body, same
-- ownership checks, same idempotency guards, so a ticketed call and a JWT call
-- cannot drift apart. Identical technique to confirm_gym_visit_v3, which has
-- carried the nonce wake path since 2026-08-05.
--
-- The impersonation is transaction-local (`set_config(..., true)`) and PostgREST
-- runs one transaction per request, so it cannot leak into another caller.
-- A rejected ticket raises SQLSTATE 28000, which PostgREST answers 403 with the
-- code intact — the client uses that to fall back to the persisted token rather
-- than treating it as a dead network.
-- ---------------------------------------------------------------------------

create or replace function public.open_gym_visit_by_ticket(
  p_ticket     text,
  p_device_id  text,
  p_partner_id uuid,
  p_region_id  text default null,
  p_started_at timestamptz default null,
  p_platform   text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid;
begin
  v_user := _device_ticket_user(p_ticket, p_device_id);
  if v_user is null then
    raise exception 'invalid or expired device ticket' using errcode = '28000';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  return open_gym_visit(p_partner_id, p_region_id, p_started_at, p_platform);
end;
$$;

create or replace function public.close_gym_visit_by_ticket(
  p_ticket    text,
  p_device_id text,
  p_visit_id  uuid,
  p_ended_at  timestamptz default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid;
begin
  v_user := _device_ticket_user(p_ticket, p_device_id);
  if v_user is null then
    raise exception 'invalid or expired device ticket' using errcode = '28000';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform close_gym_visit(p_visit_id, p_ended_at);
end;
$$;

create or replace function public.log_gym_visit_tick_by_ticket(
  p_ticket    text,
  p_device_id text,
  p_visit_id  uuid,
  p_detail    jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid;
begin
  v_user := _device_ticket_user(p_ticket, p_device_id);
  if v_user is null then
    raise exception 'invalid or expired device ticket' using errcode = '28000';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform log_gym_visit_tick(p_visit_id, coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('auth', 'device_ticket'));
end;
$$;

create or replace function public.log_geofence_region_event_by_ticket(
  p_ticket    text,
  p_device_id text,
  p_region_id text,
  p_event     text,
  p_platform  text default null,
  p_detail    jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid;
begin
  v_user := _device_ticket_user(p_ticket, p_device_id);
  if v_user is null then
    raise exception 'invalid or expired device ticket' using errcode = '28000';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform log_geofence_region_event(p_region_id, p_event, p_platform,
    coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('auth', 'device_ticket'));
end;
$$;

-- A progress MARKER, not a credit: it records that a claim already landed
-- elsewhere, and cannot itself move a point. Included because it is called
-- immediately after the claim on the dwell path — i.e. on a wake — and a frozen
-- one leaves the beacon nudging a visit that is already paid.
create or replace function public.mark_gym_visit_progress_by_ticket(
  p_ticket     text,
  p_device_id  text,
  p_visit_id   uuid,
  p_stage      text,
  p_session_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid;
begin
  v_user := _device_ticket_user(p_ticket, p_device_id);
  if v_user is null then
    raise exception 'invalid or expired device ticket' using errcode = '28000';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform mark_gym_visit_progress(p_visit_id, p_stage, p_session_id);
end;
$$;

-- The wake presents the anon key, exactly as the nonce path does; the ticket is
-- the authority, so `anon` must be able to execute these.
revoke all on function public.open_gym_visit_by_ticket(text, text, uuid, text, timestamptz, text) from public;
grant execute on function public.open_gym_visit_by_ticket(text, text, uuid, text, timestamptz, text) to anon, authenticated;

revoke all on function public.close_gym_visit_by_ticket(text, text, uuid, timestamptz) from public;
grant execute on function public.close_gym_visit_by_ticket(text, text, uuid, timestamptz) to anon, authenticated;

revoke all on function public.log_gym_visit_tick_by_ticket(text, text, uuid, jsonb) from public;
grant execute on function public.log_gym_visit_tick_by_ticket(text, text, uuid, jsonb) to anon, authenticated;

revoke all on function public.log_geofence_region_event_by_ticket(text, text, text, text, text, jsonb) from public;
grant execute on function public.log_geofence_region_event_by_ticket(text, text, text, text, text, jsonb) to anon, authenticated;

revoke all on function public.mark_gym_visit_progress_by_ticket(text, text, uuid, text, uuid) from public;
grant execute on function public.mark_gym_visit_progress_by_ticket(text, text, uuid, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Revoke. Authenticated by the TICKET, not by a session: sign-out is exactly
-- the moment the JWT may already be gone (a forced sign-out, a revoked family,
-- a locked keychain), and a credential that can only be retired while you still
-- hold a working session is a credential that never gets retired.
-- ---------------------------------------------------------------------------
create or replace function public.revoke_device_wake_ticket(
  p_ticket    text,
  p_device_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update device_wake_tickets
     set revoked_at = now()
   where device_id  = p_device_id
     and revoked_at is null
     and token_hash = encode(extensions.digest(coalesce(p_ticket, ''), 'sha256'), 'hex');
end;
$$;

revoke all on function public.revoke_device_wake_ticket(text, text) from public;
grant execute on function public.revoke_device_wake_ticket(text, text) to anon, authenticated;
