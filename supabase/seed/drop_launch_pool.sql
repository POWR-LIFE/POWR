-- POWR Drop launch pool, 2026-10-26 (run once; safe to re-run).
--
-- Partner codes from the live partner rewards — never the POWR Store, QA or
-- TEST rewards — one prize per brand, each with its own stock so the brand's
-- code pool keeps codes for members who spend POWR on them. Tribe's is a
-- shared promo code (unlimited); the rest draw from code pools. HUEL is an
-- affiliate link, which can't be handed out as a code.
--
-- The Vault is off for everyone (vault_rollout mode 'none'), so nobody can win
-- a Vault prize yet: both are switched off here (turn them back on in
-- /admin/drop when the Vault launches) and the fallback pays POWR now.
--
-- Odds after this (daily pool, weights): +20 POWR now 40, Tribe 7, Frank 6,
-- MAJIC 6, REP 6, SWT 6, OMNITY 5, MATHAN 3 — about 51% POWR, 49% a partner
-- code. Fallback (once the daily budget is spent, or nothing else can pay):
-- +10 POWR now. Everything here is editable on /admin/drop. The switch
-- (drop_live) is not touched here.

update public.drop_prizes set weight = 40, updated_at = now()
 where pool = 'daily' and kind = 'points' and amount = 20 and weight = 45;

update public.drop_prizes set active = false, note = 'Off until the Vault launches', updated_at = now()
 where kind = 'vault' and active and note in ('Launch pool', 'Once the daily budget is spent');

insert into public.drop_prizes (pool, kind, amount, weight, active, note)
select 'fallback', 'points', 10, 1, true, 'Once the daily budget is spent'
 where not exists (select 1 from public.drop_prizes where pool = 'fallback' and kind = 'points');

insert into public.drop_prizes (pool, kind, reward_id, weight, stock, active, note)
select 'daily', 'partner', v.reward_id, v.weight, v.stock, true, v.note
  from (values
    ('1b24fa59-aa67-4c4b-a877-891cee4732b0'::uuid, 7, 60, 'Tribe 35% off site-wide (shared code)'),
    ('6540d4d9-a853-45dc-967c-d90d7b32d5bf'::uuid, 6, 30, 'Frank 20% off (code pool)'),
    ('4b702b32-a39f-4488-a8df-a4e66e1365e9'::uuid, 6, 30, 'MAJIC 25% off (code pool)'),
    ('f1cd3b92-11ea-4a7a-a332-1f5a59718aed'::uuid, 6, 30, 'REP 20% off (code pool)'),
    ('e3408699-d06e-4a7f-a1c4-9ff692359161'::uuid, 6, 20, 'SWT 15% off (code pool)'),
    ('30e820b9-479e-4555-9f2c-d330ac3295e4'::uuid, 5, 15, 'OMNITY 20% off (code pool, one per person)'),
    ('cf8b2cd2-5bf0-4d30-a0d3-40e1878016a3'::uuid, 3, 10, 'MATHAN £15 off over £75 (code pool)')
  ) as v(reward_id, weight, stock, note)
  join public.rewards r on r.id = v.reward_id and r.active
 where not exists (select 1 from public.drop_prizes p where p.reward_id = v.reward_id);

insert into public.admin_audit_log (admin_id, action, target_type, target_id, metadata)
values ((select id from public.profiles where username = 'jpowr'), 'drop_setup', 'drop', 'launch_pool',
        jsonb_build_object('partner_prizes', 7, 'source', 'supabase/seed/drop_launch_pool.sql'));
