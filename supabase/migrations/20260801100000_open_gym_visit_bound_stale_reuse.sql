-- Bound open_gym_visit's reuse branch, and stop manufacturing the rows it feeds on.
--
-- FIELD-CAUGHT 2026-08-01 (bluegigsolutions + jamiemasonwright both reported "over
-- 40 minutes, no background notification"). The reuse branch added on 2026-07-30
-- exists for ONE case: two client paths racing to open the SAME check-in
-- (setActiveAndNotify ~1170 and heartbeatVisitStream's late-open ~1510). It matched
-- on `ended_at is null and status = 'open'` with NO age bound and NO partner check,
-- so it just as happily handed back YESTERDAY's visit.
--
-- Why that kills the whole wake mechanism: the only rows that linger `open` are the
-- ones that already burned all 4 nudges without a device answer. The beacon's dwell
-- filter is `.eq('status','open').lt('nudge_count', 4)` (gym-visit-beacon/index.ts:56),
-- so a reused row is excluded PERMANENTLY — zero wakes for the whole new session —
-- and no new gym_visits row is ever created. Then the hourly abandon cron (jobid 8)
-- sets ended_at mid-session and the client is left heartbeating into a closed row.
--
-- Measured: 3 users, 9 visits, 8 user-days. Detector = a stream_tick whose
-- client-reported elapsed_min is >120 min BELOW the row's own age. Worst cases:
--   802d18be (jamiemasonwright) tick 08-01 07:08:57 elapsed_min 33 on a row started
--     07-31 18:39 (age 750 min); zero gym_visits rows for that user on 08-01 at all.
--   e3eed202 (Yan26, a real external user) 07-31 18:38 check-in at partner 7d865c3b
--     handed a row opened 11.6 h earlier AT A DIFFERENT PARTNER (ed6c3f91). Her
--     104-minute session was recorded 13 h 10 m late and lost its 40-min upgrade.
-- Points were never lost — the exit / app-open paths still claim — but the entire
-- background-claim feature is silently inert for the affected session.
--
-- Not a client bug: a fresh entryTimestamp is minted in exactly one place,
-- setActiveAndNotify (GeofenceContext.tsx:1136), which writes the record with NO
-- visitId; every other write spreads `...active`. So a stored record carrying
-- today's entryTimestamp AND yesterday's visitId can only have come from this RPC.
--
-- TRUST MODEL UNCHANGED: nothing here awards anything or asserts presence.
-- "No fix, no credit" is untouched.

-- ---------------------------------------------------------------------------
-- 1. close_reason — stop overloading `status` as both lifecycle and cause.
-- ---------------------------------------------------------------------------
-- The abandon cron and close_gym_visit both overwrite `status` unconditionally, so
-- 17 of 48 'abandoned' visits were in fact fully credited. No code consumer reads
-- `status`, so nothing is broken today — but it made this audit read a 65% exit
-- failure rate against a true 43%. Cause goes in its own column from here.
alter table gym_visits add column if not exists close_reason text;

comment on column gym_visits.close_reason is
  'Why the visit ended: exit | superseded_by_new_check_in | abandoned_12h. `status` is lifecycle state only.';

-- ---------------------------------------------------------------------------
-- 2. open_gym_visit — reuse only a LIVE, SAME-GYM, RECENT visit.
-- ---------------------------------------------------------------------------
create or replace function public.open_gym_visit(
  p_partner_id uuid,
  p_region_id  text,
  p_started_at timestamptz,
  p_platform   text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- The racing double-open this branch exists for happens within SECONDS. Four
  -- hours is already far beyond that and still comfortably inside a legitimate
  -- long session, while excluding every observed stale reuse (shortest was 9.7 h).
  -- SUPERSEDED by 20260801100001 — see that migration for why age is the wrong
  -- question and started_at identity is the right one.
  c_reuse_window constant interval := interval '4 hours';
  v_user       uuid := auth.uid();
  v_id         uuid;
  v_status     text;
  v_started_at timestamptz;
  v_partner_id uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  -- Serialise every open for THIS user. Taken BEFORE the read, so the loser's
  -- SELECT below runs on a snapshot that already contains the winner's row
  -- (READ COMMITTED: each statement takes a fresh snapshot). Released at commit;
  -- other users are unaffected.
  perform pg_advisory_xact_lock(hashtextextended('open_gym_visit:' || v_user::text, 0));

  select id, status, started_at, partner_id
    into v_id, v_status, v_started_at, v_partner_id
    from gym_visits
   where user_id = v_user and ended_at is null and status in ('open','claimed','upgraded')
   order by started_at desc
   limit 1;

  -- Same live session double-opening (racing check-in paths) — re-use it.
  -- BOUNDED on all three axes, because an unbounded match is how a fresh check-in
  -- got welded to a nudge-capped row from the previous day:
  --   status  — a claimed/upgraded row is a finished session, never a live one;
  --   age     — a row older than the reuse window is not "the same check-in";
  --   partner — Yan26's 07-31 reuse crossed gyms, which would let
  --             confirm_gym_visit_v2 later credit a session at a gym she was
  --             never in. `is not distinct from` so a null/null pair still matches.
  if v_id is not null
     and v_status = 'open'
     and v_started_at > now() - c_reuse_window
     and v_partner_id is not distinct from p_partner_id
  then
    -- The reuse branch returns BEFORE the check_in insert below, so without this
    -- the event log has no record of the check-in at all — which is why 08-01
    -- showed a lone stream_tick and nothing else.
    insert into gym_visit_events (visit_id, user_id, event, detail)
    values (v_id, v_user, 'reused', jsonb_build_object(
      'region_id', p_region_id,
      'age_min',   round(extract(epoch from (now() - v_started_at)) / 60)
    ));
    return v_id;
  end if;

  -- Anything else live — a finished-but-never-exited visit (2026-07-15), or one
  -- now too old / at a different gym to be this check-in — is CLOSED so the beacon
  -- sees the NEW session. ended_at is bounded by the last location-proven presence.
  -- The `ended_at is null` predicate + `if found` keep a re-run from overwriting a
  -- close somebody else just made, or logging a second closed_stale row.
  if v_id is not null then
    update gym_visits
       set ended_at     = coalesce(last_confirmed_at, started_at),
           -- Terminal status + explicit cause. Previously this left 'claimed' /
           -- 'upgraded' in place, which is what made superseded rows invisible.
           status       = 'closed',
           close_reason = 'superseded_by_new_check_in'
     where id = v_id and ended_at is null;

    if found then
      insert into gym_visit_events (visit_id, user_id, event, detail)
      values (v_id, v_user, 'closed_stale', jsonb_build_object(
        'reason',         'superseded_by_new_check_in',
        'prior_status',   v_status,
        'age_min',        round(extract(epoch from (now() - v_started_at)) / 60),
        'partner_changed', (v_partner_id is distinct from p_partner_id)
      ));
    end if;
    v_id := null;
  end if;

  -- Bounded at two attempts, so this can never spin.
  for attempt in 1..2 loop
    insert into gym_visits (user_id, partner_id, region_id, started_at, platform)
    values (v_user, p_partner_id, p_region_id, coalesce(p_started_at, now()), p_platform)
    on conflict (user_id) where ended_at is null do nothing
    returning id into v_id;

    if v_id is not null then
      insert into gym_visit_events (visit_id, user_id, event, detail)
      values (v_id, v_user, 'check_in', jsonb_build_object('region_id', p_region_id));
      return v_id;
    end if;

    -- Only reachable from a writer that did not hold our lock: it now owns the
    -- one live slot. ADOPT its row rather than returning NULL — a NULL means the
    -- device has no visit id at all, so the beacon can never wake it, which is
    -- strictly worse than the duplicate this guards against. No check_in event
    -- here: the winner already logged one for that row. The predicate matches the
    -- INDEX predicate exactly (no status filter), so whatever occupies the slot
    -- is always found and the loop terminates.
    select id into v_id
      from gym_visits
     where user_id = v_user and ended_at is null
     order by started_at desc
     limit 1;

    if v_id is not null then return v_id; end if;
    -- The winner's row was closed in the gap; the slot is free again — retry once.
  end loop;

  raise exception 'open_gym_visit: could not open or adopt a live visit for %', v_user;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. confirm_gym_visit_v2 — resolve the visit when credit is DECLINED.
-- ---------------------------------------------------------------------------
-- This is what manufactures the permanently-open rows section 2 defends against.
-- When the day's gym session already carries an `earn` row, the function returned
-- {triggered: null} and left the visit `status='open'` forever. The client only
-- console.log()s that (lib/gymVisits.ts:60-63), so the beacon burned all 4 nudges
-- on a visit that could never be credited and then left the row open for the next
-- day's check-in to inherit. 10 visits in 30 days, ~40 wasted high-priority wakes.
--
-- Declining is CORRECT (idx_one_session_per_type_per_day allows one gym session per
-- UTC day) — it just has to be recorded. Advancing the status is also what unblocks
-- the upgrade stage, which keys on status='claimed': on 08-01 jamiemasonwright's
-- relay ran with p_visit_id = null, so his visit never reached 'claimed' and the
-- 40-min upgrade nudge was dead independently of the nudge cap.
create or replace function public.confirm_gym_visit_v2(
  p_visit_id       uuid,
  p_inside         boolean,
  p_detail         jsonb default '{}'::jsonb,
  p_request_credit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_visit gym_visits%rowtype;
  v_dwell_min int := 30;
  v_upgrade_min int := 40;
  v_elapsed_min numeric;
  v_session_id uuid;
  v_req bigint;
  v_triggered text := null;
  v_declined text := null;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_visit from gym_visits where id = p_visit_id and user_id = v_user;
  if not found then raise exception 'visit not found'; end if;

  update gym_visits
     set last_confirmed_at = case when p_inside then now() else last_confirmed_at end
   where id = p_visit_id and user_id = v_user;

  -- Written unconditionally, before any credit branch: this row is the ONLY proof
  -- that a silent wake reached the device's JS. Do not move it below a guard.
  insert into gym_visit_events (visit_id, user_id, event, detail)
  values (p_visit_id, v_user,
          case when p_inside then 'confirmed_inside' else 'confirmed_outside' end,
          coalesce(p_detail, '{}'::jsonb));

  if not (p_inside and p_request_credit) then
    return jsonb_build_object('triggered', null);
  end if;

  -- Same source of truth as the beacon and the edge functions.
  begin
    v_dwell_min := coalesce((select value from system_config where key = 'min_gym_dwell_minutes')::int, 30);
  exception when others then v_dwell_min := 30;
  end;
  begin
    v_upgrade_min := coalesce((select value from system_config where key = 'gym_upgrade_minutes')::int, 40);
  exception when others then v_upgrade_min := 40;
  end;

  v_elapsed_min := extract(epoch from (now() - v_visit.started_at)) / 60;

  if v_visit.status = 'open' and v_elapsed_min >= v_dwell_min then
    -- Resolve (or create) the session for this visit's UTC day. The client
    -- usually inserted it already; when it didn't, this row carries the visit's
    -- own server-side entry time, so the duration can't be inflated.
    select id into v_session_id
      from activity_sessions
     where user_id = v_user and type = 'gym' and verification = 'geofence'
       and date_trunc('day', started_at at time zone 'UTC') = date_trunc('day', v_visit.started_at at time zone 'UTC')
     order by started_at desc
     limit 1;

    if v_session_id is null then
      insert into activity_sessions
        (user_id, type, started_at, ended_at, duration_sec, verification, trust_score, partner_id, raw_gps)
      values
        (v_user, 'gym', v_visit.started_at, now(),
         least(extract(epoch from (now() - v_visit.started_at))::int, 12 * 60 * 60),
         'geofence', 0.94, v_visit.partner_id,
         jsonb_build_object(
           'partnerId', v_visit.partner_id,
           'entryTimestamp', (extract(epoch from v_visit.started_at) * 1000)::bigint,
           'createdBy', 'confirm_gym_visit_v2'))
      on conflict do nothing
      returning id into v_session_id;

      if v_session_id is null then
        -- Lost the race to the client's own insert — use theirs.
        select id into v_session_id
          from activity_sessions
         where user_id = v_user and type = 'gym' and verification = 'geofence'
           and date_trunc('day', started_at at time zone 'UTC') = date_trunc('day', v_visit.started_at at time zone 'UTC')
         order by started_at desc
         limit 1;
      end if;
    end if;

    if v_session_id is not null and not exists (
      select 1 from point_transactions where session_id = v_session_id and type = 'earn'
    ) then
      select net.http_post(
        url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/claim-points',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
        ),
        body := jsonb_build_object('session_id', v_session_id, 'user_id', v_user, 'visit_id', p_visit_id)
      ) into v_req;
      v_triggered := 'claim';

    elsif v_session_id is not null then
      -- Already claimed by another path (client dwell machine, exit, app-open).
      -- Advance the visit anyway: the claim is REAL, it just wasn't ours. Leaving
      -- it 'open' is what starved the upgrade stage and orphaned the row.
      v_declined := 'already_claimed';
      update gym_visits
         set status             = 'claimed',
             claimed_session_id = coalesce(claimed_session_id, v_session_id),
             claimed_at         = coalesce(claimed_at, now())
       where id = p_visit_id and user_id = v_user and status = 'open';
    end if;

  elsif v_visit.status = 'claimed' and v_elapsed_min >= v_upgrade_min then
    v_session_id := v_visit.claimed_session_id;
    if v_session_id is null then
      select id into v_session_id
        from activity_sessions
       where user_id = v_user and type = 'gym' and verification = 'geofence'
         and date_trunc('day', started_at at time zone 'UTC') = date_trunc('day', v_visit.started_at at time zone 'UTC')
       order by started_at desc
       limit 1;
    end if;

    if v_session_id is not null and not exists (
      select 1 from point_transactions
      where session_id = v_session_id and type = 'earn' and description like 'gym session upgrade%'
    ) then
      select net.http_post(
        url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/upgrade-gym-tier',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
        ),
        body := jsonb_build_object('session_id', v_session_id, 'user_id', v_user, 'visit_id', p_visit_id)
      ) into v_req;
      v_triggered := 'upgrade';

    elsif v_session_id is not null then
      -- Upgrade already paid (or the session was claimed at the 40-min tier
      -- outright, which is the common case for an exit claim scored off full
      -- duration). Nothing left to ask for — stop nudging this visit.
      v_declined := 'already_upgraded';
      update gym_visits
         set status      = 'upgraded',
             upgraded_at = coalesce(upgraded_at, now())
       where id = p_visit_id and user_id = v_user and status = 'claimed';
    end if;
  end if;

  if v_declined is not null then
    insert into gym_visit_events (visit_id, user_id, event, detail)
    values (p_visit_id, v_user, 'credit_declined', jsonb_build_object(
      'reason',      v_declined,
      'session_id',  v_session_id,
      'elapsed_min', round(v_elapsed_min)
    ));
  end if;

  return jsonb_build_object(
    'triggered',  v_triggered,
    'declined',   v_declined,
    'session_id', v_session_id,
    'request_id', v_req
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. close_gym_visit — only log an exit that actually happened.
-- ---------------------------------------------------------------------------
-- finalizeActiveGeofence has no re-entrancy guard (GeofenceContext.tsx:1249-1313:
-- it reads ACTIVE_GEOFENCE_KEY at :1252 and only removes it at :1283, and `await
-- getItem` alone yields the microtask queue), so every concurrent headless
-- invocation passes the `if (!raw) return true` gate. Visit 54b70cb6 logged 31
-- `exit` rows in 1.4 s. The UPDATE is already idempotent — it carries
-- `ended_at is null` — but the event insert was gated on OWNERSHIP rather than on
-- whether the update applied, so 30 of those 31 were phantom rows.
-- The client-side lease is the real fix; this stops the log lying meanwhile.
create or replace function public.close_gym_visit(
  p_visit_id uuid,
  p_ended_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_ended_at timestamptz := coalesce(p_ended_at, now());
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  update gym_visits
     set ended_at     = v_ended_at,
         status       = 'closed',
         close_reason = 'exit'
   where id = p_visit_id and user_id = v_user and ended_at is null;

  -- Only the call that actually closed the visit logs the exit. A loser in a
  -- concurrent burst is a silent no-op, not a second `exit` row.
  if found then
    insert into gym_visit_events (visit_id, user_id, event, detail)
    values (p_visit_id, v_user, 'exit', jsonb_build_object('ended_at', v_ended_at));
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. abandon cron — record the cause, leave the predicate alone.
-- ---------------------------------------------------------------------------
-- Deliberately NOT adding `and status = 'open'`: credited rows would then keep
-- ended_at null forever and permanently occupy the user's slot in
-- gym_visits_one_live_per_user_idx, which is a worse bug than a mislabelled status.
select cron.alter_job(
  8,
  command := $cron$
  update public.gym_visits
     set status = 'abandoned',
         close_reason = coalesce(close_reason, 'abandoned_12h'),
         ended_at = coalesce(ended_at, last_confirmed_at, started_at + interval '12 hours')
   where ended_at is null and started_at < now() - interval '12 hours'
  $cron$
);
