-- ============================================================================
-- Live Ops 2026-11-28: a witness gap cap, and two blind spots on the board
-- ============================================================================
--
-- WHAT WAS WRONG (morning Live Ops check, 2026-11-28)
--
-- 1. AN EXIT VOUCHED FOR 12 SILENT HOURS. close_gym_visit (20260906170000)
--    believes a device-presented exit on any visit with a proof clock, bounded
--    only by the 12 h backstop. Visit 14ab4b5b (ONE LDN, iOS): proven once at the
--    08:31 check-in, no push token so no wake could land, and the exit fence fired
--    at 20:26 236 m away — end_basis exit_witness, clamped:false, proof_gap_s
--    42,756. The session (42,902 s) passed the proof audit as fully proven
--    because gym_visit_end_witnessed_at counts the witness as proof.
--    60 days of exit_witness closes: honest stationary lifters sit at 45–90 min
--    of gap (wakes unanswered, phone in a locker) and the largest honest-looking
--    one is 167 min; the outliers are 493, 635 and 713 min — all iOS, all proven
--    only at check-in, all with a single nudge attempt.
--
-- 2. NO PUSH TOKEN WAS INVISIBLE. The wake-starved streak counts nudge_sent. With
--    no token the beacon writes ONE nudge_failed per stage and sends nothing, so
--    the streak stayed 0 and no badge fired for the 12 h.
--
-- 3. A STUCK APPROACH STREAM WAS INVISIBLE. After a reaper close, an Android
--    device kept its high-accuracy approach stream running for 15 h (fixed in the
--    client: expireStaleApproach). Nothing on the board could show it.
--
-- WHAT THIS DOES
--
-- • close_gym_visit: a witnessed end more than 3 h past the anchor (the last
--   proof or credit stamp) is capped at anchor + 3 h and written with
--   end_basis 'witness_gap_capped' — deliberately NOT an END_WITNESS_BASES value,
--   so claim-points' audit flags the session for review instead of passing it.
--   Never-drop-a-workout is untouched: nothing is un-awarded, only surfaced.
-- • gym_visit_end_witnessed_at: an exit_witness / capped_12h row whose own
--   proof_gap_s exceeds 3 h is not a witness. Judges closes written before this
--   migration by the same rule, without rewriting their evidence. Mirrors
--   WITNESS_MAX_GAP_SEC in supabase/functions/_shared/proofAudit.ts.
-- • admin_liveops_board / admin_liveops_visit: two new alert inputs,
--   wake_path_missing and approach_live_age_s (shared/liveops.ts renders
--   NO WAKE PATH and APPROACH STUCK). The board's return type grows, so it is
--   dropped and recreated; the drill-in is jsonb and only gains keys.
-- • Backfill: sessions from the last 90 days whose witness no longer counts and
--   whose claimed duration now exceeds proof by > 30 min are flagged
--   unproven_duration for /admin/sessions, with a proof_audit row each.
--
-- COMPATIBILITY. No signature change to close_gym_visit or the drill-in. The
-- board gains two trailing columns; the admin page types them optional, so the
-- page and this migration may land in either order.
--
-- Bodies built from the repo copies that match production
-- (20261125120000 close_gym_visit, 20260812170000 board, 20260905120000
-- drill-in) by anchored replacement, so nothing outside the hunks differs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. close_gym_visit: cap trust in a witness after 3 h of silence.
-- ---------------------------------------------------------------------------

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
  -- Longest stretch an exit fence may vouch for with no proof in between. See header.
  c_witness_max_gap constant interval := interval '3 hours';
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
    -- ⚠ WITNESS GAP CAP (2026-11-28). An exit fence proves when the phone NOTICED
    -- it was outside, not when the member left. After 3 h of silence it vouches
    -- for nothing: visit 14ab4b5b was proven once at 08:31 and witnessed at 20:26.
    -- Cap the end, and name the basis so the proof audit does not count it.
    if v_ended_at > v_anchor + c_witness_max_gap then
      v_ended_at  := v_anchor + c_witness_max_gap;
      v_end_basis := 'witness_gap_capped';
    end if;
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


