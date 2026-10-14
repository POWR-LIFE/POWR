-- In-store redemption, step 1 of 2: a delivery type for rewards that live
-- only at a shop's till.
--
-- An in-store-only reward checked by staff scan or by looking at the screen
-- hands the member a live voucher, not a code, so it must never read as a
-- code pool: PartnerHome, the admin Vault and the setup reminders all treat
-- 'POOL' as "needs codes loaded". 'IN_STORE' keeps those surfaces quiet.
-- Online + in store ('both') and till-barcode rewards keep their code-backed
-- type; reward_in_store (next migration) carries the in-store behaviour.
--
-- Its own file because a new enum value can't be used in the transaction that
-- adds it.

alter type public.reward_integration_type add value if not exists 'IN_STORE';
