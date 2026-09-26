-- =============================================================
-- Gym-run events, part 3: the pushes that run themselves
-- =============================================================
-- A gym never writes a push. It switches each template push on or off and
-- picks the hour of the daily standings push; POWR's wording does the rest,
-- with the gym's name, the event's name and the first prize filled in. Every
-- send still passes send-push-notification's gates (the admin kill switch,
-- the per-type daily cap, the member's own preferences).
--
--   event_announced   Once per event, to the venue's members and recent
--                     visitors (the event's audience_recent_days) who haven't
--                     joined. 10:00–20:00 UK, at least 30 minutes after
--                     publishing so a slip can still be cancelled. Follows the
--                     member's Announcements switch.
--   event_kickoff     Once, to registrants, the morning scoring starts.
--   event_doors_open  Once, to registrants, on the day of the finale night.
--   event_rank_daily  The existing standings pulse; its time
--                     (notify_rank_at) is now a gym setting too, and staff get
--                     one "send now" a day.
--
-- Class: 'social' with a daily cap of 1, like the other event pushes — NOT
-- the nudge pool. ~28 people a day spend their one nudge on the 8am
-- reminder (push_send_log, 14 days to 2026-09-24), and an announcement sent
-- once per event would never reach them. The brakes instead: once per
-- event, one of each type per member per day, two active events per gym,
-- members and recent visitors only, and the Announcements opt-out.
--
-- Defaults come from the template (push_defaults): the three one-offs on
-- where they apply; the standings pulse at 19:00 for the short formats and
-- off for the monthly one (28 daily pushes is too many).
--
-- Sends are claimed in live_event_pulse_sends like the rank/gate pulses,
-- and go through send-push's batch shape ({ targets }, 100 a call) rather
-- than one request per member.

alter table public.event_templates
  add column if not exists push_defaults jsonb not null default '{}'::jsonb;

update public.event_templates set push_defaults = '{"announce": true, "kickoff": true, "doors": false, "rank_at": null}'::jsonb    where key = 'monthly';
update public.event_templates set push_defaults = '{"announce": true, "kickoff": true, "doors": false, "rank_at": "19:00"}'::jsonb where key = 'sprint';
update public.event_templates set push_defaults = '{"announce": true, "kickoff": true, "doors": true, "rank_at": "19:00"}'::jsonb  where key = 'finale';

alter table public.live_events
  add column if not exists notify_announce boolean not null default false,
  add column if not exists notify_kickoff  boolean not null default false,
  add column if not exists notify_doors    boolean not null default false;

comment on column public.live_events.notify_announce is
  'Send event_announced once to the venue''s members and recent visitors who haven''t joined (live_event_notification_dispatch).';
comment on column public.live_events.notify_kickoff is
  'Send event_kickoff once to registrants the morning scoring starts.';
comment on column public.live_events.notify_doors is
  'Send event_doors_open once to registrants on the day of the finale night.';

alter table public.live_event_pulse_sends
  drop constraint if exists live_event_pulse_sends_kind_check,
  add  constraint live_event_pulse_sends_kind_check
       check (kind = any (array['rank', 'gate', 'announce', 'kickoff', 'doors']));

insert into public.notification_config (type, enabled, category, class, daily_cap, description) values
  ('event_announced',  true, 'social', 'social', 1,
   'A new event at a gym, once, to its members and recent visitors who haven''t joined. Switched on per event (gym portal or /admin/events); follows the Announcements preference.'),
  ('event_kickoff',    true, 'social', 'social', 1,
   'Registrants, the morning an event''s scoring starts. Switched on per event.'),
  ('event_doors_open', true, 'social', 'social', 1,
   'Registrants, the day of an event''s finale night, before the doors open. Switched on per event.')
on conflict (type) do nothing;

-- ── When is a one-off push due? ─────────────────────────────────────────────
-- UK wall clock throughout, like the pulse times. Gym events start at local
-- midnight, so the kickoff lands at 08:00; an event starting later in the
-- day gets it once it has started (never after 21:00).
create or replace function public._live_event_template_ready(p_event public.live_events, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with c as (select now() at time zone 'Europe/London' as t)
  select case p_kind
    when 'announce' then
          p_event.notify_announce
      and not p_event.hidden
      and p_event.status in ('scheduled', 'live')
      and coalesce(p_event.review_status, '') not in ('pending', 'rejected', 'pulled')
      and p_event.venue_partner_id is not null
      and now() >= coalesce(p_event.published_at, p_event.updated_at) + interval '30 minutes'
      and now() < coalesce(p_event.lock_at, p_event.window_end_at)
      and extract(hour from (select t from c)) between 10 and 19
    when 'kickoff' then
          p_event.notify_kickoff
      and not p_event.hidden
      and p_event.status = 'live'
      and now() >= p_event.window_start_at
      and now() < least(p_event.window_start_at + interval '14 hours',
                        coalesce(p_event.lock_at, p_event.window_end_at))
      and extract(hour from (select t from c)) between 8 and 20
    when 'doors' then
          p_event.notify_doors
      and not p_event.hidden
      and p_event.status in ('live', 'locked')
      and p_event.doors_open_at is not null
      and now() < p_event.doors_open_at
      and (p_event.doors_open_at at time zone 'Europe/London')::date = (select t from c)::date
      and extract(hour from (select t from c)) between 9 and 16
    else false
  end
$$;

-- ── Who gets it ─────────────────────────────────────────────────────────────
-- announce: the venue's people (the same two tests as _live_event_in_audience,
-- minus the radius — strangers nearby see the event in the app, they don't
-- get a push about it) who haven't joined. kickoff / doors: registrants.
create or replace function public._live_event_template_audience(p_event public.live_events, p_kind text)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select a.id
    from (
      select p.id from public.profiles p
       where p.preferred_gym_id = p_event.venue_partner_id
      union
      select s.user_id from public.activity_sessions s
       where s.partner_id = p_event.venue_partner_id
         and s.started_at > now() - make_interval(days => p_event.audience_recent_days)
    ) a(id)
   where p_kind = 'announce'
     and p_event.venue_partner_id is not null
     and not exists (select 1 from public.live_event_participants lp
                      where lp.event_id = p_event.id and lp.user_id = a.id)
  union all
  select lp.user_id
    from public.live_event_participants lp
   where p_kind in ('kickoff', 'doors')
     and lp.event_id = p_event.id
     and lp.disqualified_at is null
$$;

-- ── What the push says ──────────────────────────────────────────────────────
-- The facts send-push words the push from — also handed to the gym portal,
-- which previews the push with the same wording code (eventPushCopy.ts).
create or replace function public._live_event_template_payload(p_event public.live_events)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'event_id',      p_event.id,
    'event_slug',    p_event.slug,
    'event_name',    p_event.name,
    'gym_name',      (select p.name from public.partners p where p.id = p_event.venue_partner_id),
    'prize',         coalesce(
                       (select pz ->> 'label' from jsonb_array_elements(coalesce(p_event.prizes, '[]'::jsonb)) pz
                         where pz ->> 'rank' = '1' limit 1),
                       p_event.prizes -> 0 ->> 'label'),
    'starts_at',     p_event.window_start_at,
    'ends_at',       p_event.window_end_at,
    'doors_open_at', p_event.doors_open_at,
    'venue_only',    p_event.count_venue_only,
    'attendance',    p_event.attendance_bonus_points
  )
