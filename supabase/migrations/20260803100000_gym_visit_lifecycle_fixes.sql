-- Two lifecycle bugs that quietly end a visit while the user is still in the gym.
--
-- Both matter more than they look, because a gym_visits row is the ONLY handle
-- the server has on a live session: gym-visit-beacon's dueVisits selects on
-- `ended_at is null`, so the moment a visit ends the beacon stops nudging for it
-- — the dwell claim AND the 40-min upgrade both go dark. Ending a visit early is
-- therefore equivalent to abandoning the points.

-- ---------------------------------------------------------------------------
-- 1. abandon cron (jobid 8) — don't give up on someone who is demonstrably there
-- ---------------------------------------------------------------------------
-- The predicate was start-age only: `ended_at is null and started_at < now() - 12h`.
-- Nothing consulted last_confirmed_at, which is written on every location-proven
-- inside-confirm — so a user still actively confirming presence at hour 12 was
-- marked 'abandoned' anyway, and their visit stopped being nudgeable.
--
-- Measured 2026-08-03: 55 of 100 post-beacon visits are status='abandoned' with a
-- mean span of 477 min. This is the single largest producer of dead visits.
--
-- The 12h backstop itself is kept — an actually-stale row must still be closed so
-- it cannot occupy the user's one live slot in gym_visits_one_live_per_user_idx.
-- The guard only says: if the device proved presence in the last 30 minutes, this
-- visit is alive, leave it for the next run.
--
-- Still deliberately NOT adding `and status = 'open'` (see 20260801100000 §5):
-- credited rows would then keep ended_at null forever and permanently occupy the
-- live slot, which is worse than a mislabelled status.
select cron.alter_job(
  8,
  command := $cron$
  update public.gym_visits
     set status = 'abandoned',
         close_reason = coalesce(close_reason, 'abandoned_12h'),
         ended_at = coalesce(ended_at, last_confirmed_at, started_at + interval '12 hours')
   where ended_at is null
     and started_at < now() - interval '12 hours'
     and coalesce(last_confirmed_at, started_at) < now() - interval '30 minutes'
  $cron$
);

-- ---------------------------------------------------------------------------
-- 2. open_gym_visit — the 4h ceiling was meant as a backstop, not a rule
-- ---------------------------------------------------------------------------
-- 20260801100001 fixed reuse to key on check-in IDENTITY rather than age, and its
-- own header says "The 4-hour ceiling is KEPT as a backstop for a caller that
-- passes no started_at". But the reuse branch ANDs `v_started_at > now() -
-- c_reuse_window` in for EVERY caller, including the ones that do pass a
-- timestamp — so the ceiling is a rule, not a backstop.
--
-- The consequence lands exactly on the long visits this work is about: 47% of
-- visits run past 4h. Beyond that mark the heartbeat's late-open retry (which
-- replays the SAME stored entryTimestamp) stops matching its own live row, so
-- instead of reusing it the function CLOSES it as 'superseded_by_new_check_in'
-- and opens a fresh one. The original visit dies mid-session and takes the
-- upgrade stage with it.
--
-- Identity is already proven by the two conditions that follow: the row's
-- started_at must sit within ±5 min of the caller's own check-in timestamp, and
-- the partner must match. A row satisfying both IS this check-in, whatever its
-- age. So apply the ceiling only when the caller gave us no timestamp to match on.
create or replace function public.open_gym_visit(
  p_partner_id uuid,
  p_region_id  text,
  p_started_at timestamptz,
  p_platform   text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c_same_checkin constant interval := interval '5 minutes';
  c_reuse_window constant interval := interval '4 hours';
  v_user       uuid := auth.uid();
  v_id         uuid;
  v_status     text;
  v_started_at timestamptz;
  v_partner_id uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  perform pg_advisory_xact_lock(hashtextextended('open_gym_visit:' || v_user::text, 0));

  select id, status, started_at, partner_id
    into v_id, v_status, v_started_at, v_partner_id
    from gym_visits
   where user_id = v_user and ended_at is null and status in ('open','claimed','upgraded')
   order by started_at desc
   limit 1;

  -- Re-use ONLY the row that is this very check-in, still live, at this gym.
  --   status   — a claimed/upgraded row is a finished session, never a live one
  --   identity — the row's started_at must BE the check-in the caller describes
  --   age      — backstop ONLY when the caller passed no started_at to match on;
  --              with a timestamp, identity is proof enough at any age (a 9-hour
  --              shift is still the same check-in)
  --   partner  — Yan26's 07-31 reuse crossed gyms, which would let
  --              confirm_gym_visit_v2 later credit a session at a gym she was
  --              never in. `is not distinct from` so a null/null pair matches.
  if v_id is not null
     and v_status = 'open'
     and (p_started_at is not null or v_started_at > now() - c_reuse_window)
     and v_partner_id is not distinct from p_partner_id
     and v_started_at between coalesce(p_started_at, now()) - c_same_checkin
                          and coalesce(p_started_at, now()) + c_same_checkin
  then
    insert into gym_visit_events (visit_id, user_id, event, detail)
    values (v_id, v_user, 'reused', jsonb_build_object(
      'region_id', p_region_id,
      'age_min',   round(extract(epoch from (now() - v_started_at)) / 60)
    ));
    return v_id;
  end if;

  -- Anything else live — finished-but-never-exited (2026-07-15), or belonging to a
  -- different check-in / different gym — is CLOSED so the beacon sees the NEW
  -- session. ended_at is bounded by the last location-proven presence.
  if v_id is not null then
    update gym_visits
       set ended_at     = coalesce(last_confirmed_at, started_at),
           status       = 'closed',
           close_reason = 'superseded_by_new_check_in'
     where id = v_id and ended_at is null;

    if found then
      insert into gym_visit_events (visit_id, user_id, event, detail)
      values (v_id, v_user, 'closed_stale', jsonb_build_object(
        'reason',          'superseded_by_new_check_in',
        'prior_status',    v_status,
        'age_min',         round(extract(epoch from (now() - v_started_at)) / 60),
        'partner_changed', (v_partner_id is distinct from p_partner_id)
      ));
    end if;
    v_id := null;
  end if;

  for attempt in 1..2 loop
    insert into gym_visits (user_id, partner_id, region_id, started_at, platform)
    values (v_user, p_partner_id, p_region_id, coalesce(p_started_at, now()), p_platform)
    on conflict (user_id) where ended_at is null do nothing
    returning id into v_id;

    if v_id is not null then
      insert into gym_visit_events (visit_id, user_id, event, detail)
      values (v_id, v_user, 'check_in', jsonb_build_object('region_id', p_region_id));
      return v_id;
    end if;

    -- Only reachable from a writer that did not hold our lock: it now owns the one
    -- live slot. ADOPT its row rather than returning NULL — a NULL means the device
    -- heartbeats into nothing for the rest of the visit.
    select id into v_id
      from gym_visits
     where user_id = v_user and ended_at is null
     order by started_at desc
     limit 1;

    if v_id is not null then return v_id; end if;
  end loop;

  raise exception 'open_gym_visit: could not open or adopt a live visit for %', v_user;
end;
$function$;

-- Signature is unchanged, so CREATE OR REPLACE keeps the existing ACL and cannot
-- leave a second overload behind (the 20260801100000 gotcha). Re-assert grants
-- anyway so the state is explicit and anon stays revoked.
revoke all on function public.open_gym_visit(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.open_gym_visit(uuid, text, timestamptz, text)
  to authenticated, service_role;
