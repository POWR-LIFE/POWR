-- Backfill checkout_url for redemptions created before the receipt-snapshot
-- columns existed (pre 2026-06-09 wallet_atomic_redeem). The original backfill
-- covered title/partner/image but not checkout_url, so older wallet entries
-- never show the "Use at X" button. Same precedence as redeem-reward:
-- reward.url first, else the partner's template with {code} substituted.
update public.redemptions r
   set checkout_url = coalesce(rw.url, replace(p.checkout_url_template, '{code}', r.code))
  from public.rewards rw
  left join public.partners p on p.id = rw.partner_id
 where rw.id = r.reward_id
   and r.checkout_url is null
   and coalesce(rw.url, p.checkout_url_template) is not null;
