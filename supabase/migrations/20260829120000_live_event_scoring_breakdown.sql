-- Live events: the scoring breakdown, admin side.
--
-- 2026-08-29, Jamie: "a more detailed breakdown of the leaderboard the admin
-- can use to see what points are scoring what for each user … so we can see
-- who is doing what and make any adjustments if needed." The app shows a
-- member their own points; the admin panel showed only each person's total
-- and a session count. Nothing said WHICH rows made the number, or why a
-- row a member can see in their wallet is not on the board.
--
-- Three pieces:
--
--   1. _live_event_ledger — every ledger row that could have counted for the
--      event (credited inside the window, or backed by a session whose
--      activity overlaps it), each labelled with a bucket, whether it
--      counted, and the reason it did not. _live_event_counted becomes a
--      thin filter over it, so the breakdown can never disagree with the
--      score: same rows, same rule, one place. Every existing consumer
--      (_live_event_scores, _live_event_user_points, both leaderboards,
--      settle, anticheat) keeps reading _live_event_counted unchanged.
--
--   2. live_event_score_adjustments — an EVENT-SCOPED correction. Adds to
--      or takes from a person's score on THIS board only; the member's
--      wallet is untouched (wallet corrections stay on /admin/users, as
--      before). Always counts, whatever count_adjustments says — that flag
--      governs ordinary ledger adjustments that happen to land in the
--      window; this table exists for no other purpose than the board. It
--      is counted at the moment it was made, capped at the window end for
--      the tie-break, so a post-lock correction can never beat in-window
--      activity on time. Matches the DQ design: event-scoped, points
--      untouched, and Settle has to be re-run if results are already saved.
--
--   3. admin_get_event_scoring (per-person totals by bucket + by activity,
--      plus what was excluded and why), admin_get_event_user_ledger (one
--      person's rows, counted and not), admin_adjust_event_score and
--      admin_remove_event_score_adjustment.
--
-- Bucket vocabulary (shared/eventScoring.ts carries the labels):
--   activity · streak · challenge · bonus · adjustment · penalty · other
--   invite · attendance (never count) · event_adjustment (the new table)
-- Reason vocabulary (null = counted):
--   outside_window · manual_off · walking_off · activity_not_included ·
--   streak_off · challenges_off · bonuses_off · adjustments_off ·
--   never_counts · no_anchor · type_not_scored

-- ── 0. Snapshot the counted set before touching the predicate ───────────────
-- FNL x POWR is LIVE while this lands. The refactor below must be a pure
-- restatement of the predicate; §3b proves it against real data and aborts
-- the whole migration (one transaction) on any difference.

create temp table _counted_before as
  select ev.id as event_id, c.user_id, c.amount, c.created_at
  from public.live_events ev
  cross join lateral public._live_event_counted(ev.id) c
  where ev.status <> 'archived';

-- ── 1. Event-scoped adjustments ──────────────────────────────────────────────

create table if not exists public.live_event_score_adjustments (
  id         uuid        primary key default gen_random_uuid(),
  event_id   uuid        not null references public.live_events(id) on delete cascade,
  user_id    uuid        not null references public.profiles(id)    on delete cascade,
  amount     integer     not null check (amount <> 0 and amount between -5000 and 5000),
  reason     text        not null check (btrim(reason) <> ''),
  admin_id   uuid        references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.live_event_score_adjustments is
  'Admin corrections to one person''s score on one live-event board. Event-scoped: never touches the member''s wallet. Always counts toward the event score; removed rows stop counting.';

create index if not exists live_event_score_adjustments_event_user_idx
  on public.live_event_score_adjustments (event_id, user_id);

alter table public.live_event_score_adjustments enable row level security;

drop policy if exists "Admins read event score adjustments" on public.live_event_score_adjustments;
create policy "Admins read event score adjustments"
  on public.live_event_score_adjustments for select
  to authenticated
  using (exists (select 1 from public.admin_roles ar where ar.user_id = (select auth.uid())));

revoke all on public.live_event_score_adjustments from public, anon;
grant select on public.live_event_score_adjustments to authenticated;

-- ── 2. The labelled ledger ───────────────────────────────────────────────────
-- Candidate rows: credited inside the window, OR session-backed with the
-- activity overlapping it (a backfilled workout credited in-window but done
-- before it is a candidate that gets reason 'outside_window' — exactly the
-- row an admin asks about). Redeems are spends and never appear.

create or replace function public._live_event_ledger(p_event_id uuid, p_uid uuid default null)
returns table (
  tx_id        uuid,
  user_id      uuid,
  amount       integer,
  tx_type      text,
  source       text,
  description  text,
  created_at   timestamptz,
  session_id   uuid,
  activity     text,
  verification text,
  started_at   timestamptz,
  ended_at     timestamptz,
  bucket       text,
  counted      boolean,
  counted_at   timestamptz,
  reason       text
)
language sql
stable
security definer
set search_path = public
as $$
  with ev as (
    select * from public.live_events where id = p_event_id
  ),
  rows as (
    select pt.id                              as tx_id,
           pt.user_id,
           pt.amount,
           pt.type::text                      as tx_type,
           pt.source,
           pt.description,
           pt.created_at,
           s.id                               as session_id,
           s.type::text                       as s_type,
           s.verification::text               as s_verif,
           s.started_at,
           coalesce(s.ended_at, s.started_at) as ended_at
    from public.point_transactions pt
    cross join ev
    left join public.activity_sessions s on s.id = pt.session_id
    where (p_uid is null or pt.user_id = p_uid)
      and pt.type::text <> 'redeem'
      and (
        (pt.created_at >= ev.window_start_at and pt.created_at < ev.window_end_at)
        or (s.id is not null
            and coalesce(s.ended_at, s.started_at) > ev.window_start_at
            and s.started_at                       < ev.window_end_at)
      )
  ),
  sess as (
    -- session-backed: in the window when the ACTIVITY overlaps it.
    -- "manual" = the session's verification, never the ledger source
    -- (native HealthKit rows are source = 'manual_log').
    select r.*,
           case when r.tx_type = 'streak' then 'streak'
                when r.tx_type = 'earn'   then 'activity'
                else r.tx_type end as bucket,
           case
             when not (r.ended_at > ev.window_start_at and r.started_at < ev.window_end_at)
                                                                              then 'outside_window'
             when r.tx_type = 'streak' and not ev.count_streak                then 'streak_off'
             when r.tx_type = 'streak'                                        then null
             when r.tx_type <> 'earn'                                         then 'type_not_scored'
             when not ev.count_manual  and coalesce(r.s_verif, '') = 'manual' then 'manual_off'
             when not ev.count_walking and coalesce(r.s_type, '')  = 'walking' then 'walking_off'
             when ev.included_activities is not null
                  and not (r.s_type = any (ev.included_activities))           then 'activity_not_included'
             else null
           end as reason
    from rows r
    cross join ev
    where r.session_id is not null
  ),
  other as (
    -- sessionless rows credited in the window. Which ones count is the
    -- event's choice, with two fixed rules the editor promises: penalties
    -- always reduce a score; invite rewards (and the attendance reward)
    -- never add to one. Sessionless earn / streak rows ride on in-window
    -- activity the member had already banked (a counted session row
    -- credited at or before them).
    select r.*,
           case
             when r.tx_type = 'penalty'    then 'penalty'
             when r.tx_type = 'adjustment' then 'adjustment'
             when coalesce(r.source, '') in ('weekly_challenge', 'shared_challenge', 'shared_challenge_bonus')
                                           then 'challenge'
             when coalesce(r.source, '') in ('referral_received', 'referral_sent', 'invite_milestone')
                                           then 'invite'
             when coalesce(r.source, '') = 'event_attendance'
                                           then 'attendance'
             when r.tx_type = 'bonus'      then 'bonus'
             when r.tx_type = 'streak'     then 'streak'
             else 'other'
           end as bucket,
           case
             when coalesce(r.source, '') in ('referral_received', 'referral_sent', 'invite_milestone', 'event_attendance')
                                                                              then 'never_counts'
             when r.tx_type = 'penalty'                                       then null
             when r.tx_type = 'adjustment'
                  then case when ev.count_adjustments then null else 'adjustments_off' end
             when coalesce(r.source, '') in ('weekly_challenge', 'shared_challenge', 'shared_challenge_bonus')
                  then case when ev.count_challenges then null else 'challenges_off' end
             when r.tx_type = 'bonus'
                  then case when ev.count_bonuses then null else 'bonuses_off' end
             when r.tx_type = 'streak' and not ev.count_streak                then 'streak_off'
             when r.tx_type in ('earn', 'streak')
                  then case when exists (
                         select 1 from sess x
                         where x.user_id = r.user_id
                           and x.reason is null
                           and x.created_at <= r.created_at
                       ) then null else 'no_anchor' end
             else 'type_not_scored'
           end as reason
    from rows r
    cross join ev
    where r.session_id is null
  )
  select s.tx_id, s.user_id, s.amount, s.tx_type, s.source, s.description, s.created_at,
         s.session_id, s.s_type, s.s_verif, s.started_at, s.ended_at,
         s.bucket, (s.reason is null),
         case when s.reason is null then s.ended_at end, s.reason
  from sess s
  union all
  select o.tx_id, o.user_id, o.amount, o.tx_type, o.source, o.description, o.created_at,
         o.session_id, o.s_type, o.s_verif, o.started_at, o.ended_at,
         o.bucket, (o.reason is null),
         case when o.reason is null then o.created_at end, o.reason
  from other o
$$;

revoke all on function public._live_event_ledger(uuid, uuid) from public, anon, authenticated;

-- ── 3. The scorer's predicate, now a filter over the ledger ─────────────────
-- Same output columns and semantics as before (probe: md5 of the counted
-- set must match the previous definition on real data), plus the
-- event-scoped adjustments.

create or replace function public._live_event_counted(p_event_id uuid, p_uid uuid default null)
returns table(user_id uuid, amount integer, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select l.user_id, l.amount, l.counted_at
  from public._live_event_ledger(p_event_id, p_uid) l
  where l.counted
  union all
  select a.user_id, a.amount, least(a.created_at, ev.window_end_at)
  from public.live_event_score_adjustments a
  join public.live_events ev on ev.id = a.event_id
  where a.event_id = p_event_id
    and (p_uid is null or a.user_id = p_uid)
$$;

revoke all on function public._live_event_counted(uuid, uuid) from public, anon, authenticated;

-- ── 3b. Prove the restatement ───────────────────────────────────────────────
-- The adjustments table is empty at this point, so the new counted set must
-- be row-for-row identical to the snapshot. Any difference is a bug in §2,
-- and the exception rolls everything back.

do $$
declare
  v_missing integer;
  v_extra   integer;
  v_rows    integer;
begin
  create temp table _counted_after as
    select ev.id as event_id, c.user_id, c.amount, c.created_at
    from public.live_events ev
    cross join lateral public._live_event_counted(ev.id) c
    where ev.status <> 'archived';

  select count(*) into v_missing from (
    select event_id, user_id, amount, created_at from _counted_before
    except all
    select event_id, user_id, amount, created_at from _counted_after
  ) d;
  select count(*) into v_extra from (
    select event_id, user_id, amount, created_at from _counted_after
    except all
    select event_id, user_id, amount, created_at from _counted_before
  ) d;
  select count(*) into v_rows from _counted_before;

  if v_missing > 0 or v_extra > 0 then
    raise exception 'live_event_scoring_breakdown: counted set changed (% rows before; % dropped, % added) — migration aborted',
      v_rows, v_missing, v_extra;
  end if;
  raise notice 'live_event_scoring_breakdown: counted set unchanged across % rows', v_rows;
end;
$$;

drop table if exists _counted_before;
drop table if exists _counted_after;

-- ── 4. The breakdown: everyone on the board, points by bucket ───────────────
-- Rows are the scorer's output (deadline-mode boards unenforced, like the
-- ops standings, so the admin sees who Settle would drop) narrowed to
-- people who have anything to look at — a score, a candidate ledger row,
-- or an adjustment. A global-scope event would otherwise list every member.

create or replace function public.admin_get_event_scoring(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event   public.live_events;
  v_enforce boolean;
  v_rows    jsonb;
  v_totals  jsonb;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  v_enforce := (v_event.entry_gate_mode = 'entry');

  with led as (
    select * from public._live_event_ledger(v_event.id)
  ),
  per as (
    select l.user_id,
           coalesce(sum(l.amount) filter (where l.counted and l.bucket = 'activity'),   0)::integer as activity_pts,
           coalesce(sum(l.amount) filter (where l.counted and l.bucket = 'streak'),     0)::integer as streak_pts,
           coalesce(sum(l.amount) filter (where l.counted and l.bucket = 'challenge'),  0)::integer as challenge_pts,
           coalesce(sum(l.amount) filter (where l.counted and l.bucket = 'bonus'),      0)::integer as bonus_pts,
           coalesce(sum(l.amount) filter (where l.counted and l.bucket = 'adjustment'), 0)::integer as adjustment_pts,
           coalesce(sum(l.amount) filter (where l.counted and l.bucket = 'penalty'),    0)::integer as penalty_pts,
           coalesce(sum(l.amount) filter (where l.counted and l.bucket = 'other'),      0)::integer as other_pts,
           (count(*) filter (where l.counted))::integer                                             as counted_rows,
           (count(*) filter (where not l.counted))::integer                                         as excluded_rows,
           coalesce(sum(l.amount) filter (where not l.counted and l.amount > 0), 0)::integer        as excluded_pts,
           (count(distinct l.session_id) filter (where l.counted and l.session_id is not null))::integer as counted_sessions,
           max(l.counted_at) filter (where l.counted)                                               as last_counted_at
    from led l
    group by l.user_id
  ),
  acts as (
    select t.user_id, jsonb_object_agg(t.activity, t.pts) as by_activity
    from (
      select l.user_id, coalesce(l.activity, 'unknown') as activity, sum(l.amount)::integer as pts
      from led l
      where l.counted and l.bucket = 'activity'
      group by l.user_id, coalesce(l.activity, 'unknown')
    ) t
    group by t.user_id
  ),
  excl as (
    select t.user_id, jsonb_object_agg(t.reason, t.pts) as excluded_by_reason
    from (
      select l.user_id, l.reason, sum(l.amount)::integer as pts
      from led l
      where not l.counted
      group by l.user_id, l.reason
    ) t
    group by t.user_id
  ),
  adj as (
    select a.user_id, sum(a.amount)::integer as pts, count(*)::integer as n
    from public.live_event_score_adjustments a
    where a.event_id = v_event.id
    group by a.user_id
  ),
  ranked as (
    select s.user_id, s.score, s.rank, s.last_counted_tx_at
    from public._live_event_scores(v_event.id, v_enforce) s
    where s.score <> 0
       or exists (select 1 from per   where per.user_id = s.user_id)
       or exists (select 1 from adj   where adj.user_id = s.user_id)
    order by s.rank
    limit 500
  )
  select jsonb_agg(jsonb_build_object(
           'rank',               r.rank,
           'user_id',            r.user_id,
           'display_name',       p.display_name,
           'username',           p.username,
           'avatar_url',         p.avatar_url,
           'member_id',          p.referral_code,
           'points',             r.score,
           'last_counted_at',    r.last_counted_tx_at,
           'gate_count',         g.n,
           'gate_met',           (v_event.entry_gate_n <= 0 or g.n >= v_event.entry_gate_n),
           'by_bucket',          jsonb_build_object(
                                   'activity',         coalesce(per.activity_pts, 0),
                                   'streak',           coalesce(per.streak_pts, 0),
                                   'challenge',        coalesce(per.challenge_pts, 0),
                                   'bonus',            coalesce(per.bonus_pts, 0),
                                   'adjustment',       coalesce(per.adjustment_pts, 0),
                                   'penalty',          coalesce(per.penalty_pts, 0),
                                   'other',            coalesce(per.other_pts, 0),
                                   'event_adjustment', coalesce(adj.pts, 0)
                                 ),
           'by_activity',        coalesce(acts.by_activity, '{}'::jsonb),
           'counted_rows',       coalesce(per.counted_rows, 0),
           'counted_sessions',   coalesce(per.counted_sessions, 0),
           'excluded_rows',      coalesce(per.excluded_rows, 0),
           'excluded_points',    coalesce(per.excluded_pts, 0),
           'excluded_by_reason', coalesce(excl.excluded_by_reason, '{}'::jsonb),
           'adjustments_n',      coalesce(adj.n, 0)
         ) order by r.rank)
    into v_rows
    from ranked r
    join public.profiles p on p.id = r.user_id
    left join per  on per.user_id  = r.user_id
    left join acts on acts.user_id = r.user_id
    left join excl on excl.user_id = r.user_id
    left join adj  on adj.user_id  = r.user_id
    left join lateral (select public._live_event_gate_count(v_event.id, r.user_id) as n) g on true;

  select jsonb_build_object(
           'counted_points',   coalesce(sum(l.amount) filter (where l.counted), 0),
           'excluded_points',  coalesce(sum(l.amount) filter (where not l.counted and l.amount > 0), 0),
           'excluded_rows',    count(*) filter (where not l.counted),
           'adjusted_points',  (select coalesce(sum(a.amount), 0) from public.live_event_score_adjustments a where a.event_id = v_event.id),
           'adjustments_n',    (select count(*) from public.live_event_score_adjustments a where a.event_id = v_event.id)
         )
    into v_totals
    from public._live_event_ledger(v_event.id) l;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id',                  v_event.id,
      'status',              v_event.status,
      'window_start_at',     v_event.window_start_at,
      'window_end_at',       v_event.window_end_at,
      'lock_at',             v_event.lock_at,
      'entry_gate_mode',     v_event.entry_gate_mode,
      'entry_gate_n',        v_event.entry_gate_n,
      'frozen',              (v_event.status in ('revealed', 'settled', 'archived')),
      'included_activities', v_event.included_activities,
      'count_manual',        v_event.count_manual,
      'count_walking',       v_event.count_walking,
      'count_streak',        v_event.count_streak,
      'count_challenges',    v_event.count_challenges,
      'count_bonuses',       v_event.count_bonuses,
      'count_adjustments',   v_event.count_adjustments
    ),
    'rows',         coalesce(v_rows, '[]'::jsonb),
    'totals',       v_totals,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.admin_get_event_scoring(uuid) from public, anon;
grant execute on function public.admin_get_event_scoring(uuid) to authenticated;

-- ── 5. One person's rows ────────────────────────────────────────────────────
-- Every candidate row, counted or not, newest first; plus their event
-- adjustments and the score the app is showing them.

create or replace function public.admin_get_event_user_ledger(p_event_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'event_id', v_event.id,
    'user', (
      select jsonb_build_object(
        'user_id',      p.id,
        'display_name', p.display_name,
        'username',     p.username,
        'avatar_url',   p.avatar_url,
        'member_id',    p.referral_code
      )
      from public.profiles p where p.id = p_user_id
    ),
    'points', public._live_event_user_points(v_event.id, p_user_id),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'tx_id',        l.tx_id,
               'amount',       l.amount,
               'tx_type',      l.tx_type,
               'source',       l.source,
               'description',  l.description,
               'created_at',   l.created_at,
               'session_id',   l.session_id,
               'activity',     l.activity,
               'verification', l.verification,
               'started_at',   l.started_at,
               'ended_at',     l.ended_at,
               'duration_sec', s.duration_sec,
               'flagged',      s.flagged,
               'venue_name',   pv.name,
               'raw_name',     s.raw_activity_name,
               'bucket',       l.bucket,
               'counted',      l.counted,
               'counted_at',   l.counted_at,
               'reason',       l.reason
             ) order by coalesce(l.counted_at, l.ended_at, l.created_at) desc, l.tx_id)
      from (
        select * from public._live_event_ledger(v_event.id, p_user_id)
        order by coalesce(counted_at, ended_at, created_at) desc
        limit 500
      ) l
      left join public.activity_sessions s on s.id = l.session_id
      left join public.partners pv on pv.id = s.partner_id
    ), '[]'::jsonb),
    'adjustments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',         a.id,
               'amount',     a.amount,
               'reason',     a.reason,
               'created_at', a.created_at,
               'admin_name', coalesce(pa.display_name, pa.username, 'Admin')
             ) order by a.created_at desc)
      from public.live_event_score_adjustments a
      left join public.profiles pa on pa.id = a.admin_id
      where a.event_id = v_event.id and a.user_id = p_user_id
    ), '[]'::jsonb),
    'frozen', (v_event.status in ('revealed', 'settled', 'archived')),
    'generated_at', now()
  );
