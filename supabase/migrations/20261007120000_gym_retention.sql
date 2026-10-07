-- =============================================================
-- Retention: who's drifting from the gym, measured against their own normal
-- =============================================================
-- Jamie, 2026-10-07, on the Gym Clash trailer's "See who's drifting. Before
-- they cancel." slide: "That within itself needs to be a full analytical
-- suite" and "I don't think we need to opt in … update our privacy policy as
-- well as the Ts and Cs and have a setting in the app where this can be opted
-- in or out of."
--
-- What a gym sees, and on what footing:
--   * VISITS AT THAT GYM ONLY: the days and times POWR checked someone in
--     there (activity_sessions at the gym with verification 'geofence',
--     which is POWR's own check-in, never Apple Health / Health Connect /
--     a wearable). On by default; the member switches it off in Settings,
--     then Privacy ("Let gyms see my visits": gym_visit_optouts). A member
--     who had already hidden from gym boards starts with it off.
--   * Everything else they do (runs, rides, home workouts) stays behind the
--     existing opt-in, "Share with <gym>" (gym_activity_consents): Apple and
--     Google require express consent before health-app data reaches a third
--     party.
--   * Who counts: members who picked the gym (profiles.preferred_gym_id)
--     and anyone checked in there in the last 180 days.
--   * Clash+ ('insights'): the counts, the trend and the win-backs, no
--     names, and only once at least 5 people count. Clash Pro ('people'):
--     the names, the patterns, the reach-out log and the per-member nudge.
--
-- Drift is personal. Each person's usual gap between visits (the 75th
-- percentile of their gaps across the 84 days up to their last visit) sets
-- their own thresholds: slipping at 1.5× it (4 days at least), drifting at
-- 2.5× (7 to 28 days), lapsed after 60 days. Someone who trains daily
-- drifts after a week; someone who comes weekly after 18 days. Fewer than 4
-- visit days in that stretch is no pattern yet: 'new' (first visit in the
-- last 28 days) or 'occasional'.
--
-- "Stopped coming" vs "POWR can't see them": when the phone has told POWR
-- nothing for 7 days (no permission check, no synced session, no geofence
-- event, no push token refresh), or location is denied, the person is not
-- counted as drifting and is never nudged or emailed about: they may well
-- still be training (Garmin via Terra has been down since 21 Sept, for one).

-- ── The member's switch: visits are shared unless they say no ──────────────
create table if not exists public.gym_visit_optouts (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  opted_out_at timestamptz not null default now()
);
comment on table public.gym_visit_optouts is
  'Members who switched off "Let gyms see my visits" (Settings, then Privacy). Gyms never see their visits, drift status or name in Retention. Written only by set_gym_visit_sharing().';
alter table public.gym_visit_optouts enable row level security;
drop policy if exists "Members read their own visit opt-out" on public.gym_visit_optouts;
create policy "Members read their own visit opt-out" on public.gym_visit_optouts
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Admins read visit opt-outs" on public.gym_visit_optouts;
create policy "Admins read visit opt-outs" on public.gym_visit_optouts
  for select to authenticated
  using (exists (select 1 from public.admin_roles a where a.user_id = (select auth.uid())));

-- Someone who already took themselves off gym boards asked gyms not to show
-- them; start them with visits off too.
insert into public.gym_visit_optouts (user_id, opted_out_at)
select p.id, now()
  from public.profiles p
  join auth.users u on u.id = p.id
 where p.show_on_leaderboard = false
on conflict (user_id) do nothing;

-- ── What staff did about it ────────────────────────────────────────────────
create table if not exists public.gym_member_outreach (
  id         uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  staff_id   uuid references auth.users(id) on delete set null,
  channel    text not null check (channel in ('call', 'text', 'email', 'in_person', 'push', 'other')),
  note       text check (note is null or char_length(note) <= 280),
  status     text,
  gap_days   integer,
  created_at timestamptz not null default now()
);
create index if not exists gym_member_outreach_partner_idx on public.gym_member_outreach (partner_id, created_at desc);
create index if not exists gym_member_outreach_person_idx on public.gym_member_outreach (partner_id, user_id, created_at desc);
alter table public.gym_member_outreach enable row level security;
revoke all on table public.gym_member_outreach from public, anon, authenticated;
comment on table public.gym_member_outreach is
  'A gym''s reach-outs to members who were slipping or drifting (call, text, email, in person, other; push = POWR''s nudge). status/gap_days are as they stood when logged. Read and written only through gym_* functions (Clash Pro).';

