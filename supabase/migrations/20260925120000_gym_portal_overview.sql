-- =============================================================
-- Gym portal overview: the numbers that change every day
-- =============================================================
-- Jamie, 2026-09-25: the overview must fit one screen, show what a gym wants
-- at a glance, and give people a reason to open it again. What changes
-- daily is what does that, so gym_portal_summary gains three things the old
-- weekly totals couldn't say:
--   * days      — sessions and athletes at the gym for each of the last 14
--                 local days (last week, then this week), for a day-by-day
--                 strip with last week as a ghost behind it;
--   * now       — people in the gym right now: open gym visits started in
--                 the last 6 hours, exactly as the Gym League's in_now counts
--                 them (20260913120000), so the two screens never disagree;
--   * new_faces — members whose first-ever session at this gym was this week.
-- Re-stated from prod (md5 ca217c5b3828e995bd7970ac04674895, the body in
-- 20260924180100); nothing else about the payload changes.

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
                       where e.venue_partner_id = p_partner_id),
    -- Last week then this week, one row per local day, so the overview can
    -- draw today against the same day last week.
    'days',          (select jsonb_agg(jsonb_build_object(
                               'day',      to_char(g.day, 'YYYY-MM-DD'),
                               'sessions', coalesce(x.sessions, 0),
                               'athletes', coalesce(x.athletes, 0)) order by g.day)
                        from generate_series((v_prev_start at time zone v_tz)::date,
                                             (v_week_end at time zone v_tz)::date - 1,
                                             interval '1 day') g(day)
                        left join (select (s.started_at at time zone v_tz)::date as day,
                                          count(*)::integer                     as sessions,
                                          count(distinct s.user_id)::integer    as athletes
                                     from public.activity_sessions s
                                    where s.partner_id = p_partner_id
                                      and s.started_at >= v_prev_start
                                      and s.started_at <  v_week_end
                                    group by 1) x on x.day = g.day::date),
    'now',           (select count(*) from public.gym_visits v
                       where v.partner_id = p_partner_id
                         and v.ended_at is null
                         and v.started_at > now() - interval '6 hours'),
    'new_faces',     (select count(*) from (select s.user_id, min(s.started_at) as first_at
                                              from public.activity_sessions s
                                             where s.partner_id = p_partner_id
                                             group by s.user_id) f
                       where f.first_at >= v_week_start)
  );
end;
$$;
