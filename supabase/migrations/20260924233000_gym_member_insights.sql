-- =============================================================
-- Member insights: what a gym's members do, everywhere
-- =============================================================
-- Jamie, 2026-09-24: "give the gyms the data about their users … so they
-- can see what their members are doing" (the packages' THE DATA slide).
--
-- Decisions:
--   * ACTIVITY ONLY: what members do, how often, when, for how long and how
--     far. Never sleep (activity_sessions has a 'sleep' type: excluded),
--     heart rate, calories or location.
--   * A gym's members = people who picked it as their gym in the app
--     (profiles.preferred_gym_id).
--   * Clash+ ('insights'): anonymous numbers across ALL members, and only
--     once a gym has at least 5 members; any activity row needs at least 3.
--   * Clash Pro ('people'): named detail, ONLY for members who switched on
--     "Share with <gym>" in the app (gym_activity_consents). The consent is
--     tied to that gym: pick another gym and it stops counting.
--
-- Flagged sessions don't count, and neither do daily step logs: they arrive
-- as zero-length 'walking' rows (~15,000 steps, 0 s) and are steps, not
-- activity. A real walk (5+ minutes) counts. Sessions anywhere count (gym,
-- run, ride, walk…), not just at the gym; gym_insights keeps the at-the-gym
-- view.

-- ── The member's switch ─────────────────────────────────────────────────────
create table if not exists public.gym_activity_consents (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete cascade,
  granted_at timestamptz not null default now()
);

comment on table public.gym_activity_consents is
  'A member''s "Share with my gym" switch: their activity (not sleep, heart rate or location) is shown by name to that gym''s portal while it stays their gym. Written only by set_gym_activity_sharing().';

alter table public.gym_activity_consents enable row level security;
drop policy if exists "Members read their own sharing" on public.gym_activity_consents;
create policy "Members read their own sharing" on public.gym_activity_consents
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Admins read sharing" on public.gym_activity_consents;
create policy "Admins read sharing" on public.gym_activity_consents
  for select to authenticated
  using (exists (select 1 from public.admin_roles a where a.user_id = (select auth.uid())));

-- The app's Settings row: the member's gym, whether it has a portal (no
-- portal, nobody to share with: the row hides), and the switch.
create or replace function public.my_gym_sharing()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'gym_id',   p.preferred_gym_id,
    'gym_name', g.name,
    'portal',   coalesce(s.enabled and s.suspended_at is null, false),
    'sharing',  coalesce(c.partner_id = p.preferred_gym_id, false),
    'since',    case when c.partner_id = p.preferred_gym_id then c.granted_at end
  )
    from public.profiles p
    left join public.partners g on g.id = p.preferred_gym_id
    left join public.gym_portal_settings s on s.partner_id = p.preferred_gym_id
    left join public.gym_activity_consents c on c.user_id = p.id
   where p.id = auth.uid()
$$;

create or replace function public.set_gym_activity_sharing(p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select preferred_gym_id into v_gym from public.profiles where id = auth.uid();
  if coalesce(p_on, false) then
    if v_gym is null then
      raise exception 'Pick your gym first' using errcode = 'P0001';
    end if;
    insert into public.gym_activity_consents (user_id, partner_id, granted_at)
    values (auth.uid(), v_gym, now())
    on conflict (user_id) do update set partner_id = excluded.partner_id, granted_at = now();
  else
    delete from public.gym_activity_consents where user_id = auth.uid();
  end if;
  return public.my_gym_sharing();
end;
$$;

revoke all on function public.my_gym_sharing() from public, anon;
revoke all on function public.set_gym_activity_sharing(boolean) from public, anon;
grant execute on function public.my_gym_sharing() to authenticated;
grant execute on function public.set_gym_activity_sharing(boolean) to authenticated;

-- ── Named detail is Clash Pro ───────────────────────────────────────────────
-- Re-stated from 20260924230000 (prod matches); 'people' is new.
create or replace function public._gym_features(p_level integer)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'boards',   true,                          -- board, TV screens, league, ranking
    'events',   coalesce(p_level, 0) >= 1,     -- run its own in-gym challenges
    'insights', coalesce(p_level, 0) >= 1,     -- the Members dashboard
    'studio',   coalesce(p_level, 0) >= 2,     -- the content portal
    'people',   coalesce(p_level, 0) >= 2      -- named member insights (opted-in members)
  )
