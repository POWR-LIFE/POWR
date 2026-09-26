-- =============================================================
-- Gym-run events, part 4: the step-by-step builder's choices
-- =============================================================
-- Jamie, 2026-09-25: gym events need to be "step by step", with more of what
-- the admin editor has: "simple yes, but still powerful". A gym now chooses,
-- within what each format offers:
--   * how long it runs (day_choices), and for a finale format when the night
--     starts and how long it lasts (night_hour_choices / night_length_choices);
--   * what counts: every verified workout, only sessions at the gym, or the
--     activities it picks (walking, which includes daily steps, only when
--     picked; sleep never);
--   * how many places the leaderboard shows (board_choices);
--   * prize photos ({ label, image_url }, uploaded to POWR storage);
--   * an event logo, and whether it stands in for the name (as the admin
--     editor's logo_url / logo_only);
--   * a booking link for its own booking page;
--   and it already could: name, first day, prizes, rules, headline, promo
--   picture or video, finale bonus preset, nearby radius, pushes, reveal time.
-- Still POWR-only: points beyond the presets, invite rewards, entry gates,
-- manual workouts, streak and other bonuses, global scope, custom times.
--
-- Rules: the house rules members read first are now WRITTEN FROM THE CHOICES
-- (_gym_event_house_rules), so they can never disagree with how the board
-- scores: a gym that adds walking or runs 10 days must not publish "walking
-- doesn't count" or "for seven days". The gym's own lines live apart in
-- live_events.own_rules; rules = house || own, rewritten whenever what counts
-- or the gym's lines change. event_templates.default_rules no longer feeds
-- gym events.
--
-- Also here: gym_preview_event (the builder's live preview: dates and rules,
-- nothing saved), a reveal time that re-dating leaves out of range is cleared,
-- a gym's booking link can't carry {email} (the app fills it in when a member
-- taps Book, and gyms don't get members' email addresses), get_live_event
-- says who runs the event (managed_by), so the app stops promising a booking
-- link for gym events that don't use one, and the event pushes' payload
-- carries the activities picked, so the announcement never says "every
-- verified workout counts" when only runs do (send-push-notification ships
-- with this: _shared/eventPushCopy.ts reads it).

alter table public.event_templates
  add column if not exists day_choices          integer[] not null default '{}',
  add column if not exists night_hour_choices   integer[] not null default '{}',
  add column if not exists night_length_choices integer[] not null default '{}',
  add column if not exists board_choices        integer[] not null default '{10,20,50}';

update public.event_templates set day_choices = '{14,21,28,42}'                                                  where key = 'monthly';
update public.event_templates set day_choices = '{2,3,4}'                                                        where key = 'sprint';
update public.event_templates set day_choices = '{5,7,10}', night_hour_choices = '{17,18,19,20}', night_length_choices = '{2,3,4}' where key = 'finale';

-- The formats' blurbs describe their shape, not a fixed length: the gym picks that now.
update public.event_templates set blurb = 'Weeks of sessions at {gym}: whoever trains there most wins. Winners revealed after the last day.' where key = 'monthly';
update public.event_templates set blurb = 'A short, sharp few days of verified workouts, anywhere. Fridays make a good start.'                where key = 'sprint';
update public.event_templates set blurb = 'Around a week of verified workouts anywhere, then a night at {gym} where the winners are revealed.' where key = 'finale';

alter table public.live_events add column if not exists own_rules jsonb;
comment on column public.live_events.own_rules is
  'Gym-run events: the gym''s own rule lines. rules = the house rules written from the event''s choices (_gym_event_house_rules) followed by these.';

-- Any gym event saved before this: its own lines are whatever followed the
-- template's rules.
update public.live_events e
   set own_rules = coalesce((select jsonb_agg(r order by o)
                               from jsonb_array_elements(coalesce(e.rules, '[]'::jsonb)) with ordinality x(r, o)
                              where o > coalesce((select jsonb_array_length(t.default_rules)
                                                    from public.event_templates t where t.key = e.template_key), 0)),
                            '[]'::jsonb)
 where e.managed_by = 'gym' and e.own_rules is null;

