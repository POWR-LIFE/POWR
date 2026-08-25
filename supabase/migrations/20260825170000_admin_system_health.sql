-- ---------------------------------------------------------------------------
-- Admin System Health — the running diagnosis behind docs/system-health-scope.md.
--
-- WHAT THIS IS: the instrumentation for the 2026-08-25 scale review. The review
-- found the check-in → points chain CORRECT under concurrency but capacity-bound
-- in five places (workstreams W1–W5 in the scope doc). Every signal here exists
-- to say WHEN one of those workstreams has to start — before an outage says it.
--
-- FACTS ONLY. Every function here returns numerators, denominators, counts and
-- timestamps. The judgement (green / watch / act / unknown, the threshold, the
-- reason) lives in shared/systemHealth.ts as pure functions with jest coverage.
-- Same split as Live Ops, same reason: a rule that is wrong in SQL is invisible.
--
-- ⚠ EVIDENCE. pg_stat_statements and pg_stat_database are CUMULATIVE since their
-- last reset, and both reset on every restart and compute change. A snapshot
-- table (hourly cron) is what makes "is this getting worse?" answerable past the
-- last restart; the TS layer derives interval rates from consecutive snapshots.
-- Every signal carries evidence_ok; a source that is unavailable or reset renders
-- as UNKNOWN, never as green.
--
-- ⚠ OWNERSHIP. Reading pg_stat_statements, cron.job_run_details and net.* needs
-- the owner role (postgres — pg_read_all_stats). These are SECURITY DEFINER and
-- owned by the migration runner for exactly that reason, which makes is_admin()
-- the whole defence. Nothing here is granted to anon, ever.
-- ---------------------------------------------------------------------------

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. PERMANENT SNAPSHOTS
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.system_health_snapshots (
  id           bigserial primary key,
  captured_at  timestamptz not null default now(),
  signal       text        not null,
  numerator    numeric,
  denominator  numeric,
  detail       jsonb,
  evidence_ok  boolean     not null default true
);

create index if not exists system_health_snapshots_signal_time_idx
  on public.system_health_snapshots (signal, captured_at desc);

-- Reachable only through the definer RPCs below.
alter table public.system_health_snapshots enable row level security;
revoke all on table public.system_health_snapshots from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. THE FACTS — one jsonb document, one key per signal
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Each signal is computed inside its own BEGIN/EXCEPTION block so a single
-- unavailable source (an extension missing on a branch DB, a permission change,
-- a renamed column) marks THAT signal evidence_ok=false and leaves the rest of
-- the page honest — instead of one error blanking the whole diagnosis.
--
-- Shape per signal: { numerator, denominator, detail, evidence_ok }.
--   count  → numerator only (denominator null)
--   ratio  → numerator / denominator   (e.g. total_exec_time / calls)
--   pct    → numerator / denominator   (the TS multiplies by 100, or returns null
--            when the denominator is 0 — never 0%)
--
-- Not granted to anyone: called only from the two gated wrappers + the cron.
create or replace function public.system_health_facts()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v            jsonb := '{}'::jsonb;
  s            jsonb;
  v_excl_users uuid[];
  v_dwell      integer := 30;
  v_now        timestamptz := now();
  v_24h        timestamptz := now() - interval '24 hours';
  v_7d         timestamptz := now() - interval '7 days';
  v_pss_reset  timestamptz;
  v_db_reset   timestamptz;
  v_last_snap  timestamptz;