-- ---------------------------------------------------------------------------
-- 2. The audit agrees: a witness past the gap cap is not a witness.
-- ---------------------------------------------------------------------------
create or replace function public.gym_visit_end_witnessed_at(p_visit_id uuid)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select (e.detail ->> 'ended_at')::timestamptz
    from gym_visit_events e
   where e.visit_id = p_visit_id
     and e.event = 'exit'
     and e.detail ->> 'end_basis' in ('exit_witness', 'capped_12h')
     -- Mirrors WITNESS_MAX_GAP_SEC in _shared/proofAudit.ts. Reads the exit row's
     -- own proof_gap_s, so closes written before this migration are judged by the
     -- same rule without rewriting their evidence.
     and coalesce(_gym_detail_num(e.detail, 'proof_gap_s'), 0) <= 10800
   order by e.created_at desc
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 3. Live Ops board + drill-in: WAKE PATH MISSING and APPROACH STUCK inputs.
--    The board's return type grows, so it is dropped and recreated.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_liveops_board(integer, boolean, integer);

create or replace function public.admin_liveops_board(
  p_window_hours  integer default 12,
  p_include_test  boolean default false,
  p_limit         integer default 100
)
returns table (
  visit_id                uuid,
  user_id                 uuid,
  username                text,
  display_name            text,
  email                   text,
  partner_id              uuid,
  venue_name              text,
  region_id               text,
  platform                text,
  status                  text,
  started_at              timestamptz,
  checked_in_at           timestamptz,
  announced_at            timestamptz,
  claimed_at              timestamptz,
  upgraded_at             timestamptz,
  ended_at                timestamptz,
  close_reason            text,
  last_proven_at          timestamptz,
  last_confirmed_at       timestamptz,
  completed_push_at       timestamptz,
  claimed_session_id      uuid,
  last_heard_at           timestamptz,
  last_heard_kind         text,
  unanswered_nudge_streak integer,
  undrawn_push_count      integer,
  dwell_minutes           integer,
  upgrade_minutes         integer,
  is_test                 boolean,
  wake_path_missing       boolean,
  approach_live_age_s     integer
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_excl_users    uuid[] := public.liveops_excluded_user_ids();
  v_excl_partners uuid[] := public.liveops_excluded_partner_ids();
  v_dwell         integer;
  v_upgrade       integer;
begin
  if not is_admin() then
    raise exception 'Access denied: admin only';
  end if;

  select t.dwell_minutes, t.upgrade_minutes into v_dwell, v_upgrade from public.liveops_thresholds() t;

  return query
    select
      v.id,
      v.user_id,
      p.username,
      p.display_name,
      u.email::text,
      v.partner_id,
      pt.name,
      v.region_id,
      v.platform,
      v.status,
      v.started_at,
      v.created_at,
      v.announced_at,
      v.claimed_at,
      v.upgraded_at,
      v.ended_at,
      v.close_reason,
      v.last_proven_at,
      v.last_confirmed_at,
      v.completed_push_at,
      v.claimed_session_id,
      heard.at,
      heard.kind,
      coalesce(nudge.streak, 0)::integer,
      coalesce(push.undrawn, 0)::integer,
      v_dwell,
      v_upgrade,
      (v.user_id = any(v_excl_users) or v.partner_id = any(v_excl_partners)),
      coalesce(wake.missing, false),
      appr.age_s
    from public.gym_visits v
    join public.profiles p on p.id = v.user_id
    join auth.users u      on u.id = v.user_id
    left join public.partners pt on pt.id = v.partner_id
    -- Proof of life, of any kind, from any table. Ordered union rather than
    -- greatest() so the WINNING source is named, not just the timestamp.
    left join lateral (
      select h.at, h.kind
      from (
        select max(e.created_at) as at, 'region event'::text as kind
          from public.geofence_region_events e where e.user_id = v.user_id
        union all
        select max(e.created_at), 'visit event'
          from public.gym_visit_events e where e.user_id = v.user_id
        union all
        select max(l.delivered_at), 'push displayed'
          from public.push_send_log l where l.user_id = v.user_id
        union all
        select max(t.updated_at), 'push token'
          from public.user_push_tokens t where t.user_id = v.user_id
      ) h
      where h.at is not null
      order by h.at desc
      limit 1
    ) heard on true
    -- How many of the most recent wake nudges got NO response from the device.
    -- A wake is answered when the device leaves a footprint after it: a sweep row
    -- (geofence_region_events) or a wake_received (gym_visit_events). Three in a
    -- row unanswered is the wake-starved-device signature — but the threshold
    -- itself is the client's call, so this returns the raw streak.
    left join lateral (
      select coalesce(min(x.rn) filter (where x.answered) - 1, count(*))::integer as streak
      from (
        select
          row_number() over (order by n.created_at desc) as rn,
          exists (
            select 1 from public.geofence_region_events g
            where g.user_id = v.user_id and g.event = 'sweep'
              and g.created_at > n.created_at
              and g.created_at < n.created_at + interval '5 minutes'
          ) or exists (
            select 1 from public.gym_visit_events w
            where w.visit_id = v.id and w.event = 'wake_received'
              and w.created_at > n.created_at
              and w.created_at < n.created_at + interval '5 minutes'
          ) as answered
        from public.gym_visit_events n
        where n.visit_id = v.id and n.event = 'nudge_sent'
        order by n.created_at desc
        limit 10
      ) x
    ) nudge on true
    -- Accepted by FCM, never stamped by the device, and old enough that a late
    -- receipt is no longer plausible: "sent, never drew". fence_refresh is the
    -- wake loop's own traffic and never draws a banner by design.
    left join lateral (
      select count(*)::integer as undrawn
      from public.push_send_log l
      where l.user_id = v.user_id
        and l.type <> 'fence_refresh'
        and l.status = 'accepted'
        and l.transport = 'fcm_direct'
        and l.delivered_at is null
        and l.created_at >= v.created_at - interval '5 minutes'
        and l.created_at <= coalesce(v.ended_at, now()) + interval '10 minutes'
        and l.created_at < now() - interval '5 minutes'
    ) push on true
    -- The beacon wanted to wake this device and there was nothing to wake: no push
    -- token. It logs nudge_failed ONCE per stage, so the unanswered streak above can
    -- never reach the wake-starved threshold for it — 14ab4b5b sat 12 h at streak 0.
    -- Cleared by any later nudge_sent (a token turned up).
    left join lateral (
      select true as missing
      from public.gym_visit_events f
      where f.visit_id = v.id and f.event = 'nudge_failed'
        and f.detail ->> 'reason' = 'no_tokens'
        and not exists (
          select 1 from public.gym_visit_events s
          where s.visit_id = v.id and s.event = 'nudge_sent' and s.created_at > f.created_at
        )
      limit 1
    ) wake on true
    -- The device is STILL reporting an escalated approach stream half an hour after
    -- this visit closed. approach_age_s rides every row the stream touches, so a
    -- recent one is proof the high-accuracy stream is running with nothing to check
    -- in to (8c6f02e6, 2026-11-28: 15 h).
    left join lateral (
      select max(_gym_detail_num(g.detail, 'approach_age_s'))::integer as age_s
      from public.geofence_region_events g
      where v.ended_at is not null
        and g.user_id = v.user_id
        and g.created_at > v.ended_at + interval '30 minutes'
        and g.created_at > now() - interval '30 minutes'
        and g.detail ? 'approach_age_s'
    ) appr on true
    where (v.ended_at is null or v.ended_at > now() - make_interval(hours => greatest(p_window_hours, 1)))
      and (p_include_test
           or (not (v.user_id = any(v_excl_users)) and not (v.partner_id = any(v_excl_partners))))
    order by (v.ended_at is null) desc, coalesce(v.ended_at, v.started_at) desc
    limit greatest(least(coalesce(p_limit, 100), 500), 1);
end;
$function$;


revoke all on function public.admin_liveops_board(integer, boolean, integer) from public, anon;
grant execute on function public.admin_liveops_board(integer, boolean, integer) to authenticated;

create or replace function public.admin_liveops_visit(
  p_visit_id    uuid,
  p_event_limit integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_visit   public.gym_visits%rowtype;
  v_limit   integer := greatest(least(coalesce(p_event_limit, 600), 2000), 50);
  v_from    timestamptz;
  v_to      timestamptz;
  v_total   integer;
  v_dwell   integer;
  v_upgrade integer;
  v_result  jsonb;
begin
  if not is_admin() then
    raise exception 'Access denied: admin only';
  end if;

  select * into v_visit from public.gym_visits where id = p_visit_id;
  if not found then
    return null;
  end if;

  select t.dwell_minutes, t.upgrade_minutes into v_dwell, v_upgrade from public.liveops_thresholds() t;

  -- Reach back before the visit was minted: the ENTER that started it, and the
  -- arm burst that preceded it, are the interesting part of a check-in failure.
  v_from := least(v_visit.started_at, v_visit.created_at) - interval '20 minutes';
  v_to   := coalesce(v_visit.ended_at, now()) + interval '15 minutes';

  select count(*)::integer into v_total
  from (
    select e.created_at from public.geofence_region_events e
      where e.user_id = v_visit.user_id and e.created_at between v_from and v_to
    union all
    select e.created_at from public.gym_visit_events e
      where e.visit_id = v_visit.id
  ) c;

  select jsonb_build_object(
    -- Enumerated, not to_jsonb(v_visit): the row carries wake_nonce_hash, which
    -- is a wake credential and has no business crossing to a client.
    'visit', jsonb_build_object(
        'id',                 v_visit.id,
        'user_id',            v_visit.user_id,
        'partner_id',         v_visit.partner_id,
        'region_id',          v_visit.region_id,
        'platform',           v_visit.platform,
        'status',             v_visit.status,
        'started_at',         v_visit.started_at,
        'checked_in_at',      v_visit.created_at,
        'announced_at',       v_visit.announced_at,
        'claimed_at',         v_visit.claimed_at,
        'upgraded_at',        v_visit.upgraded_at,
        'ended_at',           v_visit.ended_at,
        'close_reason',       v_visit.close_reason,
        'last_proven_at',     v_visit.last_proven_at,
        'last_confirmed_at',  v_visit.last_confirmed_at,
        'completed_push_at',  v_visit.completed_push_at,
        'claimed_session_id', v_visit.claimed_session_id,
        'nudge_count',        v_visit.nudge_count,
        'nudge_count_upgrade',v_visit.nudge_count_upgrade,
        'venue_name',    (select pt.name from public.partners pt where pt.id = v_visit.partner_id),
        'username',      (select p.username from public.profiles p where p.id = v_visit.user_id),
        'display_name',  (select p.display_name from public.profiles p where p.id = v_visit.user_id),
        'email',         (select u.email::text from auth.users u where u.id = v_visit.user_id),

        -- Alert inputs. visitAlerts() in shared/liveops.ts renders the SAME badges
        -- from a board row or from this document, so the document has to carry the
        -- same four fields the board's SELECT does. Without them the drawer printed
        -- "threshold undefinedm" and — worse, because nothing showed — dropped the
        -- WAKE STARVED and PUSH NEVER DREW badges entirely: `undefined >= 3` and
        -- `undefined > 0` are both false, so the alert simply never appeared on the
        -- one screen you open when a visit looks stuck.
        'dwell_minutes',   v_dwell,
        'upgrade_minutes', v_upgrade,
        -- Both derivations are copied VERBATIM from admin_liveops_board so the
        -- badge cannot say one thing on the board and another in the drawer.
        'unanswered_nudge_streak', coalesce((
          select coalesce(min(x.rn) filter (where x.answered) - 1, count(*))::integer
          from (
            select
              row_number() over (order by n.created_at desc) as rn,
              exists (
                select 1 from public.geofence_region_events g
                where g.user_id = v_visit.user_id and g.event = 'sweep'
                  and g.created_at > n.created_at
                  and g.created_at < n.created_at + interval '5 minutes'
              ) or exists (
                select 1 from public.gym_visit_events w
                where w.visit_id = v_visit.id and w.event = 'wake_received'
                  and w.created_at > n.created_at
                  and w.created_at < n.created_at + interval '5 minutes'
              ) as answered
            from public.gym_visit_events n
            where n.visit_id = v_visit.id and n.event = 'nudge_sent'
            order by n.created_at desc
            limit 10
          ) x
        ), 0),
        'wake_path_missing', exists (
          select 1
          from public.gym_visit_events f
          where f.visit_id = v_visit.id and f.event = 'nudge_failed'
            and f.detail ->> 'reason' = 'no_tokens'
            and not exists (
              select 1 from public.gym_visit_events s
              where s.visit_id = v_visit.id and s.event = 'nudge_sent' and s.created_at > f.created_at
            )
        ),
        'approach_live_age_s', (
          select max(_gym_detail_num(g.detail, 'approach_age_s'))::integer
          from public.geofence_region_events g
          where v_visit.ended_at is not null
            and g.user_id = v_visit.user_id
            and g.created_at > v_visit.ended_at + interval '30 minutes'
            and g.created_at > now() - interval '30 minutes'
            and g.detail ? 'approach_age_s'
        ),
        'undrawn_push_count', (
          select count(*)::integer
          from public.push_send_log l
          where l.user_id = v_visit.user_id
            and l.type <> 'fence_refresh'
            and l.status = 'accepted'
            and l.transport = 'fcm_direct'
            and l.delivered_at is null
            and l.created_at >= v_visit.created_at - interval '5 minutes'
            and l.created_at <= coalesce(v_visit.ended_at, now()) + interval '10 minutes'
            and l.created_at < now() - interval '5 minutes'
        )
      ),
    'thresholds', jsonb_build_object('dwell_minutes', v_dwell, 'upgrade_minutes', v_upgrade),

    -- The OS-delivered ENTER for this region that preceded the check-in, if the
    -- OS delivered one at all. Its absence is a finding, not a gap: on iOS the
    -- region crossing routinely never arrives and the check-in comes from the
    -- arm-time burst or a poll instead.
    'entered_at', (
      select min(e.created_at) from public.geofence_region_events e
      where e.user_id = v_visit.user_id and e.event = 'enter'
        and e.region_id = v_visit.region_id
        and e.created_at between v_from and coalesce(v_visit.created_at, now()) + interval '2 minutes'
    ),
    -- Which path actually produced the check-in. NULL 'via' is not "unknown
    -- because we failed to look" — the foreground check-in path logs no region
    -- event at all, so absence names it.
    'checkin_via', (
      select e.detail->>'via' from public.geofence_region_events e
      where e.user_id = v_visit.user_id and e.event = 'checked_in'
        and e.created_at between v_from and coalesce(v_visit.created_at, now()) + interval '5 minutes'
      order by e.created_at desc limit 1
    ),
    'exit_detected_at', (
      select max(e.created_at) from public.geofence_region_events e
      where e.user_id = v_visit.user_id and e.event = 'exit'
        and e.region_id = v_visit.region_id
        and v_visit.ended_at is not null
        and e.created_at between v_visit.created_at and v_visit.ended_at + interval '5 minutes'
    ),

    -- Device header. app_version / ota_update_id come from the push token because
    -- that is the row the device rewrites every launch — the closest thing we
    -- have to "what build is this human running right now".
    'device', (
      select to_jsonb(d) from (
        select
          t.platform, t.app_version, t.app_build, t.ota_update_id, t.ota_channel,
          t.updated_at as token_updated_at,
          (select t2.ota_update_id
             from public.user_push_tokens t2
            where t2.platform = t.platform
              and t2.ota_channel is not distinct from t.ota_channel
              and t2.ota_update_id is not null
            order by t2.updated_at desc limit 1) as newest_ota_on_channel
        from public.user_push_tokens t
        where t.user_id = v_visit.user_id
        order by t.updated_at desc nulls last
        limit 1
      ) d
    ),
    'last_heard', (
      select to_jsonb(h) from (
        select x.at, x.kind from (
          select max(e.created_at) as at, 'region event'::text as kind
            from public.geofence_region_events e where e.user_id = v_visit.user_id
          union all
          select max(e.created_at), 'visit event'
            from public.gym_visit_events e where e.user_id = v_visit.user_id
          union all
          select max(l.delivered_at), 'push displayed'
            from public.push_send_log l where l.user_id = v_visit.user_id
          union all
          select max(t.updated_at), 'push token'
            from public.user_push_tokens t where t.user_id = v_visit.user_id
        ) x
        where x.at is not null
        order by x.at desc limit 1
      ) h
    ),

    'events_total', v_total,
    'events_limit', v_limit,
    'events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at asc, e.src asc)
      from (
        select * from (
          select 'geo'::text as src, g.event, g.region_id, g.detail, g.created_at
            from public.geofence_region_events g
           where g.user_id = v_visit.user_id and g.created_at between v_from and v_to
          union all
          select 'visit', w.event, null, w.detail, w.created_at
            from public.gym_visit_events w
           where w.visit_id = v_visit.id
        ) u
        order by u.created_at desc
        limit v_limit
      ) e
    ), '[]'::jsonb),

    -- fence_refresh is excluded: it is the wake loop talking to itself, it never
    -- draws a banner, and at ~2.6k rows/30d it would bury every push that did.
    'pushes', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at asc)
      from (
        select l.id, l.type, l.title, l.status, l.skip_reason, l.error,
               l.transport, l.delivered_at, l.created_at
        from public.push_send_log l
        where l.user_id = v_visit.user_id
          and l.type <> 'fence_refresh'
          and l.created_at between v_from and v_to
        order by l.created_at asc
        limit 100
      ) l
    ), '[]'::jsonb),

    'session', (
      select to_jsonb(s) from (
        select a.id, a.type::text, a.started_at, a.ended_at, a.duration_sec,
               a.verification::text, a.trust_score, a.partner_id, a.flagged, a.flag_reason
        from public.activity_sessions a
        where a.id = v_visit.claimed_session_id
      ) s
    ),
    'points', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at asc)
      from (
        select pt.amount, pt.type::text, pt.description, pt.source, pt.created_at
        from public.point_transactions pt
        where pt.user_id = v_visit.user_id
          and pt.created_at between v_from and v_to
        order by pt.created_at asc
        limit 50
      ) t
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;


