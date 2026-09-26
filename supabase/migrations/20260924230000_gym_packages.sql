-- =============================================================
-- Gym Clash packages: a package per gym, three months free first
-- =============================================================
-- Jamie's packages (Gym Clash packages, 2026-09-24):
--   clash       Free, always. The area leaderboard, the gym's own board and
--               screens, its live ranking.
--   clash_plus  £129 a month. + its own in-gym challenges, POWR partner
--               prizes, the monthly data dashboard (Members).
--   pro         £349 a month / £4,188 a year. + Clash Nights, the content
--               portal (Studio), member insights, guest leads, quarterly report.
--   founding    Clash Pro at £1,995 a year for the first 10 gyms, price locked;
--               only offered during the free trial.
-- Every gym starts with three months with everything switched on
-- (trial_ends_at), then runs on its package: free Clash until POWR sets
-- another. POWR sets the package in /admin/gyms and invoices outside the
-- product; owners ask for a change from their portal (Slack gets a line).
--
-- What each package unlocks lives in ONE place, _gym_features(). The portal
-- reads it through gym_package() to lock its pages; the gym_* functions that
-- START something check it through _gym_require(). Finishing what is under
-- way is never locked: a trial that ends mid-event still reveals its winners.

alter table public.gym_portal_settings
  add column if not exists package              text not null default 'clash',
  add column if not exists trial_ends_at        timestamptz default (now() + interval '3 months'),
  add column if not exists billing              text,
  add column if not exists package_note         text,
  add column if not exists package_set_at       timestamptz,
  add column if not exists package_set_by       uuid references auth.users(id) on delete set null,
  add column if not exists package_requested    text,
  add column if not exists package_requested_at timestamptz;

alter table public.gym_portal_settings
  drop constraint if exists gym_portal_settings_package_check,
  add  constraint gym_portal_settings_package_check
       check (package in ('clash', 'clash_plus', 'pro', 'founding')),
  drop constraint if exists gym_portal_settings_billing_check,
  add  constraint gym_portal_settings_billing_check
       check (billing is null or billing in ('monthly', 'annual')),
  drop constraint if exists gym_portal_settings_package_requested_check,
  add  constraint gym_portal_settings_package_requested_check
       check (package_requested is null or package_requested in ('clash', 'clash_plus', 'pro', 'founding'));

comment on column public.gym_portal_settings.trial_ends_at is
  'Everything is switched on until this moment (three months from the portal being switched on); after it the gym runs on its package.';

-- ── What unlocks where ──────────────────────────────────────────────────────
-- Level 0 Clash, 1 Clash+, 2 Clash Pro / Founding Pro (and the trial).
create or replace function public._gym_package_level(p_package text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_package when 'clash_plus' then 1 when 'pro' then 2 when 'founding' then 2 else 0 end
$$;

-- The one list. A new gated feature is a new line here.
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
    'studio',   coalesce(p_level, 0) >= 2      -- the content portal
  )
$$;

