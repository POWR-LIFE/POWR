-- In-store voucher webhooks (2026-10-13): voucher.confirmed and voucher.swiped.
--
-- In-store-only rewards (staff scan or look-and-swipe) have no code, so the
-- code.* events said nothing when one was used at a till. Partners on the API
-- now get:
--   voucher.confirmed  staff scanned the voucher (powr.life/scan or a signed-in
--                      portal user). For a reward that also has a code
--                      (online + in store), code.used fires too, as before.
--   voucher.swiped     staff swiped it on the member's phone: shown at the
--                      till, not confirmed by the shop.
-- Payload (data): brand_name, voucher_id, redemption_id, reward_id,
-- reward_title, code (code-backed rewards only), site {id, name, stand_code},
-- opened_at, swiped_at | confirmed_at, confirmed_by ('staff'|'manager'),
-- staff_name, spend_pence, at_shop. Null fields are dropped. The member is
-- never identified.
--
-- Endpoints opt in per event (manage-partner-api ALLOWED_EVENTS); none exist
-- in production yet, so nothing is backfilled. Queuing never blocks a confirm
-- or swipe: _in_store_notify swallows its own errors.

alter table public.reward_brand_webhook_endpoints
  alter column events set default '{code.assigned,code.used,pool.low,voucher.confirmed,voucher.swiped}';

-- Queues a partner webhook for an in-store voucher outcome. Never raises:
-- a webhook problem must not stop staff confirming at the till. The member
-- is not identified; the brand's portal shows "Alex M." but its systems
-- don't need even that.
create or replace function public._in_store_notify(p_voucher_id uuid, p_event text)
returns void language plpgsql volatile security definer set search_path = public
as $$
declare v_brand text; v_payload jsonb;
begin
  select btrim(v.brand_name),
         jsonb_strip_nulls(jsonb_build_object(
           'brand_name', btrim(v.brand_name),
           'voucher_id', v.id,
           'redemption_id', v.redemption_id,
           'reward_id', v.reward_id,
           'reward_title', coalesce(d.reward_title, r.title),
           'code', case when d.code_id is not null then d.code end,
           'site', case when s.id is not null then jsonb_build_object('id', s.id, 'name', s.name, 'stand_code', s.stand_code) end,
           'opened_at', v.opened_at,
           'swiped_at', v.swiped_at,
           'confirmed_at', v.confirmed_at,
           'confirmed_by', case when v.confirmed_by_staff_id is not null then 'staff'
                                when v.confirmed_by_user_id is not null then 'manager' end,
           'staff_name', st.name,
           'spend_pence', v.spend_pence,
           'at_shop', v.at_shop))
    into v_brand, v_payload
    from public.in_store_vouchers v
    join public.redemptions d on d.id = v.redemption_id
    join public.rewards r on r.id = v.reward_id
    left join public.reward_brand_sites s on s.id = coalesce(v.confirm_site_id, v.site_id)
    left join public.reward_brand_staff st on st.id = v.confirmed_by_staff_id
   where v.id = p_voucher_id;
  if v_brand is null then return; end if;
  perform public.enqueue_brand_webhook(v_brand, p_event, v_payload);
exception when others then
  raise warning 'in-store webhook % for % not queued: %', p_event, p_voucher_id, sqlerrm;
end $$;
revoke all on function public._in_store_notify(uuid, text) from public, anon, authenticated;

create or replace function public.in_store_scan_confirm(
  p_token text default null,
  p_site_id uuid default null,
  p_voucher_id uuid default null,
  p_ticket text default null,
  p_spend_pence integer default null
) returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  s record;
  v public.in_store_vouchers%rowtype;
  v_cfg public.reward_in_store%rowtype;
  v_red public.redemptions%rowtype;
  v_site uuid;
begin
  select * into s from public._in_store_scanner(p_token);
  select * into v from public.in_store_vouchers where id = p_voucher_id for update;
  if not found or lower(btrim(v.brand_name)) <> lower(s.brand_name) then
    return jsonb_build_object('error', 'NOT_FOUND');
  end if;
  if v.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'confirmed_at', v.confirmed_at, 'already', true);
  end if;
  if v.check_ticket is null or v.check_ticket <> coalesce(p_ticket, '') or v.checked_at < now() - interval '5 minutes' then
    return jsonb_build_object('error', 'CHECK_AGAIN');
  end if;
  select * into v_red from public.redemptions where id = v.redemption_id for update;
  if v_red.status not in ('active', 'used') or (v_red.status = 'used' and v.status <> 'swiped') then
    return jsonb_build_object('error', 'ALREADY_USED');
  end if;
  select * into v_cfg from public.reward_in_store where reward_id = v.reward_id;

  select b.id into v_site from public.reward_brand_sites b
   where b.id = coalesce(p_site_id, s.staff_site_id, v.site_id)
     and lower(btrim(b.brand_name)) = lower(s.brand_name);

  update public.in_store_vouchers
     set status = 'confirmed',
         confirmed_at = now(),
         confirmed_by_staff_id = s.staff_id,
         confirmed_by_user_id = s.user_id,
         confirm_site_id = v_site,
         spend_pence = case when coalesce(v_cfg.ask_spend, false) and p_spend_pence between 0 and 1000000 then p_spend_pence end,
         check_ticket = null
   where id = v.id;

  update public.redemptions set status = 'used', used_at = coalesce(used_at, now()) where id = v.redemption_id;

  -- The shop confirmed it: a backing pool code becomes `used` (brand-confirmed),
  -- which fires the brand's code.used webhook via trg_code_used_webhook.
  if v_red.code_id is not null then
    update public.redemption_codes set status = 'used', used_at = now()
     where id = v_red.code_id and status = 'reserved';
  end if;

  perform public._in_store_notify(v.id, 'voucher.confirmed');

  return jsonb_build_object('ok', true, 'confirmed_at', now());
end $$;

create or replace function public.in_store_swipe_voucher(p_voucher_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare v public.in_store_vouchers%rowtype;
begin
  select * into v from public.in_store_vouchers where id = p_voucher_id and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if v.status in ('swiped', 'confirmed') then
    return jsonb_build_object('voucher', public._in_store_voucher_payload(v.id));
  end if;
  -- A few seconds' grace for a swipe that started just before the timer ran out.
  if v.expires_at < now() - interval '15 seconds' then return jsonb_build_object('error', 'CLOSED'); end if;
  if exists (select 1 from public.redemptions where id = v.redemption_id and status <> 'active') then
    return jsonb_build_object('error', 'ALREADY_USED');
  end if;

  update public.in_store_vouchers set status = 'swiped', swiped_at = now() where id = v.id;
  update public.redemptions set status = 'used', used_at = coalesce(used_at, now())
   where id = v.redemption_id and status = 'active';
  perform public._in_store_notify(v.id, 'voucher.swiped');
  return jsonb_build_object('voucher', public._in_store_voucher_payload(v.id));
end $$;
