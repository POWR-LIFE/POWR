-- =============================================================
-- Gym-run events, part 2: what a gym can do, and what runs by itself
-- =============================================================
-- Gym staff create events from a template (20260924200000), publish them
-- (a gym's first event waits for POWR; a trusted gym's go straight out), and
-- reveal the winners from their phone. Everything else runs on the clock.
--
-- Gym functions (each opens with the venue-role check; no emails out):
--   gym_list_events / gym_event_detail     every event at the venue (POWR-run
--                                          ones read-only)
--   gym_create_event                       template + name, start date, prizes,
--                                          optional rules/promo/preset/radius
--   gym_update_event                       what's editable narrows as it runs
--   gym_publish_event                      checks, then scheduled (trusted) or
--                                          pending review (not yet trusted)
--   gym_withdraw_event / gym_delete_event / gym_cancel_event
--   gym_reveal_event / gym_set_reveal_at   staff press Reveal, or schedule it
--   gym_event_board / gym_event_roster     standings (sealed or not) + who's in
--   gym_event_disqualify / gym_event_reinstate
--
-- Admin: admin_review_gym_event (approve, optionally trusting the gym; or
-- reject with a note), admin_pull_event (any event, any time).
--
-- The clock (live_event_auto_transitions, re-stated from prod) now also:
--   · freezes results at lock + grace (auto_settle events);
--   · reveals at reveal_at, or as a safety net auto_reveal_after_hours
--     after that (Jamie: nag, then auto-reveal);
--   · pays the attendance reward once doors close, to registrants the venue
--     geofence saw during the night (no hand-marked payouts);
--   · wraps revealed gym events to settled after 3 days.
--
-- Slack gets a line when an event needs review, when a trusted gym
-- publishes, cancels, or removes a member (notify-gym-event).

alter table public.live_event_attendance_awards
  drop constraint if exists live_event_attendance_awards_source_check,
  add  constraint live_event_attendance_awards_source_check
       check (source = any (array['door', 'pay_all', 'auto']));

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- The caller's role on an event they may CHANGE: admin anywhere, the venue
-- team on the venue's own gym-run events.
create or replace function public._event_role(p_event public.live_events)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.admin_roles a where a.user_id = auth.uid()) then 'admin'
    when p_event.managed_by = 'gym' then public._gym_role(p_event.venue_partner_id)
  end
$$;

create or replace function public._gym_tz(p_partner_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select tz from public.gym_boards where partner_id = p_partner_id), 'Europe/London')
$$;

