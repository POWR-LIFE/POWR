-- =============================================================
-- Partner prizes: a gym picks a POWR brand reward as an event prize
-- =============================================================
-- Jamie, 2026-09-26: "allowing the gyms to be able to purchase rewards at
-- discount … a single promo code when needed … which they can attach to
-- events." Decided: included with every package that runs events, up to
-- three partner prizes per event, POWR settles with brands.
--
-- How it works
--   * A brand (or POWR, in the admin reward editor) marks a reward
--     `event_prize`. It must have a code to give: a pool with stock, or a
--     shared promo code. Affiliate links are not prizes.
--   * The builder's Prizes step offers the catalogue (gym_prize_catalogue).
--     A partner prize's words and picture come from the reward, never the
--     gym: _gym_event_fields stores {rank, label, image_url, reward_id}.
--   * At the reveal, whoever pressed it, _live_event_issue_prizes gives each
--     winner their code exactly as a redemption at zero points: the same
--     wallet receipt (title, brand, picture, code, checkout link), the same
--     receipt email (the redemptions insert trigger), the same brand
--     webhook. live_event_prize_codes records it once per rank, so a second
--     reveal or a re-run can never issue twice.
--   * The reveal push adds "Your prize is in your Wallet." for a winner with
--     a partner prize (notify_live_event_revealed → prize_in_wallet).
--   * The event page shows the gym the brand, the winner and the code, so
--     the front desk can read it out; the winner has it in the app anyway.
-- _gym_event_fields, _gym_event_json and notify_live_event_revealed are
-- re-stated from prod (md5 7bf2a5b8…, 7b88dcaa…, 8d52cf1a…).

-- ── The reward's side ───────────────────────────────────────────────────
alter table public.rewards add column if not exists event_prize boolean not null default false;
comment on column public.rewards.event_prize is 'Gyms may pick this reward as a prize for their events; the winner''s code is issued at the reveal.';

-- Who won what: one code per rank per event, issued once.
create table if not exists public.live_event_prize_codes (
  event_id      uuid not null references public.live_events(id) on delete cascade,
  rank          integer not null,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  reward_id     uuid not null references public.rewards(id),
  redemption_id uuid references public.redemptions(id) on delete set null,
  code          text not null,
  issued_at     timestamptz not null default now(),
  primary key (event_id, rank)
);
create index if not exists live_event_prize_codes_user_idx on public.live_event_prize_codes (user_id);
alter table public.live_event_prize_codes enable row level security;
revoke all on table public.live_event_prize_codes from public, anon, authenticated;
comment on table public.live_event_prize_codes is 'Partner prizes issued at a live event''s reveal: the winner, the reward, the code and the wallet receipt, once per rank.';

-- "Tribe · 20% off": the words a partner prize carries, wherever prizes show.
create or replace function public._reward_prize_label(r public.rewards)
returns text
language sql
immutable
set search_path = public
as $$
  select left(
    case when nullif(btrim(coalesce(r.brand_name, '')), '') is not null
         then btrim(r.brand_name) || ' · ' else '' end
    || coalesce(nullif(btrim(coalesce(r.value_label, '')), ''), r.title), 60)
$$;
revoke all on function public._reward_prize_label(public.rewards) from public, anon, authenticated;

-- A reward can be a prize when there is a code to give: a shared promo
-- code, or a pool with stock. An affiliate link is an offer, not a prize.
create or replace function public._reward_offerable(r public.rewards)
returns boolean
language sql
stable
set search_path = public
as $$
  select r.active
     and r.event_prize
     and r.integration_type <> 'AFFILIATE'
     and (nullif(btrim(coalesce(r.promo_code, '')), '') is not null
          or exists (select 1 from public.redemption_codes c
                      where c.reward_id = r.id and c.status = 'available' and c.expires_at > now()))
$$;
revoke all on function public._reward_offerable(public.rewards) from public, anon, authenticated;

-- What a gym can pick from.
create or replace function public.gym_prize_catalogue(p_partner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public._gym_role(p_partner_id) is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',              r.id,
             'brand_name',      r.brand_name,
             'title',           r.title,
             'offer',           r.offer,
             'value_label',     r.value_label,
             'image_url',       r.image_url,
             'hero_image_url',  r.hero_image_url,
             'brand_color',     r.brand_color,
             'reward_kind',     r.reward_kind,
             'terms',           r.terms,
             'code_expiry_days', r.code_expiry_days,
             'label',           public._reward_prize_label(r),
             -- Codes left in the pool; null for a shared code, which never runs out.
             'available',       case when nullif(btrim(coalesce(r.promo_code, '')), '') is not null then null
                                     else (select count(*) from public.redemption_codes c
                                            where c.reward_id = r.id and c.status = 'available' and c.expires_at > now()) end
           ) order by r.brand_name, r.sort_order, r.title)
      from public.rewards r
     where public._reward_offerable(r)
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.gym_prize_catalogue(uuid) from public, anon;
grant execute on function public.gym_prize_catalogue(uuid) to authenticated;

