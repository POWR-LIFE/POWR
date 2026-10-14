-- In-store rollout switch (2026-10-13).
--
-- Merging the in-store portal gives every brand the In Store page, and a brand
-- can switch a live reward to in-store-only with no approval step. Until the
-- app update carrying the voucher screen has reached members, that would sell
-- members a reward they can't use. So brands only get in-store once POWR flips
-- system_config 'partner_in_store_enabled' (admin > System Config > Partner
-- Portal). The QA store (qa_brand_name, POWR Store) and admins always have it,
-- so testing never stops. The portal hides the page and the wizard option
-- using in_store_enabled_for_brand; partner_set_reward_in_store enforces it.

insert into public.system_config (key, value, description)
values ('partner_in_store_enabled', 'false',
        'In-store redemption for brands: the In Store page and putting rewards in store. Off until the app update is out. The QA store and admins always have it.')
on conflict (key) do nothing;

create or replace function public.in_store_enabled_for_brand(p_brand text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admin_roles where user_id = auth.uid())
      or coalesce((select lower(btrim(value)) = 'true' from public.system_config where key = 'partner_in_store_enabled'), false)
      or (nullif(btrim(p_brand), '') is not null and lower(btrim(p_brand)) = lower(public.qa_brand_name()))
$$;
revoke all on function public.in_store_enabled_for_brand(text) from public, anon;
grant execute on function public.in_store_enabled_for_brand(text) to authenticated;

create or replace function public.partner_set_reward_in_store(
  p_brand text,
  p_reward_id uuid,
  p_where text,
  p_check text default 'staff_scan',
  p_requires_stand boolean default false,
  p_ask_spend boolean default true,
  p_window_minutes integer default 5,
  p_barcode_format text default 'code128',
  p_site_ids uuid[] default null
) returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  v_brand text := public._in_store_caller_brand(p_brand);
  v_reward public.rewards%rowtype;
  v_prior text;
  v_only boolean;
begin
  if p_where not in ('online', 'in_store', 'both') then raise exception 'Pick online, in store or both' using errcode = '22023'; end if;
  -- Rollout switch: brands can only put rewards in store once POWR turns it
  -- on (the QA store and admins always can). Turning in-store OFF is always allowed.
  if p_where <> 'online' and not public.in_store_enabled_for_brand(v_brand) then
    raise exception 'In-store rewards aren''t switched on for your brand yet. Talk to POWR to get set up.' using errcode = '42501';
  end if;
  if p_check not in ('staff_scan', 'look', 'till_barcode') then raise exception 'Pick how your shop checks it' using errcode = '22023'; end if;
  if p_barcode_format not in ('ean13', 'code128', 'qr') then raise exception 'Unknown barcode type' using errcode = '22023'; end if;

  select * into v_reward from public.rewards where id = p_reward_id and lower(btrim(brand_name)) = lower(v_brand) for update;
  if not found then raise exception 'Reward not found' using errcode = 'P0002'; end if;
  if v_reward.reward_kind <> 'digital' then raise exception 'Posted rewards can''t be used in store' using errcode = '22023'; end if;
  if p_where <> 'online' and v_reward.integration_type::text = 'AFFILIATE' and p_check = 'till_barcode' then
    raise exception 'A link reward has no codes for a till to scan. Use staff scan or look at the screen.' using errcode = '22023';
  end if;

  select online_integration_type into v_prior from public.reward_in_store where reward_id = p_reward_id;
  v_only := p_where = 'in_store' and p_check in ('staff_scan', 'look');

  insert into public.reward_in_store (reward_id, redeem_where, check_method, requires_stand, ask_spend,
                                      window_minutes, barcode_format, site_ids, online_integration_type,
                                      updated_by, updated_at)
  values (p_reward_id, p_where, p_check, coalesce(p_requires_stand, false), coalesce(p_ask_spend, true),
          least(greatest(coalesce(p_window_minutes, 5), 1), 30), p_barcode_format,
          case when p_site_ids is null or cardinality(p_site_ids) = 0 then null else p_site_ids end,
          case when v_reward.integration_type::text <> 'IN_STORE' then v_reward.integration_type::text else v_prior end,
          auth.uid(), now())
  on conflict (reward_id) do update set
    redeem_where = excluded.redeem_where,
    check_method = excluded.check_method,
    requires_stand = excluded.requires_stand,
    ask_spend = excluded.ask_spend,
    window_minutes = excluded.window_minutes,
    barcode_format = excluded.barcode_format,
    site_ids = excluded.site_ids,
    online_integration_type = excluded.online_integration_type,
    updated_by = excluded.updated_by,
    updated_at = now();

  -- In-store only (no codes) <=> IN_STORE. Anything else needs its code source back.
  if v_only and v_reward.integration_type::text <> 'IN_STORE' then
    update public.rewards set integration_type = 'IN_STORE' where id = p_reward_id;
  elsif not v_only and v_reward.integration_type::text = 'IN_STORE' then
    update public.rewards
       set integration_type = coalesce(nullif(v_prior, 'IN_STORE'), 'POOL')::public.reward_integration_type
     where id = p_reward_id;
  end if;

  return jsonb_build_object('ok', true,
    'integration_type', (select integration_type from public.rewards where id = p_reward_id));
end $$;