-- ── When each person started drifting, for the morning email and "since" ────
create table if not exists public.gym_drift_alerts (
  partner_id     uuid not null references public.partners(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  flagged_on     date not null,
  gap_days       integer not null,
  drift_after    integer not null,
  cleared_on     date,
  cleared_reason text check (cleared_reason in ('returned', 'opted_out', 'left')),
  emailed_at     timestamptz,
  primary key (partner_id, user_id, flagged_on)
);
create unique index if not exists gym_drift_alerts_open_idx on public.gym_drift_alerts (partner_id, user_id) where cleared_on is null;
alter table public.gym_drift_alerts enable row level security;
revoke all on table public.gym_drift_alerts from public, anon, authenticated;
comment on table public.gym_drift_alerts is
  'One row per drift episode: flagged by get_gym_drift_digests (daily) when someone crosses their own drift line, cleared when they come back (returned), switch visits off (opted_out) or stop counting for the gym (left).';

-- ── Who gets the morning email ──────────────────────────────────────────────
alter table public.gym_staff add column if not exists drift_email boolean not null default true;
comment on column public.gym_staff.drift_email is 'This person gets the morning email when someone at the gym starts drifting (Settings, then Email).';

-- ── The rule: one row per person the gym can see ────────────────────────────
-- p_as_of null = today (with the phone-signal check); a past date gives the
-- picture as it stood that day (the trend), signal assumed fine.
create or replace function public._gym_retention_people(p_partner_id uuid, p_as_of date default null)
returns table (
  user_id     uuid,
  is_member   boolean,
  status      text,
  signal      text,
  location    text,
  first_visit date,
  last_visit  date,
  gap_days    integer,
  visit_days  integer,
  per_week    numeric,
  usual_gap   numeric,
  slip_after  integer,
  drift_after integer,
  recent_28   integer,
  prev_56     integer,
  part        text,
  dows        integer[],
  visits      date[]
)
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select x.tz,
           coalesce(p_as_of, (now() at time zone x.tz)::date) as as_of,
           p_as_of is null as live
      from (select public._gym_tz(p_partner_id) as tz) x
  ),
  -- Visit days at this gym from POWR's own check-ins, and the hour they
  -- arrived (their first visit of the day).
  days as (
    select s.user_id, (s.started_at at time zone c.tz)::date as d,
           min(extract(hour from s.started_at at time zone c.tz))::integer as h
      from public.activity_sessions s, cfg c
     where s.partner_id = p_partner_id
       and s.verification::text = 'geofence'
       and not coalesce(s.flagged, false)
       and s.type::text <> 'sleep'
       and s.started_at >= ((c.as_of - 180)::timestamp at time zone c.tz)
       and s.started_at <  ((c.as_of + 1)::timestamp at time zone c.tz)
     group by s.user_id, (s.started_at at time zone c.tz)::date
  ),
  pop as (
    select u.user_id, bool_or(u.is_member) as is_member
      from (
        select pr.id as user_id, true as is_member
          from public.profiles pr where pr.preferred_gym_id = p_partner_id
        union all
        select distinct d.user_id, false from days d
      ) u
      join public.profiles pr on pr.id = u.user_id
     where not exists (select 1 from public.gym_visit_optouts o where o.user_id = u.user_id)
     group by u.user_id
  ),
  span as (
    select d.user_id, min(d.d) as first_visit, max(d.d) as last_visit
      from days d group by d.user_id
  ),
  -- Their pattern: the 84 days up to their last visit.
  base as (
    select d.user_id, d.d, d.h,
           d.d - lag(d.d) over (partition by d.user_id order by d.d) as gap
      from days d join span s on s.user_id = d.user_id
     where d.d > s.last_visit - 84
  ),
  st as (
    select b.user_id,
           count(*)::integer as n,
           percentile_cont(0.75) within group (order by b.gap) filter (where b.gap is not null) as p75,
           max(b.d) - min(b.d) + 1 as days_spanned
      from base b group by b.user_id
  ),
  parts as (
    select x.user_id, x.part, count(*) as n,
           sum(count(*)) over (partition by x.user_id) as tot,
           row_number() over (partition by x.user_id order by count(*) desc, x.part) as rn
      from (select b.user_id,
                   case when b.h < 12 then 'morning' when b.h < 15 then 'midday'
                        when b.h < 18 then 'afternoon' else 'evening' end as part
              from base b) x
     group by x.user_id, x.part
  ),
  dowc as (
    select b.user_id, extract(isodow from b.d)::integer as dow, count(*) as n,
           sum(count(*)) over (partition by b.user_id) as tot
      from base b group by b.user_id, extract(isodow from b.d)
  ),
  dow1 as (
    select c.user_id, array_agg(c.dow order by c.dow) as dows, sum(c.n) as covered, max(c.tot) as tot
      from dowc c where c.n >= 2 and c.n >= 0.2 * c.tot
     group by c.user_id
  ),
  win as (
    select d.user_id,
           (count(*) filter (where d.d > c.as_of - 28))::integer as recent_28,
           (count(*) filter (where d.d <= c.as_of - 28 and d.d > c.as_of - 84))::integer as prev_56,
           array_agg(d.d order by d.d) filter (where d.d > c.as_of - 84) as visits
      from days d, cfg c group by d.user_id
  ),
  th as (
    select st.user_id,
           greatest(7, least(28, ceil(2.5 * coalesce(st.p75, 7))))::integer as drift_after,
           ceil(1.5 * coalesce(st.p75, 7))::integer as slip_raw
      from st
  ),
  sig as (
    select p.user_id, pr.location_permission,
           greatest(
             pr.location_permission_checked_at,
             (select max(a.created_at) from public.activity_sessions a
               where a.user_id = p.user_id and a.started_at > now() - interval '30 days'),
             (select max(v.started_at) from public.gym_visits v
               where v.user_id = p.user_id and v.started_at > now() - interval '30 days'),
             (select max(t.updated_at) from public.user_push_tokens t where t.user_id = p.user_id)
           ) as last_signal
      from pop p join public.profiles pr on pr.id = p.user_id
     where (select live from cfg)
  ),
  r as (
    select p.user_id, p.is_member,
           s.first_visit, s.last_visit,
           c.as_of - s.last_visit as gap_days,
           coalesce(st.n, 0) as n, st.p75, st.days_spanned,
           th.drift_after,
           greatest(4, least(th.drift_after - 1, th.slip_raw)) as slip_after,
           coalesce(w.recent_28, 0) as recent_28, coalesce(w.prev_56, 0) as prev_56, w.visits,
           pa.part, d1.dows, d1.covered, d1.tot,
           sg.location_permission, sg.last_signal, c.as_of, c.live
      from pop p
      cross join cfg c
      left join span s   on s.user_id = p.user_id
      left join st       on st.user_id = p.user_id
      left join th       on th.user_id = p.user_id
      left join win w    on w.user_id = p.user_id
      left join parts pa on pa.user_id = p.user_id and pa.rn = 1 and pa.n >= 3 and pa.n >= 0.6 * pa.tot
      left join dow1 d1  on d1.user_id = p.user_id
      left join sig sg   on sg.user_id = p.user_id
  )
  select r.user_id, r.is_member,
         case
           when r.last_visit is null                          then 'unseen'
           when r.n < 4 and r.first_visit > r.as_of - 28      then 'new'
           when r.n < 4                                       then 'occasional'
           when r.gap_days > 60                               then 'lapsed'
           when r.gap_days >= r.drift_after                   then 'drifting'
           when r.gap_days >= r.slip_after                    then 'slipping'
           when r.prev_56 >= 6 and r.recent_28 * 4 < r.prev_56 then 'slipping'
           else 'regular'
         end as status,
         case
           when not r.live                                    then 'ok'
           when r.location_permission = 'denied'              then 'location_off'
           when r.last_signal is null
             or r.last_signal < now() - interval '7 days'     then 'no_signal'
           else 'ok'
         end as signal,
         r.location_permission as location,
         r.first_visit, r.last_visit, r.gap_days, r.n as visit_days,
         case when r.n >= 4 then round(r.n * 7.0 / greatest(r.days_spanned, 28), 1) end as per_week,
         case when r.n >= 4 then round(r.p75::numeric, 1) end as usual_gap,
         case when r.n >= 4 then r.slip_after end as slip_after,
         case when r.n >= 4 then r.drift_after end as drift_after,
         r.recent_28, r.prev_56,
         r.part,
         case when r.dows is not null and array_length(r.dows, 1) <= 4 and r.covered >= 0.6 * r.tot then r.dows end as dows,
         coalesce(r.visits, '{}'::date[]) as visits
    from r
