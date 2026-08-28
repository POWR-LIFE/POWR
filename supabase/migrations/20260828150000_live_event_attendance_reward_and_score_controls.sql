-- Live events: an attendance reward you set per event, and finer control
-- over which point sources feed the event score.
--
-- 2026-08-28, ahead of FNL x POWR night. Two decisions from Jamie:
--
--   1. "A points reward we can set in the admin for those who have attended."
--      Attendance is a REWARD, paid once per person per event, never a score
--      input: the night is after the scoring window closes, and the ledger row
--      it writes carries source 'event_attendance' which the scorer excludes
--      outright so a mid-window event could never feed it back either.
--      Attendee = anyone the door marked (live_event_checkins) or the venue
--      fence saw inside the door band — the same union the door board shows.
--      Paid two ways, both idempotent through live_event_attendance_awards:
--        • marking someone arrived at the door pays them on the spot;
--        • "Pay attendance" on the door board pays everyone the fence saw
--          who hasn't been paid — the walk-ins nobody marked by hand.
--      Clearing a door mark never claws the points back (house rule: we
--      never take back points that were our doing).
--
--   2. "Normal rules should still apply" — the score is what a member's
--      points already are; the event only chooses WHICH of them count. The
--      existing toggles (activities, manual, walking, streaks) gain three:
--        count_challenges  — weekly / shared challenge payouts (default OFF;
--                            they are sessionless so their activity cannot be
--                            placed inside the window — see 20260827110000)
--        count_bonuses     — other bonus rows: level-up vault, creator,
--                            referral milestone… (default OFF). Invite
--                            rewards stay out whatever this says: the editor
--                            promises "invite bonus points never add to a
--                            score", and the attendance reward is excluded
--                            for the reason above.
--        count_adjustments — admin adjustments (default ON, today's
--                            behaviour). Penalties always count: the editor
--                            promises "penalties always reduce a score".
--
-- Every consumer (_live_event_scores, _live_event_user_points, both
-- leaderboards, settle) reads _live_event_counted, so one change re-scores
-- everyone the moment the flags are saved — exactly as the editor says.

-- ── 1. Columns ───────────────────────────────────────────────────────────────

alter table public.live_events
  add column if not exists attendance_bonus_points integer not null default 0,
  add column if not exists count_challenges        boolean not null default false,
  add column if not exists count_bonuses           boolean not null default false,
  add column if not exists count_adjustments       boolean not null default true;

alter table public.live_events
  drop constraint if exists live_events_attendance_bonus_points_check;
alter table public.live_events
  add constraint live_events_attendance_bonus_points_check
  check (attendance_bonus_points between 0 and 5000);

comment on column public.live_events.attendance_bonus_points is
  'Points paid once to each person who attends the event night (door mark or venue fence inside the door band). 0 = no reward. Never counts toward the event score.';
comment on column public.live_events.count_challenges is
  'Weekly / shared challenge payouts credited inside the window count toward the score. Off by default: they carry no session, so the activity that earned them cannot be placed in the window.';
comment on column public.live_events.count_bonuses is
  'Other bonus rows (vault level-up, creator, referral milestone…) credited inside the window count. Invite rewards and the attendance reward never do.';
comment on column public.live_events.count_adjustments is
  'Admin adjustments inside the window count. Penalties always count.';

-- ── 2. Attendance awards — the idempotency record ────────────────────────────

create table if not exists public.live_event_attendance_awards (
  event_id             uuid        not null references public.live_events(id) on delete cascade,
  user_id              uuid        not null references public.profiles(id)    on delete cascade,
  points               integer     not null check (points > 0),
  source               text        not null check (source in ('door', 'pay_all')),
  awarded_by           uuid        references auth.users(id) on delete set null,
  awarded_at           timestamptz not null default now(),
  point_transaction_id uuid        references public.point_transactions(id) on delete set null,
  primary key (event_id, user_id)
);

comment on table public.live_event_attendance_awards is
  'One row per person per event once their attendance reward has been paid. The primary key is what makes paying idempotent.';

alter table public.live_event_attendance_awards enable row level security;

drop policy if exists "Admins read attendance awards" on public.live_event_attendance_awards;
create policy "Admins read attendance awards"
  on public.live_event_attendance_awards for select
  to authenticated
  using (exists (select 1 from public.admin_roles ar where ar.user_id = (select auth.uid())));