-- Every date of an event from its template and first day (local midnight).
-- Without a finale night the board seals when scoring ends; with one,
-- scoring ends at midnight before the night, the board stays sealed through
-- the day and the doors open that evening.
create or replace function public._gym_event_dates(
  p_template public.event_templates, p_start date, p_tz text,
  out window_start_at timestamptz, out window_end_at timestamptz, out lock_at timestamptz,
  out doors_open_at timestamptz, out doors_close_at timestamptz
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_end date := p_start + p_template.duration_days;
begin
  window_start_at := p_start::timestamp at time zone p_tz;
  window_end_at   := v_end::timestamp at time zone p_tz;
  lock_at         := window_end_at;
  if p_template.night_start_hour is not null then
    doors_open_at  := (v_end::timestamp + make_interval(hours => p_template.night_start_hour)) at time zone p_tz;
    doors_close_at := (v_end::timestamp + make_interval(hours => p_template.night_start_hour + p_template.night_hours)) at time zone p_tz;
  end if;
end;
$$;

-- Normalise and check the fields a gym may send. Only keys present in
-- p_fields come back. Raises on anything out of bounds.
create or replace function public._gym_event_fields(p_template public.event_templates, p_fields jsonb, p_gym_name text)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_out   jsonb := '{}'::jsonb;
  v_key   text;
  v_text  text;
  v_arr   jsonb;
  v_rules jsonb;
  v_n     integer;
  i       integer;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'Nothing to save' using errcode = 'P0001';
  end if;

  for v_key in select jsonb_object_keys(p_fields) loop
    if v_key not in ('name', 'start_date', 'prizes', 'rules', 'promo_headline', 'promo_media_url',
                     'points_preset_key', 'audience_radius_km') then
      raise exception 'Can''t set %', v_key using errcode = 'P0001';
    end if;
  end loop;

  if p_fields ? 'name' then
    v_text := btrim(regexp_replace(coalesce(p_fields ->> 'name', ''), '\s+', ' ', 'g'));
    if length(v_text) not between 3 and 48 then
      raise exception 'Give the event a name of 3–48 characters' using errcode = 'P0001';
    end if;
    v_out := v_out || jsonb_build_object('name', v_text);
  end if;

  if p_fields ? 'start_date' then
    begin
      v_out := v_out || jsonb_build_object('start_date', (p_fields ->> 'start_date')::date);
    exception when others then
      raise exception 'Pick a start date' using errcode = 'P0001';
    end;
  end if;

  if p_fields ? 'prizes' then
    v_arr := p_fields -> 'prizes';
    if jsonb_typeof(v_arr) <> 'array' or jsonb_array_length(v_arr) not between 1 and 5 then
      raise exception 'Add between 1 and 5 prizes' using errcode = 'P0001';
    end if;
    v_n := jsonb_array_length(v_arr);
    v_rules := '[]'::jsonb;
    for i in 0 .. v_n - 1 loop
      v_text := btrim(coalesce(v_arr ->> i, ''));
      if length(v_text) not between 2 and 60 then
        raise exception 'Each prize needs 2–60 characters' using errcode = 'P0001';
      end if;
      v_rules := v_rules || jsonb_build_array(jsonb_build_object('rank', i + 1, 'label', v_text));
    end loop;
    v_out := v_out || jsonb_build_object('prizes', v_rules);
  end if;

  if p_fields ? 'rules' then
    v_arr := coalesce(p_fields -> 'rules', '[]'::jsonb);
    if jsonb_typeof(v_arr) <> 'array' or jsonb_array_length(v_arr) > 8 then
      raise exception 'Add up to 8 rules of your own' using errcode = 'P0001';
    end if;
    -- The template's rules always lead; the gym's own follow.
    select coalesce(jsonb_agg(replace(r, '{gym}', p_gym_name) order by o), '[]'::jsonb) into v_rules
      from jsonb_array_elements_text(p_template.default_rules) with ordinality t(r, o);
    for i in 0 .. jsonb_array_length(v_arr) - 1 loop
      v_text := btrim(coalesce(v_arr ->> i, ''));
      if v_text = '' then continue; end if;
      if length(v_text) > 200 then
        raise exception 'Keep each rule under 200 characters' using errcode = 'P0001';
      end if;
      v_rules := v_rules || to_jsonb(v_text);
    end loop;
    v_out := v_out || jsonb_build_object('rules', v_rules);
  end if;

  if p_fields ? 'promo_headline' then
    v_text := nullif(btrim(coalesce(p_fields ->> 'promo_headline', '')), '');
    if v_text is not null and length(v_text) > 80 then
      raise exception 'Keep the headline under 80 characters' using errcode = 'P0001';
    end if;
    v_out := v_out || jsonb_build_object('promo_headline', v_text);
  end if;

  if p_fields ? 'promo_media_url' then
    v_text := nullif(btrim(coalesce(p_fields ->> 'promo_media_url', '')), '');
    if v_text is not null
       and v_text not like 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/%' then
      raise exception 'Upload the image here rather than linking to it' using errcode = 'P0001';
    end if;
    v_out := v_out || jsonb_build_object('promo_media_url', v_text);
  end if;

  if p_fields ? 'points_preset_key' then
    v_text := coalesce(p_fields ->> 'points_preset_key', p_template.default_preset);
    if not (v_text = any (p_template.allowed_presets)) then
      raise exception 'That points option isn''t available for this kind of event' using errcode = 'P0001';
    end if;
    v_out := v_out || jsonb_build_object('points_preset_key', v_text);
  end if;

  if p_fields ? 'audience_radius_km' then
    if p_fields -> 'audience_radius_km' = 'null'::jsonb then
      v_out := v_out || jsonb_build_object('audience_radius_km', null);
    elsif not ((p_fields ->> 'audience_radius_km')::integer = any (p_template.radius_choices)) then
      raise exception 'Pick one of the nearby distances offered' using errcode = 'P0001';
    else
      v_out := v_out || jsonb_build_object('audience_radius_km', (p_fields ->> 'audience_radius_km')::integer);
    end if;
  end if;

  return v_out;
end;
$$;

-- Slack line for POWR. Queued by pg_net and sent after commit, so a rolled
-- back action never pings.
create or replace function public._gym_event_notify(p_event public.live_events, p_kind text, p_detail jsonb default '{}'::jsonb)
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
      'event',  jsonb_build_object('id', p_event.id, 'slug', p_event.slug, 'name', p_event.name,
                                   'window_start_at', p_event.window_start_at, 'template_key', p_event.template_key),
      'gym',    (select jsonb_build_object('id', p.id, 'name', p.name) from public.partners p where p.id = p_event.venue_partner_id),
      'actor',  (select coalesce(pr.display_name, pr.username) from public.profiles pr where pr.id = auth.uid()),
      'detail', coalesce(p_detail, '{}'::jsonb)
    ),
    timeout_milliseconds := 5000
  );
