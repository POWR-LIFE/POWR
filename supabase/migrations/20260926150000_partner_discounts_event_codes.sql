-- =============================================================
-- Partner discounts for gyms, and an optional partner code for
-- everyone who took part in an event
-- =============================================================
-- Jamie, 2026-09-26, correcting 20260926120000 / 20260926130000: "The
-- discount/reward from a partner is not a prize itself. We just offer the
-- discount so they can purchase products that could potentially be used as
-- a prize. But the promo code landing in a wallet idea I kind of like when an
-- event is complete." Then: use the pool of codes as normal, and keep it an
-- option rather than something a gym has to have on. Discounts come with
-- Clash+ and up (the 'events' feature).
--
-- 1. Partner discounts: the brand discounts POWR members get, for the gym to
--    buy prizes and kit. gym_partner_discounts() lists every active reward;
--    gym_claim_partner_code() gives the gym what it needs for one: a shared
--    promo code as it is, one code from the brand's pool (held for the gym,
--    never a member's), or the brand's affiliate link. A gym gets the same
--    code back for 7 days, so nobody drains a pool.
-- 2. Prizes are the gym's own again: _gym_event_fields stops taking a reward
--    as a prize. The prize-code table, its trigger and its issuer go (no
--    event ever used them, no code was issued).
-- 3. The event partner code: off unless the gym picks a brand
--    (live_events.partner_reward_id), which it can do until the board seals.
--    When the winners are revealed, everyone who took part (still in the
--    event, with points) gets a code from that brand in their Wallet, from
--    the pool as normal: a zero-point redemption with the brand webhook, once
--    per person (live_event_partner_codes). A shared code already in
--    someone's Wallet stays their one receipt, as the app does, and a brand's
--    per-person limit holds. If the pool runs short, the highest on the board
--    get theirs first. The reveal push names the brand. No receipt email:
--    a reveal would send them all at once, and Mailgun drops everything past
--    about 26 recipients in 30 seconds.
-- Re-stated from prod (md5 in brackets): gym_create_event [0bfc89b1],
-- gym_update_event [4c337399], _gym_event_fields [3cc59098],
-- _gym_event_json [baed28f6], notify_live_event_revealed [7d8ab1f8].

-- ── What a reward is worth, the way the app's Rewards tab says it ───────
create or replace function public._reward_value_label(r public.rewards)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when r.discount_type = 'percentage' and r.discount_value is not null
             then trim_scale(r.discount_value)::text || '% off'
           when r.discount_type = 'fixed_amount' and r.discount_value is not null
             then '£' || trim_scale(r.discount_value)::text || ' off'
           else coalesce(nullif(btrim(coalesce(r.value_label, '')), ''),
                         nullif(btrim(coalesce(r.title, '')), ''))
         end
$$;
revoke all on function public._reward_value_label(public.rewards) from public, anon, authenticated;

create or replace function public._reward_prize_label(r public.rewards)
returns text
language sql
immutable
set search_path = public
as $$
  select left(case
                when nullif(btrim(coalesce(r.brand_name, '')), '') is null
                  then coalesce(public._reward_value_label(r), 'Partner code')
                when public._reward_value_label(r) is null
                  or lower(public._reward_value_label(r)) = lower(btrim(r.brand_name))
                  then btrim(r.brand_name)
                else btrim(r.brand_name) || ' · ' || public._reward_value_label(r)
              end, 60)
$$;
revoke all on function public._reward_prize_label(public.rewards) from public, anon, authenticated;

-- ── 1. Partner discounts for the gym ────────────────────────────────────
create table if not exists public.gym_partner_codes (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners(id) on delete cascade,
  reward_id   uuid not null references public.rewards(id) on delete cascade,
  code        text,
  code_id     uuid references public.redemption_codes(id) on delete set null,
  url         text,
  expires_at  timestamptz,
  claimed_by  uuid references auth.users(id) on delete set null,
  -- The wall clock, so the latest claim is always the newest row.
  claimed_at  timestamptz not null default clock_timestamp()
);
create index if not exists gym_partner_codes_gym_reward_idx on public.gym_partner_codes (partner_id, reward_id, claimed_at desc);
alter table public.gym_partner_codes enable row level security;
revoke all on table public.gym_partner_codes from public, anon, authenticated;
comment on table public.gym_partner_codes is 'Codes and links a gym took from its partner discounts (gym_claim_partner_code): what it was given, when, by whom.';