$$;
revoke all on function public._gym_retention_people(uuid, date) from public, anon, authenticated;

comment on function public._gym_retention_people(uuid, date) is
  'Retention rule, one row per person a gym can see (members + anyone checked in there in 180 days, minus gym_visit_optouts): status unseen/new/occasional/regular/slipping/drifting/lapsed against their own usual gap; signal ok/location_off/no_signal (today only). Visits = POWR geofence check-ins at the gym only.';

-- Counts, as every surface shows them. Slipping / drifting / lapsed only
-- count when POWR can still hear the phone; the rest is "can't see".
create or replace function public._gym_retention_counts(p_partner_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'population', count(*),
    'regular',    count(*) filter (where status = 'regular'),
    'slipping',   count(*) filter (where status = 'slipping' and signal = 'ok'),
    'drifting',   count(*) filter (where status = 'drifting' and signal = 'ok'),
    'lapsed',     count(*) filter (where status = 'lapsed'   and signal = 'ok'),
    'new',        count(*) filter (where status = 'new'),
    'occasional', count(*) filter (where status = 'occasional'),
    'unseen',     count(*) filter (where status = 'unseen'),
    'cant_see',   count(*) filter (where status in ('slipping', 'drifting', 'lapsed') and signal <> 'ok')
  )
    from public._gym_retention_people(p_partner_id)
$$;
revoke all on function public._gym_retention_counts(uuid) from public, anon, authenticated;

