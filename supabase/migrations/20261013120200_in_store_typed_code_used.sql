-- In-store redemption follow-up: a typed code for a voucher that was just
-- confirmed now reads "Already used" instead of "No match".
--
-- in_store_scan_check's typed-code search only looked at open and swiped
-- vouchers, so staff re-checking a code they had just confirmed (or a member
-- showing a used voucher's last code) got "No match", which reads like a typo
-- rather than "don't apply the discount". Confirmed vouchers still inside
-- their window now match and fall through to the existing 'used' answer.
-- Found driving the scan page end to end on 2026-10-13.

create or replace function public.in_store_scan_check(
  p_token text default null,
  p_site_id uuid default null,
  p_voucher_id uuid default null,
  p_proof text default null,
  p_typed_code text default null
) returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare
  s record;
  v public.in_store_vouchers%rowtype;
  v_cfg public.reward_in_store%rowtype;
  v_red public.redemptions%rowtype;
  v_step bigint := floor(extract(epoch from clock_timestamp()) / 10)::bigint;
  v_code text := upper(regexp_replace(coalesce(p_typed_code, ''), '[\s-]', '', 'g'));
  v_proof_ok boolean;
  v_ticket text;
  v_used_site text;
begin
  select * into s from public._in_store_scanner(p_token);

  if p_voucher_id is not null then
    select * into v from public.in_store_vouchers where id = p_voucher_id;
    if not found then return jsonb_build_object('result', 'not_found'); end if;
  elsif length(v_code) = 6 then
    -- Typed fallback: search this brand's live vouchers for the current code.
    select x.* into v from public.in_store_vouchers x
     where lower(btrim(x.brand_name)) = lower(s.brand_name)
       and x.status in ('open', 'swiped', 'confirmed')
       and x.expires_at > now() - interval '2 minutes'
       and v_code in (public.in_store_typed_code(x.secret, v_step),
                      public.in_store_typed_code(x.secret, v_step - 1),
                      public.in_store_typed_code(x.secret, v_step - 2),
                      public.in_store_typed_code(x.secret, v_step - 3),
                      public.in_store_typed_code(x.secret, v_step + 1))
     order by x.opened_at desc
     limit 1;
    if not found then return jsonb_build_object('result', 'not_found'); end if;
  else
    return jsonb_build_object('result', 'not_found');
  end if;

  if lower(btrim(v.brand_name)) <> lower(s.brand_name) then
    return jsonb_build_object('result', 'other');
  end if;

  select * into v_red from public.redemptions where id = v.redemption_id;
  select * into v_cfg from public.reward_in_store where reward_id = v.reward_id;

  if v.status = 'confirmed' or (v_red.status = 'used' and v.status <> 'swiped') then
    select b.name into v_used_site from public.in_store_vouchers c
      left join public.reward_brand_sites b on b.id = c.confirm_site_id
     where c.redemption_id = v.redemption_id and c.status = 'confirmed'
     order by c.confirmed_at desc limit 1;
    return jsonb_build_object('result', 'used',
      'reward_title', coalesce(v_red.reward_title, (select title from public.rewards where id = v.reward_id)),
      'used_at', coalesce(v.confirmed_at, v_red.used_at),
      'used_site_name', v_used_site);
  end if;

  -- A scanned QR must carry a code from the last ~40 seconds: a screenshot won't.
  if p_voucher_id is not null then
    v_proof_ok := lower(coalesce(p_proof, '')) in (
      public.in_store_voucher_proof(v.secret, v_step),
      public.in_store_voucher_proof(v.secret, v_step - 1),
      public.in_store_voucher_proof(v.secret, v_step - 2),
      public.in_store_voucher_proof(v.secret, v_step - 3),
      public.in_store_voucher_proof(v.secret, v_step + 1));
    if not v_proof_ok then return jsonb_build_object('result', 'stale'); end if;
  end if;

  if v.status = 'open' and v.expires_at <= now() then
    return jsonb_build_object('result', 'closed');
  end if;

  v_ticket := encode(extensions.gen_random_bytes(12), 'hex');
  update public.in_store_vouchers set check_ticket = v_ticket, checked_at = now() where id = v.id;

  return jsonb_build_object(
    'result', 'valid',
    'voucher_id', v.id,
    'ticket', v_ticket,
    'reward_title', coalesce(v_red.reward_title, (select title from public.rewards where id = v.reward_id)),
    'member_label', coalesce(public._in_store_member_label(v.user_id), 'POWR member'),
    'opened_at', v.opened_at,
    'expires_at', v.expires_at,
    'swiped', v.status = 'swiped',
    'ask_spend', coalesce(v_cfg.ask_spend, false),
    'server_now', clock_timestamp());
end $$;
