-- ─────────────────────────────────────────────────────────────────────────────
-- THE REAPER'S CLOCK MUST NOT BE RESETTABLE BY EVIDENCE NOBODY PROVED.
--
-- The stale-close reaper (gym-visit-beacon) fires on 45 minutes of SILENCE:
--
--     provenMs = max(last_confirmed_at, upgraded_at, claimed_at, started_at)
--     if (provenMs > now - 45min) continue;   -- "still live"
--
-- `last_confirmed_at` was the only one of those four that can advance
-- repeatedly, and it turns out FOUR different writers move it — three of which
-- are pure bookkeeping with no device and no fix behind them at all:
--
--   1. confirm_gym_visit_v2, on ANY inside-confirm. `inside` is deliberately
--      generous on the client (radius + 50 m hysteresis, and TRUE BY DEFAULT
--      when the fix is too coarse to run the geometry) so a bad fix can never
--      flap a real session out. Right for staying open, useless as proof.
--   2. mark_gym_visit_progress — a claim/upgrade marker.
--   3. claim-points (index.ts:673) and upgrade-gym-tier (index.ts:96), which
--      stamp it to now() from the SERVER on a relay, with the phone possibly
--      miles away and hours late.
--
-- Measured 2026-08-10: iOS visit 2efeea36 upgraded at 09:08:05Z; a server-side
-- `claimed` relay at 09:42:30Z stamped last_confirmed_at and pushed its reaper
-- deadline from 09:53 to 10:27 — a 34-minute deferral bought by a bookkeeping
-- write, with the owner miles away. Android aff0a1f7 answered every
-- fence_refresh within ~1 s all morning on 900 m fixes, so it could have
-- deferred the reaper indefinitely in principle. That, and not a dead reaper,
-- is the likeliest explanation of the never-closed visits going back to
-- 2026-07-14: several show last_confirmed_at advancing HOURS past any plausible
-- exit (df7ec2ac 23 h, 3ea18952 16.6 h, b10554e2 16.3 h).
--
-- ⚠ The fix is NOT to make `inside` strict. That decision has the opposite risk
-- profile (see gymPresence.ts, and the 07-03 / 07-11 starvations): staying open
-- must stay generous. What has to be strict is PROOF.
--
-- So: a separate column with exactly ONE writer and one meaning.
--
--   last_confirmed_at — "the device answered us". Unchanged, four writers.
--                       Drives the presence pass's ask/backoff cadence, which
--                       is the right question for it to answer.
--   last_proven_at    — "the device proved, with a fix worth BILLING, that it
--                       was inside". Written only by confirm_gym_visit_v2, only
--                       when the reported fix passes the same test PR #374
--                       applied to credit (lib/health/gymPresence.ts,
--                       fixCreditsPresence): trusted fix, and the venue inside
--                       the fix's own error bar.
--
-- Derived SERVER-SIDE from the detail every shipped client already sends
-- (fix_trusted / distance_m / accuracy_m — see GeofenceContext runVisitCheck),
-- deliberately NOT from a new client-sent flag: this repo has been burned
-- repeatedly by two sources of truth for one rule, and deriving it here means
-- the fix lands on every phone in the field WITHOUT waiting for an OTA.
-- ─────────────────────────────────────────────────────────────────────────────

alter table gym_visits add column if not exists last_proven_at timestamptz;

comment on column gym_visits.last_proven_at is
  'Last moment the DEVICE proved it was inside with a fix good enough to bill '
  '(fixCreditsPresence: trusted accuracy, venue within the fix''s own error bar). '
  'Written only by confirm_gym_visit_v2. This — never last_confirmed_at — is what '
  'the stale-close reaper may treat as proof of presence.';

-- Backfill: no row gets retroactive "proof" it never had. Existing open visits
-- fall back to max(upgraded_at, claimed_at, started_at) in the reaper, which is
-- the honest floor for a visit whose device never proved anything.

-- ── helpers ──────────────────────────────────────────────────────────────────

-- A jsonb detail field is client-supplied text: 'null', '', or garbage must not
-- be able to raise inside a wake's one round-trip.
create or replace function _gym_detail_num(p_detail jsonb, p_key text)
returns numeric
language plpgsql
immutable
set search_path to 'public'
as $$
begin
  return nullif(p_detail ->> p_key, '')::numeric;
exception when others then
  return null;
end;
$$;

