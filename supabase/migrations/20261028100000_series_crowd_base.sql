-- The start line's crowd: how full it is when the invite period opens.
--
-- Applies AFTER 20261027120000_series_join.sql (restates
-- get_series_invite_board reading one more round column; nothing else changes).
--
-- The crowd waiting at the start line is the real members plus the pacers who
-- fill it to the board's day-1 size by the gun (20261026150000). The share of
-- those pacers already there when the invite period opens was fixed at 0.4;
-- on 2026-10-28 that read 685 against a 1,500 board and Jamie asked for 1,200.
-- The share is now a round setting, `series_rounds.crowd_base` (0..1, default
-- 0.4), so the opening crowd can be set per round without touching the
-- function. Round 01's is worked out as this applies so the line reads 1,200
-- at that moment (about 0.78), then climbs ~19 a day to 1,500 at the gun.
--
--   waiting(t) = real + round(pacers_at_gun * (base + (1 - base) * p)),
--   p = clamp((t - ramp_from) / (ramp_to - ramp_from), 0, 1)
--
-- Nothing about pacers changes: none is named, none reaches a push, and the
-- board itself (_series_field) is untouched.

alter table public.series_rounds
  add column if not exists crowd_base numeric not null default 0.4;

alter table public.series_rounds drop constraint if exists series_rounds_crowd_base_check;
alter table public.series_rounds
  add constraint series_rounds_crowd_base_check check (crowd_base >= 0 and crowd_base <= 1);

comment on column public.series_rounds.crowd_base is
  'Share of the pacers at the gun already on the start line when the invite period opens (0..1). The crowd ramps from this share to all of them at the gun.';

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
  -- Members who joined the round's season (20261027120000).
  members as (
    select p.id, coalesce(nullif(trim(p.display_name), ''), p.username, 'POWR member') as name,
           coalesce(p.show_on_leaderboard, true) as listed
      from public.series_entries e
      join public.profiles p on p.id = e.user_id
     where e.season_id = v_round.season_id and e.joined_at < v_round.ends_at
       and not public._series_is_demo(p.id)
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
      'base', v_round.crowd_base),
    'me', jsonb_build_object(
      'rank', (select k.rank from ranked k where k.user_id = v_uid),
      'friends', coalesce((select p.friends from per p where p.user_id = v_uid), 0),
      'joining', coalesce((select p.joining from per p where p.user_id = v_uid), 0),
      'code', (select pr.referral_code from public.profiles pr where pr.id = v_uid),
      'joined', exists (select 1 from public.series_entries e
                         where e.season_id = v_round.season_id and e.user_id = v_uid))
  ) into v_out;
  return v_out;
end;
$$;

-- Round 01: 1,200 on the line as this applies (see the header). The share is
-- solved from the function's own inputs at this moment: real members, the
-- pacers at the gun and how far the invite period has run.
update public.series_rounds r
   set crowd_base = round(greatest(0, least(1,
         (((1200 - m.real)::numeric / nullif(m.pacers_at_gun, 0)) - m.p) / nullif(1 - m.p, 0))), 5)
  from (
    with rd as (select * from public.series_rounds where slug = 'autumn-01'),
    members as (
      select p.id, coalesce(p.show_on_leaderboard, true) as listed
        from rd, public.series_entries e join public.profiles p on p.id = e.user_id
       where e.season_id = rd.season_id and e.joined_at < rd.ends_at
         and not public._series_is_demo(p.id)
         and not exists (select 1 from public.series_exclusions x
                          where x.user_id = p.id and (x.round_id is null or x.round_id = rd.id))
    )
    select (select count(*) from members where listed) as real,
           least((select count(*) from public.series_pacers sp where not sp.disabled),
                 greatest(0, rd.pacer_target - (select count(*) from members))) as pacers_at_gun,
           least(1, greatest(0,
             extract(epoch from (now() - coalesce(rd.invite_from, rd.starts_at - interval '14 days')))
             / extract(epoch from (rd.starts_at - coalesce(rd.invite_from, rd.starts_at - interval '14 days'))))) as p
      from rd
  ) m
 where r.slug = 'autumn-01';
