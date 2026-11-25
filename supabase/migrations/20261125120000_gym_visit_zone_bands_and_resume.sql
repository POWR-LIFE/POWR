-- ============================================================================
-- Gym visits: one distance rule, a "still here" stamp, and resuming a visit
-- (geofence review 2026-11-25, step 1)
-- ============================================================================
--
-- WHAT WAS WRONG
--
-- 1. THREE MEANINGS OF "INSIDE". Check-in used the radius. Proof used
--    radius + the fix's whole error bar, so a blurry fix proved presence from
--    further away than a sharp one. Leaving used radius + 50 m. Between the proof
--    bound and the exit bound a member could neither prove nor leave: the reaper
--    (which reads only last_proven_at) closed them after 20 quiet minutes and they
--    were told "Session complete" mid-workout. 12 of the 14 refused-but-present
--    answers in the 30 days to 11-25 were at ONE LDN (radius 30).
--
-- 2. A FALSE EXIT SPLIT A SESSION IN TWO. The re-entry minutes later was a brand
--    new visit with a clock at zero. 2026-11-16: 52 continuous minutes recorded as
--    24 + 15½, neither half reaching the 30-minute threshold.
--
-- 3. A COARSE SWEEP COULD CUT AN END TIME. close_gym_visit's `sweep_elsewhere`
--    contradiction read nearest_m with no accuracy test.
--
-- WHAT THIS DOES
--
-- • _gym_visit_band(distance, radius, accuracy) → inside | near | gone. The SQL
--   twin of lib/geofence/zone.ts venueBand. Bands meet with no gap.
-- • gym_visits.last_present_at — stamped by a fresh, trusted `inside` or `near`
--   answer. Never bills. The reaper (_shared/gymReaper.ts) reads the later of
--   last_proven_at and last_present_at for SILENCE, and still ends a closed
--   visit at last_proven_at.
-- • confirm_gym_visit_v2: proof uses the capped band; adds `near` and `band` to
--   the event detail. Credit gating is unchanged, character for character.
-- • open_gym_visit: on an explicit p_fix.resume_visit, re-opens that visit if an
--   exit closed it in the last 20 minutes, moving started_at forward by the time
--   away so the gap is never billed.
-- • close_gym_visit: sweep_elsewhere needs a trusted fix that is outside even
--   after its own error bar.
--
-- COMPATIBILITY. Additive for every app version in the field: no signature
-- changes; an app that sends no resume_visit and no `near` answers behaves
-- exactly as before, except that proof from a fix coarser than 30 m no longer
-- reaches past radius + 30. Apply BEFORE the app update that sends
-- resume_visit — against the old function, a resume request that lands within
-- two minutes of the closed visit's start would be answered with the closed id.
--
-- Built from the live bodies (pg_get_functiondef, 2026-11-25) by anchored
-- replacement, so nothing outside the hunks above differs from production.
-- ============================================================================

alter table public.gym_visits
  add column if not exists last_present_at timestamptz;

comment on column public.gym_visits.last_present_at is
  'Last fresh, trusted fix that placed the member inside or near the venue (zone band inside|near). Keeps a visit from being reaped as silent; never bills. Billing reads last_proven_at only.';

create or replace function public._gym_visit_band(p_distance numeric, p_radius numeric, p_accuracy numeric)
returns text
language sql
immutable
set search_path to 'public'
as $$
  -- Mirrors lib/geofence/zone.ts: PROOF_ACCURACY_CAP_M 30, NEAR_BAND_M 50,
  -- NEAR_ACCURACY_CAP_M 30. Change one, change both.
  select case
    when p_distance is null or p_radius is null then null
    when p_distance <= p_radius + least(greatest(coalesce(p_accuracy, 0), 0), 30) then 'inside'
    when p_distance <= p_radius + 50 + least(greatest(coalesce(p_accuracy, 0), 0), 30) then 'near'
    else 'gone'
  end
$$;

