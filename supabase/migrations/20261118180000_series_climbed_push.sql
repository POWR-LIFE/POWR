-- Series: a push when your place on the board goes up.
--
-- Applies AFTER 20261118160000_series_bounties.sql (which restates nothing
-- here). Live prod's series_dispatch_pushes matched 20261118120000 (checked
-- 18 Nov); it is restated in full from there, and only the parts below
-- changed. Nothing here changes scoring, the board, pacers or who wins what.
--
-- Jamie, 18 Nov: "We don't currently have push notifications for placement
-- changes for the series do we. We need them in".
--
-- Going down already had one (series_passed, "<name> just passed you"). Going
-- up had none. This adds it, and lets the passed push say when the place you
-- lost was the lead or a prize place.
--
--   1. series_place_marks: per member and round, the place we last counted
--      from (the board rank, the rank among members only, and the points).
--   2. series_climbed, a new notification type, seeded OFF (switch it on in
--      the admin Notifications tab). It rides the member's "Autumn Series"
--      switch (notification_preferences.series_updates) like the others.
--   3. series_dispatch_pushes (every 15 min) sends it when you're higher on
--      the board than your mark:
--        * only when you passed a member, never just a pacer: the climb is
--          counted on the members-only rank, so a pacer running past you and
--          back again is never news. The push says your board place (#6), the
--          same number the app shows.
--        * only when you banked points since the mark. Someone leaving the
--          board lifts your rank without you doing anything; that isn't news.
--        * 08:00–21:00 the member's own time. A climb from a 06:30 session
--          isn't lost: the mark waits and the push goes at 08:00. Never in
--          Blind Mode (every rank is hidden); a climb in the dark pushes when
--          the ranks come back.
--        * one climb push a day. A bigger one can still follow it the same
--          day: taking #1, or moving into the prize places (the round's place
--          prizes, 3 if none are set, as admin_series_settle counts them).
--          Each of those once a day too.
--        * counts toward the Series' 2-a-day ceiling. Never within an hour of
--          another Series push to the same person (a trophy at 08:00 and a
--          climb in the same run would land together), and never beside a
--          moment push. Those wait, they aren't dropped. On a climb day the
--          08:00 rival push stands aside, as on a moment or trophy day.
--        * a member passing you (your members-only rank gets worse) moves your
--          mark down to where you now are, so passing them back is a climb.
--          While the push is off, or the Series is off for someone, marks
--          follow the board: switching it on never pushes an old climb.
--   4. series_passed's payload adds `was` (your place at the last check) and
--      `places` (how many places win), so the copy can say "You've lost the
--      lead" or "You're out of the prize places". Who it goes to is
--      unchanged.
--
-- Deploy send-push-notification (the series_climbed copy and the passed
-- variants) BEFORE applying this. While series_climbed is off the dispatcher
-- only keeps the marks.
--
-- Idempotent: safe to run twice.

-- ── 1. The marks ────────────────────────────────────────────────────────────