-- The radius the CLIENT checked itself against. partners.locations is the same
-- array the device caches and arms from (GeofenceContext ~line 505:
-- `DEV_RADIUS_M[p.name] ?? loc.radius ?? 100`), and region_id is
-- '<partner_uuid>-<location index>', so the index picks the same circle.
--
-- ⚠ The `?? 100` fallback is mirrored ON PURPOSE. A partner with no radius
-- configured checks people in at 100 m on the device; proving presence against
-- a tighter number here would refuse credit for visits the client considers
-- perfectly valid. Divergence between the two is worse than either value.
-- The one place they differ is DEV_RADIUS_M (dev-test accounts at the POWR
-- venue, 25 m against the row's 40 m) — that makes this test slightly MORE
-- generous for those accounts only, never for a real user.
create or replace function _gym_visit_radius_m(p_partner_id uuid, p_region_id text)
returns numeric
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_idx int := coalesce(((regexp_match(coalesce(p_region_id, ''), '-(\d+)$'))[1])::int, 0);
  v_radius numeric;
begin
  select coalesce(
           (p.locations -> v_idx ->> 'radius')::numeric,
           (p.locations -> 0    ->> 'radius')::numeric
         )
    into v_radius
    from partners p
   where p.id = p_partner_id;

  return coalesce(v_radius, 100);
exception when others then
  return 100;
end;
$$;

-- ── confirm_gym_visit_v2 ─────────────────────────────────────────────────────
-- Unchanged except for the proof stamp and the `proven` marker on the event.
-- The credit branches are deliberately untouched: they are gated on p_inside,
-- which is the client's generous liveness verdict, and re-gating credit on
-- proof here would move a rule that lives on the device (and would silently
-- change what a 30-minute claim requires).

create or replace function public.confirm_gym_visit_v2(
  p_visit_id uuid,
  p_inside boolean,
  p_detail jsonb default '{}'::jsonb,
  p_request_credit boolean default false,
  p_entry_at timestamp with time zone default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_visit gym_visits%rowtype;
  v_dwell_min int := 30;
  v_upgrade_min int := 40;
  v_elapsed_min numeric;
  v_session_id uuid;
  v_req bigint;
  v_triggered text := null;
  v_declined text := null;
  v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
  v_radius numeric;
  v_distance numeric;
  v_accuracy numeric;
  v_proven boolean := false;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_visit from gym_visits where id = p_visit_id and user_id = v_user;
  if not found then raise exception 'visit not found'; end if;

  -- Would this fix justify BILLING the time up to now, as opposed to merely
  -- keeping the session open? Mirrors fixCreditsPresence exactly:
  --   trusted fix (the client's own fix_trusted, gated on MAX_FIX_ACCURACY_M)
  --   AND the venue lies inside the fix's own error bar.
  -- The 50 m hysteresis band is NOT admitted: it damps oscillation, it does not
  -- describe where anybody is.
  v_radius   := _gym_visit_radius_m(v_visit.partner_id, v_visit.region_id);
  v_distance := _gym_detail_num(v_detail, 'distance_m');
  v_accuracy := _gym_detail_num(v_detail, 'accuracy_m');
  v_proven := p_inside
          and lower(coalesce(v_detail ->> 'fix_trusted', '')) = 'true'
          and v_distance is not null
          and v_distance <= v_radius + coalesce(v_accuracy, 0);

  update gym_visits
     set last_confirmed_at = case when p_inside  then now() else last_confirmed_at end,
         last_proven_at    = case when v_proven  then now() else last_proven_at    end
   where id = p_visit_id and user_id = v_user;

  -- Written unconditionally, before any credit branch: the ONLY proof a silent
  -- wake reached the device's JS. Do not move it below a guard.
  --
  -- `proven` rides along so the answer is queryable after the fact — the 08-10
  -- investigation had to reconstruct it from accuracy_m by hand.
  insert into gym_visit_events (visit_id, user_id, event, detail)
  values (p_visit_id, v_user,
          case when p_inside then 'confirmed_inside' else 'confirmed_outside' end,
          v_detail || jsonb_build_object('proven', v_proven, 'radius_m', v_radius));

  if not (p_inside and p_request_credit) then
    return jsonb_build_object('triggered', null);
  end if;

  begin
    v_dwell_min := coalesce((select value from system_config where key = 'min_gym_dwell_minutes')::int, 30);
  exception when others then v_dwell_min := 30;
  end;
  begin
    v_upgrade_min := coalesce((select value from system_config where key = 'gym_upgrade_minutes')::int, 40);
  exception when others then v_upgrade_min := 40;
  end;

  -- BOTH clocks must agree the threshold has passed. For older clients that send no
  -- p_entry_at, fall back to the visit row's started_at (legacy behaviour).
  v_elapsed_min := extract(epoch from (now() - v_visit.started_at)) / 60;
  if p_entry_at is not null then
    v_elapsed_min := least(
      v_elapsed_min,
      extract(epoch from (now() - p_entry_at)) / 60
    );
  end if;

  if v_visit.status = 'open' and v_elapsed_min >= v_dwell_min then
    select id into v_session_id
      from activity_sessions
     where user_id = v_user and type = 'gym' and verification = 'geofence'
       and date_trunc('day', started_at at time zone 'UTC') = date_trunc('day', v_visit.started_at at time zone 'UTC')
     order by started_at desc
     limit 1;

    if v_session_id is null then
      insert into activity_sessions
        (user_id, type, started_at, ended_at, duration_sec, verification, trust_score, partner_id, raw_gps)
      values
        (v_user, 'gym', v_visit.started_at, now(),
         least(extract(epoch from (now() - v_visit.started_at))::int, 12 * 60 * 60),
         'geofence', 0.94, v_visit.partner_id,
         jsonb_build_object(
           'partnerId', v_visit.partner_id,
           'entryTimestamp', (extract(epoch from v_visit.started_at) * 1000)::bigint,
           'createdBy', 'confirm_gym_visit_v2'))
      on conflict do nothing
      returning id into v_session_id;

      if v_session_id is null then
        select id into v_session_id
          from activity_sessions
         where user_id = v_user and type = 'gym' and verification = 'geofence'
           and date_trunc('day', started_at at time zone 'UTC') = date_trunc('day', v_visit.started_at at time zone 'UTC')
         order by started_at desc
         limit 1;
      end if;
    end if;

    if v_session_id is not null and not exists (
      select 1 from point_transactions where session_id = v_session_id and type = 'earn'
    ) then
      select net.http_post(
        url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/claim-points',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
        ),
        body := jsonb_build_object('session_id', v_session_id, 'user_id', v_user, 'visit_id', p_visit_id)
      ) into v_req;
      v_triggered := 'claim';

    elsif v_session_id is not null then
      v_declined := 'already_claimed';
      update gym_visits
         set status             = 'claimed',
             claimed_session_id = coalesce(claimed_session_id, v_session_id),
             claimed_at         = coalesce(claimed_at, now())
       where id = p_visit_id and user_id = v_user and status = 'open';
    end if;

  elsif v_visit.status = 'claimed' and v_elapsed_min >= v_upgrade_min then
    v_session_id := v_visit.claimed_session_id;
    if v_session_id is null then
      select id into v_session_id
        from activity_sessions
       where user_id = v_user and type = 'gym' and verification = 'geofence'
         and date_trunc('day', started_at at time zone 'UTC') = date_trunc('day', v_visit.started_at at time zone 'UTC')
       order by started_at desc
       limit 1;
    end if;

    if v_session_id is not null and not exists (
      select 1 from point_transactions
      where session_id = v_session_id and type = 'earn' and description like 'gym session upgrade%'
    ) then
      select net.http_post(
        url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/upgrade-gym-tier',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
        ),
        body := jsonb_build_object('session_id', v_session_id, 'user_id', v_user, 'visit_id', p_visit_id)
      ) into v_req;
      v_triggered := 'upgrade';

    elsif v_session_id is not null then
      v_declined := 'already_upgraded';
      update gym_visits
         set status      = 'upgraded',
             upgraded_at = coalesce(upgraded_at, now())
       where id = p_visit_id and user_id = v_user and status = 'claimed';
    end if;
  end if;

  if v_declined is not null then
    insert into gym_visit_events (visit_id, user_id, event, detail)
    values (p_visit_id, v_user, 'credit_declined', jsonb_build_object(
      'reason',      v_declined,
      'session_id',  v_session_id,
      'elapsed_min', round(v_elapsed_min)
    ));
  end if;

  return jsonb_build_object(
    'triggered',  v_triggered,
    'declined',   v_declined,
    'session_id', v_session_id,
    'request_id', v_req
  );
end;
$function$;