revoke all on function public._gym_visit_band(numeric, numeric, numeric) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.confirm_gym_visit_v2(p_visit_id uuid, p_inside boolean, p_detail jsonb DEFAULT '{}'::jsonb, p_request_credit boolean DEFAULT false, p_entry_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
  v_radius numeric;
  v_distance numeric;
  v_accuracy numeric;
  v_fix_age_s numeric;
  v_present boolean := false;
  v_near boolean := false;
  v_band text;
  v_proven boolean := false;
  v_proven_at timestamptz;
  v_stamped_at timestamptz;
  v_stamped boolean;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_visit from gym_visits where id = p_visit_id and user_id = v_user;
  if not found then raise exception 'visit not found'; end if;

  v_radius   := _gym_visit_radius_m(v_visit.partner_id, v_visit.region_id);
  v_distance := _gym_detail_num(v_detail, 'distance_m');
  v_accuracy := _gym_detail_num(v_detail, 'accuracy_m');
  v_fix_age_s := _gym_detail_num(v_detail, 'fix_age_s');

  -- GEOMETRY + TRUST, at ANY age. This says the venue sits inside the fix's own
  -- error bar — i.e. the device WAS there when the fix was taken. It says nothing
  -- about when that was. Mirrors fixCreditsPresence minus its age test; the 50 m
  -- hysteresis band is still NOT admitted (it damps oscillation, it does not
  -- describe where anybody is).
  -- ⚠ THE ERROR BAR IS CAPPED (2026-11-25). This read
  -- `v_distance <= v_radius + coalesce(v_accuracy, 0)` with no ceiling, so a
  -- blurry fix proved presence from further away than a sharp one could: a
  -- 5 m fix 37 m from a 30 m pin was refused while a 20 m fix at the same spot
  -- passed (ONE LDN, 2026-09-07). _gym_visit_band is the one rule, shared with
  -- the app (lib/geofence/zone.ts venueBand): inside | near | gone.
  v_band := _gym_visit_band(v_distance, v_radius, v_accuracy);
  v_present := p_inside
           and coalesce((v_detail ->> 'fix_trusted')::boolean, false)
           and v_band = 'inside';

  -- NEAR: at the venue, not provably inside the circle. It never bills and
  -- never touches last_proven_at; it stamps last_present_at so the reaper does
  -- not close a member who is answering every wake from the far end of the
  -- building. Fresh fixes only — a stale reading vouches for nothing.
  v_near := p_inside
        and coalesce((v_detail ->> 'fix_trusted')::boolean, false)
        and v_band in ('inside', 'near')
        and (v_fix_age_s is null or v_fix_age_s <= 120);

  -- FRESHNESS. Unchanged, character for character. It owns ESTABLISHING the proof
  -- clock — and that is ALL it owns.
  --
  -- ⚠ IT DOES NOT GATE CREDIT, AND IT NEVER DID. The plan this migration comes
  -- from says "keep the credit branch gated on v_proven (unchanged)", and that
  -- describes a protection the function has never had: the claim and upgrade
  -- branches below read only p_inside, p_request_credit, v_visit.status and
  -- v_elapsed_min. The client makes it worse — GeofenceContext passes plain
  -- geometric `inside` as request_credit, not the provenInside it computed from
  -- fixCreditsPresence — so a trusted-but-stale inside fix past 30 minutes fires
  -- the claim relay today and still will. Stated here because this migration adds
  -- a deliberately WEAKER sibling (v_present) beside v_proven, which is exactly
  -- the setup where someone relaxes the wrong one believing credit is covered.
  -- Wiring credit to v_proven would be a real behaviour change and is NOT in
  -- scope: it would start refusing claims on stale-but-inside fixes that pay
  -- today, which is the tightening that starved whole dwells on 07-03 / 07-11.
  v_proven := v_present
          and (v_fix_age_s is null or v_fix_age_s <= 120);

  -- WHEN THE FIX WAS ACTUALLY TAKEN.
  -- ⚠ The age is CLAMPED, not merely coalesced. v_fix_age_s is client-controlled
  -- and _gym_detail_num passes a large NUMBER straight through (it only swallows
  -- non-numeric garbage), and `now() - ('1e18 seconds')::interval` raises 22015 —
  -- which would abort the whole RPC and make the wake answer nothing at all,
  -- where today the same value merely evaluates the <= 120 test false.
  -- greatest(…,0) kills clock-skew negatives so this can never exceed now();
  -- least(…,86400) makes the interval un-overflowable; the double-precision
  -- multiply avoids numeric||text interval formatting entirely.
  v_proven_at := now() - (least(greatest(coalesce(v_fix_age_s, 0), 0), 86400)::double precision) * interval '1 second';

  -- ⚠ THE MONOTONIC MAX IS DONE AGAINST THE ROW, NOT AGAINST v_visit.
  -- v_visit was read above without FOR UPDATE, so a greatest() over that snapshot
  -- is a lost update: two concurrent confirms (routine — this run logged a sweep
  -- and a dwell confirm 1 ms apart at 19:08:03.573/.574) could regress the clock,
  -- where today's `= now()` is immune because now() is monotone across
  -- transactions. Referencing the columns inside the UPDATE holds the row lock.
  --
  -- Two arms, and the difference is the NULL invariant in the header:
  --   v_proven  — a FRESH fix may establish OR advance the clock.
  --   v_present — a STALE but inside fix may only ADVANCE one that already exists.
  --
  -- ⚠ ARM 1 CLAMPS TO started_at; IT MUST NOT REFUSE. A fix taken slightly BEFORE
  -- started_at is routine, not a corner case: open_gym_visit backdates started_at
  -- to the client's own entryTimestamp, while every rung of the fix ladder serves
  -- a fix taken before that detection moment — so a check-in confirm whose fix
  -- age exceeds its lag behind started_at lands on the wrong side of the floor.
  -- Refusing it would leave last_proven_at NULL for the whole visit, which is
  -- strictly WEAKER than the rule this replaces (`case when v_proven then now()`
  -- always established) and would disarm the settle pass on the one population it
  -- exists for. Real row: visit ef404719 — started_at 11:58:31.605, its ONE and
  -- ONLY confirmed_inside at 11:58:34.328 with fix_age_s 3, i.e. a fix time 277 ms
  -- before started_at. That visit's every point came through the settle pass after
  -- five unanswered nudges; refuse it and an 82-minute session closes zero-length
  -- and uncredited. Clamping is also what keeps arm 2 safe, since arm 2 has no
  -- floor of its own and relies on last_proven_at never sitting below started_at.
  --
  -- ended_at is null: proof columns describe a LIVE visit only (2026-08-13).
  update gym_visits
     set last_confirmed_at = case when p_inside then now() else last_confirmed_at end,
         last_present_at   = case
           when v_near then greatest(coalesce(last_present_at, started_at), greatest(v_proven_at, started_at))
           else last_present_at
         end,
         last_proven_at    = case
           when v_proven  and greatest(v_proven_at, started_at) >= coalesce(last_proven_at, started_at)
             then greatest(v_proven_at, started_at)
           when v_present and last_proven_at is not null and v_proven_at > last_proven_at
             then v_proven_at
           else last_proven_at
         end
   where id = p_visit_id and user_id = v_user and ended_at is null
  -- ⚠ `stamped` IS DERIVED IN THE RETURNING, NOT FROM v_visit. Comparing the
  -- result against the pre-UPDATE snapshot reports true for a call that LOST a
  -- concurrent race (its snapshot is stale, so the winner's value looks like its
  -- own) and would hand close_gym_visit the wrong proof_writer. Post-UPDATE the
  -- row is under this statement's lock, and it can only equal the value THIS call
  -- computed if one of the two arms fired for this call. Confirms 1 ms apart are
  -- routine — this run logged a sweep and a dwell confirm at 19:08:03.573/.574.
  returning last_proven_at,
            (last_proven_at = greatest(v_proven_at, started_at))
       into v_stamped_at, v_stamped;

  -- Written unconditionally, before any credit branch: the ONLY proof a silent wake
  -- reached the device's JS. Do not move it below a guard.
  --
  -- `proven` keeps its exact meaning — admin_liveops counts detail->>'proven' =
  -- 'true' (20260813160000_liveops_history_and_evidence.sql:86) and flipping it
  -- would silently rewrite that metric. `present`, `proven_at` and `stamped` are
  -- new and additive. `stamped` is the one close_gym_visit reads: it is the only
  -- filter that is correct in BOTH worlds, because a retrospective advance logs
  -- proven:false and `created_at = last_proven_at` stops holding the moment this
  -- migration lands. Server-built keys sit to the RIGHT of || so a lying client
  -- cannot forge them.
  insert into gym_visit_events (visit_id, user_id, event, detail)
  values (p_visit_id, v_user,
          case when p_inside then 'confirmed_inside' else 'confirmed_outside' end,
          v_detail || jsonb_build_object(
            'proven',    v_proven,
            'present',   v_present,
            'near',      v_near,
            'band',      v_band,
            'proven_at', case when v_present then v_proven_at end,
            'stamped',   coalesce(v_stamped, false),
            'radius_m',  v_radius));

  if not (p_inside and p_request_credit) then
    return jsonb_build_object('triggered', null);
  end if;

  begin
    v_dwell_min := coalesce((select value from system_config where key = 'min_gym_dwell_minutes')::int, 30);
  exception when others then v_dwell_min := 30;
  end;
  begin
    v_upgrade_min := coalesce((select value from system_config where key = 'gym_upgrade_minutes')::int, 40);
  exception when others then v_upgrade_min := 40;
  end;

  -- BOTH clocks must agree the threshold has passed. For older clients that send no
  -- p_entry_at, fall back to the visit row's started_at (legacy behaviour).
  v_elapsed_min := extract(epoch from (now() - v_visit.started_at)) / 60;
  if p_entry_at is not null then
    v_elapsed_min := least(
      v_elapsed_min,
      extract(epoch from (now() - p_entry_at)) / 60
    );
  end if;

  if v_visit.status = 'open' and v_elapsed_min >= v_dwell_min then
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
           'partnerName', (select name from partners where id = v_visit.partner_id),
           'entryTimestamp', (extract(epoch from v_visit.started_at) * 1000)::bigint,
           'createdBy', 'confirm_gym_visit_v2'))
      on conflict do nothing
      returning id into v_session_id;

      if v_session_id is null then
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