-- ── The Retention page ──────────────────────────────────────────────────────
create or replace function public.gym_retention(p_partner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_named  boolean;
  v_tz     text;
  v_today  date;
  v_counts jsonb;
  v_pop    integer;
begin
  if public._gym_role(p_partner_id) is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  perform public._gym_require(p_partner_id, 'insights');
  v_named  := public._gym_can(p_partner_id, 'people');
  v_tz     := public._gym_tz(p_partner_id);
  v_today  := (now() at time zone v_tz)::date;
  v_counts := public._gym_retention_counts(p_partner_id);
  v_pop    := coalesce((v_counts ->> 'population')::integer, 0);

  -- Without names, a handful of people is too few to show even as counts.
  if not v_named and v_pop < 5 then
    return jsonb_build_object('tz', v_tz, 'as_of', v_today, 'named', false,
                              'population', v_pop, 'min_people', 5, 'too_few', true);
  end if;

  return jsonb_build_object(
    'tz',         v_tz,
    'as_of',      v_today,
    'named',      v_named,
    'population', v_pop,
    'counts',     v_counts,

    -- The last 12 weeks, as each Sunday stood (the gym's calendar).
    'trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'week_end', w.d,
               'regular',  w.regular,
               'slipping', w.slipping,
               'drifting', w.drifting,
               'lapsed',   w.lapsed) order by w.d), '[]'::jsonb)
        from (
          select g.d::date as d,
                 count(*) filter (where r.status = 'regular')  as regular,
                 count(*) filter (where r.status = 'slipping') as slipping,
                 count(*) filter (where r.status = 'drifting') as drifting,
                 count(*) filter (where r.status = 'lapsed')   as lapsed
            from generate_series(
                   date_trunc('week', v_today::timestamp) - interval '1 day' - interval '11 weeks',
                   date_trunc('week', v_today::timestamp) - interval '1 day',
                   interval '1 week') g(d)
            cross join lateral public._gym_retention_people(p_partner_id, g.d::date) r
           -- Whoever POWR can't hear today is left out of the history too, so
           -- the line meets today's counts instead of jumping.
           where not exists (select 1 from public._gym_retention_people(p_partner_id) c
                              where c.user_id = r.user_id and c.signal <> 'ok')
           group by g.d
        ) w
    ),

    -- Reached out in the last 90 days, by person: back within 14 days of a
    -- reach-out, or still inside those 14 days.
    'winback', (
      select jsonb_build_object(
               'reached', count(*),
               'back',    count(*) filter (where x.back),
               'waiting', count(*) filter (where not x.back and x.last_at > now() - interval '14 days'))
        from (
          select o.user_id, max(o.created_at) as last_at,
                 bool_or(exists (
                   select 1 from public.activity_sessions s
                    where s.user_id = o.user_id and s.partner_id = p_partner_id
                      and s.verification::text = 'geofence' and not coalesce(s.flagged, false)
                      and s.started_at > o.created_at and s.started_at <= o.created_at + interval '14 days')) as back
            from public.gym_member_outreach o
           where o.partner_id = p_partner_id
             and o.created_at > now() - interval '90 days'
             and not exists (select 1 from public.gym_visit_optouts z where z.user_id = o.user_id)
           group by o.user_id
        ) x
    ),

    'people', case when not v_named then null else (
      select coalesce(jsonb_agg(jsonb_build_object(
               'user_id',      r.user_id,
               'display_name', pr.display_name,
               'username',     pr.username,
               'avatar_url',   pr.avatar_url,
               'member_id',    pr.referral_code,
               'is_member',    r.is_member,
               'status',       r.status,
               'signal',       r.signal,
               'location',     r.location,
               'first_visit',  r.first_visit,
               'last_visit',   r.last_visit,
               'gap_days',     r.gap_days,
               'visit_days',   r.visit_days,
               'per_week',     r.per_week,
               'usual_gap',    r.usual_gap,
               'slip_after',   r.slip_after,
               'drift_after',  r.drift_after,
               'recent_28',    r.recent_28,
               'prev_56',      r.prev_56,
               'part',         r.part,
               'dows',         r.dows,
               'visits',       r.visits,
               'shares_all',   exists (select 1 from public.gym_activity_consents c
                                        where c.user_id = r.user_id and c.partner_id = p_partner_id
                                          and pr.preferred_gym_id = p_partner_id),
               'drifting_since', (select a.flagged_on from public.gym_drift_alerts a
                                   where a.partner_id = p_partner_id and a.user_id = r.user_id and a.cleared_on is null),
               'nudged_at',    (select max(n.sent_at) from public.gym_quiet_nudges n
                                   where n.partner_id = p_partner_id and n.user_id = r.user_id),
               'outreach',     (select coalesce(jsonb_agg(jsonb_build_object(
                                         'id', o.id, 'at', o.created_at, 'channel', o.channel, 'note', o.note,
                                         'by', coalesce(sp.display_name, sp.username),
                                         'mine', o.staff_id = auth.uid()) order by o.created_at desc), '[]'::jsonb)
                                  from (select * from public.gym_member_outreach o2
                                         where o2.partner_id = p_partner_id and o2.user_id = r.user_id
                                         order by o2.created_at desc limit 5) o
                                  left join public.profiles sp on sp.id = o.staff_id)
             ) order by
               case when r.status in ('slipping', 'drifting', 'lapsed') and r.signal <> 'ok' then 6
                    else case r.status when 'drifting' then 0 when 'slipping' then 1 when 'lapsed' then 2 when 'new' then 3
                                       when 'regular' then 4 when 'occasional' then 5 else 7 end end,
               case when r.drift_after > 0 then r.gap_days::numeric / r.drift_after end desc nulls last,
               r.last_visit desc nulls last), '[]'::jsonb)
        from (select * from public._gym_retention_people(p_partner_id) limit 1000) r
        join public.profiles pr on pr.id = r.user_id
    ) end
  );
end;
$$;
revoke all on function public.gym_retention(uuid) from public, anon;
grant execute on function public.gym_retention(uuid) to authenticated;