-- ── The builder's fields: a prize may be a partner reward ───────────────
create or replace function public._gym_event_fields(p_template public.event_templates, p_fields jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_out    jsonb := '{}'::jsonb;
  v_key    text;
  v_text   text;
  v_arr    jsonb;
  v_rules  jsonb;
  v_n      integer;
  v_img    text;
  v_int    integer;
  v_rid    text;
  v_reward public.rewards;
  v_partner_n integer;
  i        integer;
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
    v_partner_n := 0;
    -- A prize is its words, or { label, image_url } with a photo uploaded
    -- here, or { reward_id } for a POWR partner prize, which names and
    -- pictures itself: the winner's code is issued at the reveal.
    for i in 0 .. v_n - 1 loop
      if jsonb_typeof(v_arr -> i) = 'object' then
        v_text := btrim(coalesce(v_arr -> i ->> 'label', ''));
        v_img  := nullif(btrim(coalesce(v_arr -> i ->> 'image_url', '')), '');
        v_rid  := nullif(btrim(coalesce(v_arr -> i ->> 'reward_id', '')), '');
      else
        v_text := btrim(coalesce(v_arr ->> i, ''));
        v_img  := null;
        v_rid  := null;
      end if;
      if v_rid is not null then
        if v_rid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          raise exception 'That partner prize isn''t available right now' using errcode = 'P0001';
        end if;
        select * into v_reward from public.rewards r where r.id = v_rid::uuid;
        if not found or not public._reward_offerable(v_reward) then
          raise exception 'That partner prize isn''t available right now' using errcode = 'P0001';
        end if;
        v_partner_n := v_partner_n + 1;
        if v_partner_n > 3 then
          raise exception 'Up to 3 partner prizes per event' using errcode = 'P0001';
        end if;
        v_rules := v_rules || jsonb_build_array(
          jsonb_build_object('rank', i + 1, 'label', public._reward_prize_label(v_reward), 'reward_id', v_reward.id)
          || case when nullif(btrim(coalesce(v_reward.image_url, '')), '') is null then '{}'::jsonb
                  else jsonb_build_object('image_url', v_reward.image_url) end);
        continue;
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

-- ── The event as the portal reads it: prizes carry their reward and winner ─
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
    -- Each prize, plus its reward (a partner prize) and, after the reveal,
    -- who won it and the code they were given.
    'prizes',             coalesce((
                            select jsonb_agg(
                                     pz
                                     || case when nullif(pz ->> 'reward_id', '') is null then '{}'::jsonb
                                             else coalesce((select jsonb_build_object('reward', jsonb_build_object(
                                                              'brand_name',  r.brand_name,
                                                              'title',       r.title,
                                                              'value_label', r.value_label,
                                                              'image_url',   r.image_url,
                                                              'brand_color', r.brand_color))
                                                              from public.rewards r where r.id = (pz ->> 'reward_id')::uuid), '{}'::jsonb) end
                                     || coalesce((select jsonb_build_object('issued', jsonb_build_object(
                                                     'user_id',   c.user_id,
                                                     'name',      coalesce(pr.display_name, pr.username),
                                                     'code',      c.code,
                                                     'issued_at', c.issued_at))
                                                    from public.live_event_prize_codes c
                                                    join public.profiles pr on pr.id = c.user_id
                                                   where c.event_id = p_event.id and c.rank = (pz ->> 'rank')::integer), '{}'::jsonb)
                                     order by (pz ->> 'rank')::integer)
                              from jsonb_array_elements(coalesce(p_event.prizes, '[]'::jsonb)) pz
                          ), '[]'::jsonb),
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
revoke all on function public._gym_event_json(public.live_events, text) from public, anon, authenticated;

-- ── The reveal: each winner's code, exactly as a redemption at zero points ─
create or replace function public._live_event_issue_prizes(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  e         public.live_events;
  r         record;
  v_reward  public.rewards;
  v_partner public.partners;
  v_shared  text;
  v_code    text;
  v_code_id uuid;
  v_expires timestamptz;
  v_checkout text;
  v_red_id  uuid;
  v_n       integer := 0;
begin
  select * into e from public.live_events where id = p_event_id;
  if not found then
    return 0;
  end if;

  for r in
    select (pz ->> 'rank')::integer      as rank,
           (pz ->> 'reward_id')::uuid    as reward_id,
           res.user_id
      from jsonb_array_elements(coalesce(e.prizes, '[]'::jsonb)) pz
      join public.live_event_results res
        on res.event_id = e.id and res.rank = (pz ->> 'rank')::integer
     where nullif(pz ->> 'reward_id', '') is not null
       and not exists (select 1 from public.live_event_prize_codes c
                        where c.event_id = e.id and c.rank = (pz ->> 'rank')::integer)
     order by 1
  loop
    select * into v_reward from public.rewards where id = r.reward_id;
    if not found or not v_reward.active then
      raise warning '[_live_event_issue_prizes] % rank %: reward gone', e.slug, r.rank;
      continue;
    end if;
    select * into v_partner from public.partners where id = v_reward.partner_id;
    v_expires := now() + make_interval(days => coalesce(v_reward.code_expiry_days, 30));
    v_shared  := nullif(btrim(coalesce(v_reward.promo_code, '')), '');
    v_code    := null;
    v_code_id := null;

    -- A shared promo code is everyone's; otherwise one from the pool, held
    -- for this member, as redeem-reward does.
    if v_shared is not null then
      v_code := v_shared;
    else
      select c.id, c.code into v_code_id, v_code
        from public.claim_pool_code(v_reward.id, r.user_id, v_expires) c;
      if v_code is null then
        raise warning '[_live_event_issue_prizes] % rank %: no code left for %', e.slug, r.rank, v_reward.title;
        continue;
      end if;
    end if;
    v_checkout := case when v_partner.checkout_url_template is not null
                       then replace(v_partner.checkout_url_template, '{code}', v_code)
                       else v_reward.url end;

    insert into public.redemptions
      (user_id, reward_id, code_id, code, integration_type, powr_spent, status, expires_at, checkout_url,
       reward_title, partner_name, reward_image_url, reward_hero_image_url)
    values
      (r.user_id, v_reward.id, v_code_id, v_code, v_reward.integration_type::text, 0, 'active', v_expires, v_checkout,
       v_reward.title, coalesce(v_partner.name, v_reward.brand_name), coalesce(v_reward.image_url, v_partner.logo_url),
       v_reward.hero_image_url)
    returning id into v_red_id;

    insert into public.live_event_prize_codes (event_id, rank, user_id, reward_id, redemption_id, code)
    values (e.id, r.rank, r.user_id, v_reward.id, v_red_id, v_code);

    -- The brand's systems hear about a pool code leaving, as for a redemption.
    if v_code_id is not null and v_reward.brand_name is not null
       and exists (select 1 from public.reward_brand_webhook_endpoints w
                    where lower(w.brand_name) = lower(v_reward.brand_name) and w.active) then
      perform public.enqueue_brand_webhook(v_reward.brand_name, 'code.assigned', jsonb_build_object(
        'brand_name',   v_reward.brand_name,
        'reward_id',    v_reward.id,
        'reward_title', v_reward.title,
        'code_id',      v_code_id,
        'code',         v_code,
        'assigned_at',  now(),
        'expires_at',   v_expires,
        'source',       'event_prize',
        'event_id',     e.id));
    end if;
    v_n := v_n + 1;
  end loop;

  if v_n > 0 then
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (null, 'live_event_prizes_issued', 'live_event', e.id::text,
            jsonb_build_object('issued', v_n, 'by', 'auto'));
  end if;
  return v_n;
end;
$$;
revoke all on function public._live_event_issue_prizes(uuid) from public, anon, authenticated;

-- Whoever reveals (the gym, POWR's safety net, an admin), the codes go out.
-- Named to fire before trg_notify_live_event_revealed (triggers run in name
-- order), so the push can say the prize is in the Wallet.
create or replace function public._live_event_issue_prizes_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._live_event_issue_prizes(new.id);
  return new;
exception when others then
  raise warning '[_live_event_issue_prizes_trigger] %: %', new.slug, sqlerrm;
  return new;
end;
$$;
revoke all on function public._live_event_issue_prizes_trigger() from public, anon, authenticated;

drop trigger if exists live_events_issue_prizes on public.live_events;
create trigger live_events_issue_prizes
  after update of status on public.live_events
  for each row
  when (new.status = 'revealed' and old.status is distinct from 'revealed')
  execute function public._live_event_issue_prizes_trigger();

-- ── The reveal push knows when the prize is already in the Wallet ────────
create or replace function public.notify_live_event_revealed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_token text;
begin
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'shared_resolve_token';

  for r in
    select lp.user_id,
           res.rank,
           res.prize_label,
           exists (select 1 from public.live_event_prize_codes c
                    where c.event_id = new.id and c.user_id = lp.user_id) as in_wallet
      from public.live_event_participants lp
      left join public.live_event_results res
             on res.event_id = lp.event_id and res.user_id = lp.user_id
     where lp.event_id = new.id
       and lp.disqualified_at is null
  loop
    perform net.http_post(
      url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-resolve-token', v_token
      ),
      body := jsonb_build_object(
        'target_user_id', r.user_id,
        'type', 'event_results_revealed',
        'payload', jsonb_build_object(
          'event_id',        new.id,
          'event_slug',      new.slug,
          'event_name',      new.name,
          'rank',            r.rank,
          'prize_label',     r.prize_label,
          'prize_in_wallet', r.in_wallet
        )
      ),
      timeout_milliseconds := 5000
    );
  end loop;
  return new;
exception when others then
  raise warning '[notify_live_event_revealed] %: %', new.slug, sqlerrm;
  return new;
end;
$$;