revoke all on public.live_event_attendance_awards from public, anon;
grant select on public.live_event_attendance_awards to authenticated;

-- ── 3. The door band, in one place ───────────────────────────────────────────
-- admin_get_event_door inlined this; the pay path needs the same answer, so
-- it becomes a helper and the door RPC below is re-created on top of it.

create or replace function public._live_event_door_band(
  p_event public.live_events,
  out band_from   timestamptz,
  out band_to     timestamptz,
  out band_source text
)
language plpgsql
immutable
set search_path = public
as $$
begin
  -- Explicit doors win; otherwise the night starts when the board locks;
  -- otherwise when the window ends.
  if p_event.doors_open_at is not null then
    band_from   := p_event.doors_open_at;
    band_source := 'doors';
    -- Doors open with no close: a night, not a week.
    band_to     := coalesce(p_event.doors_close_at, p_event.doors_open_at + interval '12 hours');
  elsif p_event.lock_at is not null then
    band_from   := p_event.lock_at;
    band_source := 'lock';
    band_to     := p_event.doors_close_at;
  else
    band_from   := p_event.window_end_at;
    band_source := 'window';
    band_to     := p_event.doors_close_at;
  end if;
end;
$$;

revoke all on function public._live_event_door_band(public.live_events) from public, anon, authenticated;

-- ── 4. Paying one person ─────────────────────────────────────────────────────
-- Returns true when this call paid them, false when the event has no reward
-- or they were already paid. Runs as the owner; callers are the two admin
-- RPCs below, so enforce_point_award_cap sees an admin and passes the row
-- through — the service-role claim is belt and braces for a direct call.

create or replace function public._live_event_award_attendance(
  p_event   public.live_events,
  p_user_id uuid,
  p_source  text,
  p_by      uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims text;
  v_tx     uuid;
begin
  if coalesce(p_event.attendance_bonus_points, 0) <= 0 then
    return false;
  end if;

  insert into public.live_event_attendance_awards (event_id, user_id, points, source, awarded_by)
  values (p_event.id, p_user_id, p_event.attendance_bonus_points, p_source, p_by)
  on conflict (event_id, user_id) do nothing;
  if not found then
    return false;
  end if;

  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims',
    (coalesce(nullif(v_claims, '')::jsonb, '{}'::jsonb)
       || jsonb_build_object('role', 'service_role'))::text, true);

  insert into public.point_transactions (user_id, amount, type, source, description)
  values (p_user_id, p_event.attendance_bonus_points, 'bonus', 'event_attendance',
          'Attended ' || coalesce(p_event.name, 'a live event'))
  returning id into v_tx;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  update public.live_event_attendance_awards
     set point_transaction_id = v_tx
   where event_id = p_event.id and user_id = p_user_id;

  return true;
end;
$$;

revoke all on function public._live_event_award_attendance(public.live_events, uuid, text, uuid) from public, anon, authenticated;

-- ── 5. The door board, now carrying the reward state ─────────────────────────