exception when others then
  raise warning '[_gym_event_notify] %', sqlerrm;
end;
$$;

-- One event as the portal shows it.
create or replace function public._gym_event_json(p_event public.live_events, p_role text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',                 p_event.id,
    'slug',               p_event.slug,
    'name',               p_event.name,
    'status',             p_event.status,
    'hidden',             p_event.hidden,
    'managed_by',         p_event.managed_by,
    'editable',           p_event.managed_by = 'gym' and p_role in ('admin', 'owner', 'staff'),
    'review_status',      p_event.review_status,
    'review_note',        p_event.review_note,
    'submitted_at',       p_event.submitted_at,
    'published_at',       p_event.published_at,
    'template_key',       p_event.template_key,
    'template',           (select jsonb_build_object('name', t.name, 'duration_days', t.duration_days,
                                                     'finale', t.night_start_hour is not null,
                                                     'allowed_presets', t.allowed_presets,
                                                     'radius_choices', t.radius_choices,
                                                     'rule_count', jsonb_array_length(t.default_rules))
                             from public.event_templates t where t.key = p_event.template_key),
    'window_start_at',    p_event.window_start_at,
    'window_end_at',      p_event.window_end_at,
    'lock_at',            p_event.lock_at,
    'doors_open_at',      p_event.doors_open_at,
    'doors_close_at',     p_event.doors_close_at,
    'reveal_at',          p_event.reveal_at,
    'revealed_at',        p_event.revealed_at,
    'results_cut_at',     p_event.results_cut_at,
    'auto_reveal_at',     case when p_event.auto_reveal_after_hours is not null and p_event.lock_at is not null
                               then p_event.lock_at + make_interval(hours => p_event.settle_grace_hours + p_event.auto_reveal_after_hours) end,
    'prizes',             coalesce(p_event.prizes, '[]'::jsonb),
    'rules',              coalesce(p_event.rules, '[]'::jsonb),
    'promo_headline',     p_event.promo_headline,
    'promo_media_url',    p_event.promo_media_url,
    'points_preset_key',  p_event.points_preset_key,
    'attendance_bonus_points', p_event.attendance_bonus_points,
    'attendance_paid_at', p_event.attendance_paid_at,
    'audience_radius_km', p_event.audience_radius_km,
    'board_size',         p_event.board_size,
    'display_token',      p_event.display_token,
    'participants',       (select count(*) from public.live_event_participants lp
                            where lp.event_id = p_event.id and lp.disqualified_at is null),
    'disqualified',       (select count(*) from public.live_event_participants lp
                            where lp.event_id = p_event.id and lp.disqualified_at is not null)
  )
$$;

revoke all on function public._event_role(public.live_events) from public, anon, authenticated;
revoke all on function public._gym_tz(uuid) from public, anon, authenticated;
revoke all on function public._gym_event_dates(public.event_templates, date, text) from public, anon, authenticated;
revoke all on function public._gym_event_fields(public.event_templates, jsonb, text) from public, anon, authenticated;
revoke all on function public._gym_event_notify(public.live_events, text, jsonb) from public, anon, authenticated;
revoke all on function public._gym_event_json(public.live_events, text) from public, anon, authenticated;

-- ── Reading ─────────────────────────────────────────────────────────────────
create or replace function public.gym_list_events(p_partner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public._gym_role(p_partner_id);
begin
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(public._gym_event_json(e, v_role) order by e.window_start_at desc)
      from public.live_events e
     where e.venue_partner_id = p_partner_id
       and (e.managed_by = 'gym' or e.status <> 'draft')
       and not (e.status = 'archived' and e.managed_by = 'powr')
  ), '[]'::jsonb);
end;
$$;

