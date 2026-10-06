-- =============================================================
-- Live events: "Coming soon" — advertise before registration opens
-- =============================================================
-- Until now an event was either a draft (nobody but preview testers sees
-- it) or scheduled (visible AND open for registration, invites counting).
-- There was no way to put an event in front of people without also opening
-- the door, which is exactly what a venue wants in the weeks before it has
-- confirmed the details.
--
-- status 'announced' (shown as "Coming soon" everywhere a human reads it)
-- sits between draft and scheduled:
--
--   draft → announced → scheduled → live → locked → revealed → settled
--
--   · The app and the promo page show the event (name, venue, artwork,
--     headline, prizes) with "Registration opens <day>" — or "soon" when no
--     time is set.
--   · join_live_event refuses it, with a message saying why.
--   · Nothing else treats it as running: referral attribution, invite gates,
--     pulse/template pushes and the auto lifecycle all key on scheduled/live
--     (or later), so none of them see an announced event. No change needed
--     there — that exclusion IS the behaviour.
--
-- registration_opens_at (optional) is when the door opens. With
-- auto_lifecycle on, the minute cron moves announced → scheduled at that
-- time (and the existing scheduled → live step follows in the same tick if
-- scoring has already started). Blank = the admin opens it by hand.
--
-- OLDER BUILDS NEVER SEE IT. They don't know the status and would render it
-- as something it isn't (the 1.5.x switcher calls anything non-scheduled
-- "LIVE NOW"). So both read paths take p_with_announced (default false):
-- an old build's call is unchanged and gets exactly what it got before —
-- an announced event behaves like a draft for it. Builds that render the
-- coming-soon state pass true.

alter table public.live_events
  add column if not exists registration_opens_at timestamptz;

comment on column public.live_events.registration_opens_at is
  'When a Coming soon (announced) event opens for registration. Shown in the app and on the promo page; with auto_lifecycle the cron moves announced → scheduled at this time. Null = opened by hand.';

alter table public.live_events
  drop constraint if exists live_events_status_check,
  add  constraint live_events_status_check
       check (status in ('draft', 'announced', 'scheduled', 'live', 'locked', 'revealed', 'settled', 'archived'));

-- ── get_live_event ─────────────────────────────────────────────
-- Signature change (new defaulted arg): drop the 1-arg form first, or
-- PostgREST can't choose between the two for a { p_slug } call.

drop function if exists public.get_live_event(text);

create function public.get_live_event(p_slug text, p_with_announced boolean default false)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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

  -- Coming soon: only for a build that can render it. An older build gets
  -- what it always got for a not-yet-public event — nothing.
  if v_event.status = 'announced' and not coalesce(p_with_announced, false) then
    return null;
  end if;

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
    'audience_mode',     v_event.audience_mode,
    'managed_by',        v_event.managed_by,
    'window_start_at',   v_event.window_start_at,
    'window_end_at',     v_event.window_end_at,
    'lock_at',           v_event.lock_at,
    'doors_open_at',     v_event.doors_open_at,
    'doors_close_at',    v_event.doors_close_at,
    'registration_opens_at', v_event.registration_opens_at,
    'is_locked',         (v_event.status = 'locked'
                          or v_event.hidden
                          or (v_event.lock_at is not null and now() >= v_event.lock_at)),
    'revealed_at',       v_event.revealed_at,
    'prizes',            v_event.prizes,
    'board_size',        v_event.board_size,
    'invite_bonus_points',    v_event.invite_bonus_points,
    'invite_milestone_n',     v_event.invite_milestone_n,
    'invite_milestone_bonus', v_event.invite_milestone_bonus,
    'reward_referrals_on_signup', v_event.reward_referrals_on_signup,
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
$function$;

revoke all on function public.get_live_event(text, boolean) from public, anon;
grant execute on function public.get_live_event(text, boolean) to authenticated;

-- ── get_active_live_events ─────────────────────────────────────
-- Coming-soon events sort after anything open (live, then scheduled) and
-- before finished ones: an event you can't join yet should never take the
-- first Home page from one you can.

drop function if exists public.get_active_live_events(double precision, double precision);

