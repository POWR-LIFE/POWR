-- Close a never-proven, never-claimed visit after 3 hours of nothing.
--
-- The structural gap recorded in project_gym_visit_status_ended_invariant:
-- nothing closes a visit on silence BEFORE the upgrade, so a check-in whose
-- device never once proved presence — a drive-by whose exit never reached the
-- server, or a phone whose background pipeline was dead — sits open for twelve
-- hours (visit 42c92efb, 2026-08-25: 4 nudges, 4 wakes, 0 confirms, abandoned at
-- 19:20). Live Ops shows it stuck all day; the settle passes skip it (they
-- require last_proven_at); the nudge budget is long spent.
--
-- WHY 3 HOURS AND WHY THIS SHAPE. This must never drop a workout. The visit is
-- selected only when it has no proof of presence at all (last_proven_at null)
-- and no claim — so there is no evidence to bank and no session to finalize. A
-- late claim after the close is exactly what already happens on the exit path
-- today (visit 24ce5188, 2026-08-20: exit-clamped to 0.0 min, claimed via relay
-- 16 s later with late_stamp; the 12h-abandoned visits of 08-17 were claimed the
-- next day) — mark_gym_visit_progress keeps a terminal status and stamps
-- claimed_at, claim-points scores the session and flags it unproven_duration.
-- Real late claims in the field landed at 103 and 122 min after check-in; 3 h
-- clears them with room. ended_at = started_at: the visit proved nothing, so
-- nothing later is an honest end — the same doctrine as the 12 h branch.
--
-- Same job, second statement, so the two nets stay in one place. close_reason
-- 'abandoned_unproven' distinguishes it from the 12 h net in Live Ops history.
do $job$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'abandon-stale-gym-visits';
  if v_jobid is null then
    raise exception 'cron job abandon-stale-gym-visits not found';
  end if;

  perform cron.alter_job(
    v_jobid,
    command := $cron$
    update public.gym_visits v
       set status       = 'abandoned',
           close_reason = coalesce(v.close_reason, 'abandoned_12h'),
           ended_at     = greatest(v.started_at, least(
                            coalesce(
                              v.last_confirmed_at,
                              (select max(e.created_at) from public.gym_visit_events e
                                where e.visit_id = v.id
                                  and e.event in ('stream_tick','confirmed_inside','check_in')),
                              v.started_at),
                            v.started_at + interval '12 hours'))
     where v.ended_at is null
       and v.started_at < now() - interval '12 hours';

    update public.gym_visits v
       set status       = 'abandoned',
           close_reason = coalesce(v.close_reason, 'abandoned_unproven'),
           ended_at     = v.started_at
     where v.ended_at is null
       and v.claimed_session_id is null
       and v.claimed_at is null
       and v.last_proven_at is null
       and v.started_at < now() - interval '3 hours'
    $cron$
  );
end
$job$;