create or replace function public.gym_event_detail(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
  v_role  text;
begin
  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  v_role := public._gym_role(v_event.venue_partner_id);
  if v_role is null or (v_event.managed_by = 'powr' and v_event.status = 'draft') then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return public._gym_event_json(v_event, v_role);
end;
$$;

-- ── Creating and editing ────────────────────────────────────────────────────
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
    auto_lifecycle, auto_settle, settle_grace_hours, auto_reveal_after_hours, created_by
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
    true, true, v_tpl.settle_grace_hours, v_tpl.auto_reveal_after_hours, auth.uid()
  )
  returning * into v_event;

  perform public._gym_audit(p_partner_id, 'gym_event_created',
    jsonb_build_object('event_id', v_event.id, 'template', v_tpl.key, 'name', v_event.name));
  return public._gym_event_json(v_event, v_role);
end;
$$;

create or replace function public.gym_update_event(p_event_id uuid, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event   public.live_events;
  v_role    text;
  v_tpl     public.event_templates;
  v_gym     text;
  v_f       jsonb;
  v_key     text;
  v_early   boolean;
  v_dated   boolean := false;
  d_start   timestamptz;
  d_end     timestamptz;
  d_lock    timestamptz;
  d_open    timestamptz;
  d_close   timestamptz;
  v_preset  public.event_point_presets;
  v_tz      text;
begin
  select * into v_event from public.live_events where id = p_event_id for update;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  v_role := public._event_role(v_event);
  if v_role is null or v_event.managed_by <> 'gym' then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_tpl from public.event_templates where key = v_event.template_key;
  select name into v_gym from public.partners where id = v_event.venue_partner_id;
  v_f := public._gym_event_fields(v_tpl, p_fields, v_gym);

  -- Everything until it starts; only the words and picture while it runs;
  -- nothing once the board has sealed.
  v_early := v_event.status = 'draft' or (v_event.status = 'scheduled' and now() < v_event.window_start_at);
  for v_key in select jsonb_object_keys(v_f) loop
    if v_early then continue; end if;
    if v_event.status = 'live' and v_key in ('name', 'promo_headline', 'promo_media_url') then continue; end if;
    raise exception 'That can''t change once the event has started' using errcode = 'P0001';
  end loop;

  v_tz := public._gym_tz(v_event.venue_partner_id);
  if v_f ? 'start_date' then
    if v_event.status <> 'draft' and ((v_f ->> 'start_date')::date::timestamp at time zone v_tz) < now() + interval '2 hours' then
      raise exception 'A published event needs to start at least 2 hours from now' using errcode = 'P0001';
    end if;
    if (v_f ->> 'start_date')::date < (now() at time zone v_tz)::date then
      raise exception 'Pick a start date from today on' using errcode = 'P0001';
    end if;
    select * into d_start, d_end, d_lock, d_open, d_close
      from public._gym_event_dates(v_tpl, (v_f ->> 'start_date')::date, v_tz);
    v_dated := true;
  end if;
  if v_f ? 'points_preset_key' then
    select * into v_preset from public.event_point_presets where key = v_f ->> 'points_preset_key';
  end if;

  update public.live_events e set
    name                    = coalesce(v_f ->> 'name', e.name),
    prizes                  = coalesce(v_f -> 'prizes', e.prizes),
    rules                   = coalesce(v_f -> 'rules', e.rules),
    promo_headline          = case when v_f ? 'promo_headline'  then v_f ->> 'promo_headline'  else e.promo_headline end,
    promo_media_url         = case when v_f ? 'promo_media_url' then v_f ->> 'promo_media_url' else e.promo_media_url end,
    audience_radius_km      = case when v_f ? 'audience_radius_km' then (v_f ->> 'audience_radius_km')::integer else e.audience_radius_km end,
    points_preset_key       = coalesce(v_preset.key, e.points_preset_key),
    attendance_bonus_points = coalesce(v_preset.attendance_bonus_points, e.attendance_bonus_points),
    window_start_at         = case when v_dated then d_start else e.window_start_at end,
    window_end_at           = case when v_dated then d_end   else e.window_end_at end,
    lock_at                 = case when v_dated then d_lock  else e.lock_at end,
    eligibility_cutoff_at   = case when v_dated then d_lock  else e.eligibility_cutoff_at end,
    doors_open_at           = case when v_dated then d_open  else e.doors_open_at end,
    doors_close_at          = case when v_dated then d_close else e.doors_close_at end
  where e.id = p_event_id
  returning * into v_event;

  perform public._gym_audit(v_event.venue_partner_id, 'gym_event_updated',
    jsonb_build_object('event_id', v_event.id, 'fields', (select jsonb_agg(k) from jsonb_object_keys(v_f) k)));
  return public._gym_event_json(v_event, v_role);
end;
$$;

-- ── Publishing ──────────────────────────────────────────────────────────────
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

create or replace function public.gym_withdraw_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
  v_role  text;
begin
  select * into v_event from public.live_events where id = p_event_id for update;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  v_role := public._event_role(v_event);
  if v_role is null or v_event.managed_by <> 'gym' then raise exception 'Not authorised' using errcode = '42501'; end if;
  if v_event.review_status is distinct from 'pending' then
    raise exception 'Only an event waiting for POWR can be withdrawn' using errcode = 'P0001';
  end if;
  update public.live_events set review_status = null, submitted_at = null where id = p_event_id returning * into v_event;
  perform public._gym_audit(v_event.venue_partner_id, 'gym_event_withdrawn', jsonb_build_object('event_id', v_event.id));
  return public._gym_event_json(v_event, v_role);
end;
$$;

create or replace function public.gym_delete_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
begin
  select * into v_event from public.live_events where id = p_event_id for update;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if public._event_role(v_event) is null or v_event.managed_by <> 'gym' then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if v_event.status <> 'draft' then
    raise exception 'Only a draft can be deleted — cancel a published event instead' using errcode = 'P0001';
  end if;
  perform public._gym_audit(v_event.venue_partner_id, 'gym_event_deleted', jsonb_build_object('event_id', v_event.id, 'name', v_event.name));
  delete from public.live_events where id = p_event_id;
end;
$$;

create or replace function public.gym_cancel_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
  v_role  text;
begin
  select * into v_event from public.live_events where id = p_event_id for update;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  v_role := public._event_role(v_event);
  if v_role is null or v_event.managed_by <> 'gym' then raise exception 'Not authorised' using errcode = '42501'; end if;
  if v_event.status <> 'scheduled' or now() >= v_event.window_start_at then
    raise exception 'Only an event that hasn''t started can be cancelled — contact POWR' using errcode = 'P0001';
  end if;
  update public.live_events set status = 'archived', hidden = true where id = p_event_id returning * into v_event;
  perform public._gym_audit(v_event.venue_partner_id, 'gym_event_cancelled', jsonb_build_object('event_id', v_event.id));
  perform public._gym_event_notify(v_event, 'cancelled',
    jsonb_build_object('registrants', (select count(*) from public.live_event_participants lp where lp.event_id = v_event.id)));
  return public._gym_event_json(v_event, v_role);
end;
$$;

-- ── The reveal ──────────────────────────────────────────────────────────────
create or replace function public.gym_reveal_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
  v_role  text;
begin
  select * into v_event from public.live_events where id = p_event_id for update;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  v_role := public._event_role(v_event);
  if v_role is null or v_event.managed_by <> 'gym' then raise exception 'Not authorised' using errcode = '42501'; end if;
  if v_event.status not in ('live', 'locked') or now() < coalesce(v_event.lock_at, v_event.window_end_at) then
    raise exception 'The winners can be revealed once the board has sealed' using errcode = 'P0001';
  end if;

  if v_event.status = 'live' then
    update public.live_events set status = 'locked' where id = p_event_id;
  end if;
  perform public._live_event_cut_results(p_event_id);
  update public.live_events set status = 'revealed', revealed_at = now() where id = p_event_id
  returning * into v_event;

  perform public._gym_audit(v_event.venue_partner_id, 'gym_event_revealed', jsonb_build_object('event_id', v_event.id));
  return public._gym_event_json(v_event, v_role);
end;
$$;

create or replace function public.gym_set_reveal_at(p_event_id uuid, p_reveal_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
  v_role  text;
begin
  select * into v_event from public.live_events where id = p_event_id for update;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  v_role := public._event_role(v_event);
  if v_role is null or v_event.managed_by <> 'gym' then raise exception 'Not authorised' using errcode = '42501'; end if;
  if v_event.status in ('revealed', 'settled', 'archived') then
    raise exception 'The winners are already out' using errcode = 'P0001';
  end if;
  if p_reveal_at is not null
     and (p_reveal_at < v_event.lock_at or p_reveal_at > v_event.lock_at + interval '7 days') then
    raise exception 'Pick a time after the board seals and within a week of it' using errcode = 'P0001';
  end if;
  update public.live_events set reveal_at = p_reveal_at where id = p_event_id returning * into v_event;
  perform public._gym_audit(v_event.venue_partner_id, 'gym_event_reveal_scheduled',
    jsonb_build_object('event_id', v_event.id, 'reveal_at', p_reveal_at));
  return public._gym_event_json(v_event, v_role);
end;
$$;

-- ── Standings and who's in ──────────────────────────────────────────────────
-- Staff see the real standings even while the board is sealed, so they can
-- have the prizes ready. Names are what the board shows; joining an opt-in
-- event is the leaderboard consent.
create or replace function public.gym_event_board(p_event_id uuid)
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
  if public._gym_role(v_event.venue_partner_id) is null or v_event.status = 'draft' then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'frozen', v_event.status in ('revealed', 'settled'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank', x.rank, 'user_id', x.user_id, 'display_name', x.display_name, 'username', x.username,
               'avatar_url', x.avatar_url, 'points', x.points, 'prize', x.prize) order by x.rank)
        from (
          select r.rank, r.user_id, p.display_name, p.username, p.avatar_url, r.final_points as points, r.prize_label as prize
            from public.live_event_results r
            join public.profiles p on p.id = r.user_id
           where r.event_id = v_event.id and v_event.status in ('revealed', 'settled')
          union all
          select s.rank::integer, s.user_id, p.display_name, p.username, p.avatar_url, s.score,
                 (select pz ->> 'label' from jsonb_array_elements(coalesce(v_event.prizes, '[]'::jsonb)) pz
                   where (pz ->> 'rank')::integer = s.rank limit 1)
            from public._live_event_scores(v_event.id) s
            join public.profiles p on p.id = s.user_id
           where v_event.status not in ('revealed', 'settled')
             and s.score > 0
             and s.rank <= v_event.board_size
        ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.gym_event_roster(p_event_id uuid)
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
  if public._gym_role(v_event.venue_partner_id) is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', lp.user_id, 'display_name', p.display_name, 'username', p.username,
             'avatar_url', p.avatar_url, 'member_id', p.referral_code,
             'joined_at', lp.joined_at, 'disqualified', lp.disqualified_at is not null)
           order by lp.disqualified_at is not null, lp.joined_at)
      from public.live_event_participants lp
      join public.profiles p on p.id = lp.user_id
     where lp.event_id = v_event.id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.gym_event_disqualify(p_event_id uuid, p_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event  public.live_events;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_event from public.live_events where id = p_event_id;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if public._event_role(v_event) is null or v_event.managed_by <> 'gym' then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if v_event.status in ('revealed', 'settled', 'archived') then
    raise exception 'The results are final — contact POWR' using errcode = 'P0001';
  end if;
  if length(v_reason) not between 3 and 200 then
    raise exception 'Say why (3–200 characters) — POWR sees the reason' using errcode = 'P0001';
  end if;
  update public.live_event_participants
     set disqualified_at = now(), disqualified_by = auth.uid()
   where event_id = p_event_id and user_id = p_user_id and disqualified_at is null;
  if not found then
    raise exception 'They''re not in this event' using errcode = 'P0001';
  end if;
  perform public._gym_audit(v_event.venue_partner_id, 'gym_event_disqualified',
    jsonb_build_object('event_id', v_event.id, 'user_id', p_user_id, 'reason', v_reason));
  perform public._gym_event_notify(v_event, 'disqualified', jsonb_build_object('user_id', p_user_id, 'reason', v_reason));
  return public.gym_event_roster(p_event_id);
end;
$$;

create or replace function public.gym_event_reinstate(p_event_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
begin
  select * into v_event from public.live_events where id = p_event_id;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if public._event_role(v_event) is null or v_event.managed_by <> 'gym' then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if v_event.status in ('revealed', 'settled', 'archived') then
    raise exception 'The results are final — contact POWR' using errcode = 'P0001';
  end if;
  update public.live_event_participants
     set disqualified_at = null, disqualified_by = null
   where event_id = p_event_id and user_id = p_user_id and disqualified_at is not null;
  perform public._gym_audit(v_event.venue_partner_id, 'gym_event_reinstated',
    jsonb_build_object('event_id', v_event.id, 'user_id', p_user_id));
  return public.gym_event_roster(p_event_id);
end;
$$;

-- ── POWR's side ─────────────────────────────────────────────────────────────
create or replace function public.admin_review_gym_event(p_event_id uuid, p_decision text, p_note text default null, p_trust boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select * into v_event from public.live_events where id = p_event_id for update;
  if not found or v_event.managed_by <> 'gym' then
    raise exception 'Gym event not found' using errcode = 'P0002';
  end if;
  if v_event.review_status is distinct from 'pending' then
    raise exception 'This event isn''t waiting for review' using errcode = 'P0001';
  end if;

  if p_decision = 'approve' then
    if v_event.window_start_at <= now() then
      raise exception 'It starts in the past now — reject it with a note so the gym can move the date' using errcode = 'P0001';
    end if;
    update public.live_events
       set status = 'scheduled', review_status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(),
           review_note = nullif(btrim(coalesce(p_note, '')), ''), published_at = now()
     where id = p_event_id
    returning * into v_event;
    if p_trust then
      update public.gym_portal_settings
         set trusted_at = coalesce(trusted_at, now()), trusted_by = coalesce(trusted_by, auth.uid()), updated_at = now()
       where partner_id = v_event.venue_partner_id;
    end if;
  elsif p_decision = 'reject' then
    if length(btrim(coalesce(p_note, ''))) < 3 then
      raise exception 'Tell the gym what to change' using errcode = 'P0001';
    end if;
    update public.live_events
       set review_status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(), review_note = btrim(p_note)
     where id = p_event_id
    returning * into v_event;
  else
    raise exception 'Decision is approve or reject' using errcode = 'P0001';
  end if;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'gym_event_reviewed', 'live_event', p_event_id::text,
          jsonb_build_object('decision', p_decision, 'note', p_note, 'trusted', p_decision = 'approve' and p_trust));
  return public._gym_event_json(v_event, 'admin');
end;
$$;

create or replace function public.admin_pull_event(p_event_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason — the gym sees it' using errcode = 'P0001';
  end if;
  update public.live_events
     set status = 'archived', hidden = true,
         review_status = case when managed_by = 'gym' then 'pulled' else review_status end,
         review_note = btrim(p_reason), reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_event_id
  returning * into v_event;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
  values (auth.uid(), 'live_event_pulled', 'live_event', p_event_id::text, jsonb_build_object('reason', btrim(p_reason)));
  return public._gym_event_json(v_event, 'admin');
end;
$$;

-- ── Attendance, paid by the clock ───────────────────────────────────────────
-- Registrants the venue geofence saw during the doors window, once each.
create or replace function public._live_event_pay_attendance_auto(p_event public.live_events)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_band record;
  v_uid  uuid;
  v_paid integer := 0;
begin
  select * into v_band from public._live_event_door_band(p_event);
  for v_uid in
    select lp.user_id
      from public.live_event_participants lp
     where lp.event_id = p_event.id
       and lp.disqualified_at is null
       and exists (
         select 1 from public.gym_visits gv
          where gv.user_id = lp.user_id
            and gv.partner_id = p_event.venue_partner_id
            and gv.started_at < coalesce(v_band.band_to, now())
            and coalesce(gv.ended_at, now()) >= v_band.band_from
       )
  loop
    if public._live_event_award_attendance(p_event, v_uid, 'auto', null) then
      v_paid := v_paid + 1;
    end if;
  end loop;
  update public.live_events set attendance_paid_at = now() where id = p_event.id;
  return v_paid;
end;
$$;

-- ── The clock ───────────────────────────────────────────────────────────────
-- Re-stated from prod (pg_get_functiondef, 2026-09-24); the first two steps
-- are unchanged, the rest are new. Every automatic move is audit-logged with
-- by = 'auto'.
create or replace function public.live_event_auto_transitions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer := 0;
  r   record;
  v_x integer;
begin
  -- scheduled → live: the scoring window has opened and not yet closed.
  for r in
    update public.live_events e
       set status = 'live'
     where e.auto_lifecycle
       and e.status = 'scheduled'
       and now() >= e.window_start_at
       and now() <  e.window_end_at
    returning e.id
  loop
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (null, 'live_event_status', 'live_event', r.id::text,
            jsonb_build_object('from', 'scheduled', 'to', 'live', 'by', 'auto'));
    v_n := v_n + 1;
  end loop;

  -- live → locked: the lock time has passed. The app already treats the
  -- board as sealed from lock_at at read time; this moves the column so
  -- the admin panel agrees and Settle/Reveal become available.
  for r in
    update public.live_events e
       set status = 'locked'
     where e.auto_lifecycle
       and e.status = 'live'
       and e.lock_at is not null
       and now() >= e.lock_at
    returning e.id
  loop
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (null, 'live_event_status', 'live_event', r.id::text,
            jsonb_build_object('from', 'live', 'to', 'locked', 'by', 'auto'));
    v_n := v_n + 1;
  end loop;

  -- Freeze the results once late wearable syncs have had their grace.
  for r in
    select e.id from public.live_events e
     where e.auto_settle
       and e.status = 'locked'
       and e.results_cut_at is null
       and now() >= coalesce(e.lock_at, e.window_end_at) + make_interval(hours => e.settle_grace_hours)
  loop
    v_x := public._live_event_cut_results(r.id);
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (null, 'live_event_settled', 'live_event', r.id::text,
            jsonb_build_object('results', v_x, 'by', 'auto'));
    v_n := v_n + 1;
  end loop;

  -- Reveal: at the gym's chosen time, or as the safety net if nobody did.
  for r in
    select e.id,
           case when e.reveal_at is not null and now() >= e.reveal_at then 'scheduled' else 'safety_net' end as why
      from public.live_events e
     where e.auto_settle
       and e.status = 'locked'
       and (
         (e.reveal_at is not null and now() >= e.reveal_at)
         or (e.auto_reveal_after_hours is not null
             and now() >= coalesce(e.lock_at, e.window_end_at)
                          + make_interval(hours => e.settle_grace_hours + e.auto_reveal_after_hours))
       )
  loop
    perform public._live_event_cut_results(r.id);
    update public.live_events set status = 'revealed', revealed_at = now() where id = r.id;
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (null, 'live_event_status', 'live_event', r.id::text,
            jsonb_build_object('from', 'locked', 'to', 'revealed', 'by', 'auto', 'why', r.why));
    v_n := v_n + 1;
  end loop;

  -- Attendance reward, half an hour after the doors close.
  for r in
    select e as ev, e.id, e.attendance_bonus_points from public.live_events e
     where e.managed_by = 'gym'
       and e.attendance_bonus_points > 0
       and e.attendance_paid_at is null
       and e.doors_close_at is not null
       and now() >= e.doors_close_at + interval '30 minutes'
       and e.status in ('live', 'locked', 'revealed', 'settled')
  loop
    v_x := public._live_event_pay_attendance_auto(r.ev);
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (null, 'live_event_attendance_paid', 'live_event', r.id::text,
            jsonb_build_object('paid', v_x, 'points', r.attendance_bonus_points, 'by', 'auto'));
    v_n := v_n + 1;
  end loop;

  -- Wrap-up: a revealed gym event is settled three days later.
  for r in
    update public.live_events e
       set status = 'settled'
     where e.managed_by = 'gym'
       and e.status = 'revealed'
       and e.revealed_at < now() - interval '3 days'
    returning e.id
  loop
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (null, 'live_event_status', 'live_event', r.id::text,
            jsonb_build_object('from', 'revealed', 'to', 'settled', 'by', 'auto'));
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

revoke all on function public._live_event_pay_attendance_auto(public.live_events) from public, anon, authenticated;
revoke all on function public.live_event_auto_transitions() from public, anon, authenticated;

-- ── Grants ──────────────────────────────────────────────────────────────────
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.gym_list_events(uuid)',
    'public.gym_event_detail(uuid)',
    'public.gym_create_event(uuid, text, jsonb)',
    'public.gym_update_event(uuid, jsonb)',
    'public.gym_publish_event(uuid)',
    'public.gym_withdraw_event(uuid)',
    'public.gym_delete_event(uuid)',
    'public.gym_cancel_event(uuid)',
    'public.gym_reveal_event(uuid)',
    'public.gym_set_reveal_at(uuid, timestamptz)',
    'public.gym_event_board(uuid)',
    'public.gym_event_roster(uuid)',
    'public.gym_event_disqualify(uuid, uuid, text)',
    'public.gym_event_reinstate(uuid, uuid)',
    'public.admin_review_gym_event(uuid, text, text, boolean)',
    'public.admin_pull_event(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
