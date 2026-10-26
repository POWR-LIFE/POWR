-- POWR Drop: partner prizes read well, and an expired reward is never given.
--
-- Most partner rewards carry their value in discount_type / discount_value
-- (20% off, £15 off) with no value_label, so the reveal said only "REP ·
-- Partner reward". The Drop now builds a short value from the discount fields
-- ("20% OFF", "£15 OFF"), falling back to value_label, and takes the first line
-- of the reward's offer as its one-sentence detail. The rewards themselves are
-- untouched: the Rewards tab keeps reading its own columns.
--
-- Also: _drop_partner_ok and the could-be-inside list skip a reward whose own
-- expires_at has passed (none had one on 2026-10-26; this keeps it that way).
-- Re-states _drop_partner_ok, _drop_give and get_my_drop from 20261026180000;
-- the changes are the display lines and the expiry check.

-- The partner prize as the app shows it: brand, a short value, one line of offer.
create or replace function public._drop_reward_display(p_reward_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'brand', coalesce(nullif(btrim(pa.name), ''), nullif(btrim(rw.brand_name), ''), rw.title),
           'value_label', coalesce(
              case
                when rw.discount_value is null or rw.discount_value <= 0 then null
                when rw.discount_type::text = 'percentage'
                  then rtrim(to_char(rw.discount_value, 'FM999990.99'), '.') || '% OFF'
                when rw.discount_type::text = 'fixed_amount'
                  then '£' || rtrim(to_char(rw.discount_value, 'FM999990.99'), '.') || ' OFF'
              end,
              nullif(btrim(rw.value_label), '')),
           'title', left(nullif(btrim(split_part(btrim(coalesce(rw.offer, '')), E'\n', 1)), ''), 90))
    from public.rewards rw
    left join public.partners pa on pa.id = rw.partner_id
   where rw.id = p_reward_id;
$$;

-- A partner code can go to this member: the reward is live and in date, they
-- don't already hold an active one, and the brand's per-person limit holds.
create or replace function public._drop_partner_ok(p_uid uuid, p_reward_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rewards rw
     where rw.id = p_reward_id
       and rw.active
       and (rw.expires_at is null or rw.expires_at > now())
       and coalesce(rw.integration_type::text, '') <> 'AFFILIATE'
       and not exists (
         select 1 from public.redemptions d
          where d.user_id = p_uid and d.reward_id = rw.id
            and d.status::text = 'active' and (d.expires_at is null or d.expires_at >= now()))
       and (rw.max_redemptions_per_user is null
            or (select count(*) from public.redemptions d
                 where d.user_id = p_uid and d.reward_id = rw.id
                   and d.status::text <> 'refunded') < rw.max_redemptions_per_user)
  );
$$;

-- Pay one prize to the member. Returns what it wrote, or null when it can't
-- pay (a partner pool ran dry, the member already holds that code).
create or replace function public._drop_give(p_uid uuid, p public.drop_prizes)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims   text;
  v_tx       uuid;
  v_dep      uuid;
  v_vest     integer;
  v_vests    timestamptz;
  v_reward   public.rewards;
  v_brand    public.partners;
  v_shared   text;
  v_expires  timestamptz;
  v_code     text;
  v_code_id  uuid;
  v_checkout text;
  v_red      uuid;
begin
  if p.kind = 'points' then
    -- Service-role claim for the cap trigger, as the attendance award does.
    v_claims := current_setting('request.jwt.claims', true);
    perform set_config('request.jwt.claims',
      (coalesce(nullif(v_claims, '')::jsonb, '{}'::jsonb)
         || jsonb_build_object('role', 'service_role'))::text, true);
    insert into public.point_transactions (user_id, amount, type, source, description)
    values (p_uid, p.amount, 'bonus', 'drop', 'POWR Drop')
    returning id into v_tx;
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    return jsonb_build_object('point_tx_id', v_tx, 'detail', '{}'::jsonb);
  end if;

  if p.kind = 'vault' then
    select coalesce(nullif(regexp_replace(value, '\D', '', 'g'), '')::int, 60)
      into v_vest from public.system_config where key = 'vault_vest_days';
    if v_vest is null or v_vest <= 0 then
      v_vest := 60;
    end if;
    v_vests := now() + make_interval(days => v_vest);
    insert into public.vault_deposits (user_id, amount, source, description, vests_at)
    values (p_uid, p.amount, 'drop', 'POWR Drop', v_vests)
    returning id into v_dep;
    return jsonb_build_object('vault_deposit_id', v_dep,
                              'detail', jsonb_build_object('vest_days', v_vest, 'vests_at', v_vests));
  end if;

  -- Partner: the code lands in the Wallet as live events issue them.
  if not public._drop_partner_ok(p_uid, p.reward_id) then
    return null;
  end if;
  select * into v_reward from public.rewards where id = p.reward_id;
  select * into v_brand from public.partners where id = v_reward.partner_id;
  v_shared  := nullif(btrim(coalesce(v_reward.promo_code, '')), '');
  v_expires := now() + make_interval(days => coalesce(v_reward.code_expiry_days, 30));
  if v_shared is not null then
    v_code := v_shared;
  else
    select c.id, c.code into v_code_id, v_code
      from public.claim_pool_code(v_reward.id, p_uid, v_expires) c;
    if v_code is null then
      return null;
    end if;
  end if;
  v_checkout := case when v_brand.checkout_url_template is not null
                     then replace(v_brand.checkout_url_template, '{code}', v_code)
                     else v_reward.url end;

  -- Marked as emailed on the way in: the reveal and the Wallet show it.
  insert into public.redemptions
    (user_id, reward_id, code_id, code, integration_type, powr_spent, status, expires_at, checkout_url,
     reward_title, partner_name, reward_image_url, reward_hero_image_url, receipt_emailed_at)
  values
    (p_uid, v_reward.id, v_code_id, v_code, v_reward.integration_type::text, 0, 'active', v_expires, v_checkout,
     v_reward.title, coalesce(v_brand.name, v_reward.brand_name), coalesce(v_reward.image_url, v_brand.logo_url),
     v_reward.hero_image_url, now())
  returning id into v_red;

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
      'source',       'drop'));
  end if;

  return jsonb_build_object(
    'redemption_id', v_red,
    'reward_id', v_reward.id,
    'detail', public._drop_reward_display(v_reward.id)
              || jsonb_build_object('image_url', coalesce(v_reward.image_url, v_brand.logo_url),
                                    'expires_at', v_expires));
