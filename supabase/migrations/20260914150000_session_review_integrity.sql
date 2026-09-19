-- Session Review integrity (2026-09-14).
--
-- The admin queue (/admin/sessions) was a symptom feed for three engine
-- defects, and nobody had worked it since 06-29:
--
--   1. The presence-proof flag was stamped at claim time and never re-read.
--      Five of 34 `unproven_duration` rows were fully proven by the time the
--      visit closed (Georgie ×2, Shaun, Sorine, Lucy: proof within 1–2 min of
--      the claimed length), and an END WITNESS (close_gym_visit believing the
--      device's own exit, 20260906170000) never advanced anything the audit
--      read — LP 09-14: 102 min, exit_witness, clamped:false, flagged at
--      proven 0. This migration re-runs the audit whenever the visit changes.
--   2. Reviewers could not see WHY a row was flagged: no proven-vs-claimed, no
--      gym, no "server settle vs device", no twin marker. admin_session_review_queue
--      joins all of it server-side (is_admin() proven; never a bare select —
--      see LiveOps.jsx for why).
--   3. Backfill: clear the flags the new rules would not set.
--
-- Client + edge-function halves: claim-points (twin gate, same-class
-- duplicates, settle exemption, exit witness), gym-visit-beacon (settle marker),
-- admin-review-session (reverses earn+streak, bulk), GeofenceContext (adopts the
-- visit's claimed session instead of writing a twin).

-- ── 1. What the visit engine can vouch for ──────────────────────────────

-- The latest exit row's end when close_gym_visit believed the device's own
-- end time. Mirrors END_WITNESS_BASES in _shared/proofAudit.ts.
create or replace function public.gym_visit_end_witnessed_at(p_visit_id uuid)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select (e.detail ->> 'ended_at')::timestamptz
    from gym_visit_events e
   where e.visit_id = p_visit_id
     and e.event = 'exit'
     and e.detail ->> 'end_basis' in ('exit_witness', 'capped_12h')
   order by e.created_at desc
   limit 1;
$$;

-- Seconds of presence provable for a visit: the later of the last proof and an
-- end witness, measured from the visit's start. 0 with neither.
create or replace function public.gym_visit_proven_sec(p_visit_id uuid)
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(
    greatest(0, round(extract(epoch from (
      greatest(v.last_proven_at, gym_visit_end_witnessed_at(v.id)) - v.started_at
    )))::int),
    0)
    from gym_visits v
   where v.id = p_visit_id;
$$;

-- ── 2. Re-run the audit against the current evidence ───────────────────

-- Removes `unproven_duration` from a session's flag_reason when the visit that
-- produced it now proves the claim (within the same 30-min tolerance the edge
-- function applies), and clears the flag when no reason is left. Idempotent.
-- Never ADDS a flag: that stays a claim-time decision, so a visit that later
-- looks worse cannot retroactively cost a user their recap.
create or replace function public.reconcile_session_proof_flag(p_session_id uuid)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_session  activity_sessions%rowtype;
  v_visit_id uuid;
  v_proven   integer;
  v_reasons  text[];
  v_kept     text[];
begin
  select * into v_session from activity_sessions where id = p_session_id;
  if not found or not coalesce(v_session.flagged, false) then return false; end if;
  if coalesce(v_session.flag_reason, '') not like '%unproven_duration%' then return false; end if;

  select v.id into v_visit_id
    from gym_visits v
   where v.claimed_session_id = p_session_id
   order by v.started_at desc
   limit 1;
  if v_visit_id is null then return false; end if;

  v_proven := gym_visit_proven_sec(v_visit_id);
  if coalesce(v_session.duration_sec, 0) - v_proven > 30 * 60 then return false; end if;

  v_reasons := string_to_array(v_session.flag_reason, ',');
  select coalesce(array_agg(r), '{}') into v_kept
    from unnest(v_reasons) r
   where btrim(r) <> '' and btrim(r) <> 'unproven_duration';

  update activity_sessions
     set flag_reason = nullif(array_to_string(v_kept, ','), ''),
         flagged     = (cardinality(v_kept) > 0)
   where id = p_session_id;

  insert into gym_visit_events (visit_id, user_id, event, detail)
  values (v_visit_id, v_session.user_id, 'proof_audit', jsonb_build_object(
    'session_id',  p_session_id,
    'session_sec', coalesce(v_session.duration_sec, 0),
    'proven_sec',  v_proven,
    'flagged',     (cardinality(v_kept) > 0),
    'cleared',     'unproven_duration',
    'remaining',   v_kept));
  return true;
end;
$$;

-- Fires on every visit change that can move the proof clock or the end: a
-- proof stamp, a close (exit / stale / abandon / settle), a late claim stamp.
create or replace function public.gym_visit_reconcile_session_flag()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.claimed_session_id is not null then
    perform reconcile_session_proof_flag(new.claimed_session_id);
  end if;
  return null;
end;
$$;

drop trigger if exists gym_visits_reconcile_session_flag on public.gym_visits;
create trigger gym_visits_reconcile_session_flag
  after update of last_proven_at, ended_at, status, claimed_session_id on public.gym_visits
  for each row
  when (new.claimed_session_id is not null)
  execute function public.gym_visit_reconcile_session_flag();

-- close_gym_visit also updates the claimed activity_session's ended_at/duration.
-- Reconcile there too so an exit witness written in the same close path is seen
-- against the final claimed duration rather than a pre-close snapshot.
create or replace function public.activity_session_reconcile_proof_flag()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform reconcile_session_proof_flag(new.id);
  return null;
end;
$$;

drop trigger if exists activity_sessions_reconcile_proof_flag on public.activity_sessions;
create trigger activity_sessions_reconcile_proof_flag
  after update of ended_at, duration_sec on public.activity_sessions
  for each row
  when (coalesce(new.flagged, false) and coalesce(new.flag_reason, '') like '%unproven_duration%')
  execute function public.activity_session_reconcile_proof_flag();

-- ── 3. The review queue, joined ────────────────────────────────────────

-- One row per flagged session with everything a reviewer needs to decide:
-- who, where, claimed vs proven, how the row came to exist (device claim /
-- server settle / wearable import), whether a twin row exists for the same
-- visit, and whether the account is internal (admins + the Stratford test
-- geofence) so the default view is real members only.
create or replace function public.admin_session_review_queue(
  p_include_internal boolean default false,
  p_limit integer default 500
)
returns table (
  session_id        uuid,
  user_id           uuid,
  display_name      text,
  username          text,
  email             text,
  type              text,
  verification      text,
  trust_score       double precision,
  duration_sec      integer,
  started_at        timestamptz,
  created_at        timestamptz,
  flag_reason       text,
  partner_id        uuid,
  partner_name      text,
  device_id         text,
  origin            text,
  earned_points     integer,
  visit_id          uuid,
  visit_status      text,
  close_reason      text,
  visit_started_at  timestamptz,
  visit_ended_at    timestamptz,
  last_proven_at    timestamptz,
  end_witnessed_at  timestamptz,
  proven_sec        integer,
  no_active_answers integer,
  twin_session_id   uuid,
  is_internal       boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  return query
  with q as (
    select a.*
      from activity_sessions a
     where a.flagged = true
  ),
  vis as (
    select distinct on (v.claimed_session_id)
           v.claimed_session_id, v.id, v.status, v.close_reason, v.started_at, v.ended_at, v.last_proven_at
      from gym_visits v
     where v.claimed_session_id in (select q.id from q)
     order by v.claimed_session_id, v.started_at desc
  )
  select
    q.id,
    q.user_id,
    p.display_name,
    p.username,
    u.email::text,
    q.type::text,
    q.verification::text,
    q.trust_score,
    q.duration_sec,
    q.started_at,
    q.created_at,
    q.flag_reason,
    q.partner_id,
    pa.name,
    q.device_id,
    case
      when q.verification::text = 'geofence' and q.device_id is null then 'server_settle'
      when q.verification::text = 'geofence' then 'device'
      when q.verification::text in ('wearable', 'health') then 'wearable'
      else q.verification::text
    end,
    coalesce((select sum(t.amount) from point_transactions t
               where t.session_id = q.id and t.type in ('earn', 'streak')), 0)::int,
    vis.id,
    vis.status,
    vis.close_reason,
    vis.started_at,
    vis.ended_at,
    vis.last_proven_at,
    case when vis.id is null then null else gym_visit_end_witnessed_at(vis.id) end,
    case when vis.id is null then 0 else gym_visit_proven_sec(vis.id) end,
    case when vis.id is null then 0 else (
      select count(*)::int from gym_visit_events e
       where e.visit_id = vis.id and e.event = 'confirmed_outside'
         and e.detail ->> 'reason' = 'no_active_session') end,
    (select b.id from activity_sessions b
      where b.user_id = q.user_id and b.id <> q.id
        and b.type = q.type and b.verification = q.verification
        and b.started_at between q.started_at - interval '60 seconds' and q.started_at + interval '60 seconds'
      order by b.created_at limit 1),
    (exists (select 1 from admin_roles ar where ar.user_id = q.user_id)
      or q.partner_id = '7d865c3b-ff17-43d8-b31f-f8ce6b470986'
      or u.email in ('jamiemasonwright@gmail.com', 'bluegigsolutions@gmail.com'))
  from q
  left join profiles p on p.id = q.user_id
  left join auth.users u on u.id = q.user_id
  left join partners pa on pa.id = q.partner_id
  left join vis on vis.claimed_session_id = q.id
  where p_include_internal
     or not (exists (select 1 from admin_roles ar where ar.user_id = q.user_id)
             or q.partner_id = '7d865c3b-ff17-43d8-b31f-f8ce6b470986'
             or u.email in ('jamiemasonwright@gmail.com', 'bluegigsolutions@gmail.com'))
  order by q.started_at desc
  limit greatest(1, least(p_limit, 2000));
end;
$$;

revoke all on function public.admin_session_review_queue(boolean, integer) from anon, authenticated;
grant execute on function public.admin_session_review_queue(boolean, integer) to authenticated;

-- ── 4. Backfill the queue under the new rules ───────────────────────────

-- 4a. Re-audit every flagged unproven row against today's evidence.
do $$
declare r record; n int := 0;
begin
  for r in select id from activity_sessions where flagged and coalesce(flag_reason, '') like '%unproven_duration%'
  loop
    if reconcile_session_proof_flag(r.id) then n := n + 1; end if;
  end loop;
  raise notice 'reconciled unproven_duration on % sessions', n;
end $$;

-- 4b. `duplicate` only counts a sibling of the same evidence class now (a
-- wearable workout on the day of a geofence visit is not a second claim).
-- Drop the reason where no same-class sibling exists on that UTC day.
with dup as (
  select a.id, a.flag_reason,
         exists (
           select 1 from activity_sessions b
            where b.user_id = a.user_id and b.id <> a.id and b.type = a.type
              and date_trunc('day', b.started_at at time zone 'UTC') = date_trunc('day', a.started_at at time zone 'UTC')
              and (case
                     when a.verification::text = 'geofence' then b.verification::text = 'geofence'
                     when a.verification::text = 'manual'   then true
                     else b.verification::text in ('wearable', 'health')
                   end)
         ) as same_class_sibling
    from activity_sessions a
   where a.flagged and coalesce(a.flag_reason, '') like '%duplicate%'
),
fix as (
  select d.id,
         nullif(array_to_string(array(
           select btrim(r) from unnest(string_to_array(d.flag_reason, ',')) r
            where btrim(r) <> '' and btrim(r) <> 'duplicate'), ','), '') as remaining
    from dup d
   where not d.same_class_sibling
)
update activity_sessions a
   set flag_reason = fix.remaining,
       flagged     = (fix.remaining is not null)
  from fix
 where a.id = fix.id;

-- ── 5. The relay refuses twins too, and tidies the orphan ───────────────

-- relay_gym_claim already answers 'already_claimed_today' when the day is paid
-- and never posts. The row the client handed it stays behind as an unpaid twin
-- (Georgie 240384e5, Shaun e4f37748, Matt d0388145 …) that the queue then shows
-- as a 'duplicate'. The client stores nothing on that status (it is an error
-- outcome), so a row nothing references can go. Body otherwise unchanged from
-- 20260912120100.
create or replace function public.relay_gym_claim(p_session_id uuid, p_visit_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user         uuid := auth.uid();
  v_req          bigint;
  v_started      timestamptz;
  v_verification text;
  v_winner       uuid;
  v_deleted      boolean := false;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select started_at, verification::text
    into v_started, v_verification
    from activity_sessions
   where id = p_session_id and user_id = v_user;
  if v_started is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Points already exist → nothing to relay; a retrying client resolves instantly.
  if exists (
    select 1 from point_transactions where session_id = p_session_id and type = 'earn'
  ) then
    return jsonb_build_object('status', 'already_claimed');
  end if;

  -- The day is already paid for a geofence gym session → nothing to relay,
  -- whichever row this is. A DISTINCT status: 'already_claimed' makes the client
  -- stamp p_session_id onto the visit (mark_gym_visit_progress lets the caller's
  -- id win), and here p_session_id may be the wrong row. Do not post; do not loop.
  select a.id into v_winner
    from activity_sessions a
    join point_transactions pt on pt.session_id = a.id and pt.type = 'earn'
   where a.user_id = v_user
     and a.type = 'gym'
     and a.verification = 'geofence'
     and date_trunc('day', a.started_at at time zone 'UTC')
       = date_trunc('day', v_started at time zone 'UTC')
   order by a.started_at desc
   limit 1;
  if v_winner is not null then
    -- Tidy the twin when nothing references it: no ledger row, no visit.
    if v_verification = 'geofence'
       and not exists (select 1 from point_transactions where session_id = p_session_id)
       and not exists (select 1 from gym_visits where claimed_session_id = p_session_id)
    then
      delete from activity_sessions where id = p_session_id and user_id = v_user;
      v_deleted := found;
    end if;
    return jsonb_build_object('status', 'already_claimed_today', 'session_id', v_winner, 'deleted', v_deleted);
  end if;

  -- Only a geofence-verified session is a gym claim. Anything else is the
  -- 2026-09-08 shape and must not reach claim-points.
  if v_verification is distinct from 'geofence'
     or not exists (
       select 1
         from activity_sessions
        where id = p_session_id
          and type = 'gym'
     ) then
    return jsonb_build_object('status', 'not_relayable', 'verification', v_verification);
  end if;

  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/claim-points',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := jsonb_build_object(
      'session_id', p_session_id,
      'user_id', v_user,
      'visit_id', p_visit_id
    )
  ) into v_req;

  return jsonb_build_object('status', 'accepted', 'request_id', v_req);
end;
$function$;
