-- Two "unreachable" gym_visits states, one shared root cause: `status` and
-- `ended_at` were written by different statements at different times, and nothing
-- ever asserted they agree.
--
-- Audited 2026-08-09. Twelve rows carried a non-terminal status ('open',
-- 'claimed', 'upgraded') with `ended_at` already stamped, the oldest from
-- 2026-07-14. They read as "never closed" — but ZERO visits in the table have
-- `ended_at is null`. Nothing was open. The label was wrong, not the lifecycle.
--
-- ---------------------------------------------------------------------------
-- Why neither closer ever touched them
-- ---------------------------------------------------------------------------
-- Both closers key on `ended_at is null`, and these rows have ended_at set:
--
--   * beacon stale-close reaper (gym-visit-beacon, 45 min past upgraded_at)
--       .is('ended_at', null).not('upgraded_at','is',null)
--   * abandon cron (jobid 8, hourly at :20)
--       where ended_at is null and started_at < now() - interval '12 hours'
--
-- So "the 45-minute reaper never ran" is not what happened. It runs every minute
-- (38,724 executions since 2026-07-13, zero failures) and the abandon cron has
-- run 646 times, also without failure. Both simply cannot match a row whose
-- ended_at is already stamped. Once a visit entered this state it was permanently
-- unreachable by every mechanism designed to close it.
--
-- ---------------------------------------------------------------------------
-- How the rows got there — two historical paths, both now closed
-- ---------------------------------------------------------------------------
-- PATH A — a closer that stamped ended_at but not status. Before 20260801100000,
-- open_gym_visit's supersede branch was:
--
--     update gym_visits set ended_at = coalesce(last_confirmed_at, started_at)
--      where id = v_id and ended_at is null;          -- no status, no close_reason
--
-- Signature: ended_at == last_confirmed_at exactly, plus a 'closed_stale' event.
-- Matches b2fb71a2, cae1c4c1, f5da0e54, fa50658c.
--
-- PATH B — a late progress relay resurrecting a status that had already gone
-- terminal. Before 20260808102000, mark_gym_visit_progress did `set status =
-- p_stage` unconditionally, and it has never had an `ended_at is null` guard. So:
-- abandon cron ends the visit ('abandoned', ended_at = started_at + 12h) → hours
-- later the device finally answers → status flips back to 'claimed'/'upgraded'
-- while ended_at stays. Matches ab3e0f38 (upgrade landed 14h after start, 2h
-- after the cron ended it) and 3ea18952 (claim landed 16h after start, keeping
-- close_reason='abandoned_12h' next to status='claimed'). 09fa5dc7 is the same
-- shape against a real exit: close_gym_visit wrote 'closed'/'exit' at 19:23:03,
-- and a claim relay 5 seconds later flipped status back to 'claimed'.
--
-- close_reason is null on every July row because the column did not exist until
-- 20260801100000 — that is why the cause is invisible on the older ones and has
-- to be recovered from gym_visit_events and the timestamp arithmetic below.
--
-- 20260808102000 (monotonic status) closed PATH B's status regression. This
-- migration adds the missing `ended_at is null` guard so the state cannot be
-- reconstructed by any other ordering, and asserts the invariant.
--
-- ---------------------------------------------------------------------------
-- Why upgraded_at is reachable with claimed_at null
-- ---------------------------------------------------------------------------
-- It is not an accident — it is written into the CASE:
--
--     when p_stage = 'upgraded' and status in ('open','claimed') then 'upgraded'
--
-- 'open' is accepted, and claimed_at is only stamped when p_stage = 'claimed'.
-- upgrade-gym-tier's markVisitUpgraded does the same thing directly. The trigger
-- is a device that answers a dwell nudge LATE: b2fb71a2's dwell nudges went out at
-- 30 and 36 minutes, the device replied at 40.9 minutes, and the client went
-- straight to the 40-min tier — the claim stage was never separately recorded.
--
-- The fix must not be "refuse the upgrade". The dwell was genuinely served and the
-- bonus is genuinely earned; refusing it would drop a real workout to satisfy a
-- bookkeeping rule. Instead an upgrade now IMPLIES the claim: claimed_at is
-- stamped from upgraded_at whenever it is missing. That is enforced by a trigger
-- rather than in each caller, so it also holds for the edge functions that write
-- gym_visits directly and would otherwise need a deploy to stay legal.
--
-- ---------------------------------------------------------------------------
-- Why this backfill cannot resurrect the 2026-08-08 duplicate-visit hazard
-- ---------------------------------------------------------------------------
-- The field test on 2026-08-08 established that closing a visit server-side makes
-- an Android device open a DUPLICATE, because it re-resolves via openGymVisit on
-- every wake. That hazard is about making a LIVE visit stop being live.
--
-- This migration never does that. It only writes `status`, `close_reason` and
-- `claimed_at` on rows where `ended_at is ALREADY not null`. Every liveness
-- predicate in the system keys on `ended_at is null` — open_gym_visit's lookup and
-- its one-live-per-user partial index, gym-visit-beacon's dueVisits, the fence and
-- presence passes, the stale-close scan, upgrade-gym-tier's visit read. None of
-- them reads `status` to decide whether a visit is live. So no device's view of
-- what is open changes by a single row, and the invariant holds regardless of
-- whether the visitId stamping fix (e272f7f) has reached devices yet.

