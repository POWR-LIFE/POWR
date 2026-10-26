-- The start line's crowd: pacers wait there too.
--
-- Applies AFTER 20261026120000_series_invite_board.sql (restates
-- get_series_invite_board with one more key; nothing else changes).
--
-- Pacers are on the board as members from the gun (20261022120000), so the
-- crowd waiting at the start line has to hold them too, or it would show the
-- 131 real members and jump to ~1,500 the moment the round opens. They fill
-- it up over the invite period: `base` of the day-1 seats when it opens,
-- rising in a straight line to all of them at the gun, so at the gun the crowd
-- is the board's day-1 size (pacer_target). The app works the count out per
-- second from these numbers:
--
--   waiting(t) = real + round(pacers_at_gun * (base + (1 - base) * p)),
--   p = clamp((t - ramp_from) / (ramp_to - ramp_from), 0, 1)
--
-- Pacers stay OUT of the invite race itself: they bring no friends, so they're
-- simply on the start line. No pacer is ever named here, and nothing about
-- them reaches a push.

create or replace function public.get_series_invite_board(p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_round public.series_rounds;
  v_out   jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_slug is not null then
    select * into v_round from public.series_rounds where slug = p_slug and (published or public.is_admin());
  else
    select * into v_round from public.series_rounds
     where published and starts_at > now() order by starts_at limit 1;
  end if;
  if v_round.id is null then
    return null;
  end if;

  with win as (
    select * from public._series_referral_windows(v_round.id)
  ),
  refs as (
    select rf.referrer_id, rf.referred_id, rf.converted_at
      from public.referrals rf
     where exists (select 1 from win w where rf.created_at >= w.starts_at and rf.created_at < w.ends_at)
       and not public._series_is_demo(rf.referred_id)
  ),
  per as (
    select r.referrer_id as user_id,
           count(distinct r.referred_id) filter (where r.converted_at is not null and r.converted_at < v_round.ends_at)::int as friends,
           count(distinct r.referred_id) filter (where r.converted_at is null)::int as joining,
           max(r.converted_at) as reached
      from refs r
     group by r.referrer_id
  ),
  members as (
    select p.id, coalesce(nullif(trim(p.display_name), ''), p.username, 'POWR member') as name,
           coalesce(p.show_on_leaderboard, true) as listed
      from public.profiles p
     where not public._series_is_demo(p.id)
       and not exists (select 1 from public.series_exclusions x
                        where x.user_id = p.id and (x.round_id is null or x.round_id = v_round.id))
  ),
  ranked as (
    select m.id as user_id, m.name, m.listed, per.friends, per.joining,
           row_number() over (order by per.friends desc, per.reached, m.id)::int as rank
      from per join members m on m.id = per.user_id
     where per.friends > 0
  )
  select jsonb_build_object(
    'round', jsonb_build_object('slug', v_round.slug, 'name', v_round.name, 'starts_at', v_round.starts_at),
    'open', v_round.invite_from is not null and now() >= v_round.invite_from and now() < v_round.starts_at,
    'opens_at', v_round.invite_from,
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
              'rank', k.rank, 'name', k.name, 'friends', k.friends, 'joining', k.joining, 'you', k.user_id = v_uid)
              order by k.rank)
              from ranked k where (k.rank <= 10 and k.listed) or k.user_id = v_uid), '[]'::jsonb),
    'ranked', (select count(*) from ranked),
    'start_line', (select count(*) from members m where m.listed and not exists (select 1 from ranked k where k.user_id = m.id)),
    -- The crowd at the start line: real members waiting, and the pacers who
    -- fill it up to the board's day-1 size by the gun (see the header).
    'crowd', jsonb_build_object(
      'real', (select count(*) from members m where m.listed),
      'pacers_at_gun', least(
        (select count(*) from public.series_pacers sp where not sp.disabled),
        greatest(0, v_round.pacer_target - (select count(*) from members))),
      'ramp_from', coalesce(v_round.invite_from, v_round.starts_at - interval '14 days'),
      'ramp_to', v_round.starts_at,
      'base', 0.4),
    'me', jsonb_build_object(
      'rank', (select k.rank from ranked k where k.user_id = v_uid),
      'friends', coalesce((select p.friends from per p where p.user_id = v_uid), 0),
      'joining', coalesce((select p.joining from per p where p.user_id = v_uid), 0),
      'code', (select pr.referral_code from public.profiles pr where pr.id = v_uid))
  ) into v_out;
  return v_out;
end;
$$;
