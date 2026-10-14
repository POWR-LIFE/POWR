-- Removes the POWR Store in-store demo data (scripts/seed-powr-store-instore-demo.py).
-- Sample rewards carry '[sample]' in their description; sample shops and staff
-- were inserted with created_by NULL. Jamie's own shop "POWR", his scan link
-- and the TEST rewards are left alone.
begin;

delete from public.in_store_vouchers
 where reward_id in (select id from public.rewards where brand_name = 'POWR Store' and description like '[sample]%');
delete from public.redemptions
 where reward_id in (select id from public.rewards where brand_name = 'POWR Store' and description like '[sample]%');
-- Codes, reward_in_store rows and placements cascade with the reward.
delete from public.rewards where brand_name = 'POWR Store' and description like '[sample]%';

delete from public.reward_brand_staff
 where brand_name = 'POWR Store' and created_by is null and name in ('Ellie', 'Priya', 'Dan');
delete from public.in_store_vouchers
 where site_id in (select id from public.reward_brand_sites where brand_name = 'POWR Store' and created_by is null and name in ('Stratford', 'Shoreditch'));
delete from public.reward_brand_sites
 where brand_name = 'POWR Store' and created_by is null and name in ('Stratford', 'Shoreditch');

commit;
