-- =============================================================
-- SERIES SCREEN — the POWR Series on a TV, one screen for every TV
--
-- Jamie (11-02): "on our gym clash page, we have the links that we can send
-- to the gyms to display certain screens … We want to have something similar
-- for the series", then "We want the link to be in the series page, not the
-- gym page", then "We should be able to have one screen for all."
--
-- powr.life/series-tv?k=<key>: the countdown to the round, how it works, the
-- seven prizes, Squad Builder and the QR to join. Nothing on it is per gym or
-- per member, so it is not a gym screen: no gym_boards row, one link. The
-- link's key, on/off switch and city live in system_config
-- (series_screen_key, series_screen = 'on'|'off', series_screen_city) and are
-- run from /admin/series → Screens, which creates them on first use (admins
-- already write system_config). The edge function series-screen reads them.
--
-- The one thing the screen needs from the database that a table read can't
-- give it is the start-line crowd for the rail, so it gets the SAME numbers
-- get_series_invite_board gives the app (real members + the pacers' ramp):
-- the TV and the phone in front of it agree. Service role only.
-- =============================================================

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