end;
$$;

-- Today's Drop for the signed-in member, or null when it's off for them.
-- Makes today's row on first ask. Steps and minutes are the server's own
-- count, so call it after the app's step sync.
create or replace function public.get_my_drop()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_tz     text;
  v_today  date;
  r        public.drop_days;
  v_steps  integer;
  v_mins   integer;
  v_monday date;
  v_first  date;
  v_week   jsonb;
  v_inside jsonb;
begin
  if not coalesce(public._drop_enabled_for(v_uid), false) then
    return null;
  end if;
  v_tz := public._drop_tz(v_uid);
  v_today := (now() at time zone v_tz)::date;
  r := public._drop_make_day(v_uid, v_tz, v_today);

  select m.steps, m.minutes into v_steps, v_mins
    from public._drop_movement(v_uid, v_tz, v_today, v_today) m;

  -- Monday to yesterday: opened, missed, or none (before their first Drop).
  v_monday := v_today - (extract(isodow from v_today)::integer - 1);
  select min(day) into v_first from public.drop_days where user_id = v_uid;
  select coalesce(jsonb_agg(
           case when dd.status = 'opened' then 'opened'
                when g.d < v_first then 'none'
                else 'missed' end
           order by g.d), '[]'::jsonb)
    into v_week
    from (select gs::date as d
            from generate_series(v_monday::timestamp, (v_today - 1)::timestamp, interval '1 day') gs) g
    left join public.drop_days dd on dd.user_id = v_uid and dd.day = g.d;

  -- What could be inside: the live daily prizes, best odds first.
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', x.kind, 'amount', x.amount, 'brand', x.brand, 'value_label', x.value_label, 'title', x.title)
           order by x.weight desc), '[]'::jsonb)
    into v_inside
    from (
      select * from (
        select distinct on (p.kind, p.amount, p.reward_id)
               p.kind, p.amount, p.weight,
               dsp->>'brand' as brand, dsp->>'value_label' as value_label, dsp->>'title' as title
          from public.drop_prizes p
          left join public.rewards rw on rw.id = p.reward_id
          left join lateral (select public._drop_reward_display(rw.id) as dsp) dd on rw.id is not null
         where p.pool = 'daily'
           and p.active
           and (p.starts_at is null or p.starts_at <= now())
           and (p.ends_at is null or p.ends_at > now())
           and (p.stock is null or p.given < p.stock)
           and (p.kind <> 'partner' or (rw.active and (rw.expires_at is null or rw.expires_at > now())
                                        and coalesce(rw.integration_type::text, '') <> 'AFFILIATE'))
         order by p.kind, p.amount, p.reward_id, p.weight desc
      ) d
      order by d.weight desc
      limit 4
    ) x;

  return jsonb_build_object(
    'day',             v_today,
    'status',          r.status,
    'target',          jsonb_build_object('steps', r.target_steps, 'minutes', r.target_minutes, 'basis', r.basis,
                                          'typical_steps', r.typical_steps, 'typical_minutes', r.typical_minutes),
    'steps',           coalesce(v_steps, 0),
    'minutes',         coalesce(v_mins, 0),
    'prize',           public._drop_prize_json(r),
    'opened_at',       r.opened_at,
    'week',            v_week,
    'day_index',       extract(isodow from v_today)::integer - 1,
    'comeback',        case when r.comeback then jsonb_build_object('days_away', r.days_away) end,
    'could_be_inside', v_inside,
    'resets_at',       (v_today + 1)::timestamp at time zone v_tz
  );
end;
$$;

revoke all on function public._drop_reward_display(uuid) from public, anon, authenticated;
revoke all on function public._drop_partner_ok(uuid, uuid) from public, anon, authenticated;
revoke all on function public._drop_give(uuid, public.drop_prizes) from public, anon, authenticated;
revoke all on function public.get_my_drop() from public, anon;
grant execute on function public.get_my_drop() to authenticated;