$$;

-- ── Anonymous numbers across all members (Clash+) ───────────────────────────
-- Windows in the gym's time: the last 4 COMPLETE weeks against the 4 before
-- (a half-finished week would read as a drop); weekly series of p_weeks;
-- 12 months for the seasonal view. "Gone quiet" = trained at least 6 days in
-- the 6 weeks before the last two, and not at all in the last two; "slowing"
-- = under half their usual pace.
create or replace function public.gym_member_activity(p_partner_id uuid, p_weeks integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_weeks   integer := least(greatest(coalesce(p_weeks, 12), 4), 26);
  v_tz      text;
  v_week0   timestamp;
  v_this    timestamptz;
  v_cur     timestamptz;
  v_prev    timestamptz;
  v_from    timestamptz;
  v_members integer;
begin
  if public._gym_role(p_partner_id) is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  perform public._gym_require(p_partner_id, 'insights');

  v_tz    := public._gym_tz(p_partner_id);
  v_week0 := date_trunc('week', now() at time zone v_tz);
  v_this  := v_week0 at time zone v_tz;
  v_cur   := (v_week0 - interval '4 weeks') at time zone v_tz;
  v_prev  := (v_week0 - interval '8 weeks') at time zone v_tz;
  v_from  := (v_week0 - make_interval(weeks => v_weeks - 1)) at time zone v_tz;

  select count(*) into v_members from public.profiles where preferred_gym_id = p_partner_id;
  if v_members < 5 then
    return jsonb_build_object('members', v_members, 'min_members', 5, 'too_few', true);
  end if;

  return (
    with m as (
      select id from public.profiles where preferred_gym_id = p_partner_id
    ),
    s as (
      select * from (
        select s.user_id, s.type::text as type, s.started_at, s.partner_id,
               greatest(0, coalesce(s.duration_sec, extract(epoch from (s.ended_at - s.started_at))::integer, 0)) as dur,
               coalesce(s.distance_m, 0) as dist,
               (s.started_at at time zone v_tz) as lt
          from public.activity_sessions s
          join m on m.id = s.user_id
         where s.type::text <> 'sleep'
           and not coalesce(s.flagged, false)
           and s.started_at >= least(v_from, v_prev, now() - interval '12 months')
      ) x
      where not (type = 'walking' and dur < 300)
    ),
    act as (
      select count(distinct user_id) filter (where started_at >= v_cur  and started_at < v_this) as cur,
             count(distinct user_id) filter (where started_at >= v_prev and started_at < v_cur)  as prev
        from s
    ),
    mix as (
      select type,
             count(distinct user_id) filter (where started_at >= v_cur)  as members,
             count(*)               filter (where started_at >= v_cur)  as sessions,
             coalesce(sum(dur)      filter (where started_at >= v_cur), 0) / 60 as minutes,
             round((coalesce(sum(dist) filter (where started_at >= v_cur), 0) / 1000.0)::numeric, 1) as km,
             count(distinct user_id) filter (where started_at < v_cur)  as prev_members,
             count(*)               filter (where started_at < v_cur)  as prev_sessions
        from s
       where started_at >= v_prev and started_at < v_this
       group by type
    ),
    main as (
      select user_id, type,
             row_number() over (partition by user_id order by sum(dur) desc, count(*) desc, type) as rn
        from s
       where started_at >= v_prev and started_at < v_this
       group by user_id, type
    ),
    seg as (
      select type, count(*) as members from main where rn = 1 group by type
    ),
    days4 as (
      select user_id, count(distinct lt::date) as d
        from s where started_at >= v_cur and started_at < v_this
       group by user_id
    ),
    pace as (
      select m.id,
             count(distinct s.lt::date) filter (where s.started_at >= now() - interval '14 days') as recent,
             count(distinct s.lt::date) filter (where s.started_at <  now() - interval '14 days'
                                                  and s.started_at >= now() - interval '56 days') as base
        from m left join s on s.user_id = m.id
       group by m.id
    )
    select jsonb_build_object(
      'members',     v_members,
      'min_members', 5,
      'tz',          v_tz,
      'week_start',  v_this,
      'active_4w',   (select count(*) from days4),
      'sharing',     (select count(*) from public.gym_activity_consents c
                        join m on m.id = c.user_id
                       where c.partner_id = p_partner_id),

      'weeks', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'week_start',     w.wk at time zone v_tz,
                 'active_members', coalesce(x.members, 0),
                 'sessions',       coalesce(x.sessions, 0),
                 'minutes',        coalesce(x.minutes, 0)
               ) order by w.wk), '[]'::jsonb)
          from generate_series(v_week0 - make_interval(weeks => v_weeks - 1), v_week0, interval '1 week') w(wk)
          left join (
            select date_trunc('week', lt) as wk, count(distinct user_id) as members, count(*) as sessions, sum(dur) / 60 as minutes
              from s where started_at >= v_from
             group by 1
          ) x on x.wk = w.wk
      ),

      'active_prev_4w', (select prev from act),
      -- Activities at least 3 members did (now or before); the rest summed.
      -- change_pct is per ACTIVE MEMBER (sessions each, now vs the 4 weeks
      -- before), so new members joining doesn't read as "running is up".
      'mix', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'type', type, 'members', members, 'sessions', sessions, 'minutes', minutes, 'km', km,
                 'prev_sessions', prev_sessions,
                 'change_pct', case when prev_sessions >= 4 and act.prev >= 5 and act.cur >= 5
                                    then round(100.0 * ((sessions::numeric / act.cur) / (prev_sessions::numeric / act.prev) - 1)) end
               ) order by sessions desc, type), '[]'::jsonb)
          from mix, act where greatest(members, prev_members) >= 3
      ),
      'other_sessions', (select coalesce(sum(sessions), 0) from mix where greatest(members, prev_members) < 3),

      -- Each member's main activity over 8 weeks (by time), groups of 3+.
      'segments', (
        select coalesce(jsonb_agg(jsonb_build_object('type', type, 'members', members) order by members desc, type), '[]'::jsonb)
          from seg where members >= 3
      ),
      'segments_other', (select coalesce(sum(members), 0) from seg where members < 3),
      'inactive_8w', v_members - (select count(distinct user_id) from main),

      -- Days a week, averaged over the last 4 complete weeks.
      'consistency', jsonb_build_object(
        'none',   v_members - (select count(*) from days4),
        'low',    (select count(*) from days4 where d <= 8),
        'mid',    (select count(*) from days4 where d > 8 and d <= 16),
        'high',   (select count(*) from days4 where d > 16)
      ),

      'weekdays', (
        select jsonb_agg(coalesce(c.n, 0) order by d.d)
          from generate_series(1, 7) d(d)
          left join (
            select extract(isodow from lt)::integer as d, count(*) as n
              from s where started_at >= v_prev and started_at < v_this
             group by 1
          ) c on c.d = d.d
      ),
      'hours', (
        select jsonb_agg(coalesce(c.n, 0) order by h.h)
          from generate_series(0, 23) h(h)
          left join (
            select extract(hour from lt)::integer as h, count(*) as n
              from s where started_at >= v_prev and started_at < v_this
             group by 1
          ) c on c.h = h.h
      ),
      'months', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'month', to_char(mo.m, 'YYYY-MM'),
                 'active_members', coalesce(x.members, 0),
                 'sessions', coalesce(x.sessions, 0)
               ) order by mo.m), '[]'::jsonb)
          from generate_series(date_trunc('month', now() at time zone v_tz) - interval '11 months',
                               date_trunc('month', now() at time zone v_tz), interval '1 month') mo(m)
          left join (
            select date_trunc('month', lt) as m, count(distinct user_id) as members, count(*) as sessions
              from s group by 1
          ) x on x.m = mo.m
      ),

      -- Their gym sessions over 8 weeks: here, at other gyms (never named),
      -- or with no gym attached (a wearable workout at home, or not checked in).
      'gym_sessions', jsonb_build_object(
        'here',       (select count(*) from s where type = 'gym' and partner_id = p_partner_id and started_at >= v_prev and started_at < v_this),
        'other_gyms', (select count(*) from s where type = 'gym' and partner_id is not null and partner_id <> p_partner_id and started_at >= v_prev and started_at < v_this),
        'elsewhere',  (select count(*) from s where type = 'gym' and partner_id is null and started_at >= v_prev and started_at < v_this)
      ),

      'quiet',   (select count(*) from pace where base >= 6 and recent = 0),
      'slowing', (select count(*) from pace where base >= 6 and recent > 0 and recent * 6 < base)
    )
  );