revoke all on function public.admin_liveops_visit(uuid, integer) from public, anon;
grant execute on function public.admin_liveops_visit(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Backfill: surface the sessions the old rule passed.
-- ---------------------------------------------------------------------------
with hit as (
  select a.id as session_id, v.id as visit_id, a.user_id,
         coalesce(a.duration_sec, 0) as duration_sec,
         public.gym_visit_proven_sec(v.id) as proven
    from public.gym_visits v
    join public.activity_sessions a on a.id = v.claimed_session_id
   where v.ended_at > now() - interval '90 days'
     and exists (
       select 1 from public.gym_visit_events e
        where e.visit_id = v.id and e.event = 'exit'
          and e.detail ->> 'end_basis' in ('exit_witness', 'capped_12h')
          and _gym_detail_num(e.detail, 'proof_gap_s') > 10800
     )
),
flagged as (
  update public.activity_sessions a
     set flagged     = true,
         flag_reason = case
           when coalesce(a.flag_reason, '') like '%unproven_duration%' then a.flag_reason
           else concat_ws(',', nullif(a.flag_reason, ''), 'unproven_duration')
         end
    from hit h
   where a.id = h.session_id
     and h.duration_sec - h.proven > 30 * 60
     and not (coalesce(a.flagged, false) and coalesce(a.flag_reason, '') like '%unproven_duration%')
  returning a.id, h.visit_id, a.user_id, h.duration_sec, h.proven
)
insert into public.gym_visit_events (visit_id, user_id, event, detail)
select f.visit_id, f.user_id, 'proof_audit', jsonb_build_object(
         'session_id',  f.id,
         'session_sec', f.duration_sec,
         'proven_sec',  f.proven,
         'flagged',     true,
         'backfill',    'witness_gap_cap_20261128')
  from flagged f;
