-- =============================================================
-- SERIES SCREEN — the POWR Series on the gym's TV
--
-- Jamie (11-02): "on our gym clash page, we have the links that we can send
-- to the gyms to display certain screens on their displays. We want to have
-- something similar for the series."
--
-- A third link on the gym's display token (powr.life/series/tv/<slug>?k=),
-- beside the wall (/gym/) and Gym Clash (/league/): the season, the round's
-- countdown, how it works, the seven prizes, Squad Builder and the QR to
-- join. Nothing per member is on it. Two pieces here:
--   gym_boards.series_enabled   pause this screen without touching the others
--   _series_screen_crowd(round) the start-line crowd for the rail — the SAME
--                               numbers get_series_invite_board gives the app
--                               (real members + the pacers' ramp), so the TV
--                               and the phone in front of it agree. Service
--                               role only; the edge function series-screen
--                               is the only caller.
-- gym_board_update (the venue portal) learns the new switch and
-- gym_portal_summary carries it back, so the Screens page can pause it.
-- =============================================================

alter table public.gym_boards
  add column if not exists series_enabled boolean not null default true;

comment on column public.gym_boards.series_enabled is
  'Whether the Series screen (/series/tv/<slug>) answers for this board. Independent of enabled (the wall) and league_enabled (Gym Clash).';

-- ── The start-line crowd, for a screen with no member ───────────────────────
-- The members and crowd pieces of get_series_invite_board (20261026150000),
-- without the member-bound parts. Keep the two in step: a change to who
-- counts as waiting belongs in both.
create or replace function public._series_screen_crowd(p_round uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with r as (
    select * from public.series_rounds where id = p_round
  ),
  members as (
    select p.id, coalesce(p.show_on_leaderboard, true) as listed
      from r
      join public.series_entries e on e.season_id = r.season_id and e.joined_at < r.ends_at
      join public.profiles p on p.id = e.user_id
     where not public._series_is_demo(p.id)
       and not exists (select 1 from public.series_exclusions x
                        where x.user_id = p.id and (x.round_id is null or x.round_id = r.id))
  )
  select jsonb_build_object(
    'real', (select count(*) from members m where m.listed),
    'pacers_at_gun', least(
      (select count(*) from public.series_pacers sp where not sp.disabled),
      greatest(0, r.pacer_target - (select count(*) from members))),
    'ramp_from', coalesce(r.invite_from, r.starts_at - interval '14 days'),
    'ramp_to', r.starts_at,
    'base', r.crowd_base)
  from r;
$$;

revoke all on function public._series_screen_crowd(uuid) from public, anon, authenticated;

-- ── The venue portal: pause / resume the Series screen ──────────────────────
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
    if v_key not in ('enabled', 'league_enabled', 'series_enabled', 'viewing', 'board_size', 'league_radius_km', 'rotate_token') then
      raise exception 'Can''t change %', v_key using errcode = 'P0001';
    end if;
  end loop;

  if (p_patch ? 'enabled'        and jsonb_typeof(p_patch -> 'enabled')        <> 'boolean')
  or (p_patch ? 'league_enabled' and jsonb_typeof(p_patch -> 'league_enabled') <> 'boolean')
  or (p_patch ? 'series_enabled' and jsonb_typeof(p_patch -> 'series_enabled') <> 'boolean')
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
         series_enabled   = coalesce((p_patch ->> 'series_enabled')::boolean, b.series_enabled),
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

-- ── The summary carries the switch back to the Screens page ─────────────────
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
               'series_enabled',   v_board.series_enabled,
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