begin
  -- Shared exclusions — dev/test accounts run every field test and would swamp
  -- the claim/integrity statistics. (Live Ops helper; definer, owner-only.)
  begin
    v_excl_users := public.liveops_excluded_user_ids();
  exception when others then
    v_excl_users := '{}'::uuid[];
  end;
  begin
    select dwell_minutes into v_dwell from public.liveops_thresholds();
  exception when others then
    v_dwell := 30;
  end;

  -- ── LEDGER (W1) ──────────────────────────────────────────────────────────

  -- Earn-insert cost. The PostgREST-generated INSERT statements on
  -- point_transactions carry the full trigger cost (both lifetime sums + the
  -- rewards scan) inside their exec time. CUMULATIVE since stats_reset — the TS
  -- derives the recent interval mean from consecutive snapshots.
  -- ⚠ Schema-qualified: the extension lives in `extensions`, and search_path is
  -- pinned to public. Unqualified, this block reported "relation does not
  -- exist" on day one.
  begin
    select jsonb_build_object(
      'numerator',   coalesce(sum(total_exec_time), 0),
      'denominator', coalesce(sum(calls), 0),
      'detail', jsonb_build_object(
        'statements',  count(*),
        'max_ms',      round(coalesce(max(max_exec_time), 0)::numeric, 1),
        'stats_since', min(stats_since),
        'cumulative',  true
      ),
      'evidence_ok', coalesce(sum(calls), 0) > 0
    ) into s
    from extensions.pg_stat_statements
    where query like '%INSERT INTO "public"."point_transactions"%';
    v := v || jsonb_build_object('ledger.insert_mean_ms', s);
  exception when others then
    v := v || jsonb_build_object('ledger.insert_mean_ms', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- The tenure axis. The trigger sums are O(rows for this user); this rises with
  -- zero user growth.
  begin
    with per_user as (
      select user_id, count(*)::numeric as n from public.point_transactions group by user_id
    )
    select jsonb_build_object(
      'numerator',   coalesce(max(n), 0),
      'denominator', null,
      'detail', jsonb_build_object(
        'users', count(*),
        'p50',   round(coalesce(percentile_cont(0.5) within group (order by n), 0)::numeric),
        'p95',   round(coalesce(percentile_cont(0.95) within group (order by n), 0)::numeric),
        'max',   coalesce(max(n), 0)
      ),
      'evidence_ok', true
    ) into s from per_user;
    v := v || jsonb_build_object('ledger.rows_per_user', s);
  exception when others then
    v := v || jsonb_build_object('ledger.rows_per_user', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  begin
    select jsonb_build_object(
      'numerator', count(*), 'denominator', null,
      'detail', jsonb_build_object('last_7d', count(*) filter (where created_at >= v_7d)),
      'evidence_ok', true
    ) into s from public.point_transactions;
    v := v || jsonb_build_object('ledger.total_rows', s);
  exception when others then
    v := v || jsonb_build_object('ledger.total_rows', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- W1 shadow phase (20260825200100): user_point_balances is kept in step by a
  -- trigger and read by NOTHING yet. This is the reconcile — the ledger is the
  -- authority, and every member whose stored row disagrees with it counts.
  -- Zero for a week is the cutover evidence. If the table or function is
  -- missing (a branch DB), the block reports UNKNOWN, not green.
  begin
    select jsonb_build_object(
      'numerator', count(*), 'denominator', (select count(*) from public.user_point_balances),
      'detail', jsonb_build_object(
        'drifted', coalesce((
          select jsonb_agg(jsonb_build_object('user_id', d.user_id, 'net', d.stored_net || '/' || d.actual_net, 'earned', d.stored_earned || '/' || d.actual_earned))
          from (select * from public.user_point_balances_drift() limit 20) d
        ), '[]'::jsonb),
        'phase', 'shadow — nothing reads the table yet'
      ),
      'evidence_ok', true
    ) into s from public.user_point_balances_drift();
    v := v || jsonb_build_object('ledger.balance_drift', s);
  exception when others then
    v := v || jsonb_build_object('ledger.balance_drift', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- ── CLAIM CHAIN (W2) ─────────────────────────────────────────────────────

  -- The signature of an isolate dying between claim-points steps 10 and 11c:
  -- the earn row landed but the visit never got its stamp, or the stamp landed
  -- against a session with no earn row.
  begin
    select jsonb_build_object(
      'numerator', count(*) filter (where open_after_claim or claimed_no_earn),
      'denominator', null,
      'detail', jsonb_build_object(
        'open_after_claim', count(*) filter (where open_after_claim),
        'claimed_no_earn',  count(*) filter (where claimed_no_earn),
        'claimed_visits',   count(*)
      ),
      'evidence_ok', true
    ) into s
    from (
      select
        gv.status = 'open' and gv.claimed_at < v_now - interval '10 minutes' as open_after_claim,
        gv.claimed_session_id is not null and not exists (
          select 1 from public.point_transactions pt
          where pt.session_id = gv.claimed_session_id and pt.type = 'earn'
        ) as claimed_no_earn
      from public.gym_visits gv
      where gv.claimed_at >= v_24h
        and not (gv.user_id = any(v_excl_users))
    ) x;
    v := v || jsonb_build_object('claims.partial_24h', s);
  exception when others then
    v := v || jsonb_build_object('claims.partial_24h', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- Wake → claim wall time. Same legs Live Ops measures; kept to the two
  -- events that bracket the claim call itself.
  begin
    with per_visit as (
      select
        e.visit_id,
        extract(epoch from (
          min(e.created_at) filter (where e.event = 'claimed')
          - min(e.created_at) filter (where e.event = 'wake_received')
        )) as secs
      from public.gym_visit_events e
      where e.created_at >= v_24h
        and e.event in ('wake_received', 'claimed')
        and not (e.user_id = any(v_excl_users))
      group by e.visit_id
    ), ok as (
      select secs from per_visit where secs is not null and secs >= 0 and secs <= 3600
    )
    select jsonb_build_object(
      'numerator',   round(coalesce(percentile_cont(0.95) within group (order by secs), 0)::numeric, 1),
      'denominator', count(*),
      'detail', jsonb_build_object(
        'p50',     round(coalesce(percentile_cont(0.5) within group (order by secs), 0)::numeric, 1),
        'samples', count(*)
      ),
      'evidence_ok', count(*) > 0
    ) into s from ok;
    v := v || jsonb_build_object('claims.wall_p95_s', s);
  exception when others then
    v := v || jsonb_build_object('claims.wall_p95_s', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- A 429 on a proven visit is the 2026-08-13 class — the anti-abuse cap spent
  -- by a writer it does not govern. Must stay at zero.
  begin
    select jsonb_build_object(
      'numerator', count(*) filter (where
          (e.event = 'settled' and (e.detail ->> 'status') = '429')
          or (e.event = 'credit_declined' and (e.detail ->> 'reason') ilike '%rate%')
          or (e.detail ->> 'error') ilike '%rate limit%'),
      'denominator', null,
      'detail', jsonb_build_object(
        'declined_reasons', (
          select coalesce(jsonb_object_agg(r.reason, r.n), '{}'::jsonb)
          from (
            select coalesce(d.detail ->> 'reason', 'unknown') as reason, count(*) as n
            from public.gym_visit_events d
            where d.created_at >= v_24h and d.event = 'credit_declined'
              and not (d.user_id = any(v_excl_users))
            group by 1
          ) r
        )
      ),
      'evidence_ok', true
    ) into s
    from public.gym_visit_events e
    where e.created_at >= v_24h
      and e.event in ('settled', 'credit_declined')
      and not (e.user_id = any(v_excl_users));
    v := v || jsonb_build_object('claims.rate_limited_24h', s);
  exception when others then
    v := v || jsonb_build_object('claims.rate_limited_24h', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- The read-then-write cap race: a (user, UTC day) whose strength-lane earn +
  -- streak rows exceed the 30 cap. Dev test users bypass caps by design and are
  -- excluded.
  begin
    with lane as (
      select pt.user_id,
             date_trunc('day', a.started_at at time zone 'UTC') as day,
             sum(pt.amount) as pts
      from public.point_transactions pt
      join public.activity_sessions a on a.id = pt.session_id
      where pt.type in ('earn', 'streak')
        and a.type::text in ('gym', 'hiit')
        and a.started_at >= v_7d
        and not (pt.user_id = any(v_excl_users))
      group by 1, 2
    )
    select jsonb_build_object(
      'numerator', count(*) filter (where pts > 30),
      'denominator', null,
      'detail', jsonb_build_object('user_days', count(*), 'worst', coalesce(max(pts), 0)),
      'evidence_ok', true
    ) into s from lane;
    v := v || jsonb_build_object('claims.cap_overshoot_7d', s);
  exception when others then
    v := v || jsonb_build_object('claims.cap_overshoot_7d', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- ── BEACON (W3) ──────────────────────────────────────────────────────────

  begin
    with runs as (
      select extract(epoch from (r.end_time - r.start_time)) as secs, r.status
      from cron.job_run_details r
      join cron.job j on j.jobid = r.jobid
      where j.jobname = 'gym-visit-beacon'
        and r.start_time >= v_24h
        and r.end_time is not null
    )
    select jsonb_build_object(
      'numerator',   round(coalesce(percentile_cont(0.95) within group (order by secs), 0)::numeric, 2),
      'denominator', null,
      'detail', jsonb_build_object(
        'runs', count(*),
        'max_s', round(coalesce(max(secs), 0)::numeric, 2),
        'p50_s', round(coalesce(percentile_cont(0.5) within group (order by secs), 0)::numeric, 2)
      ),
      'evidence_ok', count(*) > 0
    ) into s from runs;
    v := v || jsonb_build_object('beacon.tick_p95_s', s);
  exception when others then
    v := v || jsonb_build_object('beacon.tick_p95_s', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  begin
    select jsonb_build_object(
      'numerator', count(*) filter (where r.status <> 'succeeded'),
      'denominator', count(*),
      'detail', jsonb_build_object(
        'last_failure', max(r.start_time) filter (where r.status <> 'succeeded'),
        'last_message', (
          select r2.return_message from cron.job_run_details r2
          join cron.job j2 on j2.jobid = r2.jobid
          where j2.jobname = 'gym-visit-beacon' and r2.status <> 'succeeded' and r2.start_time >= v_24h
          order by r2.start_time desc limit 1
        )
      ),
      'evidence_ok', count(*) > 0
    ) into s
    from cron.job_run_details r
    join cron.job j on j.jobid = r.jobid
    where j.jobname = 'gym-visit-beacon' and r.start_time >= v_24h;
    v := v || jsonb_build_object('beacon.failures_24h', s);
  exception when others then
    v := v || jsonb_build_object('beacon.failures_24h', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- The beacon's own nudge_sent receipts carry queued/failed per wake. The
  -- 2026-08-12 read was 116 sent / 722 failed.
  begin
    select jsonb_build_object(
      'numerator',   coalesce(sum((e.detail ->> 'failed')::int), 0),
      -- sent = Expo-queued + FCM-direct (the beacon's own `stats.sent`); the
      -- first cut counted queued alone and read 15 direct wakes as 0 attempts.
      'denominator', coalesce(sum((e.detail ->> 'queued')::int), 0)
                   + coalesce(sum((e.detail ->> 'fcm_direct')::int), 0)
                   + coalesce(sum((e.detail ->> 'failed')::int), 0),
      'detail', jsonb_build_object(
        'wakes',      count(*),
        'queued',     coalesce(sum((e.detail ->> 'queued')::int), 0),
        'failed',     coalesce(sum((e.detail ->> 'failed')::int), 0),
        'fcm_direct', coalesce(sum((e.detail ->> 'fcm_direct')::int), 0)
      ),
      'evidence_ok', count(*) > 0
    ) into s
    from public.gym_visit_events e
    where e.created_at >= v_24h and e.event = 'nudge_sent';
    v := v || jsonb_build_object('beacon.push_fail_pct_24h', s);
  exception when others then
    v := v || jsonb_build_object('beacon.push_fail_pct_24h', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- P2 (20260825200000): the beacon writes one beacon_ticks row per stage per
  -- tick with due_count taken BEFORE its limit. The max over 24 h is the number
  -- judged; the cap it is judged against is 200 (DUE_LIMIT in the beacon).
  -- No rows in 24 h = the beacon build that writes them is not deployed, or the
  -- beacon is dead — UNKNOWN either way, with the note saying which to check.
  begin
    select jsonb_build_object(
      'numerator',   max(due_count),
      'denominator', null,
      'detail', jsonb_build_object(
        'cap', 200,
        'ticks', count(*),
        'p95', round(coalesce(percentile_cont(0.95) within group (order by due_count), 0)::numeric),
        'max_dwell',   max(due_count) filter (where stage = 'dwell'),
        'max_upgrade', max(due_count) filter (where stage = 'upgrade'),
        'count_failures', count(*) filter (where due_count is null),
        'duration_p95_ms', round(coalesce(percentile_cont(0.95) within group (order by duration_ms), 0)::numeric),
        'note', case when count(*) = 0 then 'no beacon_ticks rows in 24 h — beacon build not deployed, or beacon dead (see beacon.failures_24h)' else null end
      ),
      'evidence_ok', count(*) filter (where due_count is not null) > 0
    ) into s
    from public.beacon_ticks
    where ran_at >= v_24h;
    v := v || jsonb_build_object('beacon.due_per_tick', s);
  exception when others then
    v := v || jsonb_build_object('beacon.due_per_tick', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- ── RELAY (W4) ───────────────────────────────────────────────────────────

  begin
    select jsonb_build_object(
      'numerator', count(*), 'denominator', null,
      'detail', jsonb_build_object('batch_size', (select setting from pg_settings where name = 'pg_net.batch_size')),
      'evidence_ok', true
    ) into s from net.http_request_queue;
    v := v || jsonb_build_object('relay.queue_depth', s);
  exception when others then
    v := v || jsonb_build_object('relay.queue_depth', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- These failures leave NO receipt anywhere else — net._http_response is the
  -- only witness to a relayed claim that never arrived.
  begin
    select jsonb_build_object(
      'numerator', count(*) filter (where r.timed_out or r.error_msg is not null or r.status_code >= 400),
      'denominator', count(*),
      'detail', jsonb_build_object(
        'timed_out', count(*) filter (where r.timed_out),
        'errors',    count(*) filter (where r.error_msg is not null),
        'http_4xx',  count(*) filter (where r.status_code between 400 and 499),
        'http_5xx',  count(*) filter (where r.status_code >= 500),
        'ttl',       (select setting from pg_settings where name = 'pg_net.ttl')
      ),
      'evidence_ok', count(*) > 0
    ) into s
    from net._http_response r
    where r.created >= v_24h;
    v := v || jsonb_build_object('relay.fail_pct_24h', s);
  exception when others then
    v := v || jsonb_build_object('relay.fail_pct_24h', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  begin
    with hourly as (
      select date_trunc('hour', r.created) as h, count(*) as n
      from net._http_response r where r.created >= v_24h group by 1
    )
    select jsonb_build_object(
      'numerator', coalesce(sum(n), 0), 'denominator', null,
      'detail', jsonb_build_object('peak_hour', coalesce(max(n), 0), 'hours_with_traffic', count(*)),
      'evidence_ok', true
    ) into s from hourly;
    v := v || jsonb_build_object('relay.volume_24h', s);
  exception when others then
    v := v || jsonb_build_object('relay.volume_24h', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- ── DATABASE (W5) ────────────────────────────────────────────────────────

  begin
    select jsonb_build_object(
      'numerator',   count(*) filter (where a.backend_type = 'client backend'),
      'denominator', (select setting::int from pg_settings where name = 'max_connections'),
      'detail', jsonb_build_object(
        'active',   count(*) filter (where a.backend_type = 'client backend' and a.state = 'active'),
        'idle',     count(*) filter (where a.backend_type = 'client backend' and a.state = 'idle'),
        'idle_txn', count(*) filter (where a.backend_type = 'client backend' and a.state like 'idle in transaction%'),
        'waiting',  count(*) filter (where a.backend_type = 'client backend' and a.wait_event_type = 'Lock')
      ),
      'evidence_ok', true
    ) into s from pg_stat_activity a;
    v := v || jsonb_build_object('db.connections_pct', s);
  exception when others then
    v := v || jsonb_build_object('db.connections_pct', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- Cumulative since pg_stat_database.stats_reset; interval derived from snapshots.
  begin
    select jsonb_build_object(
      'numerator',   coalesce(d.blks_hit, 0),
      'denominator', coalesce(d.blks_hit, 0) + coalesce(d.blks_read, 0),
      'detail', jsonb_build_object(
        'shared_buffers_mb', (select (setting::bigint * 8) / 1024 from pg_settings where name = 'shared_buffers'),
        'stats_reset', d.stats_reset,
        'cumulative', true
      ),
      'evidence_ok', (coalesce(d.blks_hit, 0) + coalesce(d.blks_read, 0)) > 0
    ) into s
    from pg_stat_database d where d.datname = current_database();
    v_db_reset := (s -> 'detail' ->> 'stats_reset')::timestamptz;
    v := v || jsonb_build_object('db.cache_hit_pct', s);
  exception when others then
    v := v || jsonb_build_object('db.cache_hit_pct', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  begin
    select jsonb_build_object(
      'numerator', round(coalesce(max(extract(epoch from (v_now - a.query_start))), 0)::numeric, 1),
      'denominator', null,
      'detail', jsonb_build_object(
        'running', count(*),
        'longest_wait_event', (
          select a2.wait_event_type from pg_stat_activity a2
          where a2.backend_type = 'client backend' and a2.state <> 'idle' and a2.pid <> pg_backend_pid()
          order by a2.query_start asc limit 1
        )
      ),
      'evidence_ok', true
    ) into s
    from pg_stat_activity a
    where a.backend_type = 'client backend' and a.state <> 'idle' and a.pid <> pg_backend_pid()
      and a.query_start is not null;
    v := v || jsonb_build_object('db.longest_query_s', s);
  exception when others then
    v := v || jsonb_build_object('db.longest_query_s', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- Autovacuum keeping up on Micro's CPU share. Worst hot table is the number;
  -- every hot table is in the detail.
  begin
    with hot as (
      select relname, n_live_tup, n_dead_tup,
             case when n_live_tup + n_dead_tup > 0 then n_dead_tup::numeric / (n_live_tup + n_dead_tup) else 0 end as ratio
      from pg_stat_user_tables
      where schemaname = 'public'
        and relname in ('point_transactions', 'gym_visits', 'activity_sessions', 'gym_visit_events', 'geofence_region_events', 'push_send_log')
    ), worst as (
      select * from hot order by ratio desc limit 1
    )
    select jsonb_build_object(
      'numerator',   (select n_dead_tup from worst),
      'denominator', (select n_live_tup + n_dead_tup from worst),
      'detail', jsonb_build_object(
        'worst_table', (select relname from worst),
        'tables', (select jsonb_object_agg(relname, jsonb_build_object('live', n_live_tup, 'dead', n_dead_tup)) from hot)
      ),
      'evidence_ok', (select count(*) from hot) > 0
    ) into s;
    v := v || jsonb_build_object('db.dead_tuple_pct', s);
  exception when others then
    v := v || jsonb_build_object('db.dead_tuple_pct', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  begin
    select jsonb_build_object(
      'numerator', pg_database_size(current_database()), 'denominator', null,
      'detail', jsonb_build_object('pretty', pg_size_pretty(pg_database_size(current_database()))),
      'evidence_ok', true
    ) into s;
    v := v || jsonb_build_object('db.size_bytes', s);
  exception when others then
    v := v || jsonb_build_object('db.size_bytes', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- ── INTEGRITY ────────────────────────────────────────────────────────────

  -- ⚠ "More than one earn per session" is NOT a duplicate. A gym session
  -- legitimately carries two (claim + upgrade, different descriptions) and a
  -- health_sync walking session is topped up as the day's steps grow — the cap
  -- trigger's bound 1 exists to allow exactly that. Day one of this page counted
  -- 260 such sessions and would have reported an incident that was not one.
  -- The RACE signature (2026-05-29 investigation) is: same session, same amount,
  -- written within 5 seconds of each other. That is what this counts.
  begin
    with pairs as (
      select a.session_id, b.amount
      from public.point_transactions a
      join public.point_transactions b
        on b.session_id = a.session_id
       and b.type = 'earn'
       and b.id <> a.id
       and b.amount = a.amount
       and b.created_at > a.created_at
       and b.created_at - a.created_at < interval '5 seconds'
      where a.type = 'earn' and a.session_id is not null
    )
    select jsonb_build_object(
      'numerator', count(distinct session_id), 'denominator', null,
      'detail', jsonb_build_object('excess_rows', count(*), 'excess_points', coalesce(sum(amount), 0)),
      'evidence_ok', true
    ) into s from pairs;
    v := v || jsonb_build_object('integrity.dup_earns', s);
  exception when others then
    v := v || jsonb_build_object('integrity.dup_earns', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  begin
    select jsonb_build_object(
      'numerator', count(*), 'denominator', null,
      'detail', jsonb_build_object('oldest_started_at', min(started_at)),
      'evidence_ok', true
    ) into s
    from public.gym_visits
    where ended_at is null and started_at < v_now - interval '12 hours';
    v := v || jsonb_build_object('integrity.open_visits_12h', s);
  exception when others then
    v := v || jsonb_build_object('integrity.open_visits_12h', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- Presence PROVEN for at least the dwell threshold, visit closed, no claim.
  -- The 2026-08-13 class: the wake landed, the fix was trusted, the claim never
  -- did — and nothing else in the system records that it should have.
  begin
    select jsonb_build_object(
      'numerator', count(*) filter (where not (gv.user_id = any(v_excl_users))),
      'denominator', null,
      'detail', jsonb_build_object(
        'including_test', count(*),
        'dwell_minutes',  v_dwell,
        'visit_ids', coalesce((
          select jsonb_agg(x.id) from (
            select gv2.id from public.gym_visits gv2
            where gv2.ended_at >= v_24h and gv2.claimed_session_id is null and gv2.last_proven_at is not null
              and gv2.last_proven_at - gv2.started_at >= make_interval(mins => v_dwell)
              and not (gv2.user_id = any(v_excl_users))
            order by gv2.ended_at desc limit 20
          ) x
        ), '[]'::jsonb)
      ),
      'evidence_ok', true
    ) into s
    from public.gym_visits gv
    where gv.ended_at >= v_24h
      and gv.claimed_session_id is null
      and gv.last_proven_at is not null
      and gv.last_proven_at - gv.started_at >= make_interval(mins => v_dwell);
    v := v || jsonb_build_object('integrity.proven_unpaid_24h', s);
  exception when others then
    v := v || jsonb_build_object('integrity.proven_unpaid_24h', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- Journeys rolled up after their raw evidence was purged. The "publish a lie"
  -- guard from Live Ops, as a standing count.
  begin
    select jsonb_build_object(
      'numerator', count(*) filter (where not evidence_complete),
      'denominator', count(*),
      'detail', jsonb_build_object('journeys_7d', count(*)),
      'evidence_ok', true
    ) into s
    from public.gym_visit_journeys
    where started_at >= v_7d;
    v := v || jsonb_build_object('integrity.evidence_gap_7d', s);
  exception when others then
    v := v || jsonb_build_object('integrity.evidence_gap_7d', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- PostgREST caps EVERY response at 1000 rows and raises no error. The app
  -- reads a member's own ledger and own sessions unbounded; `rewards` is read
  -- whole. `partners` (7.8k) is already paginated and listed for the record.
  begin
    with per_user_pt as (select count(*) as n from public.point_transactions group by user_id),
         per_user_as as (select count(*) as n from public.activity_sessions group by user_id)
    select jsonb_build_object(
      'numerator', greatest(
        coalesce((select max(n) from per_user_pt), 0),
        coalesce((select max(n) from per_user_as), 0),
        (select count(*) from public.rewards)
      ),
      'denominator', null,
      'detail', jsonb_build_object(
        'ledger_rows_max_user',   coalesce((select max(n) from per_user_pt), 0),
        'sessions_max_user',      coalesce((select max(n) from per_user_as), 0),
        'rewards',                (select count(*) from public.rewards),
        'partners_paginated',     (select count(*) from public.partners),
        'cap', 1000
      ),
      'evidence_ok', true
    ) into s;
    v := v || jsonb_build_object('integrity.postgrest_cap', s);
  exception when others then
    v := v || jsonb_build_object('integrity.postgrest_cap', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- A dead cron fails silently — there is no other alarm. Allowance is derived
  -- from the schedule shape: sub-hourly jobs get 3× their interval, hourly get
  -- 3 h, daily 26 h, anything else 8 d.
  begin
    with jobs as (
      select j.jobid, j.jobname, j.schedule,
        case
          when j.schedule ~ '^\*\s'          then interval '5 minutes'
          when j.schedule ~ '^\*/\d+\s'      then make_interval(mins => 3 * substring(j.schedule from '^\*/(\d+)')::int)
          when j.schedule ~ '^\d+\s+\*\s'    then interval '3 hours'
          when j.schedule ~ '^\d+\s+\d+\s+\*\s+\*\s+\*$' then interval '26 hours'
          else interval '8 days'
        end as allowance,
        (select max(r.start_time) from cron.job_run_details r where r.jobid = j.jobid) as last_run,
        (select count(*) from cron.job_run_details r where r.jobid = j.jobid and r.start_time >= v_24h and r.status <> 'succeeded') as failed_24h
      from cron.job j
      where j.active
    )
    -- A job with NO run history is listed under never_run and not counted:
    -- cron.job has no created_at, so a job scheduled minutes ago would read as
    -- dead for its whole first allowance (this page's own cron did, on day one).
    select jsonb_build_object(
      'numerator', count(*) filter (where last_run is not null and last_run < v_now - allowance),
      'denominator', count(*),
      'detail', jsonb_build_object(
        'silent',    coalesce(jsonb_agg(jobname) filter (where last_run is not null and last_run < v_now - allowance), '[]'::jsonb),
        'never_run', coalesce(jsonb_agg(jobname) filter (where last_run is null), '[]'::jsonb),
        'failed_24h_total', coalesce(sum(failed_24h), 0),
        'failing', coalesce(jsonb_agg(jsonb_build_object('job', jobname, 'failed', failed_24h)) filter (where failed_24h > 0), '[]'::jsonb)
      ),
      'evidence_ok', count(*) > 0
    ) into s from jobs;
    v := v || jsonb_build_object('integrity.cron_silent', s);
  exception when others then
    v := v || jsonb_build_object('integrity.cron_silent', jsonb_build_object('evidence_ok', false, 'error', sqlerrm));
  end;

  -- ── Envelope ─────────────────────────────────────────────────────────────
  begin
    select i.stats_reset into v_pss_reset from extensions.pg_stat_statements_info i;
  exception when others then
    v_pss_reset := null;
  end;
  begin
    select max(captured_at) into v_last_snap from public.system_health_snapshots;
  exception when others then
    v_last_snap := null;
  end;

  return jsonb_build_object(
    'captured_at',      v_now,
    'signals',          v,
    'pss_stats_reset',  v_pss_reset,
    'db_stats_reset',   v_db_reset,
    'last_snapshot_at', v_last_snap
  );
end;
$function$;

revoke all on function public.system_health_facts() from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. GATED READ
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.admin_system_health_live()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return public.system_health_facts();
end;
$function$;

revoke all on function public.admin_system_health_live() from public, anon;
grant execute on function public.admin_system_health_live() to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. SNAPSHOT — cron every hour, plus the page's "Snapshot now"
-- ═══════════════════════════════════════════════════════════════════════════

-- Internal: not granted to anyone. The cron runs as the owner.
-- Idempotent within a minute so a button mash next to the cron tick does not
-- double-write the hour.
create or replace function public.system_health_snapshot_capture()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_doc   jsonb;
  v_at    timestamptz;
  v_n     integer := 0;
begin
  if exists (select 1 from public.system_health_snapshots where captured_at >= now() - interval '60 seconds') then
    return 0;
  end if;

  v_doc := public.system_health_facts();
  v_at  := (v_doc ->> 'captured_at')::timestamptz;

  insert into public.system_health_snapshots (captured_at, signal, numerator, denominator, detail, evidence_ok)
  select
    v_at,
    e.key,
    nullif(e.value ->> 'numerator', '')::numeric,
    nullif(e.value ->> 'denominator', '')::numeric,
    e.value -> 'detail',
    coalesce((e.value ->> 'evidence_ok')::boolean, false)
  from jsonb_each(v_doc -> 'signals') e;

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.system_health_snapshot_capture() from public, anon, authenticated;

create or replace function public.admin_system_health_snapshot()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return public.system_health_snapshot_capture();
end;
$function$;

revoke all on function public.admin_system_health_snapshot() from public, anon;
grant execute on function public.admin_system_health_snapshot() to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. HISTORY — one jsonb document keyed by signal
-- ═══════════════════════════════════════════════════════════════════════════
--
-- One row, one document, so the PostgREST 1000-row cap cannot truncate a week of
-- hourly snapshots across ~25 signals (≈4,200 points). Compact tuples, ascending:
--   { "<signal>": [[captured_at, numerator, denominator, evidence_ok], …], … }
-- Detail is deliberately left in the table — it is forensic, not a trend.
create or replace function public.admin_system_health_history(
  p_from timestamptz,
  p_to   timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v jsonb;
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(s.signal, s.points), '{}'::jsonb) into v
  from (
    select signal,
           jsonb_agg(jsonb_build_array(captured_at, numerator, denominator, evidence_ok) order by captured_at) as points
    from public.system_health_snapshots
    where captured_at >= p_from and captured_at < p_to
    group by signal
  ) s;

  return v;
end;
$function$;

revoke all on function public.admin_system_health_history(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_system_health_history(timestamptz, timestamptz) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. CRON + first snapshot
-- ═══════════════════════════════════════════════════════════════════════════

select cron.schedule(
  'snapshot-system-health',
  '0 * * * *',
  $cron$select public.system_health_snapshot_capture()$cron$
);

-- Day one has a baseline, not an empty chart.
select public.system_health_snapshot_capture();
