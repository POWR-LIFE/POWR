-- Live Ops history: honest evidence flags + searchable journeys (2026-08-13).
--
-- ═══ PART 1: evidence_complete ═════════════════════════════════════════════
--
-- The first backfill exposed the oldest trap in this codebase. 98 of 167
-- journeys came back with native_enter_at NULL and checkin_via NULL — which
-- reads as "the OS never delivered the crossing", the single most damning
-- finding on the board. It is not true. Those visits predate 2026-08-03, and
-- geofence_region_events only retains rows from then: the evidence was PURGED,
-- not absent. Rolled up naively, the permanent record would have asserted a
-- 100% OS-enter failure rate for July, forever, from data we never had.
--
-- "An absence that means two different things is not evidence of either" is
-- already written into gym-visit-beacon's fence_refresh logging for exactly this
-- reason. So the journey records whether the raw evidence window was actually
-- covered when it was rolled up. Trend queries filter on it; the UI labels an
-- uncovered journey "evidence expired" rather than scoring it as a failure.
--
-- It ORs on update, never overwrites: a journey captured while its raw rows
-- were alive stays complete forever, even though re-rolling it after the purge
-- would now compute false.

alter table public.gym_visit_journeys
  add column if not exists evidence_complete boolean not null default false;

comment on column public.gym_visit_journeys.evidence_complete is
  'True when geofence_region_events still covered this visit''s window at rollup time. False = derived nulls mean "we cannot know", NOT "it did not happen".';