-- One discount as the portal shows it, with the gym's latest code for it.
-- The same list feeds the builder's "partner code for everyone" picker:
-- event_ok says whether a reward can be that (a code to give, not a link).
create or replace function public._gym_partner_discount_row(r public.rewards, p_partner_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'reward_id',   r.id,
    'brand_name',  r.brand_name,
    'title',       r.title,
    'label',       public._reward_prize_label(r),
    'value',       public._reward_value_label(r),
    'offer',       nullif(btrim(coalesce(r.offer, '')), ''),
    'terms',       nullif(btrim(coalesce(r.terms, '')), ''),
    'image_url',   coalesce(nullif(btrim(coalesce(r.image_url, '')), ''),
                            (select p.logo_url from public.partners p where p.id = r.partner_id)),
    'hero_image_url', nullif(btrim(coalesce(r.hero_image_url, '')), ''),
    'brand_color', r.brand_color,
    'kind',        k.kind,
    -- Codes left in the pool; null for a shared code or a link, which never run out.
    'available',   case when k.kind = 'pool' then k.stock end,
    'in_stock',    k.kind <> 'pool' or k.stock > 0,
    'event_ok',    public._reward_offerable(r),
    'claim',       (select jsonb_build_object(
                             'code',       g.code,
                             'url',        g.url,
                             'claimed_at', g.claimed_at,
                             'expires_at', g.expires_at,
                             -- A new code after a week, or sooner if this one expires first.
                             'next_at',    least(g.claimed_at + interval '7 days', g.expires_at))
                      from public.gym_partner_codes g
                     where g.partner_id = p_partner_id and g.reward_id = r.id
                     order by g.claimed_at desc
                     limit 1)
  )
    from (select case when r.integration_type = 'AFFILIATE' then 'link'
                      when nullif(btrim(coalesce(r.promo_code, '')), '') is not null then 'shared'
                      else 'pool' end as kind,
                 (select count(*) from public.redemption_codes c
                   where c.reward_id = r.id and c.status = 'available' and c.expires_at > now()) as stock) k
$$;
revoke all on function public._gym_partner_discount_row(public.rewards, uuid) from public, anon, authenticated;

-- The builder's old prize catalogue goes: a partner reward is never a prize,
-- and the picker reads gym_partner_discounts instead.
drop function if exists public.gym_prize_catalogue(uuid);