CREATE OR REPLACE FUNCTION public._open_gym_visit_stamp_fix(p_visit_id uuid, p_fix jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- resume_visit is routing for open_gym_visit, not part of the fix. A late
  -- open for a resumed session carries ONLY that key, and stamping an empty
  -- fix would write a confirmed_inside row that proves nothing.
  v_fix jsonb;
begin
  if p_fix is null or jsonb_typeof(p_fix) <> 'object' then return; end if;
  v_fix := p_fix - 'resume_visit';
  if v_fix = '{}'::jsonb then return; end if;
  perform confirm_gym_visit_v2(
    p_visit_id,
    true,
    v_fix || jsonb_build_object('stage', 'check_in', 'source', 'open'),
    false,
    null
  );
exception when others then
  raise warning 'open_gym_visit: check-in proof stamp failed for %: %', p_visit_id, sqlerrm;
end;
$function$;

CREATE OR REPLACE FUNCTION public.open_gym_visit(p_partner_id uuid, p_region_id text, p_started_at timestamp with time zone, p_platform text DEFAULT NULL::text, p_fix jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c_same_checkin constant interval := interval '5 minutes';
  c_reuse_window constant interval := interval '4 hours';
  c_replay_match constant interval := interval '2 minutes';
  c_max_backdate constant interval := interval '12 hours';
  -- A visit closed by an EXIT may be re-opened for this long. The app's own
  -- window is 15 minutes (lib/geofence/zone.ts RESUME_WINDOW_MS); the slack
  -- covers the second reading and a slow open.
  c_resume_window constant interval := interval '20 minutes';
  c_resume_slack  constant interval := interval '5 minutes';
  v_resume     uuid;
  v_prior      gym_visits%rowtype;
  v_new_start  timestamptz;
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

  -- ── RESUME (2026-11-25) ────────────────────────────────────────────────────
  -- A re-entry at the same venue minutes after an exit is the SAME visit. Field
  -- 2026-11-16: a continuous 52-minute session was recorded as 24 + 15½ minutes
  -- because the app closed it on a false exit — neither half reached the dwell
  -- threshold, so there was no check-in and no gym credit. 28 exit-closed visits
  -- were re-opened at the same partner within 20 minutes in the 60 days to 11-25.
  --
  -- Only on an EXPLICIT request. The app names the visit it is resuming
  -- (p_fix.resume_visit) and only its check-in path sets that, on a fresh inside
  -- fix. A bare open at an already-closed start is still the replay case below —
  -- re-opening on that would resurrect visits a late in-flight open happens to
  -- touch, which is the bug 20260810121000 closed.
  --
  -- ⚠ THE TIME AWAY IS NOT BILLED. started_at moves forward by the length of the
  -- gap, so the visit's age is leg one plus leg two. The server measures the gap
  -- itself (now − ended_at, less the slack) and takes whichever start is later,
  -- its own or the app's: a client cannot shorten its own absence.
  begin
    v_resume := nullif(p_fix ->> 'resume_visit', '')::uuid;
  exception when others then
    v_resume := null;
  end;

  if v_resume is not null then
    select * into v_prior
      from gym_visits
     where id = v_resume
       and user_id = v_user
       and partner_id is not distinct from p_partner_id
       and ended_at is not null
       and status = 'closed'
       and close_reason = 'exit'
       and ended_at > now() - c_resume_window
     for update;

    if found then
      -- Never past the claim: a visit cannot have been claimed before it began.
      -- An honest app is nowhere near this (the claim sits >= a dwell after the
      -- original start, the shift is at most the window); it only bounds a bad one.
      v_new_start := least(
        now(),
        coalesce(v_prior.claimed_at, now()),
        greatest(
          coalesce(p_started_at, now()),
          v_prior.started_at,
          v_prior.started_at + greatest(interval '0', (now() - v_prior.ended_at) - c_resume_slack)
        )
      );

      begin
        update gym_visits
           set ended_at          = null,
               close_reason      = null,
               status            = case
                 when upgraded_at is not null then 'upgraded'
                 when claimed_at  is not null then 'claimed'
                 else 'open'
               end,
               started_at        = v_new_start,
               -- The proof clock may never sit below started_at (confirm_gym_visit_v2
               -- relies on it). A proof at exactly the start bills nothing.
               last_proven_at    = case when last_proven_at  is null then null else greatest(last_proven_at,  v_new_start) end,
               last_present_at   = case when last_present_at is null then null else greatest(last_present_at, v_new_start) end,
               -- The first leg may already have said "Session complete". The real
               -- end deserves its own, with the real length.
               completed_push_at = null
         where id = v_resume and user_id = v_user and ended_at is not null;

        if found then
          insert into gym_visit_events (visit_id, user_id, event, detail)
          values (v_resume, v_user, 'resumed', jsonb_build_object(
            'region_id',        p_region_id,
            'prior_started_at', v_prior.started_at,
            'prior_ended_at',   v_prior.ended_at,
            'started_at',       v_new_start,
            'gap_s',            round(extract(epoch from (now() - v_prior.ended_at))),
            'shift_s',          round(extract(epoch from (v_new_start - v_prior.started_at))),
            'prior_status',     case
              when v_prior.upgraded_at is not null then 'upgraded'
              when v_prior.claimed_at  is not null then 'claimed'
              else 'open'
            end
          ));
          perform _open_gym_visit_stamp_fix(v_resume, p_fix);
          return v_resume;
        end if;
      exception when unique_violation then
        -- Another open won the one-live-visit slot between the supersede above
        -- and this update. Fall through: the normal path adopts that visit.
        null;
      end;
    end if;
  end if;

  if p_started_at is not null and p_started_at < now() - c_same_checkin then
    select id into v_closed_id
      from gym_visits
     where user_id = v_user
       and partner_id is not distinct from p_partner_id
       and ended_at is not null
       and started_at between p_started_at - c_replay_match
                          and p_started_at + c_replay_match
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
$function$;

CREATE OR REPLACE FUNCTION public.close_gym_visit(p_visit_id uuid, p_ended_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user      uuid := auth.uid();
  v_ended_at  timestamptz := least(coalesce(p_ended_at, now()), now());
  v_visit     gym_visits%rowtype;
  v_anchor    timestamptz;
  v_session   uuid;
  v_requested timestamptz;
  v_anchor_of text;
  v_writer    text;
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

  v_anchor := greatest(
    v_visit.started_at,
    coalesce(v_visit.last_proven_at, v_visit.started_at),
    coalesce(v_visit.claimed_at,     v_visit.started_at),
    coalesce(v_visit.upgraded_at,    v_visit.started_at)
  );
  v_requested := v_ended_at;

  v_anchor_of := case
    when v_visit.last_proven_at is not null and v_anchor = v_visit.last_proven_at then 'last_proven_at'
    when v_visit.upgraded_at    is not null and v_anchor = v_visit.upgraded_at    then 'upgraded_at'
    when v_visit.claimed_at     is not null and v_anchor = v_visit.claimed_at     then 'claimed_at'
    else 'started_at'
  end;

  v_witnessed := p_ended_at is not null
             and (v_visit.last_proven_at is not null or v_visit.claimed_at is not null);

  if v_witnessed then
    v_radius := coalesce(_gym_visit_radius_m(v_visit.partner_id, v_visit.region_id), 100);
    v_prefix := coalesce(left(v_visit.region_id, 36), v_visit.partner_id::text);

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
               -- ⚠ ACCURACY-GATED (2026-11-25). This compared nearest_m alone, so a
               -- coarse cell fix — routinely hundreds of metres out — could pull a
               -- real visit's end time earlier. The fix must be trusted, and must
               -- still be outside once its own error bar is taken off.
               and coalesce(_gym_detail_num(r.detail, 'acc_m'), 1e9) <= 100
               and coalesce(_gym_detail_num(r.detail, 'nearest_m'), 0)
                     - coalesce(_gym_detail_num(r.detail, 'acc_m'), 0) > v_radius + 50
               and r.created_at > v_anchor
               and r.created_at <= v_requested
          ) x
      ) y;

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

  if found then
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
$function$;

-- Grants are unchanged by CREATE OR REPLACE; restated so this file stands alone.
revoke all on function public._open_gym_visit_stamp_fix(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.open_gym_visit(uuid, text, timestamptz, text, jsonb) from public, anon;
grant execute on function public.open_gym_visit(uuid, text, timestamptz, text, jsonb) to authenticated;
