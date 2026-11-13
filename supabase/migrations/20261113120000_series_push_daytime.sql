-- Series pushes in the daytime only.
--
-- Applies AFTER 20261027120000_series_join.sql (the dispatcher's last
-- restatement; live prod matches it). Nothing here changes scoring, the
-- board, pacers, the daily ceiling or who a push goes to.
--
--   1. A moment that starts in the night pushes at 08:00 UK time that morning
--      instead of at its start (_series_moment_push_at). Eight of the ten
--      Autumn moments start at 00:00, so The Gun, Double Down, Blind Mode and
--      All In would otherwise buzz every phone at midnight. A moment that is
--      already over by 08:00 sends nothing. Moments from 08:00 on (Power Hour)
--      push at their start, as before.
--   2. "X just passed you" goes out only between 08:00 and 21:00 the member's
--      own time (the app's local-notification window). A pass in the night
--      isn't saved for the morning: by then it's old news.
--   3. The 08:00 rival push stands aside on a day a moment push is still to
--      come OR has already reached you, so the 08:00 moment push never lands
--      beside a rival push. On a moment day the moment is the morning push.
--
-- series_dispatch_pushes is restated in full from 20261027120000; only the
-- parts above changed. The three series_* notification types stay as they are
-- (OFF until switched on in Notifications).

-- ── 1. When a moment pushes ─────────────────────────────────────────────────

create or replace function public._series_moment_push_at(p_starts timestamptz)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select case
    when (p_starts at time zone 'Europe/London')::time < time '08:00'
      then ((p_starts at time zone 'Europe/London')::date + time '08:00') at time zone 'Europe/London'
    else p_starts
  end
$$;

revoke all on function public._series_moment_push_at(timestamptz) from public, anon, authenticated;
grant execute on function public._series_moment_push_at(timestamptz) to service_role;

-- ── 2 + 3. The dispatcher ───────────────────────────────────────────────────

create or replace function public.series_dispatch_pushes(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round   public.series_rounds;
  v_series  text;
  v_token   text;
  v_targets jsonb := '[]'::jsonb;
  v_passed  int := 0;
  v_rival   int := 0;
  v_locked  int := 0;
  v_moments int := 0;
  m         record;
  v_batch   jsonb;
  v_n       int;
  v_on      text[];
  r         record;
begin
  select coalesce(array_agg(type), '{}') into v_on
    from public.notification_config
   where type in ('series_rival', 'series_passed', 'series_moment') and enabled;

  -- Duels run all year, so they close whether or not a round is on.
  if not p_dry_run then
    perform public._series_close_duels();
  end if;

  select * into v_round from public.series_rounds
   where published and now() >= starts_at and now() < ends_at order by starts_at limit 1;
  if v_round.id is null then
    return jsonb_build_object('round', null);
  end if;

  -- The season's name goes in every push ("… in the Winter Series").
  select s.name into v_series from public.series_seasons s where s.id = v_round.season_id;

  if not p_dry_run then
    v_locked := public._series_lock_cities(v_round.id);
  end if;

  -- A moment starting: one push to everyone the Series is on for, once. Only
  -- within half an hour of its push time, so a late run never sends a stale
  -- one. A moment that starts in the night (most start at 00:00) pushes at
  -- 08:00 UK time instead, while it's still on: never a buzz at midnight.
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
                        where pl.user_id = me.user_id and pl.kind = 'moment'
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
    v_n := jsonb_array_length(v_targets);
    if v_n > 0 then
      select decrypted_secret into v_token from vault.decrypted_secrets where name = 'shared_resolve_token';
      -- send-push takes at most 200 targets a call.
      for i in 0 .. (v_n - 1) / 200 loop
        perform net.http_post(
          url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-resolve-token', v_token),
          body := jsonb_build_object('targets', (
            select jsonb_agg(e.t order by e.n)
              from jsonb_array_elements(v_targets) with ordinality as e(t, n)
             where e.n > i * 200 and e.n <= (i + 1) * 200)),
          timeout_milliseconds := 10000);
      end loop;
    end if;

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
                            'moments', v_moments, 'cities_locked', v_locked, 'dry_run', p_dry_run);
end;
$$;

revoke all on function public.series_dispatch_pushes(boolean) from public, anon, authenticated;

update public.notification_config
   set description = 'Series: a round''s moment starts (Double Down, Power Hour, Blind Mode …): its name and line, once, to everyone the Series is on for. A moment that starts overnight pushes at 08:00 UK time. Each moment has its own push switch in /admin/series.'
 where type = 'series_moment';
