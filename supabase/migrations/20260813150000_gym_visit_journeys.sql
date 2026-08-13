-- gym_visit_journeys — the PERMANENT, per-visit fact record (2026-08-13).
--
-- WHY THIS EXISTS. Everything the e2e watcher and Live Ops know is derived from
-- four tables, two of which self-delete: geofence_region_events and
-- push_send_log are purged (30 days until today, 90 now). So the answers that
-- matter over months — "is check-in getting more reliable?", "what fraction of
-- completion banners actually draw?", "how often does the OS enter never
-- arrive?" — were structurally unanswerable: the evidence expired before a
-- trend could form.
--
-- Storing the raw firehose forever is the wrong fix. It is ~100 rows per device
-- per day and, measured 2026-08-13, 82% of it is arm-burst `exit` noise that
-- every consumer discards at read time. Instead this table distils each visit
-- into ONE row, computed while the raw rows still exist, and keeps it forever.
-- At today's volume the whole of recorded history is 167 rows.
--
-- ⚠ FACTS ONLY — NO VERDICTS. This is the same rule that governs the split
-- between the Live Ops RPCs (facts) and shared/liveops.ts (judgement), and it
-- matters more here, not less: a stored verdict is frozen at the moment it was
-- computed, and these rules have been wrong before (the reaper's "junk fixes
-- defer the close" reading, the "duplicate streak writer" that was a cap clamp).
-- A rollup of facts can be re-judged when the rules improve; a rollup of
-- verdicts is permanently wrong and invisibly so. So: timestamps and counts
-- here, "succeeded"/"stuck"/"never drew" in TypeScript, under test.
--
-- Every derivation below is copied VERBATIM from admin_liveops_visit's
-- equivalent (same 20-minute lookback, same ±2/±5 minute edges). Two definitions
-- of "entered_at" that drift apart would be a bug factory.

create table if not exists public.gym_visit_journeys (
  visit_id            uuid primary key references public.gym_visits(id) on delete cascade,
  user_id             uuid not null,
  partner_id          uuid,
  region_id           text,
  platform            text,
  -- Denormalised so history/trend queries can exclude the bench accounts without
  -- joining auth.users every time. Recomputed on every rollup, so a re-run fixes
  -- it if the exclusion list changes.
  is_test             boolean not null default false,

  -- Lifecycle stamps, copied from gym_visits (which is permanent, but copying
  -- makes a journey self-contained and indexable on its own).
  started_at          timestamptz not null,
  checked_in_at       timestamptz,
  announced_at        timestamptz,
  claimed_at          timestamptz,
  upgraded_at         timestamptz,
  ended_at            timestamptz,
  close_reason        text,
  last_proven_at      timestamptz,
  completed_push_at   timestamptz,
  claimed_session_id  uuid,

  -- Derived from the raw event streams BEFORE they are purged. This is the whole
  -- point of the table.
  native_enter_at     timestamptz,  -- null = the OS never delivered the crossing
  checkin_via         text,         -- null = foreground/unlogged path
  exit_detected_at    timestamptz,  -- null = nothing ever observed them leaving

  -- Counts. nudge counters come from the visit row (authoritative, atomic via
  -- record_gym_visit_nudge); everything else is counted off the event stream.
  nudge_count         integer not null default 0,
  nudge_count_upgrade integer not null default 0,
  wakes_received      integer not null default 0,
  confirms_inside     integer not null default 0,
  proofs              integer not null default 0,  -- confirms that cleared the accuracy gate
  settled_stages      text[]  not null default '{}',  -- stages the SERVER banked (2026-08-13 settle pass)

  -- Push outcomes for the visit's window. `receiptable` counts only fcm_direct:
  -- it is the sole transport that stamps delivered_at, so displayed/sent would
  -- understate reality on any other path. See shared/liveops.ts pushVerdict.
  pushes_sent         integer not null default 0,
  pushes_displayed    integer not null default 0,
  pushes_receiptable  integer not null default 0,

  session_duration_sec integer,
  points_earned        integer not null default 0,

  rolled_up_at        timestamptz not null default now()
);

comment on table public.gym_visit_journeys is
  'Permanent one-row-per-visit fact record for the geofence + notification chain. Facts only; judgement lives in shared/liveops.ts.';

create index if not exists gym_visit_journeys_user_started_idx  on public.gym_visit_journeys (user_id, started_at desc);
create index if not exists gym_visit_journeys_started_idx       on public.gym_visit_journeys (started_at desc);
create index if not exists gym_visit_journeys_partner_idx       on public.gym_visit_journeys (partner_id);
create index if not exists gym_visit_journeys_platform_idx      on public.gym_visit_journeys (platform);
-- Partial indexes for the two commonest "failed op" filters.
create index if not exists gym_visit_journeys_unclaimed_idx     on public.gym_visit_journeys (started_at desc) where claimed_at is null;
create index if not exists gym_visit_journeys_no_enter_idx      on public.gym_visit_journeys (started_at desc) where native_enter_at is null;

alter table public.gym_visit_journeys enable row level security;
-- No policies: reachable only through the security-definer admin RPCs, exactly
-- like every other Live Ops surface (see project_admin_rls_unfiltered_reads —
-- unfiltered client selects on admin data are a standing bug class here).
revoke all on table public.gym_visit_journeys from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- Roll up ONE visit. Idempotent: safe to re-run at any time, and re-running is
-- how a journey picks up late arrivals (a completion push that drew ten minutes
-- after close, points credited by a retry).
-- ═══════════════════════════════════════════════════════════════════════════
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
begin
  select * into v from public.gym_visits where id = p_visit_id;
  if not found then return; end if;

  -- Same window admin_liveops_visit uses, so both read the same evidence.
  v_from := least(v.started_at, v.created_at) - interval '20 minutes';
  v_to   := coalesce(v.ended_at, now()) + interval '10 minutes';

  insert into public.gym_visit_journeys as j (
    visit_id, user_id, partner_id, region_id, platform, is_test,
    started_at, checked_in_at, announced_at, claimed_at, upgraded_at, ended_at,
    close_reason, last_proven_at, completed_push_at, claimed_session_id,
    native_enter_at, checkin_via, exit_detected_at,
    nudge_count, nudge_count_upgrade, wakes_received, confirms_inside, proofs, settled_stages,
    pushes_sent, pushes_displayed, pushes_receiptable,
    session_duration_sec, points_earned, rolled_up_at
  )
  values (
    v.id, v.user_id, v.partner_id, v.region_id, v.platform,
    (v.user_id = any(v_excl_u) or v.partner_id = any(v_excl_p)),
    v.started_at, v.created_at, v.announced_at, v.claimed_at, v.upgraded_at, v.ended_at,
    v.close_reason::text, v.last_proven_at, v.completed_push_at, v.claimed_session_id,

    -- The OS-delivered ENTER that preceded the check-in, if one arrived at all.
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

    coalesce(v.nudge_count, 0),
    coalesce(v.nudge_count_upgrade, 0),
    (select count(*) from public.gym_visit_events e where e.visit_id = v.id and e.event = 'wake_received'),
    (select count(*) from public.gym_visit_events e where e.visit_id = v.id and e.event = 'confirmed_inside'),
    (select count(*) from public.gym_visit_events e where e.visit_id = v.id and e.event = 'confirmed_inside'
       and e.detail->>'proven' = 'true'),
    (select coalesce(array_agg(distinct e.detail->>'stage'), '{}') from public.gym_visit_events e
      where e.visit_id = v.id and e.event = 'settled' and e.detail->>'stage' is not null),

    -- fence_refresh is the wake loop talking to itself and never draws anything;
    -- excluded here for the same reason shared/liveops.ts isNoisePush excludes it.
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
    -- Derived-from-purgeable-evidence columns are STICKY: once we have observed
    -- an OS enter or an exit, a later rollup running after the raw rows aged out
    -- must not erase it. coalesce(new, old), never a blind overwrite.
    native_enter_at      = coalesce(excluded.native_enter_at, j.native_enter_at),
    checkin_via          = coalesce(excluded.checkin_via, j.checkin_via),
    exit_detected_at     = coalesce(excluded.exit_detected_at, j.exit_detected_at),
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


-- ═══════════════════════════════════════════════════════════════════════════
-- Batch: roll up anything missing or out of date. Cron calls this; it is also
-- the backfill (run it with a big limit).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.rollup_gym_visit_journeys(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id  uuid;
  v_n   integer := 0;
begin
  for v_id in
    select v.id
    from public.gym_visits v
    left join public.gym_visit_journeys j on j.visit_id = v.id
    where
      -- never rolled up
      j.visit_id is null
      -- or the visit has moved since we last looked
      or j.rolled_up_at < greatest(
           v.started_at, v.created_at,
           coalesce(v.claimed_at, v.created_at),
           coalesce(v.upgraded_at, v.created_at),
           coalesce(v.ended_at, v.created_at),
           coalesce(v.last_confirmed_at, v.created_at),
           coalesce(v.completed_push_at, v.created_at))
      -- or it closed recently: points, session length and display receipts all
      -- land AFTER the close, so one pass at close time would freeze a half-told
      -- story. Re-roll for 2 hours, then leave it alone forever.
      or (v.ended_at is not null and v.ended_at > now() - interval '2 hours')
      -- or it is still live
      or v.ended_at is null
    order by v.started_at desc
    limit greatest(p_limit, 1)
  loop
    perform public.rollup_gym_visit_journey(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

revoke all on function public.rollup_gym_visit_journeys(integer) from public, anon, authenticated;

-- Backfill every visit that already exists (167 at the time of writing, so this
-- is instant; the limit is just a runaway guard).
select public.rollup_gym_visit_journeys(100000);

-- Every 10 minutes. Deliberately not every minute: nothing here is live-critical
-- (the board reads gym_visits directly), and the 2-hour re-roll window above
-- already guarantees late arrivals are picked up.
select cron.schedule(
  'rollup-gym-visit-journeys',
  '*/10 * * * *',
  $cron$select public.rollup_gym_visit_journeys(500)$cron$
);