end;
$$;

revoke all on function public.admin_get_event_user_ledger(uuid, uuid) from public, anon;
grant execute on function public.admin_get_event_user_ledger(uuid, uuid) to authenticated;

-- ── 6. Adjusting a score ────────────────────────────────────────────────────
-- Refused once results are revealed (frozen, like Settle). Allowed while
-- locked with results saved — the UI nags to Re-settle, as it does for DQ.
-- Hands back the person's refreshed ledger so the panel needs no second call.

create or replace function public.admin_adjust_event_score(
  p_event_id uuid,
  p_user_id  uuid,
  p_amount   integer,
  p_reason   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
  v_id    uuid;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if v_event.status in ('revealed', 'settled', 'archived') then
    raise exception 'Results are frozen once revealed — the board cannot be adjusted' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'Enter a non-zero amount' using errcode = 'P0001';
  end if;
  if abs(p_amount) > 5000 then
    raise exception 'Keep adjustments within ±5000 points' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Give a reason — it is shown on the breakdown and in the audit log' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'No such member' using errcode = 'P0002';
  end if;

  insert into public.live_event_score_adjustments (event_id, user_id, amount, reason, admin_id)
  values (p_event_id, p_user_id, p_amount, btrim(p_reason), auth.uid())
  returning id into v_id;

  return public.admin_get_event_user_ledger(p_event_id, p_user_id)
      || jsonb_build_object('adjustment_id', v_id);
end;
$$;

revoke all on function public.admin_adjust_event_score(uuid, uuid, integer, text) from public, anon;
grant execute on function public.admin_adjust_event_score(uuid, uuid, integer, text) to authenticated;

create or replace function public.admin_remove_event_score_adjustment(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adj   public.live_event_score_adjustments;
  v_event public.live_events;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_adj from public.live_event_score_adjustments where id = p_id;
  if not found then
    raise exception 'Adjustment not found' using errcode = 'P0002';
  end if;
  select * into v_event from public.live_events where id = v_adj.event_id;
  if v_event.status in ('revealed', 'settled', 'archived') then
    raise exception 'Results are frozen once revealed — the board cannot be adjusted' using errcode = 'P0001';
  end if;

  delete from public.live_event_score_adjustments where id = p_id;

  return public.admin_get_event_user_ledger(v_adj.event_id, v_adj.user_id)
      || jsonb_build_object('removed', to_jsonb(v_adj));
end;
$$;

revoke all on function public.admin_remove_event_score_adjustment(uuid) from public, anon;
grant execute on function public.admin_remove_event_score_adjustment(uuid) to authenticated;