-- Every date of an event from its template, its first day (local midnight)
-- and the gym's choices: a length from the template's day_choices, and for a
-- finale format the night's start hour and length. Without a finale night the
-- board seals when scoring ends; with one, scoring ends at midnight before the
-- night, the board stays sealed through the day and the doors open that evening.
drop function if exists public._gym_event_dates(public.event_templates, date, text);
create or replace function public._gym_event_dates(
  p_template public.event_templates, p_start date, p_tz text,
  p_days integer default null, p_night_hour integer default null, p_night_hours integer default null,
  out window_start_at timestamptz, out window_end_at timestamptz, out lock_at timestamptz,
  out doors_open_at timestamptz, out doors_close_at timestamptz
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_end  date := p_start + coalesce(p_days, p_template.duration_days);
  v_hour integer := coalesce(p_night_hour, p_template.night_start_hour);
  v_len  integer := coalesce(p_night_hours, p_template.night_hours);
begin
  window_start_at := p_start::timestamp at time zone p_tz;
  window_end_at   := v_end::timestamp at time zone p_tz;
  lock_at         := window_end_at;
  if p_template.night_start_hour is not null then
    doors_open_at  := (v_end::timestamp + make_interval(hours => v_hour)) at time zone p_tz;
    doors_close_at := (v_end::timestamp + make_interval(hours => v_hour + v_len)) at time zone p_tz;
  end if;
end;
$$;
revoke all on function public._gym_event_dates(public.event_templates, date, text, integer, integer, integer) from public, anon, authenticated;

-- The rules every member reads first, written from what the gym picked so
-- they always match how _live_event_ledger scores: what counts, the finale
-- night, what never counts, fair play. Walking counts only when it's one of
-- the activities picked (create and update keep count_walking to that).
create or replace function public._gym_event_house_rules(
  p_template public.event_templates, p_gym text, p_venue_only boolean, p_acts text[]
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_walk boolean := coalesce('walking' = any (p_acts), false);
  v_l    text[];
  v_la   text[];
  v_list text;
  v_all  text;
  v_out  text[] := '{}';
begin
  -- The activities picked, in the order the builder shows them; walking
  -- apart, because it brings daily steps with it.
  select coalesce(array_agg(case a when 'hiit' then 'HIIT' else a end order by o), '{}') into v_l
    from unnest(array['gym', 'running', 'cycling', 'swimming', 'hiit', 'yoga', 'sports', 'dance']) with ordinality c(a, o)
   where a = any (coalesce(p_acts, '{}'));
  v_la := v_l || case when v_walk then array['walking'] else '{}'::text[] end;
  v_list := case cardinality(v_l)
              when 0 then null
              when 1 then v_l[1]
              else array_to_string(v_l[1:cardinality(v_l) - 1], ', ') || ' and ' || v_l[cardinality(v_l)]
            end;
  v_all := case cardinality(v_la)
             when 0 then null
             when 1 then v_la[1]
             else array_to_string(v_la[1:cardinality(v_la) - 1], ', ') || ' and ' || v_la[cardinality(v_la)]
           end;

  v_out := array_append(v_out, case
    when p_venue_only and v_all is not null then 'Only ' || v_all || ' sessions at {gym} count. Check in with POWR when you arrive.'
    when p_venue_only    then 'Only sessions at {gym} count. Check in with POWR when you arrive.'
    when p_acts is null  then 'Any verified workout counts, wherever you train.'
    when v_list is null  then 'Only walking counts, including your daily steps.'
    when v_walk          then 'Only verified ' || v_list || ' workouts and walking count, including your daily steps.'
    else                      'Only verified ' || v_list || ' workouts count, wherever you train.'
  end);
  if p_template.night_start_hour is not null then
    v_out := array_append(v_out, 'The board is sealed after the last day and revealed at the finale night at {gym}.');
  end if;
  v_out := array_append(v_out, case
    when p_acts is null and not p_venue_only then 'Manually logged workouts and walking don''t count.'
    else 'Manually logged workouts don''t count.'
  end);
  -- POWR's own gym is called POWR.
  v_out := array_append(v_out, case when lower(btrim(coalesce(p_gym, ''))) = 'powr'
                                    then 'Anyone gaming the board can be removed by POWR.'
                                    else 'Anyone gaming the board can be removed by {gym} or POWR.' end);

  return (select jsonb_agg(replace(r, '{gym}', coalesce(p_gym, 'the gym')) order by o)
            from unnest(v_out) with ordinality t(r, o));
end;
$$;
revoke all on function public._gym_event_house_rules(public.event_templates, text, boolean, text[]) from public, anon, authenticated;

-- What a gym may set, cleaned and checked against its template's choices.
-- The gym's rule lines come back as own_rules; the house rules that lead
-- them are written when the event is saved, from its final choices.
drop function if exists public._gym_event_fields(public.event_templates, jsonb, text);
create or replace function public._gym_event_fields(p_template public.event_templates, p_fields jsonb)
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
  v_img   text;
  v_int   integer;
  i       integer;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'Nothing to save' using errcode = 'P0001';
  end if;

  for v_key in select jsonb_object_keys(p_fields) loop
    if v_key not in ('name', 'start_date', 'prizes', 'rules', 'promo_headline', 'promo_media_url',
                     'points_preset_key', 'audience_radius_km',
                     'duration_days', 'night_start_hour', 'night_hours', 'included_activities',
                     'count_venue_only', 'board_size', 'booking_url', 'logo_url', 'logo_only') then
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
    -- A prize is its words, or { label, image_url } with a photo uploaded here.
    for i in 0 .. v_n - 1 loop
      if jsonb_typeof(v_arr -> i) = 'object' then
        v_text := btrim(coalesce(v_arr -> i ->> 'label', ''));
        v_img  := nullif(btrim(coalesce(v_arr -> i ->> 'image_url', '')), '');
      else
        v_text := btrim(coalesce(v_arr ->> i, ''));
        v_img  := null;
      end if;
      if length(v_text) not between 2 and 60 then
        raise exception 'Each prize needs 2–60 characters' using errcode = 'P0001';
      end if;
      if v_img is not null
         and v_img not like 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-images/%' then
        raise exception 'Upload prize photos here rather than linking to them' using errcode = 'P0001';
      end if;
      v_rules := v_rules || jsonb_build_array(
        jsonb_build_object('rank', i + 1, 'label', v_text)
        || case when v_img is null then '{}'::jsonb else jsonb_build_object('image_url', v_img) end);
    end loop;
    v_out := v_out || jsonb_build_object('prizes', v_rules);
  end if;

  if p_fields ? 'rules' then
    v_arr := p_fields -> 'rules';
    if jsonb_typeof(v_arr) = 'null' then
      v_arr := '[]'::jsonb;
    end if;
    if jsonb_typeof(v_arr) <> 'array' or jsonb_array_length(v_arr) > 8 then
      raise exception 'Add up to 8 rules of your own' using errcode = 'P0001';
    end if;
    v_rules := '[]'::jsonb;
    for i in 0 .. jsonb_array_length(v_arr) - 1 loop
      v_text := btrim(coalesce(v_arr ->> i, ''));
      if v_text = '' then continue; end if;
      if length(v_text) > 200 then
        raise exception 'Keep each rule under 200 characters' using errcode = 'P0001';
      end if;
      v_rules := v_rules || to_jsonb(v_text);
    end loop;
    v_out := v_out || jsonb_build_object('own_rules', v_rules);
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

  -- How long, and (finale formats) when the night starts and how long it runs:
  -- only the choices the template offers.
  if p_fields ? 'duration_days' then
    v_int := (p_fields ->> 'duration_days')::integer;
    if not (v_int = any (p_template.day_choices)) then
      raise exception 'Pick one of the lengths offered' using errcode = 'P0001';
    end if;
    v_out := v_out || jsonb_build_object('duration_days', v_int);
  end if;
  if p_fields ? 'night_start_hour' then
    v_int := (p_fields ->> 'night_start_hour')::integer;
    if p_template.night_start_hour is null or not (v_int = any (p_template.night_hour_choices)) then
      raise exception 'Pick one of the finale night times offered' using errcode = 'P0001';
    end if;
    v_out := v_out || jsonb_build_object('night_start_hour', v_int);
  end if;
  if p_fields ? 'night_hours' then
    v_int := (p_fields ->> 'night_hours')::integer;
    if p_template.night_start_hour is null or not (v_int = any (p_template.night_length_choices)) then
      raise exception 'Pick one of the finale night lengths offered' using errcode = 'P0001';
    end if;
    v_out := v_out || jsonb_build_object('night_hours', v_int);
  end if;

  -- What counts: every verified workout (null), or the activities picked.
  -- Sleep never counts; walking (daily steps included) only when picked.
  if p_fields ? 'included_activities' then
    v_arr := p_fields -> 'included_activities';
    if v_arr is null or jsonb_typeof(v_arr) = 'null' then
      v_out := v_out || jsonb_build_object('included_activities', null);
    else
      if jsonb_typeof(v_arr) <> 'array' or jsonb_array_length(v_arr) = 0 then
        raise exception 'Pick at least one activity' using errcode = 'P0001';
      end if;
      if exists (select 1 from jsonb_array_elements_text(v_arr) a
                  where a not in ('gym', 'running', 'cycling', 'swimming', 'hiit', 'yoga', 'sports', 'dance', 'walking')) then
        raise exception 'One of those activities can''t count towards an event' using errcode = 'P0001';
      end if;
      v_out := v_out || jsonb_build_object('included_activities',
        (select jsonb_agg(distinct a) from jsonb_array_elements_text(v_arr) a));
    end if;
  end if;

  if p_fields ? 'count_venue_only' then
    if jsonb_typeof(p_fields -> 'count_venue_only') <> 'boolean' then
      raise exception 'Say whether only sessions at your gym count' using errcode = 'P0001';
    end if;
    v_out := v_out || jsonb_build_object('count_venue_only', (p_fields ->> 'count_venue_only')::boolean);
  end if;

  if p_fields ? 'board_size' then
    v_int := (p_fields ->> 'board_size')::integer;
    if not (v_int = any (p_template.board_choices)) then
      raise exception 'Pick one of the leaderboard sizes offered' using errcode = 'P0001';
    end if;
    v_out := v_out || jsonb_build_object('board_size', v_int);
  end if;

  -- The gym's own booking page. The app fills {name} in when a member taps
  -- Book (lib/eventBookingLink.ts); never {email} for a gym's link, because
  -- gyms don't get members' email addresses.
  if p_fields ? 'booking_url' then
    v_text := nullif(btrim(coalesce(p_fields ->> 'booking_url', '')), '');
    if v_text is not null and (v_text !~ '^https://[^[:space:]]+\.[^[:space:]]+$' or length(v_text) > 300) then
      raise exception 'Add a booking link starting https://' using errcode = 'P0001';
    end if;
    if v_text is not null and position('{email}' in lower(v_text)) > 0 then
      raise exception 'A booking link can''t ask for members'' email addresses' using errcode = 'P0001';
    end if;
    v_out := v_out || jsonb_build_object('booking_url', v_text);
  end if;

  -- The event's own logo (uploaded here), and whether it stands in for the
  -- name on the app's event cards.
  if p_fields ? 'logo_url' then
    v_text := nullif(btrim(coalesce(p_fields ->> 'logo_url', '')), '');
    if v_text is not null
       and v_text not like 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-images/%' then
      raise exception 'Upload the logo here rather than linking to it' using errcode = 'P0001';
    end if;
    v_out := v_out || jsonb_build_object('logo_url', v_text);
  end if;
  if p_fields ? 'logo_only' then
    if jsonb_typeof(p_fields -> 'logo_only') <> 'boolean' then
      raise exception 'Say whether the logo stands in for the name' using errcode = 'P0001';
    end if;
    v_out := v_out || jsonb_build_object('logo_only', (p_fields ->> 'logo_only')::boolean);
  end if;

  return v_out;
end;
$$;
revoke all on function public._gym_event_fields(public.event_templates, jsonb) from public, anon, authenticated;

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
                                                     'radius_choices', t.radius_choices)
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
    'display_token',      p_event.display_token,
    'participants',       (select count(*) from public.live_event_participants lp
                            where lp.event_id = p_event.id and lp.disqualified_at is null),
    'disqualified',       (select count(*) from public.live_event_participants lp
                            where lp.event_id = p_event.id and lp.disqualified_at is not null)
  )
  -- The builder's choices, the dates read back in the gym's own time.
  || jsonb_build_object(
    'board_size',         p_event.board_size,
    'included_activities', p_event.included_activities,
    'count_venue_only',   p_event.count_venue_only,
    'count_walking',      p_event.count_walking,
    'own_rules',          coalesce(p_event.own_rules, '[]'::jsonb),
    'booking_url',        p_event.booking_url,
    'logo_url',           p_event.logo_url,
    'logo_only',          p_event.logo_only,
    'duration_days',      ((p_event.window_end_at at time zone public._gym_tz(p_event.venue_partner_id))::date
                           - (p_event.window_start_at at time zone public._gym_tz(p_event.venue_partner_id))::date),
    'night_start_hour',   extract(hour from p_event.doors_open_at at time zone public._gym_tz(p_event.venue_partner_id))::integer,
    'night_hours',        round(extract(epoch from (p_event.doors_close_at - p_event.doors_open_at)) / 3600)::integer
  )
