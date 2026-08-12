-- ---------------------------------------------------------------------------
-- Admin Live Ops — the e2e geofence watcher (scripts/e2e-watch.sh) as server-side
-- RPCs, so a founder can follow the gym-visit earn chain from the app instead of
-- a laptop and a bash script.
--
-- THREE FUNCTIONS, ONE UNIT OF DISPLAY: the VISIT JOURNEY.
--   admin_liveops_board       — who is in a gym right now (+ recently closed)
--   admin_liveops_visit       — one visit's timeline, device header, pushes, points
--   admin_liveops_aggregates  — did the last fix move the needle, across real users
--
-- ⚠ WHY THESE ARE RPCs AND NOT CLIENT SELECTS
-- Every table below is location data — the most sensitive thing we hold — and
-- RLS-only scoping has leaked cross-user rows before (the 14-site sweep). The
-- admin read policies on gym_visit_events / geofence_region_events / push_send_log
-- make a bare `select *` from an admin's client return EVERY user's rows, and one
-- forgotten .eq('user_id', …) is all it takes. So: nothing here is reachable
-- without is_admin() proven server-side, on every call.
--
-- ⚠ PostgREST caps EVERY response at 1000 rows. All counting/percentile work
-- happens in SQL. The board takes an explicit limit; the timeline caps its event
-- feed and reports the cap it hit rather than silently truncating.
--
-- WHAT IS DELIBERATELY *NOT* HERE: the interpretation rules that turn these facts
-- into badges (stuck, wake-starved, sent-but-never-drew, arm-burst collapse) live
-- in lib/liveops.ts as pure functions with jest coverage. SQL returns facts;
-- judgement is testable TypeScript.
-- ---------------------------------------------------------------------------

-- The time-range aggregates scan geofence_region_events by created_at across all
-- users; the only existing indexes lead with user_id, so without this every
-- window scan reads the whole table.
create index if not exists geofence_region_events_time_idx
  on public.geofence_region_events (created_at desc);

-- ── Dev/test contamination ─────────────────────────────────────────────────
-- These accounts run every field test, at a venue nobody else uses. Leaving them
-- in makes p90s meaningless: a single deliberate walk-out/walk-back-in loop can
-- outnumber a day of real visits. Excluded by DEFAULT everywhere, with an
-- include-test toggle for when the field test IS the thing being watched.
--
-- Plus-addressing is stripped: bluegigsolutions+bluegig@gmail.com is the same
-- human as bluegigsolutions@gmail.com and taints the same statistics.
-- Not granted to authenticated: it is only ever called from inside the definer
-- functions below, which run as the owner.
create or replace function public.liveops_excluded_user_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(u.id), '{}'::uuid[])
  from auth.users u
  where split_part(split_part(lower(u.email), '@', 1), '+', 1)
        in ('jamiemasonwright', 'bluegigsolutions')
$function$;

revoke all on function public.liveops_excluded_user_ids() from public, anon, authenticated;

-- The POWR office. Its geofence is armed on every dev device and fires on people
-- arriving at work, not at a gym.
create or replace function public.liveops_excluded_partner_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(p.id), '{}'::uuid[])
  from public.partners p
  where p.id::text like '7d865c3b%'
$function$;

revoke all on function public.liveops_excluded_partner_ids() from public, anon, authenticated;