create table if not exists public.series_place_marks (
  round_id    uuid not null references public.series_rounds(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  -- The board rank (pacers in), as the app shows it.
  rank        int not null,
  -- The rank among members only: what a climb is counted on.
  member_rank int not null,
  -- 0: not on the board yet. Any member above you then counts as a climb.
  points      int not null,
  marked_at   timestamptz not null default now(),
  primary key (round_id, user_id)
);
alter table public.series_place_marks enable row level security;
-- No policies: only series_dispatch_pushes (security definer) reads or writes it.

-- ── 2. The type ─────────────────────────────────────────────────────────────

-- daily_cap 2: one plain climb and one milestone (#1, the prize places) a day.
-- The dispatcher holds each to once a day; the Series ceiling holds the total.
insert into public.notification_config (type, category, description, class, daily_cap, enabled) values
  ('series_climbed', 'social',
   'Series: you moved up the board. At most one a day, plus one more if you take #1 or move into the prize places. Only when you passed a member (never just a pacer), between 08:00 and 21:00 your time; a climb overnight pushes at 08:00. Never in Blind Mode. Counts toward the Series 2-a-day ceiling.',
   'social', 2, false)
on conflict (type) do nothing;

-- ── 3. The dispatcher ───────────────────────────────────────────────────────

create or replace function public.series_dispatch_pushes(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round   public.series_rounds;
  v_series  text;
  v_targets jsonb := '[]'::jsonb;
  v_passed  int := 0;
  v_rival   int := 0;
  v_locked  int := 0;
  v_moments int := 0;
  v_trophies int := 0;
  v_climbed int := 0;
  v_tseries text;
  v_places  int;
  v_blind   boolean;
  v_mile    text;
  t         record;
  m         record;
  v_batch   jsonb;
  v_on      text[];
  r         record;
begin
  select coalesce(array_agg(type), '{}') into v_on
    from public.notification_config
   where type in ('series_rival', 'series_passed', 'series_moment', 'series_trophy', 'series_climbed') and enabled;

  -- Duels run all year, so they close whether or not a round is on.
  if not p_dry_run then
    perform public._series_close_duels();
  end if;

  -- A new trophy (20261118120000). award_honours runs at 00:15 UTC; the push
  -- goes out between 08:00 and 21:00 the member's own time, one a day, and
  -- names every metal reached since the last one (the top metal of each
  -- trophy). Not tied to a live round: Diamond, Wings and the King land the
  -- night a round ends, when none is on. Not kept past two days: last week's
  -- trophy isn't news. The King waits until the round's result is confirmed
  -- and announced (award_honours crowns a provisional winner overnight), and
  -- its two days run from the announcement. Never beside a moment push: while
  -- one is due, or in the hour after it reached you, the trophy waits.
  select s.name into v_tseries
    from public.series_rounds rd
    join public.series_seasons s on s.id = rd.season_id
   where rd.published and rd.starts_at <= now()
   order by rd.starts_at desc limit 1;
  for t in
    with fresh as (
      select a.id, a.user_id, a.kind, a.tier,
             row_number() over (partition by a.user_id, a.kind
                                order by public._honour_rank(a.tier) desc, a.awarded_at desc) as top
        from public.honour_awards a
       where a.pushed_at is null
         and 'series_trophy' = any (v_on)
         and case when a.kind = 'king' then exists (
               select 1 from public.series_results res
                where res.user_id = a.user_id and res.kind = 'place' and res.place = 1
                  and res.status = 'confirmed' and res.announced_at > now() - interval '2 days')
             else a.awarded_at > now() - interval '2 days' end
    )
    select f.user_id, pr.timezone,
           array_agg(f.id) as ids,
           jsonb_agg(jsonb_build_object(
             'kind', f.kind, 'tier', f.tier, 'count', h.count, 'detail', h.detail,
             'round', case when f.kind = 'king' then (
               select rd.name from public.series_results res
                 join public.series_rounds rd on rd.id = res.round_id
                where res.user_id = f.user_id and res.kind = 'place' and res.place = 1
                  and res.status = 'confirmed' and res.announced_at is not null
                order by rd.ends_at desc limit 1) end)
             order by public._honour_rank(f.tier) desc, f.kind) filter (where f.top = 1) as items
      from fresh f
      -- Still held: a King who's been overtaken by a newer winner gets nothing.
      join public.honours h on h.user_id = f.user_id and h.kind = f.kind
      join public.profiles pr on pr.id = f.user_id
     where public._series_enabled_for(f.user_id) and not public._series_is_demo(f.user_id)
       and public._series_local_now(pr.timezone)::time >= '08:00'
       and public._series_local_now(pr.timezone)::time < '21:00'
       and public._series_pushes_today(f.user_id, pr.timezone) < public._series_push_cap()
       and not exists (select 1 from public.series_push_log pl
                        where pl.user_id = f.user_id and pl.kind = 'moment'
                          and pl.sent_at > now() - interval '1 hour')
       and not exists (select 1 from public.series_moments mm
                         join public.series_rounds mr on mr.id = mm.round_id
                         join public.series_entries e on e.season_id = mr.season_id and e.user_id = f.user_id
                        where mr.published and mm.push and mm.pushed_at is null
                          and 'series_moment' = any (v_on)
                          and now() < mm.ends_at
                          and now() >= public._series_moment_push_at(mm.starts_at) - interval '15 minutes'
                          and now() < public._series_moment_push_at(mm.starts_at) + interval '30 minutes')
     group by f.user_id, pr.timezone
  loop
    if p_dry_run then
      v_trophies := v_trophies + 1;
      continue;
    end if;
    insert into public.series_push_log (user_id, kind, local_day)
    values (t.user_id, 'trophy', public._series_local_now(t.timezone)::date)
    on conflict do nothing;
    if found then
      v_trophies := v_trophies + 1;
      update public.honour_awards set pushed_at = now() where id = any (t.ids);
      v_targets := v_targets || jsonb_build_object(
        'target_user_id', t.user_id, 'type', 'series_trophy',
        'payload', jsonb_build_object('items', t.items, 'series', v_tseries));
    end if;
  end loop;

  select * into v_round from public.series_rounds
   where published and now() >= starts_at and now() < ends_at order by starts_at limit 1;
  if v_round.id is null then
    if not p_dry_run then
      perform public._series_send_pushes(v_targets);
    end if;
    return jsonb_build_object('round', null, 'trophies', v_trophies, 'dry_run', p_dry_run);
  end if;

  -- The season's name goes in every push ("… in the Winter Series").
  select s.name into v_series from public.series_seasons s where s.id = v_round.season_id;

  if not p_dry_run then
    v_locked := public._series_lock_cities(v_round.id);
  end if;

  -- A moment starting: one push to everyone the Series is on for, once. Only
  -- within half an hour of its push time, so a late run never sends a stale
  -- one. A moment that starts in the night (00:00–07:00 UK; most start at
  -- 00:00) pushes at 08:00 instead, while it's still on: never a midnight buzz.
  -- Logged per person like the others, so it counts toward the day's ceiling
  -- (at most one moment push a day each, and never a third Series push).
  for m in
    select * from public.series_moments
     where round_id = v_round.id and push and pushed_at is null
       and public._series_moment_push_at(starts_at) <= now()
       and public._series_moment_push_at(starts_at) > now() - interval '30 minutes'
       and now() < ends_at
       and 'series_moment' = any (v_on)
  loop
    if p_dry_run then
      v_moments := v_moments + 1;
      continue;
    end if;
    update public.series_moments set pushed_at = now() where id = m.id;
    v_moments := v_moments + 1;
    with sent as (
      insert into public.series_push_log (user_id, kind, local_day)
      select p.id, 'moment', public._series_local_now(p.timezone)::date
        from public.series_entries e
        join public.profiles p on p.id = e.user_id
       where e.season_id = v_round.season_id
         and public._series_enabled_for(p.id) and not public._series_is_demo(p.id)
         and public._series_pushes_today(p.id, p.timezone) < public._series_push_cap()
      on conflict do nothing
      returning user_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'target_user_id', sent.user_id, 'type', 'series_moment',
             'payload', jsonb_build_object('title', m.name, 'body', coalesce(m.line, ''), 'kind', m.kind,
                                           'moment_id', m.id, 'series', v_series))), '[]'::jsonb)
      into v_batch
      from sent;
    v_targets := v_targets || v_batch;
  end loop;

  -- How many places win: the round's place prizes, 3 if none are set (as
  -- admin_series_settle counts them).
  v_places := coalesce((select max(p.place) from public.series_prizes p
                         where p.round_id = v_round.id and p.kind = 'place'), 3);
  v_blind := exists (select 1 from public.series_moments b
                      where b.round_id = v_round.id and b.kind = 'blind'
                        and now() >= b.starts_at and now() < b.ends_at);

  -- You climbed (20261118180000): higher among members than your mark, with
  -- points banked since, and higher on the board too. A mark on 0 points is
  -- last place: your first points of the round put you on the board. Held for
  -- the daytime, for Blind Mode to lift and for a quiet hour, not dropped.
  for r in
    with st as materialized (
      select f.user_id, f.pacer, f.points, row_number() over (order by f.points desc, f.pacer, f.user_id)::int as rank
        from public._series_field(v_round.id) f
       where f.listed
    ),
    mem as materialized (
      select st.user_id, st.points, st.rank, row_number() over (order by st.rank)::int as member_rank
        from st
       where not st.pacer
    )
    select me.user_id, me.rank, me.member_rank, me.points, pr.timezone,
           mk.rank as was_rank, mk.points as was_points,
           ab.points as above_points,
           (select x.points from st x where x.rank = 2) as second_points
      from mem me
      join public.series_place_marks mk on mk.round_id = v_round.id and mk.user_id = me.user_id
      join public.profiles pr on pr.id = me.user_id
      left join st ab on ab.rank = me.rank - 1
     where 'series_climbed' = any (v_on)
       and not v_blind
       and me.points > mk.points
       and me.member_rank < case when mk.points = 0 then (select count(*) from mem) else mk.member_rank end
       and (mk.points = 0 or me.rank < mk.rank)
       and public._series_enabled_for(me.user_id) and not public._series_is_demo(me.user_id)
       and public._series_local_now(pr.timezone)::time >= '08:00'
       and public._series_local_now(pr.timezone)::time < '21:00'
       and public._series_pushes_today(me.user_id, pr.timezone) < public._series_push_cap()
       -- Never within an hour of another Series push to you (this run's too).
       and not exists (select 1 from public.series_push_log pl
                        where pl.user_id = me.user_id and pl.sent_at > now() - interval '1 hour')
       and not exists (select 1 from public.series_moments mm
                        where mm.round_id = v_round.id and mm.push and mm.pushed_at is null
                          and 'series_moment' = any (v_on)
                          and now() < mm.ends_at
                          and now() >= public._series_moment_push_at(mm.starts_at) - interval '15 minutes'
                          and now() < public._series_moment_push_at(mm.starts_at) + interval '30 minutes')
  loop
    -- Taking #1, or moving into the prize places, is bigger news: it can
    -- follow the day's climb push. Each kind once a day.
    v_mile := case when r.rank = 1 then 'lead'
                   when r.rank <= v_places and (r.was_points = 0 or r.was_rank > v_places) then 'prize' end;
    if p_dry_run then
      v_climbed := v_climbed + 1;
      continue;
    end if;
    insert into public.series_push_log (user_id, kind, local_day)
    values (r.user_id, case when v_mile is null then 'climbed' else 'climbed_top' end,
            public._series_local_now(r.timezone)::date)
    on conflict do nothing;
    if found then
      v_climbed := v_climbed + 1;
      v_targets := v_targets || jsonb_build_object(
        'target_user_id', r.user_id, 'type', 'series_climbed',
        'payload', jsonb_build_object(
          'rank', r.rank,
          'milestone', v_mile,
          -- At #1, your lead over #2; else the points to the place above.
          'gap', case when r.rank = 1 then r.points - coalesce(r.second_points, 0)
                      else coalesce(r.above_points, r.points) - r.points end,
          'series', v_series));
    end if;
    -- Counted from here, pushed or not: a second climb the same day isn't
    -- saved for tomorrow morning.
    update public.series_place_marks
       set rank = r.rank, member_rank = r.member_rank, points = r.points, marked_at = now()
     where round_id = v_round.id and user_id = r.user_id;
  end loop;

  -- The marks. A new member is marked where they stand. A member passed by a
  -- member (their members-only rank got worse) is marked where they now are,
  -- so passing them back is a climb. With the push off, or the Series off for
  -- them, marks follow the board, so switching it on never pushes an old climb.
  if not p_dry_run then
    insert into public.series_place_marks as mk (round_id, user_id, rank, member_rank, points, marked_at)
    select v_round.id, s.user_id, s.rank, s.member_rank, s.points, now()
      from (
        select st.user_id, st.points, st.rank, row_number() over (order by st.rank)::int as member_rank
          from (select f.user_id, f.pacer, f.points,
                       row_number() over (order by f.points desc, f.pacer, f.user_id)::int as rank
                  from public._series_field(v_round.id) f
                 where f.listed) st
         where not st.pacer
      ) s
    on conflict (round_id, user_id) do update
      set rank = excluded.rank, member_rank = excluded.member_rank,
          points = excluded.points, marked_at = excluded.marked_at
      where excluded.member_rank > mk.member_rank
         or not ('series_climbed' = any (v_on))
         or not public._series_enabled_for(excluded.user_id)
         or public._series_is_demo(excluded.user_id);
  end if;

  -- A member passed you since the last check. Never a pacer: the strongest
  -- push we send is never about someone who isn't there.
  for r in
    with st as materialized (
      select f.user_id, f.pacer, f.points, row_number() over (order by f.points desc, f.pacer, f.user_id)::int as rank
        from public._series_field(v_round.id) f
       where f.listed
    )
    select me.user_id, me.rank, me.points, a.points as by_points, pr.timezone, sn.rank as was_rank,
           coalesce(nullif(trim(ap.display_name), ''), ap.username, apc.name, 'Someone') as by_name
      from st me
      join public.series_rank_snapshots sn on sn.round_id = v_round.id and sn.user_id = me.user_id
      -- The closest person above you now who was behind you last time: a big
      -- session can carry someone past several people at once.
      join lateral (
        select x.user_id, x.points
          from st x
          join public.series_rank_snapshots sx on sx.round_id = v_round.id and sx.user_id = x.user_id
         where x.rank < me.rank and sx.rank > sn.rank and not x.pacer
         order by x.rank desc
         limit 1
      ) a on true
      join public.profiles pr on pr.id = me.user_id
      left join public.profiles ap on ap.id = a.user_id
      left join public.series_pacers apc on apc.id = a.user_id
     where not me.pacer
       and me.rank > sn.rank
       and me.points > 0
       and 'series_passed' = any (v_on)
       and public._series_enabled_for(me.user_id)
       -- Daytime only (08:00–21:00 their time, the app's own window): a watch
       -- syncing at 2am mustn't wake anyone. Not saved for the morning.
       and public._series_local_now(pr.timezone)::time >= '08:00'
       and public._series_local_now(pr.timezone)::time < '21:00'
       and public._series_pushes_today(me.user_id, pr.timezone) < public._series_push_cap()
       -- Blind Mode: nobody is told who passed them.
       and not exists (select 1 from public.series_moments b
                        where b.round_id = v_round.id and b.kind = 'blind'
                          and now() >= b.starts_at and now() < b.ends_at)
  loop
    if p_dry_run then
      v_passed := v_passed + 1;
      continue;
    end if;
    insert into public.series_push_log (user_id, kind, local_day)
    values (r.user_id, 'passed', public._series_local_now(r.timezone)::date)
    on conflict do nothing;
    if found then
      v_passed := v_passed + 1;
      v_targets := v_targets || jsonb_build_object(
        'target_user_id', r.user_id, 'type', 'series_passed',
        'payload', jsonb_build_object('name', r.by_name, 'rank', r.rank, 'gap', r.by_points - r.points, 'series', v_series,
                                      -- Your place at the last check, and how many places win: "You've lost the lead".
                                      'was', r.was_rank, 'places', v_places));
    end if;
  end loop;

  -- The 08:00 rival push, in each person's own timezone. The rival is the one
  -- get_series_board shows: a friend within reach, else the nearest member
  -- (never a pacer). Skipped on a day a moment push is still to come or has
  -- already reached you: on a moment day the moment IS the morning push, so
  -- an overnight moment (pushed at 08:00) never lands beside a rival push.
  -- The same on a trophy or climb day: a 06:30 session's climb pushes at 08:00
  -- (it runs first, above) and the rival push stands aside.
  for r in
    with st as materialized (
      select f.user_id, f.pacer, f.points, row_number() over (order by f.points desc, f.pacer, f.user_id)::int as rank
        from public._series_field(v_round.id) f
       where f.listed
    )
    select me.user_id, me.rank, me.points, pr.timezone,
           coalesce(f.user_id, a.user_id) as rv_id,
           coalesce(f.points, a.points) as rv_points,
           (f.user_id is not null) as rv_friend
      from st me
      join public.profiles pr on pr.id = me.user_id
      left join lateral (
        select x.user_id, x.points from st x
         where x.rank < me.rank and x.points - me.points <= 30
           and exists (select 1 from public.friendships fs
                        where fs.status = 'accepted'
                          and fs.user_id = least(me.user_id, x.user_id)
                          and fs.friend_id = greatest(me.user_id, x.user_id))
         order by x.rank desc limit 1
      ) f on true
      left join lateral (
        select x.user_id, x.points from st x
         where not x.pacer and x.user_id <> me.user_id
           and case when me.rank = 1 then x.rank > me.rank else x.rank < me.rank end
         order by abs(x.rank - me.rank) limit 1
      ) a on true
     where not me.pacer
       and me.points > 0
       and 'series_rival' = any (v_on)
       and public._series_enabled_for(me.user_id)
       and public._series_local_now(pr.timezone)::time >= '08:00'
       and public._series_local_now(pr.timezone)::time < '08:15'
       and coalesce(f.user_id, a.user_id) is not null
       and public._series_pushes_today(me.user_id, pr.timezone) < public._series_push_cap()
       and not exists (select 1 from public.series_moments mm
                        where mm.round_id = v_round.id and mm.push and mm.pushed_at is null
                          and 'series_moment' = any (v_on)
                          and now() < mm.ends_at
                          and now() < public._series_moment_push_at(mm.starts_at) + interval '30 minutes'
                          and public._series_local_date(public._series_moment_push_at(mm.starts_at), pr.timezone)
                              = public._series_local_now(pr.timezone)::date)
       and not exists (select 1 from public.series_push_log pl
                        where pl.user_id = me.user_id and pl.kind in ('moment', 'trophy', 'climbed', 'climbed_top')
                          and pl.local_day = public._series_local_now(pr.timezone)::date)
  loop
    if p_dry_run then
      v_rival := v_rival + 1;
      continue;
    end if;
    insert into public.series_push_log (user_id, kind, local_day)
    values (r.user_id, 'rival', public._series_local_now(r.timezone)::date)
    on conflict do nothing;
    if found then
      v_rival := v_rival + 1;
      v_targets := v_targets || jsonb_build_object(
        'target_user_id', r.user_id, 'type', 'series_rival',
        'payload', jsonb_build_object(
          'name', coalesce((select coalesce(nullif(trim(p.display_name), ''), p.username) from public.profiles p where p.id = r.rv_id),
                           'Your rival'),
          'gap', abs(r.rv_points - r.points),
          'ahead', r.rank = 1,
          'friend', r.rv_friend,
          'series', v_series));
    end if;
  end loop;

  if not p_dry_run then
    perform public._series_send_pushes(v_targets);

    -- Remember where everyone stands for the next check (pacers too).
    insert into public.series_rank_snapshots (round_id, user_id, rank, points, taken_at)
    select v_round.id, s.user_id, s.rank, s.points, now()
      from (
        select f.user_id, f.points, row_number() over (order by f.points desc, f.pacer, f.user_id)::int as rank
          from public._series_field(v_round.id) f
         where f.listed
      ) s
    on conflict (round_id, user_id) do update
      set rank = excluded.rank, points = excluded.points, taken_at = excluded.taken_at;
  end if;

  return jsonb_build_object('round', v_round.slug, 'passed', v_passed, 'rival', v_rival,
                            'moments', v_moments, 'trophies', v_trophies, 'climbed', v_climbed,
                            'cities_locked', v_locked, 'dry_run', p_dry_run);
end;
$$;

revoke all on function public.series_dispatch_pushes(boolean) from public, anon, authenticated;

grant execute on function public.series_dispatch_pushes(boolean) to service_role;