$$;

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
  v_acts   text[];
  v_venue  boolean;
  v_own    jsonb;
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

  v_f := public._gym_event_fields(v_tpl, coalesce(p_fields, '{}'::jsonb));
  if not (v_f ? 'name') or not (v_f ? 'start_date') or not (v_f ? 'prizes') then
    raise exception 'An event needs a name, a start date and at least one prize' using errcode = 'P0001';
  end if;
  if (v_f ->> 'start_date')::date < (now() at time zone v_tz)::date then
    raise exception 'Pick a start date from today on' using errcode = 'P0001';
  end if;

  select * into v_preset from public.event_point_presets
   where key = coalesce(v_f ->> 'points_preset_key', v_tpl.default_preset);
  select * into d_start, d_end, d_lock, d_open, d_close
    from public._gym_event_dates(v_tpl, (v_f ->> 'start_date')::date, v_tz,
                                 (v_f ->> 'duration_days')::integer, (v_f ->> 'night_start_hour')::integer, (v_f ->> 'night_hours')::integer);
  -- What counts: the gym's pick, else the template's. Walking counts only
  -- when it's one of the activities picked.
  v_acts := case when jsonb_typeof(v_f -> 'included_activities') = 'array'
                 then (select array_agg(a order by a) from jsonb_array_elements_text(v_f -> 'included_activities') a)
                 when v_f ? 'included_activities' then null
                 else v_tpl.included_activities end;
  v_venue := coalesce((v_f ->> 'count_venue_only')::boolean, v_tpl.count_venue_only);
  v_own   := coalesce(v_f -> 'own_rules', '[]'::jsonb);

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
    board_size, prizes, rules, own_rules, promo_headline, promo_media_url, booking_url, logo_url, logo_only,
    attendance_bonus_points, invite_bonus_points, invite_milestone_n, invite_milestone_bonus,
    reward_referrals_on_signup, entry_gate_n, entry_gate_since,
    auto_lifecycle, auto_settle, settle_grace_hours, auto_reveal_after_hours, created_by,
    notify_announce, notify_kickoff, notify_doors, notify_rank_at
  ) values (
    v_slug, v_f ->> 'name', p_partner_id, 'gym', v_tpl.key, v_preset.key, 'draft',
    'opt_in', 'venue', (v_f ->> 'audience_radius_km')::integer, 60,
    d_start, d_end, d_lock, d_open, d_close,
    d_lock,
    v_acts, v_tpl.count_manual,
    case when v_f ? 'included_activities' then coalesce('walking' = any (v_acts), false) else v_tpl.count_walking end,
    v_tpl.count_streak,
    v_venue,
    false, false, false, true,
    coalesce((v_f ->> 'board_size')::integer, v_tpl.board_size), v_f -> 'prizes',
    public._gym_event_house_rules(v_tpl, v_gym, v_venue, v_acts) || v_own, v_own,
    v_f ->> 'promo_headline', v_f ->> 'promo_media_url', v_f ->> 'booking_url',
    v_f ->> 'logo_url', coalesce((v_f ->> 'logo_only')::boolean, false) and v_f ->> 'logo_url' is not null,
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
  v_acts    text[];
  v_start   date;
  v_rules   jsonb;
  v_logo    text;
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
  v_f := public._gym_event_fields(v_tpl, p_fields);

  -- Everything until it starts; only the words and pictures while it runs;
  -- nothing once the board has sealed.
  v_early := v_event.status = 'draft' or (v_event.status = 'scheduled' and now() < v_event.window_start_at);
  for v_key in select jsonb_object_keys(v_f) loop
    if v_early then continue; end if;
    if v_event.status = 'live'
       and v_key in ('name', 'promo_headline', 'promo_media_url', 'booking_url', 'logo_url', 'logo_only') then continue; end if;
    raise exception 'That can''t change once the event has started' using errcode = 'P0001';
  end loop;

  v_tz := public._gym_tz(v_event.venue_partner_id);
  if v_f ?| array['start_date', 'duration_days', 'night_start_hour', 'night_hours'] then
    -- Whatever isn't being changed keeps its current value.
    v_start := coalesce((v_f ->> 'start_date')::date, (v_event.window_start_at at time zone v_tz)::date);
    if v_f ? 'start_date' then
      if v_event.status <> 'draft' and (v_start::timestamp at time zone v_tz) < now() + interval '2 hours' then
        raise exception 'A published event needs to start at least 2 hours from now' using errcode = 'P0001';
      end if;
      if v_start < (now() at time zone v_tz)::date then
        raise exception 'Pick a start date from today on' using errcode = 'P0001';
      end if;
    end if;
    select * into d_start, d_end, d_lock, d_open, d_close
      from public._gym_event_dates(v_tpl, v_start, v_tz,
             coalesce((v_f ->> 'duration_days')::integer,
                      (v_event.window_end_at at time zone v_tz)::date - (v_event.window_start_at at time zone v_tz)::date),
             coalesce((v_f ->> 'night_start_hour')::integer,
                      extract(hour from v_event.doors_open_at at time zone v_tz)::integer),
             coalesce((v_f ->> 'night_hours')::integer,
                      round(extract(epoch from (v_event.doors_close_at - v_event.doors_open_at)) / 3600)::integer));
    v_dated := true;
  end if;

  -- What counts after this save, and the house rules written from it:
  -- rewritten whenever what counts or the gym's own lines change.
  v_acts := case when not (v_f ? 'included_activities') then v_event.included_activities
                 when jsonb_typeof(v_f -> 'included_activities') = 'array'
                 then (select array_agg(a order by a) from jsonb_array_elements_text(v_f -> 'included_activities') a) end;
  if v_f ?| array['own_rules', 'included_activities', 'count_venue_only'] then
    v_rules := public._gym_event_house_rules(v_tpl, v_gym,
                 coalesce((v_f ->> 'count_venue_only')::boolean, v_event.count_venue_only), v_acts)
               || coalesce(v_f -> 'own_rules', v_event.own_rules, '[]'::jsonb);
  end if;
  v_logo := case when v_f ? 'logo_url' then v_f ->> 'logo_url' else v_event.logo_url end;
  if v_f ? 'points_preset_key' then
    select * into v_preset from public.event_point_presets where key = v_f ->> 'points_preset_key';
  end if;

  update public.live_events e set
    name                    = coalesce(v_f ->> 'name', e.name),
    prizes                  = coalesce(v_f -> 'prizes', e.prizes),
    rules                   = coalesce(v_rules, e.rules),
    own_rules               = coalesce(v_f -> 'own_rules', e.own_rules),
    promo_headline          = case when v_f ? 'promo_headline'  then v_f ->> 'promo_headline'  else e.promo_headline end,
    promo_media_url         = case when v_f ? 'promo_media_url' then v_f ->> 'promo_media_url' else e.promo_media_url end,
    audience_radius_km      = case when v_f ? 'audience_radius_km' then (v_f ->> 'audience_radius_km')::integer else e.audience_radius_km end,
    included_activities     = v_acts,
    count_walking           = case when v_f ? 'included_activities' then coalesce('walking' = any (v_acts), false) else e.count_walking end,
    count_venue_only        = coalesce((v_f ->> 'count_venue_only')::boolean, e.count_venue_only),
    board_size              = coalesce((v_f ->> 'board_size')::integer, e.board_size),
    booking_url             = case when v_f ? 'booking_url' then v_f ->> 'booking_url' else e.booking_url end,
    logo_url                = v_logo,
    logo_only               = coalesce((v_f ->> 'logo_only')::boolean, e.logo_only) and v_logo is not null,
    points_preset_key       = coalesce(v_preset.key, e.points_preset_key),
    attendance_bonus_points = coalesce(v_preset.attendance_bonus_points, e.attendance_bonus_points),
    window_start_at         = case when v_dated then d_start else e.window_start_at end,
    window_end_at           = case when v_dated then d_end   else e.window_end_at end,
    lock_at                 = case when v_dated then d_lock  else e.lock_at end,
    eligibility_cutoff_at   = case when v_dated then d_lock  else e.eligibility_cutoff_at end,
    doors_open_at           = case when v_dated then d_open  else e.doors_open_at end,
    doors_close_at          = case when v_dated then d_close else e.doors_close_at end,
    -- A reveal time the new dates leave outside "after the board seals and
    -- within a week of it" (gym_set_reveal_at) would fire at the wrong moment.
    reveal_at               = case when v_dated and e.reveal_at is not null
                                    and (e.reveal_at < d_lock or e.reveal_at > d_lock + interval '7 days')
                                   then null else e.reveal_at end
  where e.id = p_event_id
  returning * into v_event;

  perform public._gym_audit(v_event.venue_partner_id, 'gym_event_updated',
    jsonb_build_object('event_id', v_event.id, 'fields', (select jsonb_agg(k) from jsonb_object_keys(v_f) k)));
  return public._gym_event_json(v_event, v_role);
end;
$$;

-- The builder's live preview, nothing saved: the dates the server will set
-- and the rules the choices write, checked the way a save checks them.
-- Takes the whole form and reads only what shapes dates and rules.
create or replace function public.gym_preview_event(p_partner_id uuid, p_template_key text, p_fields jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tpl   public.event_templates;
  v_gym   text;
  v_f     jsonb;
  v_acts  text[];
  v_house jsonb;
  d_start timestamptz;
  d_end   timestamptz;
  d_lock  timestamptz;
  d_open  timestamptz;
  d_close timestamptz;
begin
  if public._gym_role(p_partner_id) is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select * into v_tpl from public.event_templates where key = p_template_key;
  if not found then
    raise exception 'Pick a kind of event' using errcode = 'P0001';
  end if;
  select name into v_gym from public.partners where id = p_partner_id;

  v_f := public._gym_event_fields(v_tpl, coalesce(
    (select jsonb_object_agg(key, value) from jsonb_each(coalesce(p_fields, '{}'::jsonb))
      where key in ('start_date', 'duration_days', 'night_start_hour', 'night_hours',
                    'included_activities', 'count_venue_only', 'rules')),
    '{}'::jsonb));
  v_acts := case when jsonb_typeof(v_f -> 'included_activities') = 'array'
                 then (select array_agg(a order by a) from jsonb_array_elements_text(v_f -> 'included_activities') a)
                 when v_f ? 'included_activities' then null
                 else v_tpl.included_activities end;
  v_house := public._gym_event_house_rules(v_tpl, v_gym,
               coalesce((v_f ->> 'count_venue_only')::boolean, v_tpl.count_venue_only), v_acts);
  if v_f ? 'start_date' then
    select * into d_start, d_end, d_lock, d_open, d_close
      from public._gym_event_dates(v_tpl, (v_f ->> 'start_date')::date, public._gym_tz(p_partner_id),
                                   (v_f ->> 'duration_days')::integer, (v_f ->> 'night_start_hour')::integer, (v_f ->> 'night_hours')::integer);
  end if;

  return jsonb_build_object(
    'window_start_at', d_start,
    'window_end_at',   d_end,
    'lock_at',         d_lock,
    'doors_open_at',   d_open,
    'doors_close_at',  d_close,
    'house_rules',     v_house,
    'rules',           v_house || coalesce(v_f -> 'own_rules', '[]'::jsonb)
  );
end;
$$;
revoke all on function public.gym_preview_event(uuid, text, jsonb) from public, anon;
grant execute on function public.gym_preview_event(uuid, text, jsonb) to authenticated;

-- Re-stated from prod (md5 76b5ad42ffd8eb116915fbeac18a0c76, the body in
-- 20260924160000) with one key added: managed_by, so the app can tell a
-- gym's event (booking link only if the gym adds one) from POWR's (the
-- link lands later).
create or replace function public.get_live_event(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_event   public.live_events;
  v_preview boolean := false;
  v_status  text;
begin
  if v_uid is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events
   where slug = p_slug and status <> 'archived';
  if not found then
    return null;
  end if;

  if v_event.status = 'draft' then
    v_preview := public._live_event_previewer(v_event, v_uid);
    if not v_preview then
      return null;
    end if;
  end if;

  v_status := case
    when not v_preview then v_event.status
    when now() >= v_event.window_start_at and now() < v_event.window_end_at then 'live'
    else 'scheduled'
  end;

  return jsonb_build_object(
    'id',                v_event.id,
    'slug',              v_event.slug,
    'name',              v_event.name,
    'logo_url',          v_event.logo_url,
    'logo_only',         v_event.logo_only,
    'status',            v_status,
    'scope',             v_event.scope,
    'audience_mode',     v_event.audience_mode,
    'managed_by',        v_event.managed_by,
    'window_start_at',   v_event.window_start_at,
    'window_end_at',     v_event.window_end_at,
    'lock_at',           v_event.lock_at,
    'doors_open_at',     v_event.doors_open_at,
    'doors_close_at',    v_event.doors_close_at,
    'is_locked',         (v_event.status = 'locked'
                          or v_event.hidden
                          or (v_event.lock_at is not null and now() >= v_event.lock_at)),
    'revealed_at',       v_event.revealed_at,
    'prizes',            v_event.prizes,
    'board_size',        v_event.board_size,
    'invite_bonus_points',    v_event.invite_bonus_points,
    'invite_milestone_n',     v_event.invite_milestone_n,
    'invite_milestone_bonus', v_event.invite_milestone_bonus,
    'reward_referrals_on_signup', v_event.reward_referrals_on_signup,
    'attendance_bonus_points', v_event.attendance_bonus_points,
    'conversion_deadline_at', v_event.conversion_deadline_at,
    'promo_headline',    v_event.promo_headline,
    'promo_media_url',   v_event.promo_media_url,
    'rules',             coalesce(v_event.rules, '[]'::jsonb),
    'booking_url',       v_event.booking_url,
    'venue',             (select jsonb_build_object(
                            'id',       p.id,
                            'name',     p.name,
                            'logo_url', p.logo_url,
                            'logo_bg',  p.logo_bg,
                            'address',  p.address,
                            'lat',      nullif(p.locations->0->>'lat', '')::double precision,
                            'lng',      nullif(p.locations->0->>'lng', '')::double precision
                          ) from public.partners p
                          where p.id = v_event.venue_partner_id),
    'is_preview',        v_preview,
    'viewer',            public._live_event_viewer(v_event, v_uid)
  );
end;
$$;

-- Re-stated from prod (md5 db7c21971699cf9cf9731b8856aecdc8, the body in
-- 20260924220000) with 'activities' added: an event that counts only the
-- activities the gym picked must not be announced as "every verified workout
-- counts" (_shared/eventPushCopy.ts reads it).
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
    'activities',    to_jsonb(p_event.included_activities),
    'attendance',    p_event.attendance_bonus_points
  )
$$;
