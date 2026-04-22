alter table public.rewards
  add column if not exists discount_type text
    check (discount_type in ('percentage', 'fixed_amount')),
  add column if not exists discount_value numeric(10,2);

update public.rewards
   set discount_type = 'percentage',
       discount_value = 50,
       value_label = '50% OFF'
 where title = 'Trial pack · 6 best sellers'
   and partner_id in (
     select id from public.partners where partner_code = 'TRIB'
   );