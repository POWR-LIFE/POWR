-- =============================================================
-- Live events: several at once, and who sees each one
-- =============================================================
-- Up to now the app asked for ONE event (get_active_live_event: earliest
-- start, limit 1) and every event was shown to every member. Venue-run
-- events break both assumptions: several venues can run at once, and a
-- Stars Gym challenge means nothing to someone who trains at ONE LDN.
--
-- audience_mode
--   'all'    Every member sees it. The default, so every existing row
--            keeps today's behaviour.
--   'venue'  The venue's people:
--              · members whose preferred gym it is;
--              · anyone with a session there in the last audience_recent_days;
--              · when audience_radius_km is set, anyone near it. "Near" is the
--                app's last known position (sent with the request, never
--                stored), or a gym they belong to / trained at in the last
--                28 days lying inside the radius.
--            Registrants and preview testers always see it. A QR / invite
--            deep link (get_live_event by slug) opens it for anyone, and
--            joining keeps it in their list from then on.
--
-- get_active_live_events(lat, lng) is the list the app reads from this
-- release on. get_active_live_event(), which older builds call, becomes the
-- first item of that list: an old build still shows at most one event, and
-- never one outside the caller's audience.

alter table public.live_events
  add column if not exists audience_mode        text    not null default 'all',
  add column if not exists audience_radius_km   integer,
  add column if not exists audience_recent_days integer not null default 60;

alter table public.live_events
  drop constraint if exists live_events_audience_mode_check,
  add  constraint live_events_audience_mode_check
       check (audience_mode in ('all', 'venue')),
  drop constraint if exists live_events_audience_radius_check,
  add  constraint live_events_audience_radius_check
       check (audience_radius_km is null or audience_radius_km between 1 and 50),
  drop constraint if exists live_events_audience_recent_days_check,
  add  constraint live_events_audience_recent_days_check
       check (audience_recent_days between 7 and 365),
  -- A venue audience needs a venue, and an opt-in board: a global board is
  -- every member by definition, which a venue audience can't be.
  drop constraint if exists live_events_audience_venue_check,
  add  constraint live_events_audience_venue_check
       check (audience_mode = 'all' or (venue_partner_id is not null and scope = 'opt_in'));

comment on column public.live_events.audience_mode is
  'all = every member sees the event. venue = the venue''s members, recent visitors and (with audience_radius_km) people nearby. Registrants, previewers and slug deep links always see it.';
comment on column public.live_events.audience_radius_km is
  'venue audience only: also show it to people within this many km of the venue. Null = no radius.';
comment on column public.live_events.audience_recent_days is
  'venue audience only: a session at the venue within this many days puts someone in the audience.';

-- ── Great-circle distance in km ─────────────────────────────────────────────
-- No PostGIS here (gym-league does its distances in TypeScript). Haversine
-- is plenty for "is this within a few km"; null in, null out.
create or replace function public._km_between(
  p_lat1 double precision, p_lng1 double precision,
  p_lat2 double precision, p_lng2 double precision
)
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $$
  select 6371.0088 * 2 * asin(least(1.0, sqrt(
           power(sin(radians(p_lat2 - p_lat1) / 2), 2)
         + cos(radians(p_lat1)) * cos(radians(p_lat2))
         * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
         )))
$$;