end;
$$;

-- ── Named detail for opted-in members (Clash Pro) ───────────────────────────
create or replace function public.gym_member_people(p_partner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
begin
  if public._gym_role(p_partner_id) is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  perform public._gym_require(p_partner_id, 'people');
  v_tz := public._gym_tz(p_partner_id);

  return (
    with c as (
      select c.user_id, c.granted_at
        from public.gym_activity_consents c
        join public.profiles p on p.id = c.user_id
       where c.partner_id = p_partner_id
         and p.preferred_gym_id = p_partner_id
    ),
    s as (
      select * from (
        select s.user_id, s.type::text as type, s.started_at,
               greatest(0, coalesce(s.duration_sec, extract(epoch from (s.ended_at - s.started_at))::integer, 0)) as dur,
               (s.started_at at time zone v_tz)::date as d
          from public.activity_sessions s
          join c on c.user_id = s.user_id
         where s.type::text <> 'sleep'
           and not coalesce(s.flagged, false)
           and s.started_at >= now() - interval '56 days'
      ) x
      where not (type = 'walking' and dur < 300)
    ),
    st as (
      select c.user_id, c.granted_at,
             count(distinct s.d) filter (where s.started_at >= now() - interval '14 days') as recent,
             count(distinct s.d) filter (where s.started_at <  now() - interval '14 days') as base,
             count(s.*) filter (where s.started_at >= now() - interval '28 days') as sessions_4w,
             coalesce(sum(s.dur) filter (where s.started_at >= now() - interval '28 days'), 0) / 60 as minutes_4w
        from c left join s on s.user_id = c.user_id
       group by c.user_id, c.granted_at
    ),
    types as (
      select user_id, jsonb_agg(jsonb_build_object('type', type, 'sessions', n) order by n desc, type) as top
        from (select user_id, type, count(*) as n from s
               where started_at >= now() - interval '28 days' group by user_id, type) x
       group by user_id
    ),
    people as (
      select st.*, t.top, pr.display_name, pr.username, pr.avatar_url, pr.referral_code,
             (select max(a.started_at) from public.activity_sessions a
               where a.user_id = st.user_id and a.type::text <> 'sleep' and not coalesce(a.flagged, false)
                 and not (a.type::text = 'walking' and coalesce(a.duration_sec, 0) < 300)) as last_active,
             (select us.current_streak from public.user_streaks us where us.user_id = st.user_id) as streak,
             case
               when st.base >= 6 and st.recent = 0            then 'quiet'
               when st.base >= 6 and st.recent * 6 < st.base  then 'slowing'
               when st.base = 0 and st.recent = 0             then 'inactive'
               else 'active'
             end as status
        from st
        join public.profiles pr on pr.id = st.user_id
        left join types t on t.user_id = st.user_id
    )
    select jsonb_build_object(
      'members', (select count(*) from public.profiles where preferred_gym_id = p_partner_id),
      'sharing', (select count(*) from c),
      'people', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'user_id',      user_id,
                 'display_name', display_name,
                 'username',     username,
                 'avatar_url',   avatar_url,
                 'member_id',    referral_code,
                 'since',        granted_at,
                 'status',       status,
                 'last_active',  last_active,
                 'recent_days',  recent,
                 'usual_days',   round(base / 3.0, 1),
                 'sessions_4w',  sessions_4w,
                 'minutes_4w',   minutes_4w,
                 'streak',       coalesce(streak, 0),
                 'top',          coalesce(top, '[]'::jsonb)
               ) order by case status when 'quiet' then 0 when 'slowing' then 1 when 'active' then 2 else 3 end,
                          last_active desc nulls last)
          from people
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.gym_member_activity(uuid, integer) from public, anon;
revoke all on function public.gym_member_people(uuid) from public, anon;
grant execute on function public.gym_member_activity(uuid, integer) to authenticated;
grant execute on function public.gym_member_people(uuid) to authenticated;