create function public.get_active_live_events(
  p_lat double precision default null,
  p_lng double precision default null,
  p_with_announced boolean default false
)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_ann boolean := coalesce(p_with_announced, false);
begin
  if v_uid is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  -- A position off the globe is ignored rather than trusted.
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    p_lat := null;
    p_lng := null;
  end if;

  return coalesce((
    select jsonb_agg(x.payload order by x.ord)
      from (
        select public.get_live_event(c.slug, v_ann) as payload, c.ord
          from (
            select e.slug,
                   row_number() over (
                     order by (e.status = 'draft'),
                              not exists (
                                select 1 from public.live_event_participants lp
                                 where lp.event_id = e.id
                                   and lp.user_id = v_uid
                                   and lp.disqualified_at is null),
                              case e.status when 'live'      then 0
                                            when 'scheduled' then 1
                                            when 'draft'     then 1
                                            when 'announced' then 2
                                            else 3 end,
                              e.window_start_at
                   ) as ord
              from public.live_events e
             where e.status <> 'archived'
               and (e.status <> 'draft' or public._live_event_previewer(e, v_uid))
               and (e.status <> 'announced' or v_ann)
               and e.window_end_at > now() - interval '7 days'
               and public._live_event_in_audience(e, v_uid, p_lat, p_lng)
          ) c
         where c.ord <= 6
      ) x
     where x.payload is not null
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.get_active_live_events(double precision, double precision, boolean) from public, anon;
grant execute on function public.get_active_live_events(double precision, double precision, boolean) to authenticated;

-- Older builds: unchanged — the first event of the default (no coming-soon)
-- list. Recreated only so it binds to the new signature explicitly.
create or replace function public.get_active_live_event()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.get_active_live_events(null, null, false) -> 0
$function$;

-- ── join_live_event ────────────────────────────────────────────
-- Rebased on the current prod body; the only change is the announced
-- refusal, which needs its own words — "can no longer be joined" is the
-- opposite of the truth for an event that hasn't opened yet.

create or replace function public.join_live_event(p_event_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_event   public.live_events;
  v_preview boolean := false;
  v_closes  timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if found and v_event.status = 'draft' then
    v_preview := public._live_event_previewer(v_event, v_uid);
  end if;
  if not found or v_event.status = 'archived' or (v_event.status = 'draft' and not v_preview) then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if v_event.scope <> 'opt_in' then
    raise exception 'This event does not require joining' using errcode = 'P0001';
  end if;
  if v_event.status = 'announced' then
    raise exception 'Registration for this event isn''t open yet' using errcode = 'P0001';
  end if;

  -- Entry closes at the eligibility cutoff (falls back to the scoring end).
  -- Same instant the account-age check below uses, so "you can still join"
  -- and "your account counts" can never disagree.
  v_closes := coalesce(v_event.eligibility_cutoff_at, v_event.window_end_at);
  if (v_event.status not in ('scheduled', 'live') and not v_preview) or now() >= v_closes then
    raise exception 'This event can no longer be joined' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid
      and p.created_at < v_closes
  ) then
    raise exception 'Your account was created after the eligibility cutoff' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.live_event_participants lp
    where lp.event_id = v_event.id and lp.user_id = v_uid
      and lp.disqualified_at is not null
  ) then
    raise exception 'You cannot rejoin this event' using errcode = 'P0001';
  end if;

  insert into public.live_event_participants (event_id, user_id)
  values (v_event.id, v_uid)
  on conflict (event_id, user_id) do nothing;

  return public._live_event_viewer(v_event, v_uid);
end;
$function$;

-- ── live_event_auto_transitions ────────────────────────────────
-- Rebased on the current prod body. New first step: announced → scheduled
-- at registration_opens_at. It runs BEFORE scheduled → live so an event
-- whose registration opens after scoring has started catches up in one tick.

create or replace function public.live_event_auto_transitions()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_n integer := 0;
  r   record;
  v_x integer;
begin
  -- announced → scheduled: registration opens at the time the admin set.
  for r in
    update public.live_events e
       set status = 'scheduled'
     where e.auto_lifecycle
       and e.status = 'announced'
       and e.registration_opens_at is not null
       and now() >= e.registration_opens_at
    returning e.id
  loop
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (null, 'live_event_status', 'live_event', r.id::text,
            jsonb_build_object('from', 'announced', 'to', 'scheduled', 'by', 'auto'));
    v_n := v_n + 1;
  end loop;

  -- scheduled → live: the scoring window has opened and not yet closed.
  for r in
    update public.live_events e
       set status = 'live'
     where e.auto_lifecycle
       and e.status = 'scheduled'
       and now() >= e.window_start_at
       and now() <  e.window_end_at
    returning e.id
  loop
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (null, 'live_event_status', 'live_event', r.id::text,
            jsonb_build_object('from', 'scheduled', 'to', 'live', 'by', 'auto'));
    v_n := v_n + 1;
  end loop;

  -- live → locked: the lock time has passed. The app already treats the
  -- board as sealed from lock_at at read time; this moves the column so
  -- the admin panel agrees and Settle/Reveal become available.
  for r in
    update public.live_events e
       set status = 'locked'
     where e.auto_lifecycle
       and e.status = 'live'
       and e.lock_at is not null
       and now() >= e.lock_at
    returning e.id
  loop
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (null, 'live_event_status', 'live_event', r.id::text,
            jsonb_build_object('from', 'live', 'to', 'locked', 'by', 'auto'));
    v_n := v_n + 1;
  end loop;

  -- Freeze the results once late wearable syncs have had their grace.
  for r in
    select e.id from public.live_events e
     where e.auto_settle
       and e.status = 'locked'
       and e.results_cut_at is null
       and now() >= coalesce(e.lock_at, e.window_end_at) + make_interval(hours => e.settle_grace_hours)
  loop
    v_x := public._live_event_cut_results(r.id);
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (null, 'live_event_settled', 'live_event', r.id::text,
            jsonb_build_object('results', v_x, 'by', 'auto'));
    v_n := v_n + 1;
  end loop;

  -- Reveal: at the gym's chosen time, or as the safety net if nobody did.
  for r in
    select e.id,
           case when e.reveal_at is not null and now() >= e.reveal_at then 'scheduled' else 'safety_net' end as why
      from public.live_events e
     where e.auto_settle
       and e.status = 'locked'
       and (
         (e.reveal_at is not null and now() >= e.reveal_at)
         or (e.auto_reveal_after_hours is not null
             and now() >= coalesce(e.lock_at, e.window_end_at)
                          + make_interval(hours => e.settle_grace_hours + e.auto_reveal_after_hours))
       )
  loop
    perform public._live_event_cut_results(r.id);
    update public.live_events set status = 'revealed', revealed_at = now() where id = r.id;
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (null, 'live_event_status', 'live_event', r.id::text,
            jsonb_build_object('from', 'locked', 'to', 'revealed', 'by', 'auto', 'why', r.why));
    v_n := v_n + 1;
  end loop;

  -- Attendance reward, half an hour after the doors close.
  for r in
    select e as ev, e.id, e.attendance_bonus_points from public.live_events e
     where e.managed_by = 'gym'
       and e.attendance_bonus_points > 0
       and e.attendance_paid_at is null
       and e.doors_close_at is not null
       and now() >= e.doors_close_at + interval '30 minutes'
       and e.status in ('live', 'locked', 'revealed', 'settled')
  loop
    v_x := public._live_event_pay_attendance_auto(r.ev);
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (null, 'live_event_attendance_paid', 'live_event', r.id::text,
            jsonb_build_object('paid', v_x, 'points', r.attendance_bonus_points, 'by', 'auto'));
    v_n := v_n + 1;
  end loop;

  -- Wrap-up: a revealed gym event is settled three days later.
  for r in
    update public.live_events e
       set status = 'settled'
     where e.managed_by = 'gym'
       and e.status = 'revealed'
       and e.revealed_at < now() - interval '3 days'
    returning e.id
  loop
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (null, 'live_event_status', 'live_event', r.id::text,
            jsonb_build_object('from', 'revealed', 'to', 'settled', 'by', 'auto'));
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$function$;

notify pgrst, 'reload schema';