$$;

-- ── The send ────────────────────────────────────────────────────────────────
-- Returns how many members it went to (dry run: would go to). The payload is
-- the same for everyone, so it rides every target unchanged.
create or replace function public.live_event_send_template(p_event_id uuid, p_kind text, p_dry_run boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ev      public.live_events;
  v_type    text;
  v_payload jsonb;
  v_token   text;
  v_targets jsonb;
  v_n       integer := 0;
begin
  if p_kind not in ('announce', 'kickoff', 'doors') then
    raise exception 'unknown template push %', p_kind;
  end if;
  select * into v_ev from public.live_events where id = p_event_id;
  if not found then
    return 0;
  end if;

  if p_dry_run then
    select count(*) into v_n from public._live_event_template_audience(v_ev, p_kind);
    return v_n;
  end if;

  v_type := case p_kind when 'announce' then 'event_announced'
                        when 'kickoff'  then 'event_kickoff'
                        else 'event_doors_open' end;
  v_payload := public._live_event_template_payload(v_ev);

  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'shared_resolve_token';

  -- send-push takes up to 200 targets a call; 100 keeps each call short.
  for v_targets in
    select jsonb_agg(jsonb_build_object('target_user_id', a.user_id, 'type', v_type, 'payload', v_payload))
      from (select t.user_id, (row_number() over (order by t.user_id) - 1) / 100 as chunk
              from public._live_event_template_audience(v_ev, p_kind) t) a
     group by a.chunk
  loop
    v_n := v_n + jsonb_array_length(v_targets);
    perform net.http_post(
      url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-resolve-token', v_token),
      body := jsonb_build_object('targets', v_targets),
      timeout_milliseconds := 60000
    );
  end loop;

  return v_n;
end;
$$;

-- ── The dispatcher (pg_cron, every 5 minutes) ───────────────────────────────
-- Re-stated from prod (pg_get_functiondef, 2026-09-24). The rank/gate loop is
-- unchanged; the one-off loop is new. A one-off kind sends once per EVENT:
-- any earlier automatic send of it, on any day, ends it.
create or replace function public.live_event_notification_dispatch()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day     date := (now() at time zone 'Europe/London')::date;
  v_total   integer := 0;
  v_n       integer;
  v_send_at timestamptz;
  v_ev      public.live_events;
  r         record;
begin
  for r in
    select e.id, k.kind,
           case k.kind when 'rank' then e.notify_rank_at else e.notify_gate_at end as at_time
      from public.live_events e
      cross join (values ('rank'), ('gate')) k(kind)
     where case k.kind when 'rank' then e.notify_rank_at else e.notify_gate_at end is not null
       and e.status in ('scheduled', 'live', 'locked')
  loop
    select * into v_ev from public.live_events where id = r.id;
    if not public._live_event_pulse_ready(v_ev, r.kind) then
      continue;
    end if;

    v_send_at := (v_day::timestamp + r.at_time) at time zone 'Europe/London';
    if now() < v_send_at or now() >= v_send_at + interval '90 minutes' then
      continue;
    end if;

    -- The claim — only the tick that inserts sends.
    insert into public.live_event_pulse_sends (event_id, kind, day, source, recipients)
    values (r.id, r.kind, v_day, 'auto', 0)
    on conflict do nothing;
    if not found then
      continue;
    end if;

    v_n := public.live_event_send_pulse(r.id, r.kind, false);
    update public.live_event_pulse_sends
       set recipients = v_n
     where event_id = r.id and kind = r.kind and day = v_day and source = 'auto';
    v_total := v_total + v_n;
  end loop;

  -- One-offs: announce / kickoff / doors.
  for r in
    select e.id, k.kind
      from public.live_events e
      cross join (values ('announce'), ('kickoff'), ('doors')) k(kind)
     where case k.kind when 'announce' then e.notify_announce
                       when 'kickoff'  then e.notify_kickoff
                       else e.notify_doors end
       and e.status in ('scheduled', 'live', 'locked')
  loop
    select * into v_ev from public.live_events where id = r.id;
    if not public._live_event_template_ready(v_ev, r.kind) then
      continue;
    end if;
    if exists (select 1 from public.live_event_pulse_sends s
                where s.event_id = r.id and s.kind = r.kind and s.source = 'auto') then
      continue;
    end if;

    insert into public.live_event_pulse_sends (event_id, kind, day, source, recipients)
    values (r.id, r.kind, v_day, 'auto', 0)
    on conflict do nothing;
    if not found then
      continue;
    end if;

    v_n := public.live_event_send_template(r.id, r.kind, false);
    update public.live_event_pulse_sends
       set recipients = v_n
     where event_id = r.id and kind = r.kind and day = v_day and source = 'auto';
    v_total := v_total + v_n;
  end loop;

  return v_total;
end;
$$;

revoke all on function public._live_event_template_ready(public.live_events, text) from public, anon, authenticated;
revoke all on function public._live_event_template_audience(public.live_events, text) from public, anon, authenticated;
revoke all on function public._live_event_template_payload(public.live_events) from public, anon, authenticated;
revoke all on function public.live_event_send_template(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.live_event_notification_dispatch() from public, anon, authenticated;

-- ── The gym's controls ──────────────────────────────────────────────────────
-- What's set, who each push would reach right now, and what has gone out.
-- "reachable" = has the app's notifications on a device (and, for the
-- announcement, hasn't switched Announcements off) — the honest number.
create or replace function public.gym_event_push_status(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
begin
  select * into v_event from public.live_events where id = p_event_id;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if public._event_role(v_event) is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'announce', v_event.notify_announce,
    'kickoff',  v_event.notify_kickoff,
    'doors',    v_event.notify_doors,
    'rank_at',  to_char(v_event.notify_rank_at, 'HH24:MI'),
    'finale',   v_event.doors_open_at is not null,
    'editable', v_event.status not in ('revealed', 'settled', 'archived', 'cancelled'),
    'rank_ready', public._live_event_pulse_ready(v_event, 'rank'),
    'payload',  public._live_event_template_payload(v_event),
    'audience', (
      select jsonb_build_object(
               'people',    count(*),
               'reachable', count(*) filter (
                              where exists (select 1 from public.user_push_tokens t where t.user_id = a.user_id)
                                and coalesce((select np.announcements from public.notification_preferences np
                                               where np.user_id = a.user_id), true)))
        from public._live_event_template_audience(v_event, 'announce') a),
    'registrants', (
      select jsonb_build_object(
               'people',    count(*),
               'reachable', count(*) filter (
                              where exists (select 1 from public.user_push_tokens t where t.user_id = a.user_id)))
        from public._live_event_template_audience(v_event, 'kickoff') a),
    'sent', coalesce((
      select jsonb_agg(jsonb_build_object('kind', s.kind, 'day', s.day, 'source', s.source,
                                          'recipients', s.recipients, 'at', s.created_at)
                       order by s.created_at desc)
        from public.live_event_pulse_sends s
       where s.event_id = v_event.id
    ), '[]'::jsonb)
  );
end;
$$;

-- p_patch keys: announce, kickoff, doors (true/false), rank_at ('HH:00'
-- between 07:00 and 21:00, or null for off).
create or replace function public.gym_event_set_push(p_event_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
  v_key   text;
  v_rank  time;
begin
  select * into v_event from public.live_events where id = p_event_id for update;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if v_event.managed_by <> 'gym' or public._event_role(v_event) is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if v_event.status in ('revealed', 'settled', 'archived', 'cancelled') then
    raise exception 'This event is over' using errcode = 'P0001';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nothing to change' using errcode = 'P0001';
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('announce', 'kickoff', 'doors', 'rank_at') then
      raise exception 'Can''t change %', v_key using errcode = 'P0001';
    end if;
    if v_key <> 'rank_at' and jsonb_typeof(p_patch -> v_key) <> 'boolean' then
      raise exception 'Switch % on or off', v_key using errcode = 'P0001';
    end if;
  end loop;
  if (p_patch ->> 'doors')::boolean and v_event.doors_open_at is null then
    raise exception 'This event has no finale night' using errcode = 'P0001';
  end if;
  if p_patch ? 'rank_at' and jsonb_typeof(p_patch -> 'rank_at') <> 'null' then
    if coalesce(p_patch ->> 'rank_at', '') !~ '^([01][0-9]|2[0-3]):00$' then
      raise exception 'Pick an hour for the standings push' using errcode = 'P0001';
    end if;
    v_rank := (p_patch ->> 'rank_at')::time;
    if v_rank < '07:00' or v_rank > '21:00' then
      raise exception 'The standings push goes out between 7am and 9pm' using errcode = 'P0001';
    end if;
  end if;

  update public.live_events e set
    notify_announce = coalesce((p_patch ->> 'announce')::boolean, e.notify_announce),
    notify_kickoff  = coalesce((p_patch ->> 'kickoff')::boolean, e.notify_kickoff),
    notify_doors    = coalesce((p_patch ->> 'doors')::boolean, e.notify_doors),
    notify_rank_at  = case when p_patch ? 'rank_at' then v_rank else e.notify_rank_at end
   where e.id = p_event_id;

  perform public._gym_audit(v_event.venue_partner_id, 'gym_event_pushes',
    jsonb_build_object('event_id', v_event.id) || p_patch);
  return public.gym_event_push_status(p_event_id);
end;
$$;

-- The standings push, now, once a UK day per event (the scheduled one still
-- goes out; event_rank_daily's cap of 2 absorbs the pair).
create or replace function public.gym_event_send_pulse(p_event_id uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
  v_day   date := (now() at time zone 'Europe/London')::date;
  v_n     integer;
begin
  -- The row lock serialises two presses of the button.
  select * into v_event from public.live_events where id = p_event_id for update;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if v_event.managed_by <> 'gym' or public._event_role(v_event) is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if not public._live_event_pulse_ready(v_event, 'rank') then
    raise exception 'The standings push only goes out while the event is live, before the board is sealed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.live_event_pulse_sends s
              where s.event_id = p_event_id and s.kind = 'rank' and s.source = 'manual' and s.day = v_day) then
    raise exception 'Already sent today. It can go again tomorrow' using errcode = 'P0001';
  end if;

  v_n := public.live_event_send_pulse(p_event_id, 'rank', p_dry_run);
  if not p_dry_run then
    insert into public.live_event_pulse_sends (event_id, kind, day, source, recipients)
    values (p_event_id, 'rank', v_day, 'manual', v_n);
    perform public._gym_audit(v_event.venue_partner_id, 'gym_event_pulse_sent',
      jsonb_build_object('event_id', v_event.id, 'recipients', v_n));
  end if;
  return jsonb_build_object('recipients', v_n, 'sent', not p_dry_run);
end;
$$;

revoke all on function public.gym_event_push_status(uuid) from public, anon;
revoke all on function public.gym_event_set_push(uuid, jsonb) from public, anon;
revoke all on function public.gym_event_send_pulse(uuid, boolean) from public, anon;
grant execute on function public.gym_event_push_status(uuid) to authenticated;
grant execute on function public.gym_event_set_push(uuid, jsonb) to authenticated;
grant execute on function public.gym_event_send_pulse(uuid, boolean) to authenticated;

-- ── New gym events start with the template's pushes ─────────────────────────
-- Re-stated from prod (md5 matches 20260924200100); only the four notify_*
-- values in the insert are new.
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

-- Gym events made before this migration pick up their template's pushes
-- (none existed in prod when it was written; this covers the gap if one is).
update public.live_events e
   set notify_announce = coalesce((t.push_defaults ->> 'announce')::boolean, false),
       notify_kickoff  = coalesce((t.push_defaults ->> 'kickoff')::boolean, false),
       notify_doors    = coalesce((t.push_defaults ->> 'doors')::boolean, false) and e.doors_open_at is not null,
       notify_rank_at  = coalesce(e.notify_rank_at, (t.push_defaults ->> 'rank_at')::time)
  from public.event_templates t
 where t.key = e.template_key
   and e.managed_by = 'gym'
   and e.status in ('draft', 'scheduled', 'live')
   and not (e.notify_announce or e.notify_kickoff or e.notify_doors);