-- ── Is this person in the event's audience? ────────────────────────────────
create or replace function public._live_event_in_audience(
  p_event public.live_events,
  p_uid   uuid,
  p_lat   double precision default null,
  p_lng   double precision default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lat double precision;
  v_lng double precision;
begin
  if p_event.audience_mode = 'all' or p_event.venue_partner_id is null then
    return true;
  end if;
  if p_uid is null then
    return false;
  end if;

  -- Already in it (a disqualified registrant still needs to see the state
  -- they're in), or an admin-listed preview tester.
  if exists (select 1 from public.live_event_participants lp
              where lp.event_id = p_event.id and lp.user_id = p_uid)
     or public._live_event_previewer(p_event, p_uid) then
    return true;
  end if;

  -- The venue is their gym.
  if exists (select 1 from public.profiles p
              where p.id = p_uid and p.preferred_gym_id = p_event.venue_partner_id) then
    return true;
  end if;

  -- They've trained there lately.
  if exists (select 1 from public.activity_sessions s
              where s.user_id = p_uid
                and s.partner_id = p_event.venue_partner_id
                and s.started_at > now() - make_interval(days => p_event.audience_recent_days)) then
    return true;
  end if;

  if p_event.audience_radius_km is null then
    return false;
  end if;

  -- The venue's pin: locations[0], the same point get_live_event hands the app.
  select pl.lat, pl.lng into v_lat, v_lng
    from public.partner_locations pl
   where pl.partner_id = p_event.venue_partner_id
   order by pl.loc_idx
   limit 1;
  if v_lat is null or v_lng is null then
    return false;
  end if;

  -- Near it now …
  if p_lat is not null and p_lng is not null
     and public._km_between(p_lat, p_lng, v_lat, v_lng) <= p_event.audience_radius_km then
    return true;
  end if;

  -- … or where they usually train is: their own gym, or any gym they've had a
  -- session at in the last 28 days. This is also what "nearby" means for a
  -- build or a phone that sends no position.
  return exists (
    select 1
      from public.partner_locations pl
     where pl.partner_id in (
             select p.preferred_gym_id
               from public.profiles p
              where p.id = p_uid and p.preferred_gym_id is not null
             union
             select s.partner_id
               from public.activity_sessions s
              where s.user_id = p_uid
                and s.partner_id is not null
                and s.started_at > now() - interval '28 days'
           )
       and public._km_between(pl.lat, pl.lng, v_lat, v_lng) <= p_event.audience_radius_km
  );
end;
$$;

revoke all on function public._live_event_in_audience(public.live_events, uuid, double precision, double precision)
  from public, anon, authenticated;

-- ── get_live_event: + audience_mode ────────────────────────────────────────
-- Re-stated from prod (pg_get_functiondef, 2026-09-24); the only change is the
-- audience_mode key. The slug lookup is deliberately NOT audience-filtered:
-- it is the QR / invite / promo-page path, which works for anyone.
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
$$;

-- ── The list ────────────────────────────────────────────────────────────────
-- Same visibility as the single pick always had (not archived; drafts only for
-- their preview testers; ended less than 7 days ago), plus the audience.
-- Order: events you're in, then live, then upcoming, then finished; earliest
-- start first within each. Drafts (preview only) go last so a tester's phone
-- still leads with what everyone else sees. The app re-sorts for display;
-- this order matters for old builds, which only ever see item 0.
create or replace function public.get_active_live_events(
  p_lat double precision default null,
  p_lng double precision default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
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
        select public.get_live_event(c.slug) as payload, c.ord
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
                                            else 2 end,
                              e.window_start_at
                   ) as ord
              from public.live_events e
             where e.status <> 'archived'
               and (e.status <> 'draft' or public._live_event_previewer(e, v_uid))
               and e.window_end_at > now() - interval '7 days'
               and public._live_event_in_audience(e, v_uid, p_lat, p_lng)
          ) c
         where c.ord <= 6
      ) x
     where x.payload is not null
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_active_live_events(double precision, double precision) from public, anon;
grant execute on function public.get_active_live_events(double precision, double precision) to authenticated;

-- Older builds: the first event of the caller's list (no position — the
-- "where they usually train" rule still covers a radius). Grants carry over.
create or replace function public.get_active_live_event()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.get_active_live_events() -> 0
$$;

-- ── Homepage: only everyone-events are "current" ───────────────────────────
-- Re-stated from prod; a venue-audience event isn't promoted on powr.life
-- while it runs. Past finished events (results, 5+ entrants) still show
-- whatever their audience was.
create or replace function public.landing_events()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(x) order by x.window_start_at desc), '[]'::json)
  from (
    select
      e.slug,
      e.name,
      e.status,
      e.window_start_at,
      e.window_end_at,
      e.doors_open_at,
      e.prizes,
      e.logo_url,
      p.name       as venue,
      p.logo_url   as venue_logo,
      p.address    as venue_address,
      c.participants,
      (e.hidden = false
         and e.status not in ('draft', 'archived')
         and e.window_end_at > now() - interval '7 days'
         and e.audience_mode = 'all') as is_current
    from live_events e
    left join partners p on p.id = e.venue_partner_id
    cross join lateral (
      select count(*) as participants
      from live_event_participants lp
      where lp.event_id = e.id and lp.disqualified_at is null
    ) c
    where e.status <> 'draft'
      and (
        (e.hidden = false and e.status <> 'archived'
           and e.window_end_at > now() - interval '7 days'
           and e.audience_mode = 'all')
        or
        (e.revealed_at is not null and e.window_end_at < now() and c.participants >= 5)
      )
    order by e.window_start_at desc
    limit 12
  ) x;
$$;
