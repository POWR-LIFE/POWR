-- Series: a push when you get a trophy.
--
-- Applies AFTER 20261115190000_honours_from_series_start.sql. Live prod's
-- series_dispatch_pushes matched 20261113120000 (checked 18 Nov); it is
-- restated in full from there, and only the parts below changed. Nothing
-- here changes scoring, the board, award_honours or who wins what.
--
-- Jamie, 18 Nov: "When someone gets a trophy, can we send them a push".
--
--   1. honour_awards.pushed_at: when the trophy's push went out.
--   2. series_trophy, a new notification type, seeded OFF (switch it on in
--      the admin Notifications tab). It rides the member's "Autumn Series"
--      switch (notification_preferences.series_updates) like the others.
--   3. series_dispatch_pushes (every 15 min) sends it:
--        * award_honours runs at 00:15 UTC, so the push waits for 08:00–21:00
--          the member's own time. Never a midnight buzz.
--        * one push a day, naming every new metal since the last one (the top
--          metal of each trophy: bronze and silver on the same night = silver).
--        * not kept past two days, so switching it on never pushes last
--          week's trophies.
--        * the King waits for the round's result to be confirmed and
--          announced: award_honours crowns a provisional winner overnight, and
--          the push must only ever tell the real winner.
--        * it counts toward the Series' 2-a-day ceiling, and the 08:00 rival
--          push stands aside on a trophy day (as on a moment day).
--        * never beside a moment push: while one is due, or in the hour after
--          it reached you, the trophy waits for a later run.
--        * between rounds too: Diamond, Wings and the King land the night a
--          round ends, when no round is live.
--   4. _series_send_pushes(): the send that closed the dispatcher, moved out
--      so the between-rounds path can use it. Unchanged.
--
-- Deploy send-push-notification (the series_trophy copy) BEFORE switching the
-- type on. While it's off the dispatcher never builds a trophy target.

-- ── 1. When the push went ───────────────────────────────────────────────────

alter table public.honour_awards add column if not exists pushed_at timestamptz;
create index if not exists honour_awards_unpushed on public.honour_awards (awarded_at) where pushed_at is null;

-- ── 2. The type ─────────────────────────────────────────────────────────────

insert into public.notification_config (type, category, description, class, daily_cap, enabled) values
  ('series_trophy', 'social',
   'Series: you got a trophy or moved up a metal (King, Power, On Fire, Diamond, Wings, The Hive, Strength). Trophies are awarded overnight; the push goes out between 08:00 and 21:00 your time, once a day, naming every new one. The King waits until the round''s result is confirmed and announced.',
   'receipt', 1, false)
on conflict (type) do nothing;

-- ── 4. The send ─────────────────────────────────────────────────────────────

create or replace function public._series_send_pushes(p_targets jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n     int := coalesce(jsonb_array_length(p_targets), 0);
  v_token text;
begin
  if v_n = 0 then
    return;
  end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'shared_resolve_token';
  -- send-push takes at most 200 targets a call.
  for i in 0 .. (v_n - 1) / 200 loop
    perform net.http_post(
      url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-resolve-token', v_token),
      body := jsonb_build_object('targets', (
        select jsonb_agg(e.t order by e.n)
          from jsonb_array_elements(p_targets) with ordinality as e(t, n)
         where e.n > i * 200 and e.n <= (i + 1) * 200)),
      timeout_milliseconds := 10000);
  end loop;
end;
$$;

revoke all on function public._series_send_pushes(jsonb) from public, anon, authenticated;
grant execute on function public._series_send_pushes(jsonb) to service_role;

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
  v_tseries text;
  t         record;
  m         record;
  v_batch   jsonb;
  v_on      text[];
  r         record;
begin
  select coalesce(array_agg(type), '{}') into v_on
    from public.notification_config
   where type in ('series_rival', 'series_passed', 'series_moment', 'series_trophy') and enabled;

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

  -- A member passed you since the last check. Never a pacer: the strongest
  -- push we send is never about someone who isn't there.
  for r in
    with st as materialized (
      select f.user_id, f.pacer, f.points, row_number() over (order by f.points desc, f.pacer, f.user_id)::int as rank
        from public._series_field(v_round.id) f
       where f.listed
    )
    select me.user_id, me.rank, me.points, a.points as by_points, pr.timezone,
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
        'payload', jsonb_build_object('name', r.by_name, 'rank', r.rank, 'gap', r.by_points - r.points, 'series', v_series));
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
                            'moments', v_moments, 'trophies', v_trophies, 'cities_locked', v_locked, 'dry_run', p_dry_run);
end;
$$;

revoke all on function public.series_dispatch_pushes(boolean) from public, anon, authenticated;
