-- Live events: invite rewards can count towards the score.
--
-- 2026-08-30, Jamie: "referrals are going to count towards the live events
-- … update this for the current running live event so they count and also
-- add a toggle in for this so we can switch it on and off in admin."
--
-- Until now invite rewards (referral_sent / referral_received on a friend's
-- first verified workout, and the invite_milestone bonus) were one of the
-- two FIXED exclusions in `_live_event_ledger` — reason 'never_counts',
-- whatever the editor said. FNL x POWR's whole mechanic is bringing friends
-- (entry gate = 3 signups), so the people doing the most of what the event
-- asks for were the ones the board did not credit for it.
--
-- This makes invite rewards a per-event switch like the others:
--
--   live_events.count_referrals  (default OFF — every existing event keeps
--                                 scoring exactly as before; FNL is flipped
--                                 on separately, audit-logged)
--
-- Rule: an invite reward counts when the switch is on AND the row was
-- credited inside the scoring window (the existing candidate filter). No
-- anchor is required — unlike a challenge payout, a referral row is paid at
-- the moment the friend's first verified workout lands, so an in-window row
-- is in-window effort by construction and can never be a wearable backfill.
-- The reason for an excluded row becomes 'referrals_off' (a switch the
-- editor can flip, like 'bonuses_off'); 'never_counts' is now attendance only.
--
-- admin_get_event_scoring gains an 'invite' bucket in by_bucket and
-- 'count_referrals' in the event block; shared/eventScoring.ts carries the
-- labels and the rule chip. _live_event_counted is untouched (a thin filter
-- over the ledger), so every board / settle / anticheat consumer picks this
-- up by construction.
--
-- Both function bodies below are the CURRENT prod bodies (verified
-- 2026-08-30 by md5 of the comment-stripped pg_get_functiondef output)
-- with only the lines described above changed — never an older file.

-- ── 0. Snapshot the counted set before touching the predicate ───────────────
-- FNL x POWR is LIVE while this lands. With the new column defaulting to
-- false the redefinition must be a pure restatement; §3 proves it against
-- real data and aborts the whole migration (one transaction) on any
-- difference.

create temp table _counted_before as
  select ev.id as event_id, c.user_id, c.amount, c.created_at
  from public.live_events ev
  cross join lateral public._live_event_counted(ev.id) c
  where ev.status <> 'archived';

-- ── 1. The switch ────────────────────────────────────────────────────────────

alter table public.live_events
  add column if not exists count_referrals boolean not null default false;

comment on column public.live_events.count_referrals is
  'When true, invite rewards credited inside the scoring window (referral_sent, referral_received, invite_milestone) count towards the event score. Default false: they are ordinary POWR points only. The event-night attendance reward never counts either way.';

-- ── 2. The labelled ledger ───────────────────────────────────────────────────

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
    -- always reduce a score; the attendance reward never adds to one.
    -- Invite rewards (both sides of a conversion + the milestone) are a
    -- switch like the others — count_referrals — and need no anchor: they
    -- are paid at the moment the friend converts, so an in-window row IS
    -- in-window effort, never a backfill. Sessionless earn / streak rows
    -- ride on in-window activity the member had already banked (a counted
    -- session row credited at or before them).
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
             when coalesce(r.source, '') = 'event_attendance'                 then 'never_counts'
             when coalesce(r.source, '') in ('referral_received', 'referral_sent', 'invite_milestone')
                  then case when ev.count_referrals then null else 'referrals_off' end
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

-- ── 3. Prove the restatement ────────────────────────────────────────────────
-- Every event still has count_referrals = false here, so the counted set
-- must be byte-identical to the snapshot. Any difference = the migration
-- rolls back.

do $$
declare
  v_missing integer;
  v_extra   integer;
begin
  select count(*) into v_missing
  from (
    select * from _counted_before
    except all
    select ev.id, c.user_id, c.amount, c.created_at
    from public.live_events ev
    cross join lateral public._live_event_counted(ev.id) c
    where ev.status <> 'archived'
  ) d;

  select count(*) into v_extra
  from (
    select ev.id, c.user_id, c.amount, c.created_at
    from public.live_events ev
    cross join lateral public._live_event_counted(ev.id) c
    where ev.status <> 'archived'
    except all
    select * from _counted_before
  ) d;

  if v_missing <> 0 or v_extra <> 0 then
    raise exception 'live_event_count_referrals: counted set changed with the switch off (missing %, extra %)', v_missing, v_extra;
  end if;
end;
$$;

drop table _counted_before;

-- ── 4. The breakdown: invite bucket + the switch in the event block ─────────

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
           coalesce(sum(l.amount) filter (where l.counted and l.bucket = 'invite'),     0)::integer as invite_pts,
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
                                   'invite',           coalesce(per.invite_pts, 0),
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
      'count_referrals',     v_event.count_referrals,
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