-- The dwell/upgrade thresholds the SERVER actually gates on (system_config,
-- admin-tunable — see lib/gymDwellConfig.ts). Read rather than hardcoded so the
-- "+Δ vs threshold" numbers stay true after someone moves the dial.
create or replace function public.liveops_thresholds()
returns table (dwell_minutes integer, upgrade_minutes integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    coalesce(nullif(regexp_replace((select c.value from public.system_config c where c.key = 'min_gym_dwell_minutes'), '\D', '', 'g'), '')::int, 30),
    coalesce(nullif(regexp_replace((select c.value from public.system_config c where c.key = 'gym_upgrade_minutes'),   '\D', '', 'g'), '')::int, 40)
$function$;

revoke all on function public.liveops_thresholds() from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. LIVE BOARD — "who is in a gym right now"
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Open visits first (there is at most one live visit per user — see
-- gym_visits_one_live_per_user_idx), then visits closed inside the window so a
-- journey stays on screen long enough to read after it ends.
--
-- last_heard_at answers the one question an event gap CANNOT: an absence of rows
-- means either "the app is dead" or "the user went nowhere", and nothing in the
-- data separates them. So we never imply either — we report the most recent sign
-- of life of ANY kind (region event, visit event, push the device stamped,
-- push-token refresh) and name which one it was.
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
  is_test                 boolean
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
      (v.user_id = any(v_excl_users) or v.partner_id = any(v_excl_partners))
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
    where (v.ended_at is null or v.ended_at > now() - make_interval(hours => greatest(p_window_hours, 1)))
      and (p_include_test
           or (not (v.user_id = any(v_excl_users)) and not (v.partner_id = any(v_excl_partners))))
    order by (v.ended_at is null) desc, coalesce(v.ended_at, v.started_at) desc
    limit greatest(least(coalesce(p_limit, 100), 500), 1);
end;
$function$;

revoke all on function public.admin_liveops_board(integer, boolean, integer) from public, anon;
grant execute on function public.admin_liveops_board(integer, boolean, integer) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. VISIT DRILL-IN — one journey, end to end
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Returns ONE jsonb document rather than a table because the caller needs six
-- differently-shaped things at once and PostgREST would otherwise need six
-- round trips (each with its own 1000-row cap) to assemble one screen.
--
-- The event feed is raw ON PURPOSE. Arming registers ~50 regions and the OS
-- reports initial state for all of them — ~230 rows in 14 seconds. Collapsing
-- that server-side would bake one interpretation into the data; the client
-- collapses it (collapseArmBursts in lib/liveops.ts) where the rule is tested and
-- the raw rows are still one toggle away.
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
        'email',         (select u.email::text from auth.users u where u.id = v_visit.user_id)
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


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. AGGREGATES — did the last fix move the needle?
-- ═══════════════════════════════════════════════════════════════════════════
--
-- One jsonb document per window. Everything is counted and percentiled IN SQL —
-- "select the rows and count them in the client" would silently stop at 1000
-- rows, and geofence_region_events alone runs ~25k rows/30d.
--
-- ⚠ Sessions of 12h+ are late-write artifacts (a duration that grew after the
-- fact), not 12-hour gym visits. They are excluded from every delta so one of
-- them cannot drag a p90 into nonsense.
create or replace function public.admin_liveops_aggregates(
  p_from         timestamptz,
  p_to           timestamptz default now(),
  p_include_test boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_excl_users    uuid[] := public.liveops_excluded_user_ids();
  v_excl_partners uuid[] := public.liveops_excluded_partner_ids();
  v_dwell         integer;
  v_upgrade       integer;
  v_result        jsonb;
begin
  if not is_admin() then
    raise exception 'Access denied: admin only';
  end if;

  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'Invalid window';
  end if;

  select t.dwell_minutes, t.upgrade_minutes into v_dwell, v_upgrade from public.liveops_thresholds() t;

  with visits as (
    select v.*
    from public.gym_visits v
    where v.created_at >= p_from and v.created_at < p_to
      and (p_include_test
           or (not (v.user_id = any(v_excl_users)) and not (v.partner_id = any(v_excl_partners))))
  ),
  -- The 12h rule. Applied to the VISIT span as well as the session duration:
  -- an abandoned_12h close is the same artifact seen from the other side.
  sane as (
    select v.* from visits v
    where coalesce(v.ended_at, now()) - v.started_at < interval '12 hours'
  ),
  -- Every stage delta as (key, seconds), so one percentile pass covers them all.
  deltas as (
    select 'enter_to_checkin' as key, extract(epoch from (v.created_at - g.at)) as secs
      from sane v
      join lateral (
        select min(e.created_at) as at from public.geofence_region_events e
        where e.user_id = v.user_id and e.event = 'enter' and e.region_id = v.region_id
          and e.created_at between v.created_at - interval '20 minutes' and v.created_at
      ) g on g.at is not null
    union all
    select 'checkin_to_claim', extract(epoch from (v.claimed_at - v.started_at))
      from sane v where v.claimed_at is not null
    union all
    select 'claim_to_upgrade', extract(epoch from (v.upgraded_at - v.claimed_at))
      from sane v where v.upgraded_at is not null and v.claimed_at is not null
    union all
    select 'exit_to_close', extract(epoch from (v.ended_at - g.at))
      from sane v
      join lateral (
        select max(e.created_at) as at from public.geofence_region_events e
        where e.user_id = v.user_id and e.event = 'exit' and e.region_id = v.region_id
          and e.created_at between v.created_at and v.ended_at
      ) g on g.at is not null
      where v.ended_at is not null
    union all
    select 'close_to_push_sent', extract(epoch from (v.completed_push_at - v.ended_at))
      from sane v where v.completed_push_at is not null and v.ended_at is not null
    union all
    -- The headline: door to the banner actually drawing on the device. Uses
    -- delivered_at, not 'accepted' — accepted only proves FCM/APNs took it.
    select 'door_to_notification', extract(epoch from (l.delivered_at - v.started_at))
      from sane v
      join lateral (
        select min(pl.delivered_at) as delivered_at from public.push_send_log pl
        where pl.user_id = v.user_id and pl.type = 'gym_session_complete'
          and pl.delivered_at is not null
          and pl.created_at between v.created_at and coalesce(v.ended_at, now()) + interval '30 minutes'
      ) l on l.delivered_at is not null
    union all
    select 'push_sent_to_drawn', extract(epoch from (l.delivered_at - l.created_at))
      from public.push_send_log l
      where l.created_at >= p_from and l.created_at < p_to
        and l.type <> 'fence_refresh' and l.delivered_at is not null
        and (p_include_test or not (l.user_id = any(v_excl_users)))
  ),
  delta_stats as (
    select
      d.key,
      count(*)::integer as n,
      round(percentile_cont(0.5) within group (order by d.secs)::numeric, 1) as p50_s,
      round(percentile_cont(0.9) within group (order by d.secs)::numeric, 1) as p90_s
    from deltas d
    where d.secs is not null and d.secs >= 0
    group by d.key
  ),
  -- Display rate. 'accepted' means the platform took it; delivered_at means the
  -- device drew it. The gap between those two columns is the whole point.
  push_rows as (
    select l.*
    from public.push_send_log l
    where l.created_at >= p_from and l.created_at < p_to
      and l.type <> 'fence_refresh'
      and (p_include_test or not (l.user_id = any(v_excl_users)))
  ),
  push_stats as (
    select
      r.type,
      coalesce(r.transport, 'unknown') as transport,
      count(*)::integer as sent,
      count(*) filter (where r.status = 'accepted')::integer as accepted,
      count(*) filter (where r.delivered_at is not null)::integer as drawn,
      -- NOT called "never drew": only the fcm_direct display path stamps
      -- delivered_at at all, so an unstamped Expo-transport row means "we cannot
      -- know", not "the banner failed". Grouped by transport so the caller can
      -- apply that distinction (pushVerdict in lib/liveops.ts) instead of the
      -- aggregate quietly asserting it.
      count(*) filter (where r.status = 'accepted' and r.delivered_at is null
                         and r.created_at < now() - interval '5 minutes')::integer as accepted_no_receipt
    from push_rows r
    group by 1, 2
  ),
  -- Which path produced each check-in. A visit with no 'checked_in' region event
  -- was checked in from a foreground context, which logs none — so the NULL
  -- bucket is named 'foreground_or_unlogged', never 'unknown'.
  checkin_paths as (
    select coalesce(pth.via, 'foreground_or_unlogged') as path, count(*)::integer as n
    from visits v
    left join lateral (
      select e.detail->>'via' as via from public.geofence_region_events e
      where e.user_id = v.user_id and e.event = 'checked_in'
        and e.created_at between v.created_at - interval '20 minutes' and v.created_at + interval '5 minutes'
      order by e.created_at desc limit 1
    ) pth on true
    group by 1
  ),
  -- Did the OS deliver a region crossing at all, or did the check-in come from
  -- the arm-time burst / a poll? (iOS routinely never delivers one.)
  native_enter as (
    select count(*) filter (where seen) ::integer as with_enter,
           count(*) filter (where not seen)::integer as without_enter
    from (
      select exists (
        select 1 from public.geofence_region_events e
        where e.user_id = v.user_id and e.event = 'enter' and e.region_id = v.region_id
          and e.created_at between v.created_at - interval '20 minutes' and v.created_at
      ) as seen
      from visits v
    ) s
  ),
  geo as (
    select e.event, e.detail->>'outcome' as outcome, count(*)::integer as n
    from public.geofence_region_events e
    where e.created_at >= p_from and e.created_at < p_to
      and (p_include_test or not (e.user_id = any(v_excl_users)))
    group by 1, 2
  )
  select jsonb_build_object(
    'window', jsonb_build_object('from', p_from, 'to', p_to, 'include_test', p_include_test),
    'thresholds', jsonb_build_object('dwell_minutes', v_dwell, 'upgrade_minutes', v_upgrade),
    'visits', (
      select jsonb_build_object(
        'total',            count(*),
        'claimed',          count(*) filter (where v.claimed_at is not null),
        'upgraded',         count(*) filter (where v.upgraded_at is not null),
        'still_open',       count(*) filter (where v.ended_at is null),
        'closed_by_exit',   count(*) filter (where v.close_reason = 'exit'),
        'excluded_over_12h',count(*) filter (where coalesce(v.ended_at, now()) - v.started_at >= interval '12 hours')
      ) from visits v
    ),
    'deltas', coalesce((select jsonb_agg(to_jsonb(s) order by s.key) from delta_stats s), '[]'::jsonb),
    'push',   coalesce((select jsonb_agg(to_jsonb(s) order by s.sent desc) from push_stats s), '[]'::jsonb),
    'close_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('reason', r.reason, 'n', r.n) order by r.n desc)
      from (
        select coalesce(v.close_reason, case when v.ended_at is null then 'still_open' else 'closed_no_reason' end) as reason,
               count(*)::integer as n
        from visits v group by 1
      ) r
    ), '[]'::jsonb),
    'checkin_paths', coalesce((
      select jsonb_agg(jsonb_build_object('path', c.path, 'n', c.n) order by c.n desc) from checkin_paths c
    ), '[]'::jsonb),
    'native_enter', (select to_jsonb(n) from native_enter n),
    'counters', (
      select jsonb_build_object(
        'exit_refuted',            coalesce(sum(g.n) filter (where g.event = 'exit_refuted'), 0),
        'coarse_rejected',         coalesce(sum(g.n) filter (where g.event = 'coarse_rejected'), 0),
        'wake_starved_self_poll',  coalesce(sum(g.n) filter (where g.outcome = 'wake_starved_self_poll'), 0),
        'sweep_no_permission',     coalesce(sum(g.n) filter (where g.outcome = 'no_permission'), 0),
        'sweep_handoff',           coalesce(sum(g.n) filter (where g.outcome = 'handoff'), 0),
        'sweep_session_active',    coalesce(sum(g.n) filter (where g.outcome = 'session_active'), 0),
        'auth_stale',              coalesce(sum(g.n) filter (where g.event = 'auth_stale'), 0),
        'stream_start_failed',     coalesce(sum(g.n) filter (where g.event = 'stream_start_failed'), 0),
        'sentinel_exit',           coalesce(sum(g.n) filter (where g.event = 'sentinel_exit'), 0)
      ) from geo g
    ),
    'nudges', (
      select jsonb_build_object(
        'sent',   count(*) filter (where e.event = 'nudge_sent'),
        'failed', count(*) filter (where e.event = 'nudge_failed')
      )
      from public.gym_visit_events e
      where e.created_at >= p_from and e.created_at < p_to
        and (p_include_test or not (e.user_id = any(v_excl_users)))
    )
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.admin_liveops_aggregates(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.admin_liveops_aggregates(timestamptz, timestamptz, boolean) to authenticated;
