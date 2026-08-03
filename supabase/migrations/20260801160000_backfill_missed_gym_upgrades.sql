-- Pay the gym sessions that were long enough for the 40-min tier but never got it.
--
-- THE DEFECT. Only 26 of 62 geofence gym sessions >= 2h ever received a
-- "gym session upgrade" transaction (42%). The claim fires at the 30-min tier
-- (15 pts) and a separate upgrade call is supposed to top it up to the 40-min
-- tier (20 pts) — but that second call is delivered by the beacon/relay and
-- frequently never lands: the visit never reaches status='claimed', or the 12h
-- abandon cron closes it first, or the nudge budget runs out, or there is no
-- push token. The user was demonstrably at a gym past the threshold and was
-- underpaid. Points may be corrected upward, so this is the one direction the
-- rules allow.
--
-- WHY A FLAT 5 AND NOT upgrade-gym-tier. The obvious approach — loop the
-- existing idempotent edge function over the missed sessions — silently
-- overpays. upgrade-gym-tier computes its target as
-- 20 + gymStreakBonus(current_streak) reading user_streaks.current_streak: the
-- streak TODAY, not the streak on the session's own day. Sorine has sessions
-- back to 2026-05-28 and a streak today of 49 (x3.0); Tim 57, Luke 47. Replaying
-- an old session at today's multiplier would pay up to 60 for a session that
-- earned ~20 at the time, irreversibly. So this pays the BASE tier difference
-- only, 20 - 15 = 5, with no multiplier. It cannot overpay by construction.
--
-- SCOPE. Deliberately excluded, and each exclusion is load-bearing:
--   · duration_sec = 43200 — the 12h backstop, never real presence. Paying these
--     rewards a measurement bug (see project_session_duration_integrity).
--   · partner "POWR" with a NULL place_id — the team's own test geofence at a
--     house, not a gym.
--   · the two dev rigs.
-- That leaves 29 sessions across 8 real users at real gyms.
--
-- THE CAP IS ENFORCED HERE, NOT BY THE TRIGGER. enforce_point_award_cap
-- (20260529000002) returns NEW immediately when the request role is NULL or
-- 'service_role' — a migration connection is exactly that case, so the trigger
-- would wave these inserts straight through. The 30/day gym cap is therefore
-- applied explicitly below, against the SESSION's UTC day.
--
-- Net effect: 43 points across 8 users. 19 of the 29 sessions were already at
-- the daily cap on their own day, so they pay 0 — had the upgrade fired at the
-- time it would have been clamped identically. NOT vaulting the clamped share
-- (which upgrade-gym-tier would have done) is a deliberate omission: the vault
-- feeds level progression and is out of scope for a corrective backfill.
--
-- IDEMPOTENT via point_transactions_unique_earn_per_session_desc, the partial
-- unique index on (session_id, description) where type='earn'. Re-running is a
-- no-op, and the fixed description also makes these rows match the
-- "already upgraded" predicate so a future sweep skips them.

with cfg as (
    select coalesce((select value::int from public.system_config
                     where key = 'gym_upgrade_minutes'), 40) as upgrade_min
),
target as (
    select s.id, s.user_id,
           date_trunc('day', s.started_at at time zone 'UTC') at time zone 'UTC' as day_start
    from public.activity_sessions s
    join public.partners p on p.id = s.partner_id
    left join auth.users u on u.id = s.user_id
    cross join cfg
    where s.type = 'gym'
      and s.verification = 'geofence'
      and s.duration_sec >= cfg.upgrade_min * 60
      and s.duration_sec <> 43200
      and not (p.name = 'POWR' and p.place_id is null)
      and coalesce(u.email, '') not in
          ('jamiemasonwright@gmail.com', 'bluegigsolutions@gmail.com')
      and not exists (
          select 1 from public.point_transactions t
          where t.session_id = s.id and t.description ilike '%upgrade%'
      )
),
-- Gym points already credited on each target session's own UTC day. Mirrors the
-- trigger's accounting: 'earn' and 'streak' rows both spend the daily cap.
already as (
    select t.id, t.user_id, t.day_start,
           coalesce((
               select sum(pt.amount)
               from public.point_transactions pt
               join public.activity_sessions s2 on s2.id = pt.session_id
               where pt.user_id = t.user_id
                 and pt.type in ('earn', 'streak')
                 and s2.type = 'gym'
                 and s2.started_at >= t.day_start
                 and s2.started_at <  t.day_start + interval '1 day'
           ), 0) as gym_today
    from target t
)
insert into public.point_transactions
    (user_id, session_id, amount, type, description, multiplier, source)
select a.user_id,
       a.id,
       least(5, 30 - a.gym_today),   -- flat tier gap, clamped to remaining headroom
       'earn',
       'gym session upgrade (backfill)',
       1.0,
       'backfill'
from already a
where 30 - a.gym_today > 0
on conflict do nothing;