-- ── Logging a reach-out (Clash Pro) ─────────────────────────────────────────
create or replace function public.gym_log_outreach(p_partner_id uuid, p_user_id uuid, p_channel text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._gym_role(p_partner_id);
  v_r    record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row  public.gym_member_outreach;
begin
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  perform public._gym_require(p_partner_id, 'people');
  if p_channel is null or p_channel not in ('call', 'text', 'email', 'in_person', 'other') then
    raise exception 'Pick how you reached out' using errcode = 'P0001';
  end if;
  if v_note is not null and char_length(v_note) > 280 then
    raise exception 'Keep the note under 280 characters' using errcode = 'P0001';
  end if;
  select * into v_r from public._gym_retention_people(p_partner_id) r where r.user_id = p_user_id;
  if not found then
    raise exception 'That person isn''t on your list' using errcode = 'P0002';
  end if;

  insert into public.gym_member_outreach (partner_id, user_id, staff_id, channel, note, status, gap_days)
  values (p_partner_id, p_user_id, auth.uid(), p_channel, v_note, v_r.status, v_r.gap_days)
  returning * into v_row;
  perform public._gym_audit(p_partner_id, 'gym_outreach_logged',
    jsonb_build_object('partner_id', p_partner_id, 'user_id', p_user_id, 'channel', p_channel, 'status', v_r.status));
  return jsonb_build_object('id', v_row.id, 'at', v_row.created_at, 'channel', v_row.channel, 'note', v_row.note, 'mine', true);
end;
$$;
revoke all on function public.gym_log_outreach(uuid, uuid, text, text) from public, anon;
grant execute on function public.gym_log_outreach(uuid, uuid, text, text) to authenticated;

-- Undo a mistaken entry: whoever logged it, the owner, or POWR. A push is
-- POWR's record of a send and stays.
create or replace function public.gym_delete_outreach(p_partner_id uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._gym_role(p_partner_id);
begin
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  perform public._gym_require(p_partner_id, 'people');
  delete from public.gym_member_outreach o
   where o.id = p_id and o.partner_id = p_partner_id and o.channel <> 'push'
     and (o.staff_id = auth.uid() or v_role in ('owner', 'admin'));
  if not found then
    raise exception 'You can only remove your own notes' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.gym_delete_outreach(uuid, uuid) from public, anon;
grant execute on function public.gym_delete_outreach(uuid, uuid) to authenticated;

-- ── The app's switches ──────────────────────────────────────────────────────
-- Re-stated from 20260924233000 (prod matches); 'visits' is new: true unless
-- the member switched "Let gyms see my visits" off.
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
    'since',    case when c.partner_id = p.preferred_gym_id then c.granted_at end,
    'visits',   not exists (select 1 from public.gym_visit_optouts o where o.user_id = p.id)
  )
    from public.profiles p
    left join public.partners g on g.id = p.preferred_gym_id
    left join public.gym_portal_settings s on s.partner_id = p.preferred_gym_id
    left join public.gym_activity_consents c on c.user_id = p.id
   where p.id = auth.uid()
$$;

create or replace function public.set_gym_visit_sharing(p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if coalesce(p_on, true) then
    delete from public.gym_visit_optouts where user_id = auth.uid();
  else
    insert into public.gym_visit_optouts (user_id) values (auth.uid())
    on conflict (user_id) do nothing;
  end if;
  return public.my_gym_sharing();
end;
$$;
revoke all on function public.set_gym_visit_sharing(boolean) from public, anon;
grant execute on function public.set_gym_visit_sharing(boolean) to authenticated;

-- ── The nudge, now for whoever is drifting (and one person at a time) ──────
-- Re-stated from 20260925170000 with Retention's rule. The whole list goes
-- at most once a day per gym; one person, from their row, any time; either
-- way a member gets it at most once a fortnight, and never when POWR can't
-- hear their phone. Every send is also a 'push' reach-out.
alter table public.gym_quiet_nudges add column if not exists single boolean not null default false;
update public.notification_config
   set description = 'A gym''s "your spot''s still here", on its press from Retention (Clash Pro), to people drifting from their usual visits there. POWR''s words; follows the Announcements preference; once per member per fortnight.'
 where type = 'gym_quiet_nudge';

drop function if exists public.gym_nudge_quiet(uuid, boolean);
create or replace function public.gym_nudge_quiet(p_partner_id uuid, p_dry_run boolean default true, p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role    text := public._gym_role(p_partner_id);
  v_gym     public.partners;
  v_tz      text;
  v_token   text;
  v_res     jsonb;
  v_targets jsonb;
  v_n       integer := 0;
  v_cooling integer := 0;
begin
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  perform public._gym_require(p_partner_id, 'people');
  select * into v_gym from public.partners where id = p_partner_id;
  v_tz := public._gym_tz(p_partner_id);

  if not p_dry_run and p_user_id is null and exists (
    select 1 from public.gym_quiet_nudges n
     where n.partner_id = p_partner_id and not n.single
       and (n.sent_at at time zone v_tz)::date = (now() at time zone v_tz)::date
  ) then
    raise exception 'Already sent today. It can go again tomorrow' using errcode = 'P0001';
  end if;

  -- Assigned, not SELECT INTO: plpgsql will not take INTO on a WITH query.
  v_res := (
    with q as (
      select r.user_id, r.status, r.gap_days,
             exists (select 1 from public.gym_quiet_nudges n
                      where n.partner_id = p_partner_id and n.user_id = r.user_id
                        and n.sent_at > now() - interval '14 days') as cooling
        from public._gym_retention_people(p_partner_id) r
       where r.signal = 'ok'
         and case when p_user_id is null then r.status = 'drifting'
                  else r.user_id = p_user_id and r.status in ('slipping', 'drifting', 'lapsed') end
       order by r.gap_days desc
       limit 200
    )
    select jsonb_build_object(
      'targets', coalesce(jsonb_agg(jsonb_build_object(
                   'target_user_id', q.user_id,
                   'type', 'gym_quiet_nudge',
                   'payload', jsonb_build_object(
                     'partner_id', p_partner_id,
                     'gym_name',   v_gym.name,
                     'lat',        nullif(v_gym.locations->0->>'lat', '')::double precision,
                     'lng',        nullif(v_gym.locations->0->>'lng', '')::double precision,
                     'weeks',      floor(q.gap_days / 7.0)::integer
                   )) order by q.gap_days desc) filter (where not q.cooling), '[]'::jsonb),
      'people',  coalesce(jsonb_agg(jsonb_build_object('user_id', q.user_id, 'status', q.status, 'gap_days', q.gap_days))
                   filter (where not q.cooling), '[]'::jsonb),
      'n',       count(*) filter (where not q.cooling),
      'cooling', count(*) filter (where q.cooling))
      from q
  );
  v_targets := v_res -> 'targets';
  v_n       := coalesce((v_res ->> 'n')::integer, 0);
  v_cooling := coalesce((v_res ->> 'cooling')::integer, 0);

  if p_user_id is not null and v_n = 0 and v_cooling = 0 and not p_dry_run then
    raise exception 'They aren''t slipping or drifting, or POWR can''t reach their phone' using errcode = 'P0001';
  end if;
  if p_dry_run or v_n = 0 then
    return jsonb_build_object('recipients', v_n, 'cooling', v_cooling, 'sent', false);
  end if;

  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'shared_resolve_token';
  perform net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-resolve-token', v_token),
    body := jsonb_build_object('targets', v_targets),
    timeout_milliseconds := 8000
  );
  insert into public.gym_quiet_nudges (partner_id, user_id, sent_by, single)
  select p_partner_id, (t ->> 'user_id')::uuid, auth.uid(), p_user_id is not null
    from jsonb_array_elements(v_res -> 'people') t;
  insert into public.gym_member_outreach (partner_id, user_id, staff_id, channel, status, gap_days)
  select p_partner_id, (t ->> 'user_id')::uuid, auth.uid(), 'push', t ->> 'status', (t ->> 'gap_days')::integer
    from jsonb_array_elements(v_res -> 'people') t;
  perform public._gym_audit(p_partner_id, 'gym_quiet_nudge_sent',
    jsonb_build_object('partner_id', p_partner_id, 'recipients', v_n, 'cooling', v_cooling, 'single', p_user_id is not null));
  return jsonb_build_object('recipients', v_n, 'cooling', v_cooling, 'sent', true);
end;
$$;
revoke all on function public.gym_nudge_quiet(uuid, boolean, uuid) from public, anon;
grant execute on function public.gym_nudge_quiet(uuid, boolean, uuid) to authenticated;

-- ── Settings: the morning email switch ──────────────────────────────────────
-- gym_profile re-stated from 20260925190000 (prod matches); 'drift_email'
-- is new, the caller's own switch (null for an admin previewing).
create or replace function public.gym_profile(p_partner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  p      public.partners;
begin
  v_role := public._gym_role(p_partner_id);
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select * into p from public.partners where id = p_partner_id;
  if not found then
    raise exception 'Gym not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id',            p.id,
    'name',          p.name,
    'description',   p.description,
    'address',       p.address,
    'phone',         p.phone,
    'website',       p.website,
    'logo_url',      p.logo_url,
    'logo_bg',       p.logo_bg,
    'image_url',     p.image1_url,
    'opening_hours', p.opening_hours,
    'lat',           nullif(p.locations->0->>'lat', '')::double precision,
    'lng',           nullif(p.locations->0->>'lng', '')::double precision,
    'can_edit',      v_role in ('owner', 'admin'),
    -- The caller's own Monday recap switch; null for an admin previewing.
    'recap_email',   (select s.recap_email from public.gym_staff s
                       where s.partner_id = p_partner_id and s.user_id = auth.uid()),
    -- The caller's own "someone started drifting" switch; null likewise.
    'drift_email',   (select s.drift_email from public.gym_staff s
                       where s.partner_id = p_partner_id and s.user_id = auth.uid())
  );
end;
$$;

create or replace function public.gym_set_drift_email(p_partner_id uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on boolean;
begin
  update public.gym_staff
     set drift_email = coalesce(p_on, true)
   where partner_id = p_partner_id and user_id = auth.uid()
  returning drift_email into v_on;
  if not found then
    raise exception 'Only the gym''s team has this switch' using errcode = '42501';
  end if;
  return v_on;
end;
$$;
revoke all on function public.gym_set_drift_email(uuid, boolean) from public, anon;
grant execute on function public.gym_set_drift_email(uuid, boolean) to authenticated;

-- ── The morning run: open and close drift episodes, say who's new ───────────
-- SERVICE ROLE ONLY (reads staff emails). send-gym-email kind drift_digest
-- calls it with p_commit = true on a real run (cron gym-drift-digest-email);
-- any other call only looks. Returns every gym with the dashboard; the
-- sender mails those with someone new and someone to tell.
create or replace function public.get_gym_drift_digests(p_commit boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g        record;
  v_feat   jsonb;
  v_named  boolean;
  v_tz     text;
  v_today  date;
  v_counts jsonb;
  v_new    jsonb;
  v_out    jsonb := '[]'::jsonb;
begin
  for g in
    select s.partner_id, p.name
      from public.gym_portal_settings s
      join public.partners p on p.id = s.partner_id
     where s.enabled and s.suspended_at is null and p.active
     order by p.name
  loop
    v_feat := public._gym_features(coalesce(public._gym_level(g.partner_id), 0));
    continue when not coalesce((v_feat ->> 'insights')::boolean, false);
    v_named  := coalesce((v_feat ->> 'people')::boolean, false);
    v_tz     := public._gym_tz(g.partner_id);
    v_today  := (now() at time zone v_tz)::date;
    v_counts := public._gym_retention_counts(g.partner_id);

    -- Drifting today, POWR can hear them, and no episode open yet.
    v_new := (
      select coalesce(jsonb_agg(jsonb_build_object(
               'user_id',     r.user_id,
               'name',        coalesce(pr.display_name, pr.username, 'A member'),
               'member_id',   pr.referral_code,
               'is_member',   r.is_member,
               'gap_days',    r.gap_days,
               'drift_after', r.drift_after,
               'per_week',    r.per_week,
               'usual_gap',   r.usual_gap,
               'part',        r.part,
               'dows',        r.dows,
               'last_visit',  r.last_visit
             ) order by r.gap_days::numeric / greatest(r.drift_after, 1) desc), '[]'::jsonb)
        from public._gym_retention_people(g.partner_id) r
        join public.profiles pr on pr.id = r.user_id
       where r.status = 'drifting' and r.signal = 'ok'
         and not exists (select 1 from public.gym_drift_alerts a
                          where a.partner_id = g.partner_id and a.user_id = r.user_id and a.cleared_on is null)
    );

    if p_commit then
      -- An episode ends when they're back (no longer drifting or lapsed),
      -- switched visits off, or no longer count for the gym.
      update public.gym_drift_alerts a
         set cleared_on = v_today,
             cleared_reason = case
               when exists (select 1 from public.gym_visit_optouts o where o.user_id = a.user_id) then 'opted_out'
               when not exists (select 1 from public._gym_retention_people(g.partner_id) r where r.user_id = a.user_id) then 'left'
               else 'returned' end
       where a.partner_id = g.partner_id
         and a.cleared_on is null
         and not exists (select 1 from public._gym_retention_people(g.partner_id) r
                          where r.user_id = a.user_id and r.status in ('drifting', 'lapsed'));
      insert into public.gym_drift_alerts (partner_id, user_id, flagged_on, gap_days, drift_after, emailed_at)
      select g.partner_id, (e ->> 'user_id')::uuid, v_today, (e ->> 'gap_days')::integer, (e ->> 'drift_after')::integer, now()
        from jsonb_array_elements(v_new) e
      on conflict do nothing;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'partner_id', g.partner_id,
      'name',       g.name,
      'tz',         v_tz,
      'named',      v_named,
      -- Without names, too few people to say even how many.
      'too_few',    not v_named and coalesce((v_counts ->> 'population')::integer, 0) < 5,
      'counts',     v_counts,
      'new_count',  jsonb_array_length(v_new),
      'new',        case when v_named then v_new else '[]'::jsonb end,
      'recipients', coalesce((
                      select jsonb_agg(distinct lower(u.email))
                        from public.gym_staff s
                        join auth.users u on u.id = s.user_id
                       where s.partner_id = g.partner_id
                         and s.drift_email
                         and u.email is not null
                         and u.deleted_at is null
                         and (u.banned_until is null or u.banned_until < now())
                    ), '[]'::jsonb)
    ));
  end loop;
  return v_out;
end;
$$;
revoke all on function public.get_gym_drift_digests(boolean) from public, anon, authenticated;

-- ── Every other surface reads the same numbers ──────────────────────────────
-- gym_member_activity (Members page, Overview, Worth doing) and
-- get_gym_weekly_recaps (the Monday email), re-stated from prod with their
-- own "gone quiet" swapped for Retention's.

create or replace function public.gym_member_activity(p_partner_id uuid, p_weeks integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_weeks   integer := least(greatest(coalesce(p_weeks, 12), 4), 26);
  v_tz      text;
  v_week0   timestamp;
  v_this    timestamptz;
  v_cur     timestamptz;
  v_prev    timestamptz;
  v_from    timestamptz;
  v_members integer;
  v_ret     jsonb;
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

  v_ret := public._gym_retention_counts(p_partner_id);

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

      -- Retention's counts (20261007120000): each person against their own
      -- usual gap between visits at the gym, members and regulars alike.
      'quiet',   (v_ret ->> 'drifting')::integer,
      'slowing', (v_ret ->> 'slipping')::integer
    )
  );
end;
$$;

create or replace function public.get_gym_weekly_recaps(p_week_start date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_out     jsonb := '[]'::jsonb;
  g         record;
  v_tz      text;
  v_end_l   timestamp;
  v_start   timestamptz;
  v_end     timestamptz;
  v_prev    timestamptz;
  v_this    jsonb;
  v_last    jsonb;
  v_events  jsonb;
  v_feat    jsonb;
  v_quiet   integer;
  v_ret     jsonb;
  v_row     jsonb;
begin
  for g in
    select s.partner_id, p.name
      from public.gym_portal_settings s
      join public.partners p on p.id = s.partner_id
     where s.enabled and s.suspended_at is null and s.recap_email
     order by p.name
  loop
    v_tz    := public._gym_tz(g.partner_id);
    v_end_l := case when p_week_start is null
                    then date_trunc('week', now() at time zone v_tz)
                    else (p_week_start + 7)::timestamp end;
    v_end   := v_end_l at time zone v_tz;
    v_start := (v_end_l - interval '7 days') at time zone v_tz;
    v_prev  := (v_end_l - interval '14 days') at time zone v_tz;
    v_feat  := public._gym_features(coalesce(public._gym_level(g.partner_id), 0));
    v_this  := public._gym_window_totals(g.partner_id, v_start, v_end);
    v_last  := public._gym_window_totals(g.partner_id, v_prev, v_start);

    -- Retention's "drifting" (20261007120000): people past their own usual
    -- gap between visits, POWR still hearing their phone. Only for packages
    -- with the dashboard (Clash+ and up); without names, only once 5+ people
    -- count, as on the Retention page.
    v_quiet := null;
    if coalesce((v_feat ->> 'insights')::boolean, false) then
      v_ret := public._gym_retention_counts(g.partner_id);
      if coalesce((v_feat ->> 'people')::boolean, false) or coalesce((v_ret ->> 'population')::integer, 0) >= 5 then
        v_quiet := (v_ret ->> 'drifting')::integer;
      end if;
    end if;

    -- Events worth a line: in flight, waiting on POWR or the gym, or
    -- revealed this week (the prizes still need handing over).
    v_events := (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id',              e.id,
               'name',            e.name,
               'status',          e.status,
               'review_status',   e.review_status,
               'managed_by',      e.managed_by,
               'participants',    (select count(*) from public.live_event_participants lp
                                    where lp.event_id = e.id and lp.disqualified_at is null),
               'window_start_at', e.window_start_at,
               'window_end_at',   e.window_end_at,
               'revealed_at',     e.revealed_at
             ) order by e.window_start_at), '[]'::jsonb)
        from (
          select * from public.live_events e
           where e.venue_partner_id = g.partner_id
             and (e.status in ('scheduled', 'live', 'locked')
                  or (e.status = 'draft' and e.review_status in ('pending', 'rejected'))
                  or (e.status = 'revealed' and e.revealed_at >= v_start))
           order by e.window_start_at
           limit 5
        ) e
    );

    v_row := jsonb_build_object(
      'partner_id', g.partner_id,
      'name',       g.name,
      'tz',         v_tz,
      'week_start', v_start,
      'week_end',   v_end,
      'recipients', coalesce((
                      select jsonb_agg(distinct lower(u.email))
                        from public.gym_staff s
                        join auth.users u on u.id = s.user_id
                       where s.partner_id = g.partner_id
                         and s.recap_email
                         and u.email is not null
                         and u.deleted_at is null
                         and (u.banned_until is null or u.banned_until < now())
                    ), '[]'::jsonb),
      'features',   v_feat,
      'this',       v_this,
      'last',       v_last,
      'new_faces',  (select count(*) from (
                       select s.user_id, min(s.started_at) as first_at
                         from public.activity_sessions s
                        where s.partner_id = g.partner_id
                        group by s.user_id) f
                      where f.first_at >= v_start and f.first_at < v_end),
      'members',    (select count(*) from public.profiles pr where pr.preferred_gym_id = g.partner_id),
      -- Last week's top three exactly as the wall showed them.
      'top',        (select coalesce(jsonb_agg(jsonb_build_object(
                              'name',     coalesce(pr.display_name, pr.username, 'A member'),
                              'points',   sc.score,
                              'sessions', sc.sessions) order by sc.rank), '[]'::jsonb)
                       from (select * from public._gym_board_scores(g.partner_id, v_start, v_end, v_tz)
                              where score > 0 order by rank limit 3) sc
                       join public.profiles pr on pr.id = sc.user_id),
      'busiest',    (select jsonb_build_object('dow', x.d, 'sessions', x.n)
                       from (select extract(isodow from s.started_at at time zone v_tz)::integer as d, count(*)::integer as n
                               from public.activity_sessions s
                              where s.partner_id = g.partner_id
                                and s.started_at >= v_start and s.started_at < v_end
                              group by 1 order by n desc, d limit 1) x),
      'quiet',      v_quiet,
      'events',     v_events,
      'quiet_week', coalesce((v_this ->> 'sessions')::integer, 0) = 0
                    and coalesce((v_last ->> 'sessions')::integer, 0) = 0
                    and jsonb_array_length(v_events) = 0
    );
    v_out := v_out || jsonb_build_array(v_row);
  end loop;
  return v_out;
end;
$$;
