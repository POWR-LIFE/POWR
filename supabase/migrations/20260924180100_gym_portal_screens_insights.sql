-- =============================================================
-- Gym portal: the gym's own home, screens and insights
-- =============================================================
-- What a gym can see and change about itself, all through functions that
-- open with the _gym_role() check (20260924180000).
--
--   gym_portal_summary(partner)       Header, portal state, screen settings,
--                                     this week vs last, member count, event
--                                     counts.
--   gym_board_setup(partner, slug)    Owner: switch on the big screens (the
--                                     same gym_boards row the admin panel
--                                     makes).
--   gym_board_update(partner, patch)  Pause/resume either screen, viewing
--                                     distance, board size, league radius.
--                                     The owner can also rotate the screen
--                                     link.
--   gym_insights(partner, weeks)      Weekly trend, busiest hours and days,
--                                     activity mix, and this week's top 10
--                                     exactly as the wall shows them.
--
-- What a gym never gets from these: emails, health detail, anyone's
-- history, or names of members who turned "show on leaderboard" off.
-- Named rows come only from _gym_board_scores, which already filters on
-- show_on_leaderboard. Everything else is counts.

-- Totals for one window: every session that started in it, whoever it
-- belongs to (counts only, so members hidden from the board still count).
create or replace function public._gym_window_totals(p_partner_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with sess as (
    select s.id, s.user_id,
           coalesce(s.duration_sec, greatest(0, extract(epoch from coalesce(s.ended_at, s.started_at) - s.started_at)))::integer as dur
      from public.activity_sessions s
     where s.partner_id = p_partner_id
       and s.started_at >= p_from
       and s.started_at <  p_to
  )
  select jsonb_build_object(
    'athletes', (select count(distinct user_id) from sess),
    'sessions', (select count(*) from sess),
    'minutes',  coalesce((select sum(dur) / 60 from sess), 0)::integer,
    'points',   coalesce((select sum(pt.amount)
                            from public.point_transactions pt
                            join sess s on s.id = pt.session_id
                           where pt.type in ('earn', 'adjustment', 'penalty')), 0)::integer
  )
$$;

revoke all on function public._gym_window_totals(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ── Home ────────────────────────────────────────────────────────────────────
create or replace function public.gym_portal_summary(p_partner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role       text := public._gym_role(p_partner_id);
  v_board      public.gym_boards;
  v_tz         text;
  v_local_now  timestamp;
  v_week_start timestamptz;
  v_week_end   timestamptz;
  v_prev_start timestamptz;
begin
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_board from public.gym_boards where partner_id = p_partner_id;
  v_tz         := coalesce(v_board.tz, 'Europe/London');
  v_local_now  := now() at time zone v_tz;
  v_week_start := date_trunc('week', v_local_now) at time zone v_tz;
  v_week_end   := (date_trunc('week', v_local_now) + interval '7 days') at time zone v_tz;
  v_prev_start := (date_trunc('week', v_local_now) - interval '7 days') at time zone v_tz;

  return jsonb_build_object(
    'role', v_role,
    'gym', (select jsonb_build_object(
                     'id',        p.id,
                     'name',      p.name,
                     'logo_url',  p.logo_url,
                     'logo_bg',   p.logo_bg,
                     'address',   p.address,
                     'image_url', p.image1_url)
              from public.partners p where p.id = p_partner_id),
    'portal', (select jsonb_build_object(
                        'enabled',           g.enabled,
                        'trusted',           g.trusted_at is not null,
                        'suspended',         g.suspended_at is not null,
                        'max_active_events', g.max_active_events)
                 from public.gym_portal_settings g where g.partner_id = p_partner_id),
    'board', case when v_board.partner_id is null then null else jsonb_build_object(
               'slug',             v_board.slug,
               'display_token',    v_board.display_token,
               'enabled',          v_board.enabled,
               'board_size',       v_board.board_size,
               'tz',               v_board.tz,
               'viewing',          v_board.viewing,
               'league_enabled',   v_board.league_enabled,
               'league_radius_km', v_board.league_radius_km,
               'created_at',       v_board.created_at) end,
    'week_start_at', v_week_start,
    'week_end_at',   v_week_end,
    'week',          public._gym_window_totals(p_partner_id, v_week_start, v_week_end),
    'last_week',     public._gym_window_totals(p_partner_id, v_prev_start, v_week_start),
    'members',       (select count(*) from public.profiles pr where pr.preferred_gym_id = p_partner_id),
    'events',        (select jsonb_build_object(
                               'live',     count(*) filter (where e.status = 'live'),
                               'upcoming', count(*) filter (where e.status = 'scheduled'),
                               'finished', count(*) filter (where e.status in ('locked', 'revealed', 'settled')
                                                             and e.window_end_at > now() - interval '30 days'))
                        from public.live_events e
                       where e.venue_partner_id = p_partner_id)
  );
end;
$$;

-- ── Screens ─────────────────────────────────────────────────────────────────
create or replace function public.gym_board_setup(p_partner_id uuid, p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._gym_role(p_partner_id);
  v_slug text := lower(trim(coalesce(p_slug, '')));
begin
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if v_role = 'staff' then
    raise exception 'Only the gym''s owner can switch the screens on' using errcode = '42501';
  end if;
  if length(v_slug) not between 2 and 40 or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Use 2–40 lower-case letters, numbers and single dashes' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.gym_boards where partner_id = p_partner_id) then
    raise exception 'This gym''s screens are already set up' using errcode = 'P0001';
  end if;

  begin
    insert into public.gym_boards (partner_id, slug, created_by)
    values (p_partner_id, v_slug, auth.uid());
  exception when unique_violation then
    raise exception 'That link is taken by another gym — try another' using errcode = 'P0001';
  end;

  perform public._gym_audit(p_partner_id, 'gym_board_created', jsonb_build_object('slug', v_slug));
  return public.gym_portal_summary(p_partner_id) -> 'board';
end;
$$;

create or replace function public.gym_board_update(p_partner_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   text := public._gym_role(p_partner_id);
  v_key    text;
  v_rotate boolean;
begin
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nothing to change' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.gym_boards where partner_id = p_partner_id) then
    raise exception 'Switch the screens on first' using errcode = 'P0001';
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('enabled', 'league_enabled', 'viewing', 'board_size', 'league_radius_km', 'rotate_token') then
      raise exception 'Can''t change %', v_key using errcode = 'P0001';
    end if;
  end loop;

  if (p_patch ? 'enabled'        and jsonb_typeof(p_patch -> 'enabled')        <> 'boolean')
  or (p_patch ? 'league_enabled' and jsonb_typeof(p_patch -> 'league_enabled') <> 'boolean')
  or (p_patch ? 'rotate_token'   and jsonb_typeof(p_patch -> 'rotate_token')   <> 'boolean') then
    raise exception 'On/off settings take true or false' using errcode = 'P0001';
  end if;
  if p_patch ? 'viewing' and (p_patch ->> 'viewing') not in ('near', 'standard', 'far') then
    raise exception 'Viewing distance is near, standard or far' using errcode = 'P0001';
  end if;
  if p_patch ? 'board_size' and (p_patch ->> 'board_size') not in ('10', '25', '50') then
    raise exception 'Board size is 10, 25 or 50' using errcode = 'P0001';
  end if;
  if p_patch ? 'league_radius_km' and (p_patch ->> 'league_radius_km') not in ('5', '10', '15', '25', '50', '100') then
    raise exception 'League radius is 5, 10, 15, 25, 50 or 100 km' using errcode = 'P0001';
  end if;

  v_rotate := coalesce((p_patch ->> 'rotate_token')::boolean, false);
  if v_rotate and v_role = 'staff' then
    raise exception 'Only the gym''s owner can change the screen link' using errcode = '42501';
  end if;

  update public.gym_boards b
     set enabled          = coalesce((p_patch ->> 'enabled')::boolean, b.enabled),
         league_enabled   = coalesce((p_patch ->> 'league_enabled')::boolean, b.league_enabled),
         viewing          = coalesce(p_patch ->> 'viewing', b.viewing),
         board_size       = coalesce((p_patch ->> 'board_size')::integer, b.board_size),
         league_radius_km = coalesce((p_patch ->> 'league_radius_km')::integer, b.league_radius_km),
         display_token    = case when v_rotate
                                 then replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
                                 else b.display_token end,
         updated_at       = now()
   where b.partner_id = p_partner_id;

  perform public._gym_audit(p_partner_id,
    case when v_rotate then 'gym_board_token_rotated' else 'gym_board_updated' end,
    p_patch - 'rotate_token');
  return public.gym_portal_summary(p_partner_id) -> 'board';
end;
$$;

-- ── Insights ────────────────────────────────────────────────────────────────
create or replace function public.gym_insights(p_partner_id uuid, p_weeks integer default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_weeks      integer := least(greatest(coalesce(p_weeks, 8), 2), 26);
  v_tz         text;
  v_week0      timestamp;   -- this week's Monday 00:00, gym-local
  v_from       timestamptz;
  v_week_start timestamptz;
  v_week_end   timestamptz;
  v_since28    timestamptz := now() - interval '28 days';
begin
  if public._gym_role(p_partner_id) is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  v_tz         := coalesce((select tz from public.gym_boards where partner_id = p_partner_id), 'Europe/London');
  v_week0      := date_trunc('week', now() at time zone v_tz);
  v_from       := (v_week0 - make_interval(weeks => v_weeks - 1)) at time zone v_tz;
  v_week_start := v_week0 at time zone v_tz;
  v_week_end   := (v_week0 + interval '7 days') at time zone v_tz;

  return jsonb_build_object(
    'tz', v_tz,

    -- Monday-to-Monday in the gym's time; new = first ever session here.
    'weeks', (
      with sess as (
        select s.id, s.user_id,
               date_trunc('week', s.started_at at time zone v_tz) as wk,
               coalesce(s.duration_sec, greatest(0, extract(epoch from coalesce(s.ended_at, s.started_at) - s.started_at)))::integer as dur
          from public.activity_sessions s
         where s.partner_id = p_partner_id
           and s.started_at >= v_from
      ),
      firsts as (
        select s.user_id, date_trunc('week', min(s.started_at) at time zone v_tz) as first_wk
          from public.activity_sessions s
         where s.partner_id = p_partner_id
         group by s.user_id
      ),
      agg as (
        select se.wk,
               count(*)::integer                                             as sessions,
               count(distinct se.user_id)::integer                           as athletes,
               count(distinct se.user_id) filter (where f.first_wk = se.wk)::integer as new_athletes,
               (sum(se.dur) / 60)::integer                                   as minutes
          from sess se
          join firsts f on f.user_id = se.user_id
         group by se.wk
      ),
      pts as (
        select se.wk, sum(pt.amount)::integer as points
          from sess se
          join public.point_transactions pt on pt.session_id = se.id
         where pt.type in ('earn', 'adjustment', 'penalty')
         group by se.wk
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'week_start',   w.wk at time zone v_tz,
               'sessions',     coalesce(a.sessions, 0),
               'athletes',     coalesce(a.athletes, 0),
               'new_athletes', coalesce(a.new_athletes, 0),
               'minutes',      coalesce(a.minutes, 0),
               'points',       coalesce(p.points, 0)
             ) order by w.wk), '[]'::jsonb)
        from generate_series(v_week0 - make_interval(weeks => v_weeks - 1), v_week0, interval '1 week') w(wk)
        left join agg a on a.wk = w.wk
        left join pts p on p.wk = w.wk
    ),

    -- Last 28 days: sessions by local start hour (0–23) and weekday (Mon–Sun).
    'hours', (
      select jsonb_agg(coalesce(c.n, 0) order by h.h)
        from generate_series(0, 23) h(h)
        left join (
          select extract(hour from s.started_at at time zone v_tz)::integer as h, count(*)::integer as n
            from public.activity_sessions s
           where s.partner_id = p_partner_id and s.started_at >= v_since28
           group by 1
        ) c on c.h = h.h
    ),
    'days', (
      select jsonb_agg(coalesce(c.n, 0) order by d.d)
        from generate_series(1, 7) d(d)
        left join (
          select extract(isodow from s.started_at at time zone v_tz)::integer as d, count(*)::integer as n
            from public.activity_sessions s
           where s.partner_id = p_partner_id and s.started_at >= v_since28
           group by 1
        ) c on c.d = d.d
    ),
    'activities', (
      select coalesce(jsonb_agg(jsonb_build_object('type', x.t, 'sessions', x.n) order by x.n desc, x.t), '[]'::jsonb)
        from (
          select s.type::text as t, count(*)::integer as n
            from public.activity_sessions s
           where s.partner_id = p_partner_id and s.started_at >= v_since28
           group by 1
        ) x
    ),
    'athletes_28d', (
      select count(distinct s.user_id)
        from public.activity_sessions s
       where s.partner_id = p_partner_id and s.started_at >= v_since28
    ),
    'members', (select count(*) from public.profiles pr where pr.preferred_gym_id = p_partner_id),

    -- This week's top 10 exactly as the wall shows them.
    'top', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'rank',         sc.rank,
               'display_name', pr.display_name,
               'username',     pr.username,
               'avatar_url',   pr.avatar_url,
               'points',       sc.score,
               'sessions',     sc.sessions
             ) order by sc.rank), '[]'::jsonb)
        from (
          select * from public._gym_board_scores(p_partner_id, v_week_start, v_week_end, v_tz)
           where score > 0
           order by rank
           limit 10
        ) sc
        join public.profiles pr on pr.id = sc.user_id
    )
  );
end;
$$;

revoke all on function public.gym_portal_summary(uuid)         from public, anon;
revoke all on function public.gym_board_setup(uuid, text)      from public, anon;
revoke all on function public.gym_board_update(uuid, jsonb)    from public, anon;
revoke all on function public.gym_insights(uuid, integer)      from public, anon;
grant execute on function public.gym_portal_summary(uuid)      to authenticated;
grant execute on function public.gym_board_setup(uuid, text)   to authenticated;
grant execute on function public.gym_board_update(uuid, jsonb) to authenticated;
grant execute on function public.gym_insights(uuid, integer)   to authenticated;