-- ---------------------------------------------------------------------------
-- 1. Backfill status/close_reason from evidence, never from a guess
-- ---------------------------------------------------------------------------
-- Precedence: an existing close_reason is authoritative; then a recorded
-- 'closed_stale' event; then ended_at landing exactly on started_at + 12h, which
-- only the abandon cron's third coalesce branch can produce. Anything left is
-- marked as such rather than being attributed to a cause we cannot evidence.
update public.gym_visits v
   set status = case
         when v.close_reason = 'abandoned_12h' then 'abandoned'
         when v.close_reason is not null then 'closed'
         when exists (select 1 from public.gym_visit_events e
                       where e.visit_id = v.id and e.event = 'closed_stale') then 'closed'
         when abs(extract(epoch from (v.ended_at - (v.started_at + interval '12 hours')))) < 1
           then 'abandoned'
         else 'closed'
       end,
       close_reason = case
         when v.close_reason is not null then v.close_reason
         when exists (select 1 from public.gym_visit_events e
                       where e.visit_id = v.id and e.event = 'closed_stale')
           then 'superseded_by_new_check_in'
         when abs(extract(epoch from (v.ended_at - (v.started_at + interval '12 hours')))) < 1
           then 'abandoned_12h'
         else 'ended_status_backfill'
       end
 where v.ended_at is not null
   and v.status not in ('closed','abandoned');

-- ---------------------------------------------------------------------------
-- 2. Backfill the implied claim
-- ---------------------------------------------------------------------------
-- ⚠ claimed_at on these rows is DERIVED, not observed: it records the moment the
-- upgrade proved the dwell, because no separate claim was ever seen. Anything
-- measuring claim latency should treat claimed_at = upgraded_at as "claim and
-- upgrade collapsed into one late answer", not as a 40-minute-instant claim.
update public.gym_visits
   set claimed_at = upgraded_at
 where upgraded_at is not null
   and claimed_at is null;

-- ---------------------------------------------------------------------------
-- 3. An upgrade implies a claim — enforced for every writer, not every caller
-- ---------------------------------------------------------------------------
create or replace function public.gym_visit_upgrade_implies_claim()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.upgraded_at is not null and new.claimed_at is null then
    new.claimed_at := new.upgraded_at;
  end if;
  return new;
end;
$function$;

comment on function public.gym_visit_upgrade_implies_claim() is
  'Stamps the implied claim when a visit is upgraded without one. Never refuses the upgrade: reaching the 40-minute tier proves the 30-minute dwell was served, so the ordering is repaired rather than the bonus dropped.';