create or replace function public._gym_level(p_partner_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when s.trial_ends_at > now() then 2 else public._gym_package_level(s.package) end
    from public.gym_portal_settings s
   where s.partner_id = p_partner_id
$$;

-- Admins may always; a gym by its package (or trial).
create or replace function public._gym_can(p_partner_id uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_roles a where a.user_id = auth.uid())
      or coalesce((public._gym_features(coalesce(public._gym_level(p_partner_id), 0)) ->> p_feature)::boolean, false)
$$;

create or replace function public._gym_require(p_partner_id uuid, p_feature text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public._gym_can(p_partner_id, p_feature) then
    raise exception 'Your package doesn''t include this. See Package in your portal to change it.'
      using errcode = 'P0001';
  end if;
end;
$$;

-- A gym-level line for Slack (the event-level one is _gym_event_notify).
create or replace function public._gym_notify(p_partner_id uuid, p_kind text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
begin
  perform net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/notify-gym-event',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'db_webhook_secret')
    ),
    body := jsonb_build_object(
      'kind',   p_kind,
      'gym',    (select jsonb_build_object('id', p.id, 'name', p.name) from public.partners p where p.id = p_partner_id),
      'actor',  (select coalesce(pr.display_name, pr.username) from public.profiles pr where pr.id = auth.uid()),
      'detail', coalesce(p_detail, '{}'::jsonb)
    ),
    timeout_milliseconds := 5000
  );
exception when others then
  raise warning '[_gym_notify] %', sqlerrm;
end;
$$;

revoke all on function public._gym_package_level(text) from public, anon, authenticated;
revoke all on function public._gym_features(integer) from public, anon, authenticated;
revoke all on function public._gym_level(uuid) from public, anon, authenticated;
revoke all on function public._gym_can(uuid, text) from public, anon, authenticated;
revoke all on function public._gym_require(uuid, text) from public, anon, authenticated;
revoke all on function public._gym_notify(uuid, text, jsonb) from public, anon, authenticated;

-- ── The gym's view of its package ───────────────────────────────────────────
create or replace function public.gym_package(p_partner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s     public.gym_portal_settings;
  v_level integer;
begin
  if public._gym_role(p_partner_id) is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select * into v_s from public.gym_portal_settings where partner_id = p_partner_id;
  if not found then
    raise exception 'This gym has no portal' using errcode = 'P0002';
  end if;
  v_level := public._gym_level(p_partner_id);
  return jsonb_build_object(
    'package',        v_s.package,
    'billing',        v_s.billing,
    'on_trial',       coalesce(v_s.trial_ends_at > now(), false),
    'trial_ends_at',  v_s.trial_ends_at,
    'level',          v_level,
    'features',       public._gym_features(v_level),
    'requested',      v_s.package_requested,
    'requested_at',   v_s.package_requested_at,
    'founding_taken', (select count(*) from public.gym_portal_settings g where g.package = 'founding'),
    'founding_limit', 10
  );
end;
$$;

-- An owner asks POWR to switch package. POWR sets it (and invoices).
create or replace function public.gym_request_package(p_partner_id uuid, p_package text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._gym_role(p_partner_id);
  v_s    public.gym_portal_settings;
begin
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if v_role = 'staff' then
    raise exception 'Only your gym''s owner can change the package' using errcode = '42501';
  end if;
  if p_package is null or p_package not in ('clash', 'clash_plus', 'pro', 'founding') then
    raise exception 'Pick a package' using errcode = 'P0001';
  end if;
  select * into v_s from public.gym_portal_settings where partner_id = p_partner_id for update;
  if not found then
    raise exception 'This gym has no portal' using errcode = 'P0002';
  end if;
  if p_package = v_s.package then
    raise exception 'You''re already on that package' using errcode = 'P0001';
  end if;
  if p_package = 'founding' then
    if not coalesce(v_s.trial_ends_at > now(), false) then
      raise exception 'Founding Pro was only available during the free trial' using errcode = 'P0001';
    end if;
    if (select count(*) from public.gym_portal_settings g where g.package = 'founding') >= 10 then
      raise exception 'All 10 founding places have gone' using errcode = 'P0001';
    end if;
  end if;

  update public.gym_portal_settings
     set package_requested = p_package, package_requested_at = now()
   where partner_id = p_partner_id;

  perform public._gym_audit(p_partner_id, 'gym_package_requested',
    jsonb_build_object('package', p_package, 'from', v_s.package));
  perform public._gym_notify(p_partner_id, 'package_request',
    jsonb_build_object('package', p_package, 'current', v_s.package, 'trial_ends_at', v_s.trial_ends_at));
  return public.gym_package(p_partner_id);
end;
$$;

revoke all on function public.gym_package(uuid) from public, anon;
revoke all on function public.gym_request_package(uuid, text) from public, anon;
grant execute on function public.gym_package(uuid) to authenticated;
grant execute on function public.gym_request_package(uuid, text) to authenticated;

-- ── Starting something new needs the package ────────────────────────────────
-- Re-stated from prod (bodies match 20260924220000 / 20260924200100 /
-- 20260924180100); each gains only its package check.

create or replace function public.gym_create_event(p_partner_id uuid, p_template_key text, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   text := public._gym_role(p_partner_id);
  v_tpl    public.event_templates;
  v_gym    text;
  v_f      jsonb;
  d_start  timestamptz;
  d_end    timestamptz;
  d_lock   timestamptz;
  d_open   timestamptz;
  d_close  timestamptz;
  v_tz     text := public._gym_tz(p_partner_id);
  v_preset public.event_point_presets;
  v_slug   text;
  v_event  public.live_events;
begin
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  perform public._gym_require(p_partner_id, 'events');

  select * into v_tpl from public.event_templates where key = p_template_key and active;
  if not found then
    raise exception 'Pick a kind of event' using errcode = 'P0001';
  end if;
  select name into v_gym from public.partners where id = p_partner_id;

  -- Rules always go through the template, even when the gym adds none.
  v_f := public._gym_event_fields(v_tpl, coalesce(p_fields, '{}'::jsonb) || jsonb_build_object('rules', coalesce(p_fields -> 'rules', '[]'::jsonb)), v_gym);
  if not (v_f ? 'name') or not (v_f ? 'start_date') or not (v_f ? 'prizes') then
    raise exception 'An event needs a name, a start date and at least one prize' using errcode = 'P0001';
  end if;
  if (v_f ->> 'start_date')::date < (now() at time zone v_tz)::date then
    raise exception 'Pick a start date from today on' using errcode = 'P0001';
  end if;

  select * into v_preset from public.event_point_presets
   where key = coalesce(v_f ->> 'points_preset_key', v_tpl.default_preset);
  select * into d_start, d_end, d_lock, d_open, d_close
    from public._gym_event_dates(v_tpl, (v_f ->> 'start_date')::date, v_tz);

  v_slug := trim(both '-' from left(regexp_replace(lower(v_f ->> 'name'), '[^a-z0-9]+', '-', 'g'), 40));
  loop
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 4);
    exit when not exists (select 1 from public.live_events where slug = v_slug);
  end loop;

  insert into public.live_events (
    slug, name, venue_partner_id, managed_by, template_key, points_preset_key, status,
    scope, audience_mode, audience_radius_km, audience_recent_days,
    window_start_at, window_end_at, lock_at, doors_open_at, doors_close_at, eligibility_cutoff_at,
    included_activities, count_manual, count_walking, count_streak, count_venue_only,
    count_challenges, count_bonuses, count_referrals, count_adjustments,
    board_size, prizes, rules, promo_headline, promo_media_url,
    attendance_bonus_points, invite_bonus_points, invite_milestone_n, invite_milestone_bonus,
    reward_referrals_on_signup, entry_gate_n, entry_gate_since,
    auto_lifecycle, auto_settle, settle_grace_hours, auto_reveal_after_hours, created_by,
    notify_announce, notify_kickoff, notify_doors, notify_rank_at
  ) values (
    v_slug, v_f ->> 'name', p_partner_id, 'gym', v_tpl.key, v_preset.key, 'draft',
    'opt_in', 'venue', (v_f ->> 'audience_radius_km')::integer, 60,
    d_start, d_end, d_lock, d_open, d_close,
    d_lock,
    v_tpl.included_activities, v_tpl.count_manual, v_tpl.count_walking, v_tpl.count_streak, v_tpl.count_venue_only,
    false, false, false, true,
    v_tpl.board_size, v_f -> 'prizes', v_f -> 'rules', v_f ->> 'promo_headline', v_f ->> 'promo_media_url',
    v_preset.attendance_bonus_points, 20, 0, 0,
    false, 0, now(),
    true, true, v_tpl.settle_grace_hours, v_tpl.auto_reveal_after_hours, auth.uid(),
    coalesce((v_tpl.push_defaults ->> 'announce')::boolean, false),
    coalesce((v_tpl.push_defaults ->> 'kickoff')::boolean, false),
    coalesce((v_tpl.push_defaults ->> 'doors')::boolean, false) and d_open is not null,
    (v_tpl.push_defaults ->> 'rank_at')::time
  )
  returning * into v_event;

  perform public._gym_audit(p_partner_id, 'gym_event_created',
    jsonb_build_object('event_id', v_event.id, 'template', v_tpl.key, 'name', v_event.name));
  return public._gym_event_json(v_event, v_role);
end;
$$;

create or replace function public.gym_publish_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event    public.live_events;
  v_role     text;
  v_settings public.gym_portal_settings;
  v_active   integer;
begin
  select * into v_event from public.live_events where id = p_event_id for update;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  v_role := public._event_role(v_event);
  if v_role is null or v_event.managed_by <> 'gym' then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  perform public._gym_require(v_event.venue_partner_id, 'events');
  if v_event.status <> 'draft' or v_event.review_status = 'pending' then
    raise exception 'This event is already published or waiting for POWR' using errcode = 'P0001';
  end if;
  if v_event.window_start_at < now() + interval '2 hours' then
    raise exception 'Move the start date: a new event needs at least 2 hours'' notice' using errcode = 'P0001';
  end if;
  if v_event.window_start_at > now() + interval '90 days' then
    raise exception 'Events can be published up to 90 days ahead' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(v_event.prizes, '[]'::jsonb)) = 0 then
    raise exception 'Add at least one prize' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.partner_locations pl where pl.partner_id = v_event.venue_partner_id) then
    raise exception 'Your gym has no location on POWR yet — contact POWR' using errcode = 'P0001';
  end if;

  select * into v_settings from public.gym_portal_settings where partner_id = v_event.venue_partner_id;
  select count(*) into v_active
    from public.live_events e
   where e.venue_partner_id = v_event.venue_partner_id
     and e.managed_by = 'gym'
     and e.id <> v_event.id
     and (e.status in ('scheduled', 'live', 'locked') or (e.status = 'draft' and e.review_status = 'pending'));
  if v_active >= coalesce(v_settings.max_active_events, 2) then
    raise exception 'You already have % events on the go — publish this once one has finished', v_active using errcode = 'P0001';
  end if;

  if v_settings.trusted_at is not null or v_role = 'admin' then
    update public.live_events
       set status = 'scheduled', review_status = 'approved', published_at = now(), submitted_at = now()
     where id = p_event_id
    returning * into v_event;
    perform public._gym_audit(v_event.venue_partner_id, 'gym_event_published', jsonb_build_object('event_id', v_event.id));
    perform public._gym_event_notify(v_event, 'published');
  else
    update public.live_events
       set review_status = 'pending', submitted_at = now(), review_note = null
     where id = p_event_id
    returning * into v_event;
    perform public._gym_audit(v_event.venue_partner_id, 'gym_event_submitted', jsonb_build_object('event_id', v_event.id));
    perform public._gym_event_notify(v_event, 'submitted');
  end if;

  return public._gym_event_json(v_event, v_role);
end;
$$;

create or replace function public.gym_insights(p_partner_id uuid, p_weeks integer default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_weeks      integer := least(greatest(coalesce(p_weeks, 8), 2), 26);
  v_tz         text;
  v_week0      timestamp;   -- this week's Monday 00:00, gym-local
  v_from       timestamptz;
  v_week_start timestamptz;
  v_week_end   timestamptz;
  v_since28    timestamptz := now() - interval '28 days';
begin
  if public._gym_role(p_partner_id) is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  v_tz         := coalesce((select tz from public.gym_boards where partner_id = p_partner_id), 'Europe/London');
  v_week0      := date_trunc('week', now() at time zone v_tz);
  v_from       := (v_week0 - make_interval(weeks => v_weeks - 1)) at time zone v_tz;
  v_week_start := v_week0 at time zone v_tz;
  v_week_end   := (v_week0 + interval '7 days') at time zone v_tz;

  -- The dashboard is Clash+. Every package keeps the member count and this
  -- week's top ten: the gym's own board is part of free Clash.
  if not public._gym_can(p_partner_id, 'insights') then
    return jsonb_build_object(
      'tz', v_tz,
      'locked', true,
      'members', (select count(*) from public.profiles pr where pr.preferred_gym_id = p_partner_id),
    'top', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'rank',         sc.rank,
               'display_name', pr.display_name,
               'username',     pr.username,
               'avatar_url',   pr.avatar_url,
               'points',       sc.score,
               'sessions',     sc.sessions
             ) order by sc.rank), '[]'::jsonb)
        from (
          select * from public._gym_board_scores(p_partner_id, v_week_start, v_week_end, v_tz)
           where score > 0
           order by rank
           limit 10
        ) sc
        join public.profiles pr on pr.id = sc.user_id
    )
    );
  end if;

  return jsonb_build_object(
    'tz', v_tz,

    -- Monday-to-Monday in the gym's time; new = first ever session here.
    'weeks', (
      with sess as (
        select s.id, s.user_id,
               date_trunc('week', s.started_at at time zone v_tz) as wk,
               coalesce(s.duration_sec, greatest(0, extract(epoch from coalesce(s.ended_at, s.started_at) - s.started_at)))::integer as dur
          from public.activity_sessions s
         where s.partner_id = p_partner_id
           and s.started_at >= v_from
      ),
      firsts as (
        select s.user_id, date_trunc('week', min(s.started_at) at time zone v_tz) as first_wk
          from public.activity_sessions s
         where s.partner_id = p_partner_id
         group by s.user_id
      ),
      agg as (
        select se.wk,
               count(*)::integer                                             as sessions,
               count(distinct se.user_id)::integer                           as athletes,
               count(distinct se.user_id) filter (where f.first_wk = se.wk)::integer as new_athletes,
               (sum(se.dur) / 60)::integer                                   as minutes
          from sess se
          join firsts f on f.user_id = se.user_id
         group by se.wk
      ),
      pts as (
        select se.wk, sum(pt.amount)::integer as points
          from sess se
          join public.point_transactions pt on pt.session_id = se.id
         where pt.type in ('earn', 'adjustment', 'penalty')
         group by se.wk
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'week_start',   w.wk at time zone v_tz,
               'sessions',     coalesce(a.sessions, 0),
               'athletes',     coalesce(a.athletes, 0),
               'new_athletes', coalesce(a.new_athletes, 0),
               'minutes',      coalesce(a.minutes, 0),
               'points',       coalesce(p.points, 0)
             ) order by w.wk), '[]'::jsonb)
        from generate_series(v_week0 - make_interval(weeks => v_weeks - 1), v_week0, interval '1 week') w(wk)
        left join agg a on a.wk = w.wk
        left join pts p on p.wk = w.wk
    ),

    -- Last 28 days: sessions by local start hour (0–23) and weekday (Mon–Sun).
    'hours', (
      select jsonb_agg(coalesce(c.n, 0) order by h.h)
        from generate_series(0, 23) h(h)
        left join (
          select extract(hour from s.started_at at time zone v_tz)::integer as h, count(*)::integer as n
            from public.activity_sessions s
           where s.partner_id = p_partner_id and s.started_at >= v_since28
           group by 1
        ) c on c.h = h.h
    ),
    'days', (
      select jsonb_agg(coalesce(c.n, 0) order by d.d)
        from generate_series(1, 7) d(d)
        left join (
          select extract(isodow from s.started_at at time zone v_tz)::integer as d, count(*)::integer as n
            from public.activity_sessions s
           where s.partner_id = p_partner_id and s.started_at >= v_since28
           group by 1
        ) c on c.d = d.d
    ),
    'activities', (
      select coalesce(jsonb_agg(jsonb_build_object('type', x.t, 'sessions', x.n) order by x.n desc, x.t), '[]'::jsonb)
        from (
          select s.type::text as t, count(*)::integer as n
            from public.activity_sessions s
           where s.partner_id = p_partner_id and s.started_at >= v_since28
           group by 1
        ) x
    ),
    'athletes_28d', (
      select count(distinct s.user_id)
        from public.activity_sessions s
       where s.partner_id = p_partner_id and s.started_at >= v_since28
    ),
    'members', (select count(*) from public.profiles pr where pr.preferred_gym_id = p_partner_id),

    -- This week's top 10 exactly as the wall shows them.
    'top', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'rank',         sc.rank,
               'display_name', pr.display_name,
               'username',     pr.username,
               'avatar_url',   pr.avatar_url,
               'points',       sc.score,
               'sessions',     sc.sessions
             ) order by sc.rank), '[]'::jsonb)
        from (
          select * from public._gym_board_scores(p_partner_id, v_week_start, v_week_end, v_tz)
           where score > 0
           order by rank
           limit 10
        ) sc
        join public.profiles pr on pr.id = sc.user_id
    )
  );
end;
$$;