create or replace function public.gym_partner_discounts(p_partner_id uuid)
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
  perform public._gym_require(p_partner_id, 'events');
  return coalesce((
    select jsonb_agg(public._gym_partner_discount_row(r, p_partner_id) order by r.brand_name, r.sort_order, r.title)
      from public.rewards r
     where r.active
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.gym_partner_discounts(uuid) from public, anon;
grant execute on function public.gym_partner_discounts(uuid) to authenticated;

create or replace function public.gym_claim_partner_code(p_partner_id uuid, p_reward_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role    text := public._gym_role(p_partner_id);
  r         public.rewards;
  v_brand   public.partners;
  v_last    public.gym_partner_codes;
  v_shared  text;
  v_code    text;
  v_code_id uuid;
  v_url     text;
  v_expires timestamptz;
  v_kind    text;
begin
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  perform public._gym_require(p_partner_id, 'events');

  select * into r from public.rewards where id = p_reward_id;
  if not found or not r.active then
    raise exception 'That discount isn''t available right now' using errcode = 'P0001';
  end if;

  -- The same code for a week (one purchase, one code), unless it has expired.
  select * into v_last from public.gym_partner_codes
   where partner_id = p_partner_id and reward_id = r.id
   order by claimed_at desc limit 1;
  if found and v_last.claimed_at > now() - interval '7 days'
     and (v_last.expires_at is null or v_last.expires_at > now()) then
    return public._gym_partner_discount_row(r, p_partner_id);
  end if;

  select * into v_brand from public.partners where id = r.partner_id;
  v_shared  := nullif(btrim(coalesce(r.promo_code, '')), '');
  v_expires := now() + make_interval(days => coalesce(r.code_expiry_days, 30));

  if r.integration_type = 'AFFILIATE' then
    v_kind := 'link';
    v_url := coalesce(nullif(btrim(coalesce(r.url, '')), ''), v_brand.checkout_url_template);
    v_expires := null;
    if v_url is null then
      raise exception 'That brand''s link isn''t set up yet' using errcode = 'P0001';
    end if;
  elsif v_shared is not null then
    v_kind := 'shared';
    v_code := v_shared;
  else
    v_kind := 'pool';
    select c.id, c.code into v_code_id, v_code
      from public.claim_pool_code(r.id, auth.uid(), v_expires) c;
    if v_code is null then
      raise exception 'No codes left for that brand right now' using errcode = 'P0001';
    end if;
  end if;
  if v_code is not null then
    v_url := case when v_brand.checkout_url_template is not null
                  then replace(v_brand.checkout_url_template, '{code}', v_code)
                  else nullif(btrim(coalesce(r.url, '')), '') end;
  end if;

  insert into public.gym_partner_codes (partner_id, reward_id, code, code_id, url, expires_at, claimed_by)
  values (p_partner_id, r.id, v_code, v_code_id, v_url, v_expires, auth.uid());

  -- The brand's systems hear about a pool code leaving, as for a member's.
  if v_code_id is not null and r.brand_name is not null
     and exists (select 1 from public.reward_brand_webhook_endpoints w
                  where lower(w.brand_name) = lower(r.brand_name) and w.active) then
    perform public.enqueue_brand_webhook(r.brand_name, 'code.assigned', jsonb_build_object(
      'brand_name',   r.brand_name,
      'reward_id',    r.id,
      'reward_title', r.title,
      'code_id',      v_code_id,
      'code',         v_code,
      'assigned_at',  now(),
      'expires_at',   v_expires,
      'source',       'gym'));
  end if;

  perform public._gym_audit(p_partner_id, 'gym_partner_code_claimed',
    jsonb_build_object('reward_id', r.id, 'brand', r.brand_name, 'kind', v_kind));
  return public._gym_partner_discount_row(r, p_partner_id);
end;
$$;
revoke all on function public.gym_claim_partner_code(uuid, uuid) from public, anon;
grant execute on function public.gym_claim_partner_code(uuid, uuid) to authenticated;

-- ── 2. The event's optional partner code ────────────────────────────────
alter table public.live_events add column if not exists partner_reward_id uuid references public.rewards(id) on delete set null;
comment on column public.live_events.partner_reward_id is 'Optional: when the winners are revealed, everyone who took part gets a code from this reward in their Wallet (_live_event_issue_partner_codes).';

create table if not exists public.live_event_partner_codes (
  event_id      uuid not null references public.live_events(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  reward_id     uuid not null references public.rewards(id),
  redemption_id uuid references public.redemptions(id) on delete set null,
  code          text not null,
  issued_at     timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table public.live_event_partner_codes enable row level security;
revoke all on table public.live_event_partner_codes from public, anon, authenticated;
comment on table public.live_event_partner_codes is 'The partner code each person who took part in a live event got at the reveal: once per person.';

-- The prize-as-reward version goes: nothing used it.
drop trigger if exists live_events_issue_prizes on public.live_events;
drop function if exists public._live_event_issue_prizes_trigger();
drop function if exists public._live_event_issue_prizes(uuid);
drop table if exists public.live_event_prize_codes;

-- ── The builder's fields: prizes are the gym's own; the partner code ────
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
  i        integer;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'Nothing to save' using errcode = 'P0001';
  end if;

  for v_key in select jsonb_object_keys(p_fields) loop
    if v_key not in ('name', 'start_date', 'prizes', 'rules', 'promo_headline', 'promo_media_url',
                     'points_preset_key', 'audience_radius_km',
                     'duration_days', 'night_start_hour', 'night_hours', 'included_activities',
                     'count_venue_only', 'board_size', 'booking_url', 'logo_url', 'logo_only', 'partner_reward_id') then
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
    -- A prize is the gym's own: its words, or { label, image_url } with a
    -- photo uploaded here. A partner brand's code is never the prize; an
    -- event can send one to everyone who took part (see the end).
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

  -- The partner code everyone who took part gets when the winners are
  -- revealed: off (null), or a reward with codes to give.
  if p_fields ? 'partner_reward_id' then
    v_rid := nullif(btrim(coalesce(p_fields ->> 'partner_reward_id', '')), '');
    if v_rid is null then
      v_out := v_out || jsonb_build_object('partner_reward_id', null);
    else
      if v_rid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'That partner code isn''t available right now' using errcode = 'P0001';
      end if;
      select * into v_reward from public.rewards r where r.id = v_rid::uuid;
      if not found or not public._reward_offerable(v_reward) then
        raise exception 'That partner code isn''t available right now' using errcode = 'P0001';
      end if;
      v_out := v_out || jsonb_build_object('partner_reward_id', v_reward.id);
    end if;
  end if;

  return v_out;
end;
$$;
revoke all on function public._gym_event_fields(public.event_templates, jsonb) from public, anon, authenticated;

-- ── Create and update carry the partner code ───────────────────────────
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
    notify_announce, notify_kickoff, notify_doors, notify_rank_at,
    partner_reward_id
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
    (v_tpl.push_defaults ->> 'rank_at')::time,
    (v_f ->> 'partner_reward_id')::uuid
  )
  returning * into v_event;

  perform public._gym_audit(p_partner_id, 'gym_event_created',
    jsonb_build_object('event_id', v_event.id, 'template', v_tpl.key, 'name', v_event.name));
  return public._gym_event_json(v_event, v_role);
end;
$$;
revoke all on function public.gym_create_event(uuid, text, jsonb) from public, anon;
grant execute on function public.gym_create_event(uuid, text, jsonb) to authenticated;

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

  -- Everything until it starts; only the words and pictures (and the partner
  -- code, which goes out at the reveal) while it runs; nothing once the board
  -- has sealed.
  v_early := v_event.status = 'draft' or (v_event.status = 'scheduled' and now() < v_event.window_start_at);
  for v_key in select jsonb_object_keys(v_f) loop
    if v_early then continue; end if;
    if v_event.status = 'live'
       and v_key in ('name', 'promo_headline', 'promo_media_url', 'booking_url', 'logo_url', 'logo_only',
                     'partner_reward_id') then continue; end if;
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
                                   then null else e.reveal_at end,
    partner_reward_id       = case when v_f ? 'partner_reward_id' then (v_f ->> 'partner_reward_id')::uuid else e.partner_reward_id end
  where e.id = p_event_id
  returning * into v_event;

  perform public._gym_audit(v_event.venue_partner_id, 'gym_event_updated',
    jsonb_build_object('event_id', v_event.id, 'fields', (select jsonb_agg(k) from jsonb_object_keys(v_f) k)));
  return public._gym_event_json(v_event, v_role);
end;
$$;
revoke all on function public.gym_update_event(uuid, jsonb) from public, anon;
grant execute on function public.gym_update_event(uuid, jsonb) to authenticated;

-- ── The event as the portal reads it ───────────────────────────────────
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
    'night_hours',        round(extract(epoch from (p_event.doors_close_at - p_event.doors_open_at)) / 3600)::integer,
    -- The optional partner code for everyone who took part.
    'partner_reward_id',  p_event.partner_reward_id,
    'partner_reward',     (select jsonb_build_object(
                                    'brand_name', r.brand_name,
                                    'title',      r.title,
                                    'label',      public._reward_prize_label(r),
                                    'value',      public._reward_value_label(r),
                                    'image_url',  r.image_url,
                                    'available',  case when nullif(btrim(coalesce(r.promo_code, '')), '') is not null then null
                                                       else (select count(*) from public.redemption_codes c
                                                              where c.reward_id = r.id and c.status = 'available' and c.expires_at > now()) end)
                             from public.rewards r where r.id = p_event.partner_reward_id),
    'partner_codes_issued', (select count(*) from public.live_event_partner_codes c where c.event_id = p_event.id)
  )
$$;
revoke all on function public._gym_event_json(public.live_events, text) from public, anon, authenticated;

-- ── 3. At the reveal: a code for everyone who took part ─────────────────
create or replace function public._live_event_issue_partner_codes(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  e          public.live_events;
  v_reward   public.rewards;
  v_brand    public.partners;
  v_shared   text;
  v_expires  timestamptz;
  s          record;
  v_code     text;
  v_code_id  uuid;
  v_checkout text;
  v_red_id   uuid;
  v_n        integer := 0;
  v_short    integer := 0;
  v_capped   integer := 0;
begin
  select * into e from public.live_events where id = p_event_id;
  if not found or e.partner_reward_id is null then
    return 0;
  end if;
  select * into v_reward from public.rewards where id = e.partner_reward_id;
  if not found or not v_reward.active or v_reward.integration_type = 'AFFILIATE' then
    raise warning '[_live_event_issue_partner_codes] %: the partner reward is gone', e.slug;
    return 0;
  end if;
  select * into v_brand from public.partners where id = v_reward.partner_id;
  v_shared  := nullif(btrim(coalesce(v_reward.promo_code, '')), '');
  v_expires := now() + make_interval(days => coalesce(v_reward.code_expiry_days, 30));

  -- Everyone who took part: still in the event, with points. Highest on the
  -- board first, so a short pool reaches the top of it.
  for s in
    select sc.user_id, sc.rank
      from public._live_event_scores(e.id) sc
     where sc.score > 0
       and not exists (select 1 from public.live_event_partner_codes c
                        where c.event_id = e.id and c.user_id = sc.user_id)
     order by sc.rank, sc.user_id
  loop
    v_code := null;
    v_code_id := null;
    v_red_id := null;
    -- A shared code already in their Wallet stays the one receipt, as the
    -- app's redemption does.
    if v_shared is not null then
      select d.id into v_red_id
        from public.redemptions d
       where d.user_id = s.user_id and d.reward_id = v_reward.id
         and d.status = 'active' and d.expires_at >= now()
       order by d.redeemed_at desc
       limit 1;
    end if;
    -- The brand's per-person limit holds, as it does when members spend.
    if v_red_id is null and v_reward.max_redemptions_per_user is not null
       and (select count(*) from public.redemptions d
             where d.user_id = s.user_id and d.reward_id = v_reward.id
               and d.status <> 'refunded') >= v_reward.max_redemptions_per_user then
      v_capped := v_capped + 1;
      continue;
    end if;
    if v_shared is not null then
      v_code := v_shared;
    else
      select c.id, c.code into v_code_id, v_code
        from public.claim_pool_code(v_reward.id, s.user_id, v_expires) c;
      if v_code is null then
        v_short := v_short + 1;
        continue;
      end if;
    end if;
    v_checkout := case when v_brand.checkout_url_template is not null
                       then replace(v_brand.checkout_url_template, '{code}', v_code)
                       else v_reward.url end;

    -- Marked as emailed on the way in, so send-redemption-receipt skips it.
    if v_red_id is null then
      insert into public.redemptions
        (user_id, reward_id, code_id, code, integration_type, powr_spent, status, expires_at, checkout_url,
         reward_title, partner_name, reward_image_url, reward_hero_image_url, receipt_emailed_at)
      values
        (s.user_id, v_reward.id, v_code_id, v_code, v_reward.integration_type::text, 0, 'active', v_expires, v_checkout,
         v_reward.title, coalesce(v_brand.name, v_reward.brand_name), coalesce(v_reward.image_url, v_brand.logo_url),
         v_reward.hero_image_url, now())
      returning id into v_red_id;
    end if;

    insert into public.live_event_partner_codes (event_id, user_id, reward_id, redemption_id, code)
    values (e.id, s.user_id, v_reward.id, v_red_id, v_code);

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
        'source',       'event',
        'event_id',     e.id));
    end if;
    v_n := v_n + 1;
  end loop;

  if v_n > 0 or v_short > 0 or v_capped > 0 then
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
    values (null, 'live_event_partner_codes_issued', 'live_event', e.id::text,
            jsonb_build_object('reward_id', v_reward.id, 'issued', v_n, 'short', v_short,
                               'capped', v_capped, 'by', 'auto'));
  end if;
  return v_n;
end;
$$;
revoke all on function public._live_event_issue_partner_codes(uuid) from public, anon, authenticated;

-- Whoever reveals (the gym, POWR's safety net, an admin), the codes go out.
-- Named to fire before trg_notify_live_event_revealed (same-event triggers
-- run in name order), so the push can name the brand.
create or replace function public._live_event_issue_partner_codes_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._live_event_issue_partner_codes(new.id);
  return new;
exception when others then
  raise warning '[_live_event_issue_partner_codes_trigger] %: %', new.slug, sqlerrm;
  return new;
end;
$$;
revoke all on function public._live_event_issue_partner_codes_trigger() from public, anon, authenticated;

drop trigger if exists live_events_issue_partner_codes on public.live_events;
create trigger live_events_issue_partner_codes
  after update of status on public.live_events
  for each row
  when (new.status = 'revealed' and old.status is distinct from 'revealed')
  execute function public._live_event_issue_partner_codes_trigger();

-- ── The reveal push names the brand whose code is in their Wallet ──────
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
           (select rw.brand_name
              from public.live_event_partner_codes c
              join public.rewards rw on rw.id = c.reward_id
             where c.event_id = new.id and c.user_id = lp.user_id) as partner_brand
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
          'partner_brand',   r.partner_brand
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
