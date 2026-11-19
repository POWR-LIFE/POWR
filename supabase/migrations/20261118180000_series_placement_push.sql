-- Series: your place on the board, at the end of your day.
--
-- Applies AFTER 20261118160000_series_bounties.sql (which restates nothing
-- here). Live prod's series_dispatch_pushes matched 20261118120000 (checked
-- 18 Nov); it is restated in full from there, and only the parts below
-- changed. Nothing here changes scoring, the board, pacers or who wins what.
--
-- Jamie, 18 Nov: "We don't currently have push notifications for placement
-- changes for the series do we. We need them in", then "Can we do the
-- notifications so it's at the end of the day based on the users local time.
-- Whatever that may be".
--
--   1. series_place_marks: per member and round, where you stood when your
--      own day began (your timezone's midnight): board rank, rank among
--      members only, points. Re-marked at the first run of each local day.
--   2. series_placement, a new notification type, seeded OFF (switch it on in
--      the admin Notifications tab). It rides the member's "Autumn Series"
--      switch (notification_preferences.series_updates) like the others.
--   3. series_dispatch_pushes (every 15 min) sends it once, between 20:00 and
--      21:00 your own time (21:00 is where Series pushes stop for the night),
--      when your place today moved:
--        * up: you passed a member and banked points today. "Up to #6 today ·
--          you started the day at #16". Your first points of the round count
--          as up (a mark on 0 points is last place).
--        * down: a member got past you, and you've taken part (points > 0).
--          "Down to #9 today · you started the day at #7".
--        * taking or losing #1, and moving into or out of the prize places
--          (the round's place prizes, 3 if none are set, as
--          admin_series_settle counts them), say so.
--        * counted on members only: pacers run all day (Round 01 has ~1,475),
--          so a place moved only by pacers is never news, either way. The push
--          gives your board place (#6), the number the app shows; it never
--          counts places, which pacers would make meaningless ("up 98").
--        * both your board place and your members-only place must agree on
--          the direction, so "up from #16" is always true.
--        * never in Blind Mode (every rank is hidden). Counts toward the
--          Series' 2-a-day ceiling. Within the hour, never straight after
--          another Series push or beside a moment push: it waits for a later
--          run in the hour, and if the hour runs out, that day goes unsaid.
--        * once it has gone, the "<name> just passed you" push stands aside for
--          the rest of your day: tonight's push already said where you are.
--   4. series_passed's payload adds `was` (your place at the last check) and
--      `places` (how many places win), so the copy can say "You've lost the
--      lead" or "You're out of the prize places". Who it goes to is unchanged.
--
-- Deploy send-push-notification (the series_placement copy and the passed
-- variants) BEFORE applying this. While series_placement is off the
-- dispatcher only keeps the marks.
--
-- Idempotent: safe to run twice.

-- ── 1. The marks ────────────────────────────────────────────────────────────

create table if not exists public.series_place_marks (
  round_id    uuid not null references public.series_rounds(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  -- The board rank (pacers in), as the app shows it.
  rank        int not null,
  -- The rank among members only: what a move is counted on.
  member_rank int not null,
  -- 0: not on the board yet. Any member below you tonight is then a climb.
  points      int not null,
  -- The member's own date this mark is the start of.
  local_day   date not null,
  marked_at   timestamptz not null default now(),
  primary key (round_id, user_id)
);
alter table public.series_place_marks enable row level security;
-- No policies: only series_dispatch_pushes (security definer) reads or writes it.

-- ── 2. The type ─────────────────────────────────────────────────────────────

insert into public.notification_config (type, category, description, class, daily_cap, enabled) values
  ('series_placement', 'social',
   'Series: where you finished the day on the board, up or down, against where you started it. Once a day between 20:00 and 21:00 your time. Only when a member passed you or you passed one (never just a pacer); says when you took or lost #1 or the prize places. Never in Blind Mode. Counts toward the Series 2-a-day ceiling.',
   'social', 1, false)
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
  v_placed  int := 0;
  v_tseries text;
  v_places  int;
  v_blind   boolean;
  v_dir     text;
  v_mile    text;
  t         record;
  m         record;
  v_batch   jsonb;
  v_on      text[];
  r         record;
begin
  select coalesce(array_agg(type), '{}') into v_on
    from public.notification_config
   where type in ('series_rival', 'series_passed', 'series_moment', 'series_trophy', 'series_placement') and enabled;

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

  -- Your day on the board (20261118180000): once, between 20:00 and 21:00
  -- your own time, where you stand against where your day began. Up when you
  -- passed a member and banked points today (a mark on 0 points is last
  -- place); down when a member got past you. Your board place has to agree,
  -- so "up from #16" is always true. See the header for the rest.
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
           mk.rank as was_rank, mk.member_rank as was_member_rank, mk.points as was_points,
           ab.points as above_points,
           (select x.points from st x where x.rank = 2) as second_points
      from mem me
      join public.profiles pr on pr.id = me.user_id
      join public.series_place_marks mk on mk.round_id = v_round.id and mk.user_id = me.user_id
           and mk.local_day = public._series_local_now(pr.timezone)::date
      left join st ab on ab.rank = me.rank - 1
     where 'series_placement' = any (v_on)
       and not v_blind
       and me.points > 0
       and ((me.points > mk.points
             and me.member_rank < case when mk.points = 0 then (select count(*) from mem) else mk.member_rank end
             and (mk.points = 0 or me.rank < mk.rank))
         or (mk.points > 0 and me.member_rank > mk.member_rank and me.rank > mk.rank))
       and public._series_enabled_for(me.user_id) and not public._series_is_demo(me.user_id)
       and public._series_local_now(pr.timezone)::time >= '20:00'
       and public._series_local_now(pr.timezone)::time < '21:00'
       and public._series_pushes_today(me.user_id, pr.timezone) < public._series_push_cap()
       -- Never straight after another Series push to you (this run's too):
       -- it waits for a later run in the hour.
       and not exists (select 1 from public.series_push_log pl
                        where pl.user_id = me.user_id and pl.sent_at > now() - interval '1 hour')
       and not exists (select 1 from public.series_moments mm
                        where mm.round_id = v_round.id and mm.push and mm.pushed_at is null
                          and 'series_moment' = any (v_on)
                          and now() < mm.ends_at
                          and now() >= public._series_moment_push_at(mm.starts_at) - interval '15 minutes'
                          and now() < public._series_moment_push_at(mm.starts_at) + interval '30 minutes')
  loop
    v_dir := case when r.was_points > 0 and r.member_rank > r.was_member_rank then 'down' else 'up' end;
    v_mile := case
      when v_dir = 'up' and r.rank = 1 then 'lead'
      when v_dir = 'up' and r.rank <= v_places and (r.was_points = 0 or r.was_rank > v_places) then 'prize'
      when v_dir = 'down' and r.was_rank = 1 then 'lost_lead'
      when v_dir = 'down' and r.was_rank <= v_places and r.rank > v_places then 'out_of_prizes'
    end;
    if p_dry_run then
      v_placed := v_placed + 1;
      continue;
    end if;
    insert into public.series_push_log (user_id, kind, local_day)
    values (r.user_id, 'place', public._series_local_now(r.timezone)::date)
    on conflict do nothing;
    if found then
      v_placed := v_placed + 1;
      v_targets := v_targets || jsonb_build_object(
        'target_user_id', r.user_id, 'type', 'series_placement',
        'payload', jsonb_build_object(
          'dir', v_dir,
          'rank', r.rank,
          -- Where your day began. Null on your first points of the round.
          'was', case when r.was_points > 0 then r.was_rank end,
          'milestone', v_mile,
          -- At #1, your lead over #2; else the points to the place above.
          'gap', case when r.rank = 1 then r.points - coalesce(r.second_points, 0)
                      else coalesce(r.above_points, r.points) - r.points end,
          'series', v_series));
    end if;
  end loop;

  -- The marks: everyone on the board, where they stand at the first run of
  -- their own day (just after their midnight), and anyone new where they
  -- stand when they first appear.
  if not p_dry_run then
    insert into public.series_place_marks as mk (round_id, user_id, rank, member_rank, points, local_day, marked_at)
    select v_round.id, s.user_id, s.rank, s.member_rank, s.points, public._series_local_now(pr.timezone)::date, now()
      from (
        select st.user_id, st.points, st.rank, row_number() over (order by st.rank)::int as member_rank
          from (select f.user_id, f.pacer, f.points,
                       row_number() over (order by f.points desc, f.pacer, f.user_id)::int as rank
                  from public._series_field(v_round.id) f
                 where f.listed) st
         where not st.pacer
      ) s
      join public.profiles pr on pr.id = s.user_id
    on conflict (round_id, user_id) do update
      set rank = excluded.rank, member_rank = excluded.member_rank, points = excluded.points,
          local_day = excluded.local_day, marked_at = excluded.marked_at
      where excluded.local_day > mk.local_day;
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
       -- Tonight's placement push already said where you are.
       and not exists (select 1 from public.series_push_log pl
                        where pl.user_id = me.user_id and pl.kind = 'place'
                          and pl.local_day = public._series_local_now(pr.timezone)::date)
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
                        where pl.user_id = me.user_id and pl.kind in ('moment', 'trophy')
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
                            'moments', v_moments, 'trophies', v_trophies, 'placement', v_placed,
                            'cities_locked', v_locked, 'dry_run', p_dry_run);
end;
$$;

revoke all on function public.series_dispatch_pushes(boolean) from public, anon, authenticated;

grant execute on function public.series_dispatch_pushes(boolean) to service_role;