create or replace function public.admin_get_event_door(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event  public.live_events;
  v_band   record;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  select * into v_band from public._live_event_door_band(v_event);

  return (
    with roster as (
      select lp.user_id, lp.joined_at, lp.disqualified_at
        from public.live_event_participants lp
       where lp.event_id = v_event.id
    ),
    -- Venue visits overlapping the band, one line per person. A visit
    -- that began before doors and is still open counts (early arrival);
    -- the freshest proof is the newer of the two presence stamps (see
    -- shared/liveops.ts — last_confirmed_at moves on any confirm,
    -- last_proven_at only on one that cleared the accuracy gate).
    visits as (
      select gv.user_id,
             min(gv.started_at)                                   as first_entered_at,
             max(greatest(gv.started_at,
                          coalesce(gv.last_proven_at,    '-infinity'::timestamptz),
                          coalesce(gv.last_confirmed_at, '-infinity'::timestamptz))) as last_proof_at,
             max(gv.ended_at)                                     as last_ended_at,
             bool_or(gv.ended_at is null)                         as has_open_visit,
             count(*)::integer                                    as visit_count,
             (array_agg(gv.platform order by gv.started_at desc))[1] as platform,
             (array_agg(gv.status   order by gv.started_at desc))[1] as last_status
        from public.gym_visits gv
       where v_event.venue_partner_id is not null
         and gv.partner_id = v_event.venue_partner_id
         and gv.started_at < coalesce(v_band.band_to, now())
         and coalesce(gv.ended_at, now()) >= v_band.band_from
       group by gv.user_id
    ),
    manual as (
      select c.user_id, c.checked_in_at, c.note,
             coalesce(pa.display_name, pa.username) as by_name
        from public.live_event_checkins c
        left join public.profiles pa on pa.id = c.checked_in_by
       where c.event_id = v_event.id
    ),
    awards as (
      select a.user_id, a.awarded_at, a.points, a.source
        from public.live_event_attendance_awards a
       where a.event_id = v_event.id
    ),
    -- Everyone with a reason to be on the board: the roster, anyone
    -- the door marked, anyone the fence saw (walk-ins — registered
    -- or not, they're in the building), and anyone already paid.
    people as (
      select user_id from roster
      union select user_id from manual
      union select user_id from visits
      union select user_id from awards
    ),
    rows_ as (
      select pe.user_id,
             coalesce(p.display_name, p.username, 'POWR member') as name,
             p.username,
             u.email,
             p.referral_code                        as member_id,
             (r.user_id is not null)                as on_roster,
             r.joined_at,
             r.disqualified_at,
             exists (select 1 from public.live_event_bookings b
                      where b.event_id = v_event.id
                        and b.email = lower(u.email))  as booked,
             g.gate_count,
             g.gate_friends,
             v.first_entered_at, v.last_proof_at, v.last_ended_at,
             coalesce(v.has_open_visit, false)     as has_open_visit,
             coalesce(v.visit_count, 0)            as visit_count,
             v.platform, v.last_status,
             m.checked_in_at                        as manual_checked_in_at,
             m.by_name                              as manual_by,
             m.note                                 as manual_note,
             a.awarded_at                           as attendance_paid_at,
             a.points                               as attendance_points,
             a.source                               as attendance_source
        from people pe
        join public.profiles p on p.id = pe.user_id
        left join auth.users u on u.id = pe.user_id
        left join roster r on r.user_id = pe.user_id
        left join visits v on v.user_id = pe.user_id
        left join manual m on m.user_id = pe.user_id
        left join awards a on a.user_id = pe.user_id
        cross join lateral (
          select case when v_event.entry_gate_n > 0
                      then public._live_event_gate_count(v_event.id, pe.user_id)
                      else null end as gate_count,
                 case when v_event.entry_gate_n > 0
                      then public._live_event_invitees(v_event.id, pe.user_id, false)
                      else null end as gate_friends
        ) g
       order by coalesce(p.display_name, p.username, 'POWR member'), pe.user_id
       limit 1000
    )
    select jsonb_build_object(
      'event', jsonb_build_object(
        'id',               v_event.id,
        'scope',            v_event.scope,
        'status',           v_event.status,
        'venue_partner_id', v_event.venue_partner_id,
        'venue_name',       (select pv.name from public.partners pv where pv.id = v_event.venue_partner_id),
        'gate_n',           v_event.entry_gate_n,
        'gate_counting',    v_event.entry_gate_counting,
        'band_from',        v_band.band_from,
        'band_to',          v_band.band_to,
        'band_source',      v_band.band_source,
        'doors_open_at',    v_event.doors_open_at,
        'doors_close_at',   v_event.doors_close_at,
        'attendance_bonus_points', v_event.attendance_bonus_points,
        'attendance_paid',  (select count(*) from awards),
        'attendance_points_paid', (select coalesce(sum(points), 0) from awards)
      ),
      'rows', coalesce((
        select jsonb_agg(to_jsonb(x) order by x.name) from rows_ x
      ), '[]'::jsonb),
      'generated_at', now()
    )
  );
end;
$$;

revoke all on function public.admin_get_event_door(uuid) from public, anon;
grant execute on function public.admin_get_event_door(uuid) to authenticated;

-- ── 6. Marking arrived pays on the spot ──────────────────────────────────────

create or replace function public.admin_set_event_checkin(
  p_event_id uuid,
  p_user_id  uuid,
  p_present  boolean,
  p_note     text default null
)
returns jsonb
language plpgsql
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
  if v_event.status = 'archived' then
    raise exception 'This event is archived' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'No such member' using errcode = 'P0002';
  end if;

  if p_present then
    insert into public.live_event_checkins (event_id, user_id, checked_in_by, note)
    values (p_event_id, p_user_id, auth.uid(), nullif(btrim(p_note), ''))
    on conflict (event_id, user_id) do update
      set note = coalesce(nullif(btrim(excluded.note), ''), public.live_event_checkins.note);
    -- A door mark is attendance. Pays once; a second mark is a no-op.
    perform public._live_event_award_attendance(v_event, p_user_id, 'door', auth.uid());
  else
    -- Clearing a mark undoes the mark, never the points.
    delete from public.live_event_checkins
     where event_id = p_event_id and user_id = p_user_id;
  end if;

  return public.admin_get_event_door(p_event_id);
end;
$$;

revoke all on function public.admin_set_event_checkin(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_event_checkin(uuid, uuid, boolean, text) to authenticated;

-- ── 7. Pay everyone who attended ─────────────────────────────────────────────
-- Attendee = door-marked ∪ venue fence inside the band (the door board's
-- union). p_user_ids narrows it (one person from the row button); null
-- means everyone. Hands back the refreshed board like the other door RPCs.

create or replace function public.admin_pay_event_attendance(
  p_event_id uuid,
  p_user_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event  public.live_events;
  v_band   record;
  v_uid    uuid;
  v_paid   integer := 0;
  v_seen   integer := 0;
  v_names  text[]  := '{}';
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if v_event.status = 'archived' then
    raise exception 'This event is archived' using errcode = 'P0001';
  end if;
  if coalesce(v_event.attendance_bonus_points, 0) <= 0 then
    raise exception 'Set an attendance reward on the event first' using errcode = 'P0001';
  end if;

  select * into v_band from public._live_event_door_band(v_event);

  for v_uid in
    with attendees as (
      select c.user_id from public.live_event_checkins c where c.event_id = v_event.id
      union
      select gv.user_id
        from public.gym_visits gv
       where v_event.venue_partner_id is not null
         and gv.partner_id = v_event.venue_partner_id
         and gv.started_at < coalesce(v_band.band_to, now())
         and coalesce(gv.ended_at, now()) >= v_band.band_from
    )
    select a.user_id from attendees a
     where p_user_ids is null or a.user_id = any (p_user_ids)
  loop
    v_seen := v_seen + 1;
    if public._live_event_award_attendance(v_event, v_uid, 'pay_all', auth.uid()) then
      v_paid := v_paid + 1;
      v_names := v_names || (select coalesce(p.display_name, p.username, 'POWR member')
                               from public.profiles p where p.id = v_uid);
    end if;
  end loop;

  return jsonb_build_object(
    'paid',     v_paid,
    'already',  v_seen - v_paid,
    'points',   v_event.attendance_bonus_points,
    'names',    to_jsonb(v_names),
    'door',     public.admin_get_event_door(p_event_id)
  );
end;
$$;

revoke all on function public.admin_pay_event_attendance(uuid, uuid[]) from public, anon;
grant execute on function public.admin_pay_event_attendance(uuid, uuid[]) to authenticated;

-- ── 8. The scorer: which sources count ───────────────────────────────────────

create or replace function public._live_event_counted(p_event_id uuid, p_uid uuid default null)
returns table(user_id uuid, amount integer, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with ev as (
    select * from public.live_events where id = p_event_id
  ),
  rows as (
    select pt.user_id, pt.amount, pt.type, pt.source, pt.created_at,
           s.id                              as session_id,
           s.type::text                      as s_type,
           s.verification::text              as s_verif,
           s.started_at,
           coalesce(s.ended_at, s.started_at) as ended_at
    from public.point_transactions pt
    left join public.activity_sessions s on s.id = pt.session_id
    where (p_uid is null or pt.user_id = p_uid)
  ),
  sess as (
    -- session-backed: in the window when the ACTIVITY overlaps it
    select r.user_id, r.amount, r.ended_at as counted_at, r.created_at
    from rows r
    cross join ev
    where r.session_id is not null
      and r.ended_at   >  ev.window_start_at
      and r.started_at <  ev.window_end_at
      and (
        (r.type = 'streak' and ev.count_streak)
        or (
          r.type = 'earn'
          and (ev.count_manual  or coalesce(r.s_verif, '') <> 'manual')
          and (ev.count_manual  or coalesce(r.source, '')  <> 'manual_log')
          and (ev.count_walking or coalesce(r.s_type, '')  <> 'walking')
          and (ev.included_activities is null
               or r.s_type = any (ev.included_activities))
        )
      )
  ),
  other as (
    -- sessionless rows credited in the window. Which ones count is the
    -- event's choice, with two fixed rules the editor promises: penalties
    -- always reduce a score; invite rewards (and the attendance reward)
    -- never add to one.
    select r.user_id, r.amount, r.created_at as counted_at
    from rows r
    cross join ev
    where r.session_id is null
      and r.created_at >= ev.window_start_at
      and r.created_at <  ev.window_end_at
      and coalesce(r.source, '') not in
            ('referral_received', 'referral_sent', 'invite_milestone', 'event_attendance')
      and (
        r.type = 'penalty'
        or (r.type = 'adjustment' and ev.count_adjustments)
        or (coalesce(r.source, '') in ('weekly_challenge', 'shared_challenge', 'shared_challenge_bonus')
            and ev.count_challenges)
        or (r.type = 'bonus' and ev.count_bonuses)
        or (
          -- sessionless earn / streak: anchored to in-window activity the
          -- member had already banked (unchanged)
          coalesce(r.source, '') not in ('weekly_challenge', 'shared_challenge', 'shared_challenge_bonus')
          and (r.type = 'earn' or (r.type = 'streak' and ev.count_streak))
          and exists (
            select 1 from sess x
            where x.user_id = r.user_id and x.created_at <= r.created_at
          )
        )
      )
  )
  select user_id, amount, counted_at from sess
  union all
  select user_id, amount, counted_at from other
$$;

-- ── 9. The app can quote the reward ──────────────────────────────────────────
-- get_live_event gains one key; nothing in the shipped client reads it yet.

create or replace function public.get_live_event(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_event   public.live_events;
  v_preview boolean := false;
  v_status  text;
begin
  if v_uid is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events
   where slug = p_slug and status <> 'archived';
  if not found then
    return null;
  end if;

  if v_event.status = 'draft' then
    v_preview := public._live_event_previewer(v_event, v_uid);
    if not v_preview then
      return null;
    end if;
  end if;

  -- Previewers see the draft as it would appear once launched.
  v_status := case
    when not v_preview then v_event.status
    when now() >= v_event.window_start_at and now() < v_event.window_end_at then 'live'
    else 'scheduled'
  end;

  return jsonb_build_object(
    'id',                v_event.id,
    'slug',              v_event.slug,
    'name',              v_event.name,
    'logo_url',          v_event.logo_url,
    'logo_only',         v_event.logo_only,
    'status',            v_status,
    'scope',             v_event.scope,
    'window_start_at',   v_event.window_start_at,
    'window_end_at',     v_event.window_end_at,
    'lock_at',           v_event.lock_at,
    'doors_open_at',     v_event.doors_open_at,
    'doors_close_at',    v_event.doors_close_at,
    'is_locked',         (v_event.status = 'locked'
                          or v_event.hidden
                          or (v_event.lock_at is not null and now() >= v_event.lock_at)),
    'revealed_at',       v_event.revealed_at,
    'prizes',            v_event.prizes,
    'board_size',        v_event.board_size,
    'invite_bonus_points',    v_event.invite_bonus_points,
    'invite_milestone_n',     v_event.invite_milestone_n,
    'invite_milestone_bonus', v_event.invite_milestone_bonus,
    'attendance_bonus_points', v_event.attendance_bonus_points,
    'conversion_deadline_at', v_event.conversion_deadline_at,
    'promo_headline',    v_event.promo_headline,
    'promo_media_url',   v_event.promo_media_url,
    'rules',             coalesce(v_event.rules, '[]'::jsonb),
    'booking_url',       v_event.booking_url,
    'venue',             (select jsonb_build_object(
                            'id',       p.id,
                            'name',     p.name,
                            'logo_url', p.logo_url,
                            'logo_bg',  p.logo_bg,
                            'address',  p.address,
                            'lat',      nullif(p.locations->0->>'lat', '')::double precision,
                            'lng',      nullif(p.locations->0->>'lng', '')::double precision
                          ) from public.partners p
                          where p.id = v_event.venue_partner_id),
    'is_preview',        v_preview,
    'viewer',            public._live_event_viewer(v_event, v_uid)
  );
end;
$$;
