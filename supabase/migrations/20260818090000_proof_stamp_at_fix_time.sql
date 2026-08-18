-- The proof clock stamped WHEN WE ASKED, not when you were there (2026-08-17 PM).
--
-- Field run 2026-08-17 PM, visits f2a43f1b (iOS) / 9346e8d2 (Android). Both
-- platforms completed the full unaided chain, both closed themselves with
-- reason=exit, and both under-recorded: iOS 44.8 min against ~54.8 elapsed,
-- Android 40.2 against ~47.3. close_gym_visit clamps ended_at to a proof clock
-- that had stopped ticking, so every minute past the last stamp is unbilled.
--
-- THE STRUCTURAL CAUSE. `last_proven_at = now()` conflates WHEN WE PROVED IT with
-- WHEN YOU WERE THERE. To stop that being a lie, the stamp refuses any fix older
-- than 120 s — so a fix is either banked at the wrong time or discarded entirely,
-- and there is no third option. A fix taken at 19:06:53 and delivered at 19:11:06
-- proves presence AT 19:06:53. Today it proves nothing at all.
--
-- The rule below is RETROSPECTIVE: a trusted, geometrically-inside fix advances
-- the clock to the FIX'S OWN timestamp, never to now(). That is strictly safer
-- than today — the anchor can only ever move EARLIER than now() — and it
-- dissolves the 2026-08-10 regression rather than working around it: the 219 s
-- precise-but-stale fix that stamped proof four minutes after departure would
-- now stamp 19:06:xx and bill zero phantom minutes instead of four.
--
-- ⚠ THE NULL INVARIANT IS LOAD-BEARING AND IS DELIBERATELY NOT RELAXED.
-- gym-visit-beacon's SETTLE pass gates on `if (!v.last_proven_at) continue;`
-- (index.ts:1168) — a NULL clock is the ONLY thing standing between a visit that
-- never proved anything and full server-side credit, and that pass bills
-- started_at → now(), NOT to the proof time. So the freshness gate still owns
-- ESTABLISHING the clock; the retrospective rule only ever ADVANCES a clock a
-- fresh fix already started. A visit whose every fix was stale-but-inside gets
-- exactly what it gets today: nothing. Verified against the live settle body
-- before writing this, not assumed.
--
-- Also here (one migration, because they are coupled): close_gym_visit gains the
-- instrumentation that says how much was lost and which writer last worked.
-- proof_writer keys off the `stamped` flag this function starts emitting, so the
-- two changes cannot be split — see the note on that lookup below.

create or replace function public.confirm_gym_visit_v2(p_visit_id uuid, p_inside boolean, p_detail jsonb default '{}'::jsonb, p_request_credit boolean default false, p_entry_at timestamp with time zone default null)
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
  v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
  v_radius numeric;
  v_distance numeric;
  v_accuracy numeric;
  v_fix_age_s numeric;
  v_present boolean := false;
  v_proven boolean := false;
  v_proven_at timestamptz;
  v_stamped_at timestamptz;
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
  v_present := p_inside
           and coalesce((v_detail ->> 'fix_trusted')::boolean, false)
           and v_distance is not null
           and v_distance <= v_radius + coalesce(v_accuracy, 0);

  -- FRESHNESS. Unchanged, character for character, and it still gates CREDIT
  -- (both branches below) and still owns ESTABLISHING the proof clock.
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
  -- ended_at is null: proof columns describe a LIVE visit only (2026-08-13).
  update gym_visits
     set last_confirmed_at = case when p_inside then now() else last_confirmed_at end,
         last_proven_at    = case
           when v_proven  and v_proven_at >= greatest(coalesce(last_proven_at, started_at), started_at)
             then v_proven_at
           when v_present and last_proven_at is not null and v_proven_at > last_proven_at
             then v_proven_at
           else last_proven_at
         end
   where id = p_visit_id and user_id = v_user and ended_at is null
  returning last_proven_at into v_stamped_at;

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
            'proven_at', case when v_present then v_proven_at end,
            'stamped',   v_stamped_at is not null and v_stamped_at is distinct from v_visit.last_proven_at,
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


-- close_gym_visit: say how much was lost, and which writer last worked.
--
-- `clamped: true` today does not say how much time it cost or which proof writer
-- was the last one to work. Both are the acceptance criteria for the next field
-- run, and the last-14-day picture says the two populations need separating: of
-- 26 clamped exits, only 4 anchored on last_proven_at. 20 (all iOS) had a NULL
-- proof clock and clamped to started_at, and the eight largest of those have ZERO
-- confirmed_inside rows on the visit — no retrospective stamp can act on a
-- confirm that never arrived. clamp_anchor is what tells those apart.
--
-- Three numbers, deliberately, because they are three different quantities:
--   proof_gap_s  — proof STALENESS: requested end minus the proof clock. NULL when
--                  the device never proved anything (which is itself the finding).
--   clamp_loss_s — minutes actually NOT BILLED: requested end minus stored end.
--                  On 2026-08-17 these differ (iOS 604/604, Android 426/425)
--                  because Android's clamp landed on upgraded_at, not on proof.
--   clamp_anchor — which of the four columns won the greatest().
-- The "under 300 s" target belongs to clamp_loss_s: it is the one that means
-- "time we failed to bill".

create or replace function public.close_gym_visit(p_visit_id uuid, p_ended_at timestamp with time zone default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user      uuid := auth.uid();
  v_ended_at  timestamptz := least(coalesce(p_ended_at, now()), now());
  v_visit     gym_visits%rowtype;
  v_anchor    timestamptz;
  v_session   uuid;
  v_requested timestamptz;
  v_anchor_of text;
  v_writer    text;
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
  -- Capture the REQUEST before the clamp overwrites it. Use this, never raw
  -- p_ended_at: p_ended_at is NULL whenever the client passes no explicit end
  -- (lib/gymVisits.ts), and it is uncapped, so a device with a fast clock would
  -- report an inflated gap.
  v_requested := v_ended_at;
  v_ended_at := greatest(v_visit.started_at, least(v_ended_at, v_anchor));

  v_anchor_of := case
    when v_visit.last_proven_at is not null and v_anchor = v_visit.last_proven_at then 'last_proven_at'
    when v_visit.upgraded_at    is not null and v_anchor = v_visit.upgraded_at    then 'upgraded_at'
    when v_visit.claimed_at     is not null and v_anchor = v_visit.claimed_at     then 'claimed_at'
    else 'started_at'
  end;

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
      'proof_writer',       v_writer));

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
$function$;