drop trigger if exists gym_visits_upgrade_implies_claim on public.gym_visits;
create trigger gym_visits_upgrade_implies_claim
  before insert or update on public.gym_visits
  for each row execute function public.gym_visit_upgrade_implies_claim();

-- ---------------------------------------------------------------------------
-- 4. mark_gym_visit_progress — status advances only while the visit is live
-- ---------------------------------------------------------------------------
-- 20260808102000 made status monotonic within the open lifecycle but left the
-- terminal states out of the CASE, so it still reasons about 'open'/'claimed' on a
-- row that has already ended. Adding `ended_at is null` states the real rule
-- directly rather than relying on the terminal statuses to stand in for it.
--
-- Timestamps keep their coalesce semantics from 20260808102000 — a genuinely late
-- 'upgraded' still records upgraded_at on an ended visit, because the stamp is
-- history and the status is state. last_confirmed_at still moves on every call:
-- the device did answer, and the reaper needs to know that.
create or replace function public.mark_gym_visit_progress(
  p_visit_id uuid,
  p_stage text,
  p_session_id uuid default null::uuid
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_stage not in ('claimed','upgraded') then raise exception 'bad stage'; end if;

  update gym_visits
     set status             = case
                                when ended_at is not null                                     then status
                                when p_stage = 'claimed'  and status = 'open'                 then 'claimed'
                                when p_stage = 'upgraded' and status in ('open','claimed')     then 'upgraded'
                                else status
                              end,
         claimed_session_id = coalesce(p_session_id, claimed_session_id),
         -- An upgrade implies the claim (see the trigger above); stamping it here
         -- too keeps the RPC self-consistent when read on its own.
         claimed_at         = case when p_stage in ('claimed','upgraded') then coalesce(claimed_at, now()) else claimed_at end,
         upgraded_at        = case when p_stage = 'upgraded' then coalesce(upgraded_at, now()) else upgraded_at end,
         last_confirmed_at  = now()
   where id = p_visit_id and user_id = v_user;

  if not found then raise exception 'visit not found'; end if;

  insert into gym_visit_events (visit_id, user_id, event, detail)
  values (p_visit_id, v_user, p_stage, jsonb_build_object('session_id', p_session_id));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. The invariants, asserted
-- ---------------------------------------------------------------------------
-- ended_at and status are set by the same statement in every closer
-- (close_gym_visit, open_gym_visit's supersede branch, the abandon cron, the
-- beacon's stale-close), and every writer that advances status is now either
-- filtered on `ended_at is null` (upgrade-gym-tier's markVisitUpgraded) or guards
-- on it directly (mark_gym_visit_progress above). confirm_gym_visit_v2's two
-- inline advances are gated on status = 'open' / 'claimed', which this constraint
-- makes equivalent to the ended_at test. So neither check can fire from a code
-- path that exists today — and if one ever does, a loud failure on a retried RPC
-- is a far better outcome than the silent drift that produced these twelve rows.
alter table public.gym_visits
  add constraint gym_visits_ended_implies_terminal
  check (ended_at is null or status in ('closed','abandoned'));

alter table public.gym_visits
  add constraint gym_visits_upgrade_implies_claim
  check (upgraded_at is null or claimed_at is not null);

comment on constraint gym_visits_ended_implies_terminal on public.gym_visits is
  'A visit with ended_at set is over. Both closers (the 12h abandon cron and the beacon stale-close reaper) select on `ended_at is null`, so a non-terminal status here is unreachable by every mechanism meant to close it — the exact state 12 rows sat in from 2026-07-14 to 2026-08-09.';

comment on constraint gym_visits_upgrade_implies_claim on public.gym_visits is
  'The 40-minute tier cannot be reached without serving the 30-minute dwell, so upgraded_at without claimed_at is not a real lifecycle. Repaired by the gym_visits_upgrade_implies_claim trigger rather than by refusing the upgrade.';