create or replace function public.rollup_gym_visit_journey(p_visit_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v          public.gym_visits%rowtype;
  v_from     timestamptz;
  v_to       timestamptz;
  v_excl_u   uuid[] := public.liveops_excluded_user_ids();
  v_excl_p   uuid[] := public.liveops_excluded_partner_ids();
  v_geo_from timestamptz;
begin
  select * into v from public.gym_visits where id = p_visit_id;
  if not found then return; end if;

  v_from := least(v.started_at, v.created_at) - interval '20 minutes';
  v_to   := coalesce(v.ended_at, now()) + interval '10 minutes';
  -- The oldest surviving raw row. If the visit's evidence window opens before
  -- it, every derivation below is "unknown", not "did not happen".
  select min(e.created_at) into v_geo_from from public.geofence_region_events e;

  insert into public.gym_visit_journeys as j (
    visit_id, user_id, partner_id, region_id, platform, is_test,
    started_at, checked_in_at, announced_at, claimed_at, upgraded_at, ended_at,
    close_reason, last_proven_at, completed_push_at, claimed_session_id,
    native_enter_at, checkin_via, exit_detected_at, evidence_complete,
    nudge_count, nudge_count_upgrade, wakes_received, confirms_inside, proofs, settled_stages,
    pushes_sent, pushes_displayed, pushes_receiptable,
    session_duration_sec, points_earned, rolled_up_at
  )
  values (
    v.id, v.user_id, v.partner_id, v.region_id, v.platform,
    (v.user_id = any(v_excl_u) or v.partner_id = any(v_excl_p)),
    v.started_at, v.created_at, v.announced_at, v.claimed_at, v.upgraded_at, v.ended_at,
    v.close_reason::text, v.last_proven_at, v.completed_push_at, v.claimed_session_id,

    (select min(e.created_at) from public.geofence_region_events e
      where e.user_id = v.user_id and e.event = 'enter'
        and e.region_id = v.region_id
        and e.created_at between v_from and coalesce(v.created_at, now()) + interval '2 minutes'),
    (select e.detail->>'via' from public.geofence_region_events e
      where e.user_id = v.user_id and e.event = 'checked_in'
        and e.created_at between v_from and coalesce(v.created_at, now()) + interval '5 minutes'
      order by e.created_at desc limit 1),
    (select max(e.created_at) from public.geofence_region_events e
      where e.user_id = v.user_id and e.event = 'exit'
        and e.region_id = v.region_id
        and v.ended_at is not null
        and e.created_at between v.created_at and v.ended_at + interval '5 minutes'),
    (v_geo_from is not null and v_from >= v_geo_from),

    coalesce(v.nudge_count, 0),
    coalesce(v.nudge_count_upgrade, 0),
    (select count(*) from public.gym_visit_events e where e.visit_id = v.id and e.event = 'wake_received'),
    (select count(*) from public.gym_visit_events e where e.visit_id = v.id and e.event = 'confirmed_inside'),
    (select count(*) from public.gym_visit_events e where e.visit_id = v.id and e.event = 'confirmed_inside'
       and e.detail->>'proven' = 'true'),
    (select coalesce(array_agg(distinct e.detail->>'stage'), '{}') from public.gym_visit_events e
      where e.visit_id = v.id and e.event = 'settled' and e.detail->>'stage' is not null),

    (select count(*) from public.push_send_log l
      where l.user_id = v.user_id and l.type <> 'fence_refresh'
        and l.created_at between v.created_at and v_to),
    (select count(*) from public.push_send_log l
      where l.user_id = v.user_id and l.type <> 'fence_refresh'
        and l.delivered_at is not null
        and l.created_at between v.created_at and v_to),
    (select count(*) from public.push_send_log l
      where l.user_id = v.user_id and l.type <> 'fence_refresh'
        and l.transport = 'fcm_direct'
        and l.created_at between v.created_at and v_to),

    (select s.duration_sec from public.activity_sessions s where s.id = v.claimed_session_id),
    (select coalesce(sum(pt.amount), 0) from public.point_transactions pt where pt.session_id = v.claimed_session_id),
    now()
  )
  on conflict (visit_id) do update set
    user_id              = excluded.user_id,
    partner_id           = excluded.partner_id,
    region_id            = excluded.region_id,
    platform             = excluded.platform,
    is_test              = excluded.is_test,
    started_at           = excluded.started_at,
    checked_in_at        = excluded.checked_in_at,
    announced_at         = excluded.announced_at,
    claimed_at           = excluded.claimed_at,
    upgraded_at          = excluded.upgraded_at,
    ended_at             = excluded.ended_at,
    close_reason         = excluded.close_reason,
    last_proven_at       = excluded.last_proven_at,
    completed_push_at    = excluded.completed_push_at,
    claimed_session_id   = excluded.claimed_session_id,
    native_enter_at      = coalesce(excluded.native_enter_at, j.native_enter_at),
    checkin_via          = coalesce(excluded.checkin_via, j.checkin_via),
    exit_detected_at     = coalesce(excluded.exit_detected_at, j.exit_detected_at),
    evidence_complete    = (j.evidence_complete or excluded.evidence_complete),
    nudge_count          = greatest(excluded.nudge_count, j.nudge_count),
    nudge_count_upgrade  = greatest(excluded.nudge_count_upgrade, j.nudge_count_upgrade),
    wakes_received       = greatest(excluded.wakes_received, j.wakes_received),
    confirms_inside      = greatest(excluded.confirms_inside, j.confirms_inside),
    proofs               = greatest(excluded.proofs, j.proofs),
    settled_stages       = case when array_length(excluded.settled_stages, 1) is null
                                then j.settled_stages else excluded.settled_stages end,
    pushes_sent          = greatest(excluded.pushes_sent, j.pushes_sent),
    pushes_displayed     = greatest(excluded.pushes_displayed, j.pushes_displayed),
    pushes_receiptable   = greatest(excluded.pushes_receiptable, j.pushes_receiptable),
    session_duration_sec = coalesce(excluded.session_duration_sec, j.session_duration_sec),
    points_earned        = greatest(excluded.points_earned, j.points_earned),
    rolled_up_at         = now();
end;
$function$;

revoke all on function public.rollup_gym_visit_journey(uuid) from public, anon, authenticated;

select public.rollup_gym_visit_journeys(100000);


-- ═══ PART 2: searchable history ════════════════════════════════════════════
--
-- ⚠ THE OUTCOME FILTERS ARE FACT PREDICATES, NOT VERDICTS, and the distinction
-- is load-bearing. 'never_claimed' asks `claimed_at is null` — a column value.
-- It does NOT ask "did this visit fail", because that depends on thresholds and
-- intent (a 6-minute walk-through SHOULD never claim). The UI pairs each filter
-- with the judgement from shared/liveops.ts, which is the only place allowed to
-- say a visit went wrong. Keep new filters on the same side of that line: if you
-- cannot express it as a column comparison, it belongs in TypeScript.
--
-- The filter KEYS are mirrored in shared/liveops.ts HISTORY_OUTCOMES; adding one
-- here means adding it there (and to __tests__/liveops.test.ts).
create or replace function public.admin_liveops_history(
  p_from         timestamptz default now() - interval '30 days',
  p_to           timestamptz default now(),
  p_user_query   text        default null,
  p_outcome      text        default 'all',
  p_platform     text        default null,
  p_partner_id   uuid        default null,
  p_include_test boolean     default false,
  p_limit        integer     default 100,
  p_offset       integer     default 0
)
returns table (
  visit_id uuid, user_id uuid, username text, display_name text, email text,
  partner_id uuid, venue_name text, platform text, is_test boolean,
  started_at timestamptz, ended_at timestamptz, close_reason text,
  claimed_at timestamptz, upgraded_at timestamptz, completed_push_at timestamptz,
  native_enter_at timestamptz, checkin_via text, exit_detected_at timestamptz,
  evidence_complete boolean,
  nudge_count integer, nudge_count_upgrade integer, wakes_received integer,
  proofs integer, settled_stages text[],
  pushes_sent integer, pushes_displayed integer, pushes_receiptable integer,
  session_duration_sec integer, points_earned integer,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_q text := nullif(trim(coalesce(p_user_query, '')), '');
begin
  if not is_admin() then
    raise exception 'Access denied: admin only';
  end if;

  return query
    with filtered as (
      select j.*, p.username, p.display_name, u.email::text as email, pt.name as venue_name
      from public.gym_visit_journeys j
      join public.profiles p   on p.id = j.user_id
      join auth.users u        on u.id = j.user_id
      left join public.partners pt on pt.id = j.partner_id
      where j.started_at >= p_from
        and j.started_at <= p_to
        and (p_include_test or not j.is_test)
        and (p_platform is null or j.platform = p_platform)
        and (p_partner_id is null or j.partner_id = p_partner_id)
        and (v_q is null
             or u.email ilike '%' || v_q || '%'
             or p.username ilike '%' || v_q || '%'
             or p.display_name ilike '%' || v_q || '%'
             or j.user_id::text = v_q
             or j.visit_id::text = v_q)
        and case coalesce(p_outcome, 'all')
              when 'all'                 then true
              -- chain progress
              when 'claimed'             then j.claimed_at is not null
              when 'never_claimed'       then j.claimed_at is null
              when 'upgraded'            then j.upgraded_at is not null
              when 'claimed_not_upgraded' then j.claimed_at is not null and j.upgraded_at is null
              when 'full_chain'          then j.claimed_at is not null and j.upgraded_at is not null
                                              and j.completed_push_at is not null
              -- detection failures (only meaningful where evidence survives)
              when 'no_os_enter'         then j.evidence_complete and j.native_enter_at is null
              when 'no_exit_detected'    then j.evidence_complete and j.ended_at is not null
                                              and j.exit_detected_at is null
              when 'no_proof'            then j.proofs = 0
              -- delivery failures
              when 'wake_starved'        then (j.nudge_count + j.nudge_count_upgrade) >= 3
                                              and j.wakes_received = 0
              when 'push_never_drew'     then j.pushes_receiptable > 0 and j.pushes_displayed = 0
              when 'no_completion_push'  then j.ended_at is not null and j.claimed_at is not null
                                              and j.completed_push_at is null
              -- how the credit landed
              when 'server_settled'      then array_length(j.settled_stages, 1) > 0
              when 'reaper_closed'       then j.close_reason in ('stale_after_upgrade', 'max_open_after_upgrade')
              when 'evidence_expired'    then not j.evidence_complete
              else true
            end
    )
    select
      f.visit_id, f.user_id, f.username, f.display_name, f.email,
      f.partner_id, f.venue_name, f.platform, f.is_test,
      f.started_at, f.ended_at, f.close_reason,
      f.claimed_at, f.upgraded_at, f.completed_push_at,
      f.native_enter_at, f.checkin_via, f.exit_detected_at,
      f.evidence_complete,
      f.nudge_count, f.nudge_count_upgrade, f.wakes_received,
      f.proofs, f.settled_stages,
      f.pushes_sent, f.pushes_displayed, f.pushes_receiptable,
      f.session_duration_sec, f.points_earned,
      count(*) over () as total_count
    from filtered f
    order by f.started_at desc
    limit greatest(coalesce(p_limit, 100), 1)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$function$;

revoke all on function public.admin_liveops_history(timestamptz, timestamptz, text, text, text, uuid, boolean, integer, integer) from public, anon;
grant execute on function public.admin_liveops_history(timestamptz, timestamptz, text, text, text, uuid, boolean, integer, integer) to authenticated;


-- ═══ PART 3: trends ════════════════════════════════════════════════════════
--
-- Daily COUNTS, never rates. The denominator question ("of what?") differs per
-- metric — OS-enter rate is over evidence-complete visits, push display rate is
-- over receiptable pushes only (fcm_direct is the sole transport that stamps
-- delivered_at) — and getting that wrong is how you publish a fake 0%. So SQL
-- ships numerators and denominators as separate facts and shared/liveops.ts
-- divides them, under test.
create or replace function public.admin_liveops_trends(
  p_from         timestamptz default now() - interval '90 days',
  p_to           timestamptz default now(),
  p_include_test boolean     default false,
  p_platform     text        default null
)
returns table (
  bucket date,
  visits bigint,
  evidence_complete bigint,
  os_enter_delivered bigint,
  claimed bigint,
  upgraded bigint,
  closed_by_reaper bigint,
  exit_detected bigint,
  server_settled bigint,
  nudges_sent bigint,
  wakes_received bigint,
  pushes_receiptable bigint,
  pushes_displayed bigint,
  points_earned bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not is_admin() then
    raise exception 'Access denied: admin only';
  end if;

  return query
    select
      (j.started_at at time zone 'UTC')::date,
      count(*),
      count(*) filter (where j.evidence_complete),
      count(*) filter (where j.evidence_complete and j.native_enter_at is not null),
      count(*) filter (where j.claimed_at is not null),
      count(*) filter (where j.upgraded_at is not null),
      count(*) filter (where j.close_reason in ('stale_after_upgrade', 'max_open_after_upgrade')),
      count(*) filter (where j.evidence_complete and j.exit_detected_at is not null),
      count(*) filter (where array_length(j.settled_stages, 1) > 0),
      coalesce(sum(j.nudge_count + j.nudge_count_upgrade), 0),
      coalesce(sum(j.wakes_received), 0),
      coalesce(sum(j.pushes_receiptable), 0),
      coalesce(sum(j.pushes_displayed), 0),
      coalesce(sum(j.points_earned), 0)
    from public.gym_visit_journeys j
    where j.started_at >= p_from
      and j.started_at <= p_to
      and (p_include_test or not j.is_test)
      and (p_platform is null or j.platform = p_platform)
    group by 1
    order by 1;
end;
$function$;

revoke all on function public.admin_liveops_trends(timestamptz, timestamptz, boolean, text) from public, anon;
grant execute on function public.admin_liveops_trends(timestamptz, timestamptz, boolean, text) to authenticated;
