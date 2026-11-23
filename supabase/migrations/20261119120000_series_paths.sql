-- The Series board's "how they got here" replay (2026-11-19).
--
-- Tap the top 3 on the Overall board, or your own row, and a card races your
-- round against one of theirs a day at a time: what each of you did, what it
-- paid, and what you'd need to pass them. This is the data behind it, one call
-- per board.
--
-- What it gives away: a day of the round, the activity type, its Series
-- points and how many sessions earned them (so the card can say "6 gym visits
-- passes #3"). Never a time, place, gym, distance, heart rate or session id.
--
-- Who's in it:
--   * you, always (once you're on the board);
--   * the board's top 3, but only when all three are real, listed members.
--     Pacers stay under the real #3 except on a quiet round start (see
--     _series_field: they can reach the leader less one, up to 20), so for
--     those first hours the podium has no replay at all rather than one row
--     that won't open;
--   * nobody else during Blind Mode, which hides who's where.
--
-- It also says where more points would put you ("me.ladder"): your place with
-- 1 to 200 more points and everyone else standing still. That's rank arithmetic
-- on the board members already see; it names nobody.
--
-- The points are the board's own: _series_ledger's sessions scored with the
-- round's moments exactly as _series_day_points does (that CTE is copied, with
-- the type kept), so a replay always ends on the total the board shows.

create or replace function public.get_series_paths(p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_round public.series_rounds;
  v_blind boolean;
  v_ids   uuid[];
  v_me    jsonb;
  v_out   jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_slug is not null then
    select * into v_round from public.series_rounds where slug = p_slug and (published or public.is_admin());
  else
    select * into v_round from public.series_rounds
     where published and now() >= starts_at and now() < ends_at order by starts_at limit 1;
  end if;
  if v_round.id is null or now() < v_round.starts_at then
    return null;
  end if;
  v_blind := exists (select 1 from public.series_moments m
                      where m.round_id = v_round.id and m.kind = 'blind' and now() >= m.starts_at and now() < m.ends_at);

  -- The board as get_series_board ranks it: listed members and pacers, plus you.
  with field as materialized (
    select * from public._series_field(v_round.id) where listed or user_id = v_uid
  ),
  ranked as (
    select f.user_id, f.pacer, row_number() over (order by f.points desc, f.pacer, f.user_id)::int as rank
      from field f
  ),
  podium as (
    select r.user_id from ranked r
     where r.rank <= 3
       and not v_blind
       and (select count(*) from ranked x where x.rank <= 3 and not x.pacer) = 3
  ),
  me as (
    select f.user_id, f.points from field f where f.user_id = v_uid and not f.pacer
  )
  select (select array_agg(distinct x.user_id)
            from (select user_id from podium union all select user_id from me) x),
         -- Your place, and the place 1 to 200 more points would give you with
         -- everyone else where they are now: "one gym visit moves you up about
         -- 85 places". The board's own order (points, members before pacers,
         -- then id), so +0 is the rank the board shows. Hidden in Blind Mode.
         (select case when v_blind then null else jsonb_build_object(
                   'rank', (select r.rank from ranked r where r.user_id = me.user_id),
                   'points', me.points,
                   'ladder', (select jsonb_agg(
                                ((select count(*) from field f
                                   where f.user_id <> me.user_id
                                     and (f.points > me.points + k
                                          or (f.points = me.points + k and not f.pacer and f.user_id < me.user_id)))::int + 1)
                                order by k)
                              from generate_series(1, 200) k)) end
            from me)
    into v_ids, v_me;

  if v_ids is null then
    return jsonb_build_object('round', v_round.slug, 'blind', v_blind, 'me', v_me, 'paths', '[]'::jsonb);
  end if;

  with r as (
    select v_round.starts_at as starts_at, v_round.ends_at as ends_at,
           (v_round.starts_at at time zone 'Europe/London')::date as day1
  ),
  led as materialized (
    select l.* from r, public._series_ledger(r.starts_at, r.ends_at) l
  ),
  mo as (
    select * from public.series_moments where round_id = v_round.id and multiplier > 1
  ),
  -- Copied from _series_day_points (20261025120000) so the totals agree.
  allin_top as (
    select m.id as moment_id, x.user_id
      from mo m
      cross join lateral (
        select l.user_id from led l
         where l.started_at < m.starts_at and l.counts
         group by l.user_id
         order by sum(l.pts) desc, l.user_id
         limit m.top_n) x
     where m.kind = 'all_in'
  ),
  scored as (
    select l.*,
           round(l.pts * coalesce((
             select max(m.multiplier) from mo m
              where l.started_at >= m.starts_at and l.started_at < m.ends_at
                and (m.kind <> 'double_down' or m.activities is null or l.type::text = any (m.activities))
                and (m.kind <> 'event_night' or l.partner_id = m.partner_id)
                and (m.kind <> 'all_in' or not exists (
                       select 1 from allin_top t where t.moment_id = m.id and t.user_id = l.user_id))
           ), 1))::int as spts
      from led l
     where l.user_id = any (v_ids)
  ),
  by_type as (
    select l.user_id, (l.day - r.day1 + 1)::int as day, l.type::text as type, sum(l.spts)::int as pts,
           (count(*) filter (where l.spts > 0))::int as n
      from scored l
      cross join r
     where l.counts
     group by l.user_id, l.day, r.day1, l.type
    having sum(l.spts) > 0
  ),
  by_day as (
    select t.user_id, t.day, sum(t.pts)::int as pts,
           jsonb_agg(jsonb_build_object('type', t.type, 'pts', t.pts, 'n', t.n) order by t.pts desc, t.type) as acts
      from by_type t
     group by t.user_id, t.day
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', u.id,
           'you', u.id = v_uid,
           'points', coalesce((select sum(d.pts) from by_day d where d.user_id = u.id), 0),
           'days', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'pts', d.pts, 'acts', d.acts) order by d.day)
                               from by_day d where d.user_id = u.id), '[]'::jsonb)
         )), '[]'::jsonb)
    into v_out
    from unnest(v_ids) as u(id);

  return jsonb_build_object('round', v_round.slug, 'blind', v_blind, 'me', v_me, 'paths', v_out);
end;
$$;

revoke all on function public.get_series_paths(text) from public, anon;
grant execute on function public.get_series_paths(text) to authenticated;
