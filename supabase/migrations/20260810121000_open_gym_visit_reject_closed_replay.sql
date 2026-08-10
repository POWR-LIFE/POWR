-- ─────────────────────────────────────────────────────────────────────────────
-- A CHECK-IN THAT HAS ALREADY ENDED CAN NEVER BE RE-OPENED.
--
-- Field 2026-08-10, Android powrcto:
--
--   aff0a1f7  started 08:25:30.393  ended 09:37:03  closed/exit  (created 08:25:34)
--   a635617c  started 08:25:30.393  ended NULL      open         (created 10:00:08)
--
-- Same backdated start, minted 23 minutes after the first one closed, at a
-- moment the device's own sweep in the same second recorded `nearest_m: 334`.
-- The beacon then nudged it four times.
--
-- HOW. Every one of open_gym_visit's decisions is scoped to `ended_at is null`:
-- the reuse branch, the supersede branch and the insert's partial unique index.
-- A CLOSED visit at the same started_at is therefore invisible, and the RPC
-- happily creates a second row backdated to a timestamp whose visit is dead.
--
-- The device supplies that timestamp from ACTIVE_GEOFENCE_KEY, and three client
-- paths pass it (GeofenceContext: the close-path resolve ~2667, the wake
-- late-open ~3366, the stream late-open ~3578). All three are gated on a
-- MISSING visitId — which on Android is the normal state, because the check-in
-- RPC's response is routinely lost while auth is wedged (this run: the row was
-- created at 08:25:34, the client never learned its id, and re-resolved via
-- `reused` on every wake for 90 minutes). The moment anything closes the visit
-- server-side — the exit here, the REAPER on 2026-08-08 — the next resolve
-- mints a duplicate. The client comment at GeofenceContext:2336 predicted this
-- exact sequence two days before it happened.
--
-- WHY THE FIX BELONGS HERE. The client cannot be the fence: stale local state
-- is precisely the condition under which these calls fire, and every fix that
-- depends on the device shipping an OTA leaves the installed base exposed. The
-- server knows the truth — it closed the visit. One guard here covers all three
-- callers, every platform, and every phone already in the field.
--
-- Related: 20260801100000_open_gym_visit_bound_stale_reuse.sql (the live-visit
-- reuse bound), 20260807093000_open_gym_visit_reuse_claimed.sql.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.open_gym_visit(
  p_partner_id uuid,
  p_region_id text,
  p_started_at timestamp with time zone,
  p_platform text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c_same_checkin constant interval := interval '5 minutes';
  c_reuse_window constant interval := interval '4 hours';
  -- How close a CLOSED visit's start must sit to the timestamp being presented
  -- before we read it as a replay of that visit rather than a new check-in.
  -- Deliberately tighter than c_same_checkin: a replay carries the byte-identical
  -- entryTimestamp (08:25:30.393 == 08:25:30.393), while a genuine re-entry
  -- carries a fresh one. See the age test below, which does the real separating.
  c_replay_match constant interval := interval '2 minutes';
  -- Nothing may be backdated further than the 12 h abandon backstop. A device
  -- holding week-old state must not be able to mint a week-long visit.
  c_max_backdate constant interval := interval '12 hours';
  v_user       uuid := auth.uid();
  v_id         uuid;
  v_status     text;
  v_started_at timestamptz;
  v_partner_id uuid;
  v_closed_id  uuid;
  v_start      timestamptz;
  v_clamped    boolean := false;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  perform pg_advisory_xact_lock(hashtextextended('open_gym_visit:' || v_user::text, 0));

  select id, status, started_at, partner_id
    into v_id, v_status, v_started_at, v_partner_id
    from gym_visits
   where user_id = v_user and ended_at is null and status in ('open','claimed','upgraded')
   order by started_at desc
   limit 1;

  -- Re-use the row that is this very check-in, still live, at this gym —
  -- whatever progress it has already recorded, and however long it has run.
  if v_id is not null
     and v_status in ('open','claimed','upgraded')
     and (p_started_at is not null or v_started_at > now() - c_reuse_window)
     and v_partner_id is not distinct from p_partner_id
     and v_started_at between coalesce(p_started_at, now()) - c_same_checkin
                          and coalesce(p_started_at, now()) + c_same_checkin
  then
    insert into gym_visit_events (visit_id, user_id, event, detail)
    values (v_id, v_user, 'reused', jsonb_build_object(
      'region_id', p_region_id,
      'age_min',   round(extract(epoch from (now() - v_started_at)) / 60),
      'status',    v_status
    ));
    return v_id;
  end if;

  if v_id is not null then
    update gym_visits
       set ended_at     = greatest(started_at, last_proven_at, upgraded_at, claimed_at),
           status       = 'closed',
           close_reason = 'superseded_by_new_check_in'
     where id = v_id and ended_at is null;

    if found then
      insert into gym_visit_events (visit_id, user_id, event, detail)
      values (v_id, v_user, 'closed_stale', jsonb_build_object(
        'reason',          'superseded_by_new_check_in',
        'prior_status',    v_status,
        'age_min',         round(extract(epoch from (now() - v_started_at)) / 60),
        'partner_changed', (v_partner_id is distinct from p_partner_id)
      ));
    end if;
    v_id := null;
  end if;

  -- ── THE REPLAY GUARD ───────────────────────────────────────────────────────
  -- Two conditions, and BOTH are needed:
  --
  --   1. the caller is presenting an entry that is no longer recent — a fresh
  --      check-in always passes now(), so this is the one that distinguishes a
  --      device replaying dead state from a user walking back in minutes after
  --      an earlier visit closed; and
  --   2. a visit for this user, at this gym, that STARTED at that moment has
  --      already ended.
  --
  -- Then this call is not a new session — it is one of the client's resolve
  -- paths asking "which visit is this?" about a visit we have already closed.
  -- Answer with the truth. The close-path resolve gets the id it needs to close
  -- (idempotent, already closed), and the two late-open paths stop re-asking
  -- instead of minting a row the beacon would nudge for hours.
  --
  -- ⚠ What this must NOT break: the legitimate late-open retry, where a
  -- check-in raced auth and NO visit was ever created. That case matches no
  -- closed row, falls straight through, and is still backdated to the device's
  -- real entry — which is what keeps the server's 30/40-minute timers honest.
  if p_started_at is not null and p_started_at < now() - c_same_checkin then
    select id into v_closed_id
      from gym_visits
     where user_id = v_user
       and partner_id is not distinct from p_partner_id
       and ended_at is not null
       and started_at between p_started_at - c_replay_match
                          and p_started_at + c_replay_match
     -- Closest start first, then the OLDEST row: where a duplicate has already
     -- been minted (aff0a1f7 and a635617c share 08:25:30.393 to the
     -- millisecond) the original is the one that carries the claim, the
     -- session and the points. Answer with that one, not with its ghost.
     order by abs(extract(epoch from (started_at - p_started_at))), created_at
     limit 1;

    if v_closed_id is not null then
      insert into gym_visit_events (visit_id, user_id, event, detail)
      values (v_closed_id, v_user, 'stale_entry_replayed', jsonb_build_object(
        'region_id',  p_region_id,
        'started_at', p_started_at,
        'age_min',    round(extract(epoch from (now() - p_started_at)) / 60),
        'platform',   p_platform
      ));
      return v_closed_id;
    end if;
  end if;

  -- Bound the backdate. Beyond the 12 h backstop the claimed entry cannot
  -- describe a session anything would still credit, so keep the row honest at
  -- the boundary rather than inventing a start nobody can defend.
  v_start := least(coalesce(p_started_at, now()), now());
  if v_start < now() - c_max_backdate then
    v_start := now() - c_max_backdate;
    v_clamped := true;
  end if;

  for attempt in 1..2 loop
    insert into gym_visits (user_id, partner_id, region_id, started_at, platform)
    values (v_user, p_partner_id, p_region_id, v_start, p_platform)
    on conflict (user_id) where ended_at is null do nothing
    returning id into v_id;

    if v_id is not null then
      insert into gym_visit_events (visit_id, user_id, event, detail)
      values (v_id, v_user, 'check_in', jsonb_build_object(
        'region_id',       p_region_id,
        'backdate_min',    round(extract(epoch from (now() - v_start)) / 60),
        'backdate_clamped', v_clamped
      ));
      return v_id;
    end if;

    select id into v_id
      from gym_visits
     where user_id = v_user and ended_at is null
     order by started_at desc
     limit 1;

    if v_id is not null then return v_id; end if;
  end loop;

  raise exception 'open_gym_visit: could not open or adopt a live visit for %', v_user;
end;
$function$;
