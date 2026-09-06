-- The check-in fix is the visit's first proof, and the exit fence is its end
-- witness (2026-09-06).
--
-- WHAT THE 30 DAYS TO 09-06 SAID (real iOS members, 77 sessions >= 30 min):
--   * 23 closed with last_proven_at NULL. The check-in itself required a
--     High-accuracy fix inside the 25 m circle, but nothing recorded it as
--     proof: proof was written only by a LATER fix (the stream heartbeat, which a
--     stationary phone never produces) or by an answered wake (68% of nudged
--     visits). gym-visit-beacon's settle pass gates on `last_proven_at`, so a
--     silent phone with no proof was skipped every minute until the member
--     opened the app — 9 visits this month, 8 paid a mean 502 minutes late.
--     Live-tracked 09-06, visit 185e82e3: four APNs-accepted dwell wakes, zero
--     answered, no proof, settle skipped for 50 minutes until a manual stamp.
--   * 1,010 minutes inside but not recorded: close_gym_visit clamps the end to
--     the last proof, so a lifter who stops moving after the 40-minute stamp is
--     recorded at 40. Same visit: OS exit fence fired at 16:07:44 and relaunched
--     the app 532 m away, and the close was clamped to the 15:48 upgrade stamp.
--
-- PART 1 — open_gym_visit(..., p_fix). The client may pass the fix that
-- DECIDED the check-in ({distance_m, accuracy_m, fix_trusted, fix_age_s}). It
-- goes through confirm_gym_visit_v2 with p_request_credit = false, so the ONE
-- existing rule decides whether it establishes the proof clock: trusted, inside
-- radius + accuracy, and no older than 120 s. A stale last-known position (the
-- enter-poll paths) fails that test exactly as it would from a wake; a coarse
-- fix never checks in at all. The event it writes is `confirmed_inside` with
-- stage 'check_in', so Live Ops' proof counters and close_gym_visit's
-- proof_writer need no change.
--
-- ⚠ ON THE 20260818082412 NULL INVARIANT ("a NULL clock is the ONLY thing
-- standing between a visit that never proved anything and full server-side
-- credit"). Still true: a visit whose check-in carried no creditable fix keeps a
-- NULL clock. What changes is that a check-in WITH a creditable fix is no longer
-- "never proved anything" — it proved it at second zero, and the settle may act
-- on that after >= 2 unanswered wakes and no OS exit. The device ticket keeps
-- its five verbs; opening a visit always asserted presence, it now carries the
-- evidence. Credit still needs claim-points, reached only by the settle or a
-- nonce confirm.
--
-- PART 2 — close_gym_visit trusts the exit fence as the END of a proven visit.
-- If the device presents an end time (the OS exit or a location-detected exit)
-- for a visit that has a proof clock or a claim, the end is that time — bounded
-- by now(), the 12 h backstop, and the EARLIEST post-anchor evidence the phone
-- was somewhere else: a confirmed_outside on this visit, an OS enter at another
-- partner, or a sweep that reported the nearest gym beyond this venue's radius
-- + hysteresis. The settle pass already treats "no exit observed" as evidence of
-- presence; this is the same trust applied at the other end. Visits with no
-- proof and no claim (drive-by phantoms, arm-burst enters) clamp exactly as
-- before. The exit row carries `end_basis` so the two populations stay
-- separable; `clamped` / `clamp_loss_s` keep their meaning (requested minus
-- stored) and now read 0 for a witnessed exit.
--
-- ⚠ ORDER OF DEPLOY: this migration BEFORE the client OTA. A client sending
-- p_fix against the old signature gets a PostgREST "function not found" and
-- the check-in opens no visit at all. The old client against this migration is
-- fine (p_fix defaults to null).

-- ---------------------------------------------------------------------------
-- Part 1: open_gym_visit carries the check-in fix.
-- Both signatures change, so the old ones are DROPPED — `create or replace`
-- with a new parameter list makes an overload, and PostgREST cannot pick
-- between two candidates that both accept the four-argument call.
-- ---------------------------------------------------------------------------
drop function if exists public.open_gym_visit_by_ticket(text, text, uuid, text, timestamptz, text);
drop function if exists public.open_gym_visit(uuid, text, timestamptz, text);

create or replace function public.open_gym_visit(
  p_partner_id uuid,
  p_region_id  text,
  p_started_at timestamptz,
  p_platform   text default null,
  p_fix        jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c_same_checkin constant interval := interval '5 minutes';
  c_reuse_window constant interval := interval '4 hours';
  -- How close a CLOSED visit's start must sit to the timestamp being presented
  -- before we read it as a replay of that visit rather than a new check-in. A
  -- replay carries the byte-identical entryTimestamp; a genuine re-entry carries a
  -- fresh one, and the age test below does the real separating.
  c_replay_match constant interval := interval '2 minutes';
  -- Nothing may be backdated further than the 12 h abandon backstop.
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
    -- A racing double-open (check_in + stream_late_open land 20 ms apart) may
    -- carry the fix on either call; the monotonic max inside confirm keeps the
    -- clock honest whichever wins.
    perform _open_gym_visit_stamp_fix(v_id, p_fix);
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
  --   1. the caller is presenting an entry that is no longer recent — a fresh
  --      check-in always passes now(), so this is what distinguishes a device
  --      replaying dead state from a user walking back in minutes after a visit
  --      closed; and
  --   2. a visit for this user, at this gym, that STARTED at that moment has
  --      already ended.
  -- Then this is not a new session — it is a client resolve path asking "which
  -- visit is this?" about a visit we have already closed. Answer with the truth.
  --
  -- ⚠ What this must NOT break: the legitimate late-open retry, where a check-in
  -- raced auth and NO visit was ever created. That matches no closed row, falls
  -- through, and is still backdated to the device's real entry.
  if p_started_at is not null and p_started_at < now() - c_same_checkin then
    select id into v_closed_id
      from gym_visits
     where user_id = v_user
       and partner_id is not distinct from p_partner_id
       and ended_at is not null
       and started_at between p_started_at - c_replay_match
                          and p_started_at + c_replay_match
     -- Closest start first, then the OLDEST row: where a duplicate has already been
     -- minted (aff0a1f7 and a635617c share 08:25:30.393 to the millisecond) the
     -- original carries the claim, the session and the points. Answer with that
     -- one, not with its ghost.
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
      -- A closed visit takes no proof (confirm's UPDATE is `ended_at is null`);
      -- deliberately no stamp here.
      return v_closed_id;
    end if;
  end if;

  -- Bound the backdate. Beyond the 12 h backstop the claimed entry cannot describe
  -- a session anything would still credit.
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
        'region_id',        p_region_id,
        'backdate_min',     round(extract(epoch from (now() - v_start)) / 60),
        'backdate_clamped', v_clamped,
        'fix_carried',      (p_fix is not null)
      ));
      perform _open_gym_visit_stamp_fix(v_id, p_fix);
      return v_id;
    end if;

    select id into v_id
      from gym_visits
     where user_id = v_user and ended_at is null
     order by started_at desc
     limit 1;

    if v_id is not null then
      perform _open_gym_visit_stamp_fix(v_id, p_fix);
      return v_id;
    end if;
  end loop;

  raise exception 'open_gym_visit: could not open or adopt a live visit for %', v_user;
end;
$$;

-- The stamp itself. A separate definer so the open's control flow above stays
-- readable, and so a malformed fix can NEVER fail the open: the check-in is the
-- one moment the device is provably awake, and losing the visit to a bad
-- telemetry payload would be strictly worse than losing the proof.
create or replace function public._open_gym_visit_stamp_fix(p_visit_id uuid, p_fix jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_fix is null or jsonb_typeof(p_fix) <> 'object' then return; end if;
  -- Server-built keys to the RIGHT of || so a client cannot relabel its fix as a
  -- wake stage. p_inside = true (a check-in is by definition an inside claim; the
  -- geometry test inside confirm decides whether it counts), request_credit =
  -- false, no p_entry_at: the check-in stamps proof and NOTHING else.
  perform confirm_gym_visit_v2(
    p_visit_id,
    true,
    p_fix || jsonb_build_object('stage', 'check_in', 'source', 'open'),
    false,
    null
  );
exception when others then
  raise warning 'open_gym_visit: check-in proof stamp failed for %: %', p_visit_id, sqlerrm;
end;
$$;
revoke all on function public._open_gym_visit_stamp_fix(uuid, jsonb) from public, anon, authenticated;

create or replace function public.open_gym_visit_by_ticket(
  p_ticket     text,
  p_device_id  text,
  p_partner_id uuid,
  p_region_id  text default null,
  p_started_at timestamptz default null,
  p_platform   text default null,
  p_fix        jsonb default null
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
  return open_gym_visit(p_partner_id, p_region_id, p_started_at, p_platform, p_fix);
end;
$$;

revoke all on function public.open_gym_visit(uuid, text, timestamptz, text, jsonb) from public, anon;
grant execute on function public.open_gym_visit(uuid, text, timestamptz, text, jsonb) to authenticated;

revoke all on function public.open_gym_visit_by_ticket(text, text, uuid, text, timestamptz, text, jsonb) from public;
grant execute on function public.open_gym_visit_by_ticket(text, text, uuid, text, timestamptz, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Part 2: close_gym_visit — the exit fence is the end witness.
-- ---------------------------------------------------------------------------
create or replace function public.close_gym_visit(p_visit_id uuid, p_ended_at timestamp with time zone default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user      uuid := auth.uid();
  v_ended_at  timestamptz := least(coalesce(p_ended_at, now()), now());
  v_visit     gym_visits%rowtype;
  v_anchor    timestamptz;
  v_session   uuid;
  v_requested timestamptz;
  v_anchor_of text;
  v_writer    text;
  -- The end-witness rule.
  v_witnessed    boolean := false;
  v_radius       numeric;
  v_prefix       text;
  v_elsewhere_at timestamptz;
  v_elsewhere_by text;
  v_end_basis    text;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_visit
    from gym_visits
   where id = p_visit_id and user_id = v_user and ended_at is null;
  if not found then return; end if;

  -- Last PROVEN moment: same anchors as staleVisitVerdict. claimed_at /
  -- upgraded_at each required a location-confirmed wake (or a server settle,
  -- whose known cost is documented in gym-visit-beacon's SETTLE pass).
  v_anchor := greatest(
    v_visit.started_at,
    coalesce(v_visit.last_proven_at, v_visit.started_at),
    coalesce(v_visit.claimed_at,     v_visit.started_at),
    coalesce(v_visit.upgraded_at,    v_visit.started_at)
  );
  -- Capture the REQUEST before any clamp overwrites it. Use this, never raw
  -- p_ended_at: p_ended_at is NULL whenever the client passes no explicit end
  -- (lib/gymVisits.ts), and it is uncapped, so a device with a fast clock would
  -- report an inflated gap.
  v_requested := v_ended_at;

  v_anchor_of := case
    when v_visit.last_proven_at is not null and v_anchor = v_visit.last_proven_at then 'last_proven_at'
    when v_visit.upgraded_at    is not null and v_anchor = v_visit.upgraded_at    then 'upgraded_at'
    when v_visit.claimed_at     is not null and v_anchor = v_visit.claimed_at     then 'claimed_at'
    else 'started_at'
  end;

  -- THE EXIT FENCE IS AN END WITNESS (2026-09-06). A device-presented end on a
  -- visit that has EITHER a proof clock OR a claim is believed, unless the
  -- record already places the phone somewhere else earlier. Visits with neither
  -- (drive-by phantoms, arm-burst enters that never carried a fix) keep the
  -- proof clamp: they never demonstrated presence, so "no exit observed" is not
  -- evidence for them.
  v_witnessed := p_ended_at is not null
             and (v_visit.last_proven_at is not null or v_visit.claimed_at is not null);

  if v_witnessed then
    v_radius := coalesce(_gym_visit_radius_m(v_visit.partner_id, v_visit.region_id), 100);
    -- Region ids are '<partner uuid>-<location idx>'; the partner uuid is the
    -- venue identity across its locations.
    v_prefix := coalesce(left(v_visit.region_id, 36), v_visit.partner_id::text);

    -- The earliest moment after the anchor at which the device was observably
    -- NOT here. Three witnesses, all device-written:
    --   * confirmed_outside on this visit (a wake answered from outside);
    --   * an OS enter at a different partner;
    --   * a sweep whose nearest gym sat beyond this venue's radius + the 50 m
    --     exit hysteresis (a 'handoff' sweep with a near nearest_m is a phone
    --     that lost local state while still inside — not a departure).
    select min(t), min(by) filter (where t = mn) into v_elsewhere_at, v_elsewhere_by
      from (
        select x.t, x.by, min(x.t) over () as mn
          from (
            select e.created_at as t, 'confirmed_outside'::text as by
              from gym_visit_events e
             where e.visit_id = p_visit_id
               and e.event = 'confirmed_outside'
               and e.created_at > v_anchor
               and e.created_at <= v_requested
            union all
            select r.created_at, 'enter_elsewhere'
              from geofence_region_events r
             where r.user_id = v_user
               and r.event = 'enter'
               and r.region_id not like v_prefix || '%'
               and r.created_at > v_anchor
               and r.created_at <= v_requested
            union all
            select r.created_at, 'sweep_elsewhere'
              from geofence_region_events r
             where r.user_id = v_user
               and r.event = 'sweep'
               and r.detail ->> 'outcome' = 'handoff'
               and coalesce(_gym_detail_num(r.detail, 'nearest_m'), 0) > v_radius + 50
               and r.created_at > v_anchor
               and r.created_at <= v_requested
          ) x
      ) y;

    -- Bounded by the 12 h backstop every duration writer uses, and never after
    -- now() (v_ended_at already is).
    v_ended_at := least(v_requested, v_visit.started_at + interval '12 hours');
    v_end_basis := case when v_ended_at < v_requested then 'capped_12h' else 'exit_witness' end;
    if v_elsewhere_at is not null and v_elsewhere_at < v_ended_at then
      v_ended_at  := greatest(v_anchor, v_elsewhere_at);
      v_end_basis := v_elsewhere_by;
    end if;
    v_ended_at := greatest(v_visit.started_at, v_ended_at);
  else
    v_ended_at  := greatest(v_visit.started_at, least(v_ended_at, v_anchor));
    v_end_basis := case when p_ended_at is null then 'no_request' else 'proof_clamp' end;
  end if;

  update gym_visits
     set ended_at     = v_ended_at,
         status       = 'closed',
         close_reason = 'exit'
   where id = p_visit_id and user_id = v_user and ended_at is null
  returning claimed_session_id into v_session;

  -- Only the call that actually closed the visit logs the exit. A loser in a
  -- concurrent burst is a silent no-op, not a second `exit` row (31 were logged
  -- in 1.4 s on visit 54b70cb6; 30 of them were phantom).
  if found then
    -- ⚠ INSIDE the `if found`, never above it. A `select … into` between the
    -- UPDATE and this test overwrites FOUND and resurrects those 30 phantom rows.
    --
    -- Keyed on `stamped`, not on `proven` and not on created_at = last_proven_at.
    -- After 20260818090000 a retrospective advance logs proven:false, so a
    -- `proven = true` filter would miss exactly the writers this is meant to
    -- find; and created_at = last_proven_at held only while both were
    -- transaction_timestamp(), which that migration ends. NULL for visits that
    -- began before it — the flag did not exist yet.
    select e.detail ->> 'stage'
      into v_writer
      from gym_visit_events e
     where e.visit_id = p_visit_id
       and e.event = 'confirmed_inside'
       and e.detail ->> 'stamped' = 'true'
     order by e.created_at desc
     limit 1;

    insert into gym_visit_events (visit_id, user_id, event, detail)
    values (p_visit_id, v_user, 'exit', jsonb_build_object(
      'ended_at',           v_ended_at,
      'requested_ended_at', p_ended_at,
      'clamped',            (p_ended_at is not null and v_ended_at < p_ended_at),
      'proof_gap_s',        round(extract(epoch from (v_requested - v_visit.last_proven_at))),
      'clamp_loss_s',       round(extract(epoch from (v_requested - v_ended_at))),
      'clamp_anchor',       v_anchor_of,
      'proof_writer',       v_writer,
      'end_basis',          v_end_basis,
      'elsewhere_at',       v_elsewhere_at));

    -- Carry the exit into the row every user-facing surface renders.
    if v_session is not null then
      update activity_sessions
         set ended_at     = greatest(coalesce(ended_at, v_ended_at), v_ended_at),
             duration_sec = least(
               43200,
               greatest(
                 coalesce(duration_sec, 0),
                 extract(epoch from (
                   greatest(coalesce(ended_at, v_ended_at), v_ended_at) - started_at
                 ))::int
               )
             )
       where id = v_session
         and user_id = v_user
         and type = 'gym';
    end if;
  end if;
end;
$$;
