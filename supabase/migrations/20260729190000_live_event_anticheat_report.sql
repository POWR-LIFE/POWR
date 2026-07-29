-- =============================================================
-- LIVE EVENTS — anti-cheat report (ticket 7)
-- =============================================================
-- Spec: context/LIVE_EVENTS_PLAN.md §4.4 / ticket 7. The Friday
-- vetting report behind the ops dashboard: every signal an admin
-- should look at before reading a name out in the room. Signals,
-- not verdicts — each one has innocent explanations (families
-- share tablets; a watch double-syncs) and the human decides.
--
--   * mirrored_sessions — the same physical wearable synced to 2+
--     accounts (the double-credit precedent). terra_connections
--     can't catch this: its PK is terra_user_id and Terra mints a
--     fresh id per connection, so one watch on two accounts looks
--     like two identities. What a shared watch CAN'T hide is the
--     data: the same workout lands on both accounts with matching
--     start times and durations. Pairs with 2+ such mirrors in the
--     window are reported. Passive types are excluded — everyone's
--     sleep rows would collide by chance.
--   * shared_devices — the same device writing sessions for 2+
--     accounts inside the event window.
--   * short_bursts — 3+ sub-15-minute wearable-verified non-passive
--     sessions by one user in one day. Wearable sessions pay a
--     flat rate, so bursts of tiny "workouts" are the farm shape.
--     Walking/sleep are excluded (auto-created rows are short by
--     nature and pay through their own capped paths).
--   * manual_heavy — board users whose event score is ≥40% manual
--     logs (and ≥20 pts, so a 5-point profile doesn't page anyone).
--     Complements the session-count chip on the standings table by
--     weighing POINTS, which is what actually buys rank.
-- =============================================================

create or replace function public.admin_get_event_anticheat(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event     public.live_events;
  v_wearables jsonb;
  v_devices   jsonb;
  v_bursts    jsonb;
  v_manual    jsonb;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  -- One watch, two accounts: near-identical wearable sessions
  -- (start within 5 min, duration within 60 s, same type) on
  -- different users, 2+ times in the window.
  select jsonb_agg(jsonb_build_object(
           'user_a',   jsonb_build_object('user_id', m.ua, 'name', coalesce(pa.display_name, pa.username, 'POWR member')),
           'user_b',   jsonb_build_object('user_id', m.ub, 'name', coalesce(pb.display_name, pb.username, 'POWR member')),
           'mirrored', m.n
         ) order by m.n desc)
    into v_wearables
    from (
      select a.user_id as ua, b.user_id as ub, count(*) as n
        from public.activity_sessions a
        join public.activity_sessions b
          on b.user_id > a.user_id
         and b.type = a.type
         and abs(extract(epoch from (b.started_at - a.started_at))) <= 300
         and abs(coalesce(b.duration_sec, 0) - coalesce(a.duration_sec, 0)) <= 60
       where a.verification::text in ('wearable', 'health')
         and b.verification::text in ('wearable', 'health')
         and a.type::text not in ('walking', 'sleep')
         and a.started_at >= v_event.window_start_at and a.started_at < v_event.window_end_at
         and b.started_at >= v_event.window_start_at and b.started_at < v_event.window_end_at
       group by a.user_id, b.user_id
      having count(*) >= 2
    ) m
    join public.profiles pa on pa.id = m.ua
    join public.profiles pb on pb.id = m.ub;

  -- Same device writing sessions for 2+ accounts inside the window.
  select jsonb_agg(jsonb_build_object('device_id', d.device_id, 'users', d.users))
    into v_devices
    from (
      select per.device_id,
             jsonb_agg(jsonb_build_object(
               'user_id',  per.user_id,
               'name',     coalesce(p.display_name, p.username, 'POWR member'),
               'sessions', per.n
             ) order by per.n desc) as users
        from (
          select s.device_id, s.user_id, count(*) as n
            from public.activity_sessions s
           where s.device_id is not null
             and s.started_at >= v_event.window_start_at
             and s.started_at <  v_event.window_end_at
           group by s.device_id, s.user_id
        ) per
        join public.profiles p on p.id = per.user_id
       group by per.device_id
      having count(*) >= 2
    ) d;

  -- Bursts of short flat-rate wearable sessions.
  select jsonb_agg(jsonb_build_object(
           'user_id',        b.user_id,
           'name',           coalesce(p.display_name, p.username, 'POWR member'),
           'day',            b.day,
           'short_sessions', b.n
         ) order by b.n desc)
    into v_bursts
    from (
      select s.user_id, date_trunc('day', s.started_at)::date as day, count(*) as n
        from public.activity_sessions s
       where s.verification::text in ('wearable', 'health')
         and s.type::text not in ('walking', 'sleep')
         and s.duration_sec < 900
         and s.started_at >= v_event.window_start_at
         and s.started_at <  v_event.window_end_at
       group by s.user_id, date_trunc('day', s.started_at)
      having count(*) >= 3
    ) b
    join public.profiles p on p.id = b.user_id;

  -- Manual logs buying rank: points-weighted, board users only.
  select jsonb_agg(jsonb_build_object(
           'user_id',       m.user_id,
           'name',          coalesce(p.display_name, p.username, 'POWR member'),
           'rank',          m.rank,
           'points',        m.score,
           'manual_points', m.manual_pts,
           'share',         round(m.manual_pts::numeric / m.score, 2)
         ) order by m.rank)
    into v_manual
    from (
      select sc.user_id, sc.rank, sc.score, mp.manual_pts
        from public._live_event_scores(p_event_id) sc
        join (
          select pt.user_id, sum(pt.amount) as manual_pts
            from public.point_transactions pt
            left join public.activity_sessions s on s.id = pt.session_id
           where pt.created_at >= v_event.window_start_at
             and pt.created_at <  v_event.window_end_at
             and pt.type = 'earn'
             and (coalesce(s.verification::text, '') = 'manual'
                  or coalesce(pt.source, '') = 'manual_log')
           group by pt.user_id
        ) mp on mp.user_id = sc.user_id
       where sc.score >= 20
         and mp.manual_pts::numeric / sc.score >= 0.4
    ) m
    join public.profiles p on p.id = m.user_id;

  return jsonb_build_object(
    'generated_at',      now(),
    'mirrored_sessions', coalesce(v_wearables, '[]'::jsonb),
    'shared_devices',    coalesce(v_devices,   '[]'::jsonb),
    'short_bursts',      coalesce(v_bursts,    '[]'::jsonb),
    'manual_heavy',      coalesce(v_manual,    '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_get_event_anticheat(uuid) from public, anon;
grant execute on function public.admin_get_event_anticheat(uuid) to authenticated;
