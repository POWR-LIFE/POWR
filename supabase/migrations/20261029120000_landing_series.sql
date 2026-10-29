-- =============================================================
-- LANDING — the Series on powr.life
--
-- Jamie (10-29): the homepage's events section goes; the Series takes its
-- place as a core piece of the app. Like landing_events(), nothing on the
-- site is dated by hand: the page asks this once and the clock decides what
-- it shows (the start line before the gun, the board while a round is on,
-- the next round between rounds).
--
-- landing_series() is anon-executable and says only what the Series share
-- card already says in public: the published season and its round (on now,
-- else next, else last — series_status()'s own pick), the round's prizes as
-- entered in /admin/series, and the start line's crowd inputs exactly as
-- get_series_invite_board() hands them to the app, so the site and the app
-- always show the same number. No member is named; no points leave.
-- =============================================================

create or replace function public.landing_series()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today   date := (now() at time zone 'Europe/London')::date;
  v_season  public.series_seasons;
  v_round   public.series_rounds;
  v_members integer := 0;
  v_listed  integer := 0;
begin
  -- The season the app wears: on today (London), else the next to start, else the last to end.
  select s.* into v_season
    from public.series_seasons s
   where s.published
   order by (v_today between s.starts_on and s.ends_on) desc,
            (s.starts_on > v_today) desc,
            case when s.starts_on > v_today then s.starts_on end asc,
            s.ends_on desc
   limit 1;
  if v_season.id is null then
    return null;
  end if;

  -- Its round: on now, else the next to start, else the last to end.
  select r.* into v_round
    from public.series_rounds r
   where r.season_id = v_season.id and r.published
   order by (now() >= r.starts_at and now() < r.ends_at) desc,
            (r.starts_at > now()) desc,
            case when r.starts_at > now() then r.starts_at end asc,
            r.ends_at desc
   limit 1;

  -- The members on the line: the same set get_series_invite_board() counts
  -- (joined the season before the round ends, not demo, not excluded).
  if v_round.id is not null then
    select count(*), count(*) filter (where m.listed)
      into v_members, v_listed
      from (
        select coalesce(p.show_on_leaderboard, true) as listed
          from public.series_entries e
          join public.profiles p on p.id = e.user_id
         where e.season_id = v_season.id
           and e.joined_at < v_round.ends_at
           and not public._series_is_demo(p.id)
           and not exists (select 1 from public.series_exclusions x
                            where x.user_id = p.id
                              and (x.round_id is null or x.round_id = v_round.id))
      ) m;
  end if;

  return jsonb_build_object(
    'season', jsonb_build_object(
      'slug', v_season.slug, 'name', v_season.name, 'look', v_season.look,
      'number', v_season.number, 'code', v_season.code,
      'starts_on', v_season.starts_on, 'ends_on', v_season.ends_on,
      'rounds', (select count(*) from public.series_rounds r
                  where r.season_id = v_season.id and r.published)),
    'round', case when v_round.id is null then null else jsonb_build_object(
      'slug', v_round.slug, 'name', v_round.name,
      'starts_at', v_round.starts_at, 'ends_at', v_round.ends_at,
      'draw_days', v_round.draw_days,
      'prizes', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'kind', p.kind, 'place', p.place, 'name', p.name, 'sponsor', p.sponsor,
                 'detail', p.detail, 'image_url', p.image_url, 'winners', p.winners)
               order by p.place nulls last, p.kind)
          from public.series_prizes p
         where p.round_id = v_round.id), '[]'::jsonb),
      -- The crowd at the start line, as the app computes it: real members
      -- waiting plus the pacers who fill the line to the board's day-1 size
      -- by the gun (20261028100000). The client ramps it with the clock.
      'crowd', jsonb_build_object(
        'real', v_listed,
        'pacers_at_gun', least(
          (select count(*) from public.series_pacers sp where not sp.disabled),
          greatest(0, v_round.pacer_target - v_members)),
        'ramp_from', coalesce(v_round.invite_from, v_round.starts_at - interval '14 days'),
        'ramp_to', v_round.starts_at,
        'base', v_round.crowd_base)) end,
    'prev_round', (
      select jsonb_build_object('slug', q.slug, 'name', q.name, 'ends_at', q.ends_at)
        from public.series_rounds q
       where q.season_id = v_season.id and q.published
         and q.id is distinct from v_round.id
         and q.ends_at <= v_round.starts_at
       order by q.ends_at desc
       limit 1),
    'next_round', (
      select jsonb_build_object('slug', n.slug, 'name', n.name,
                                'starts_at', n.starts_at, 'ends_at', n.ends_at, 'draw_days', n.draw_days)
        from public.series_rounds n
       where n.season_id = v_season.id and n.published
         and n.id is distinct from v_round.id
         and n.starts_at >= v_round.ends_at
       order by n.starts_at
       limit 1)
  );
end;
$$;

comment on function public.landing_series() is
  'powr.life: the published season, its round (on now, else next, else last), the round''s prizes and the start line''s crowd inputs. Public aggregates only; no member is named.';

revoke all on function public.landing_series() from public;
grant execute on function public.landing_series() to anon, authenticated;
