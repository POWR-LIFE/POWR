-- =============================================================
-- 1. Fix Tribe partner_code: 'TRIB' → 'TRIBE'
--    All real codes from Tribe use POWR-TRIBE-XXXXXX.
--    The 4-char stub 'TRIB' caused every code to be rejected
--    with wrong_partner_prefix.
-- =============================================================
update public.partners
   set partner_code = 'TRIBE'
 where partner_code = 'TRIB';

-- =============================================================
-- 2. Admin RLS on redemption_codes
--    Without this, the anon-key frontend can't read the pool
--    (the table has no select policy — service role only).
--    Admins need to view the full ledger.
-- =============================================================
create policy "Admins can read all redemption codes"
  on public.redemption_codes for select
  to authenticated
  using (
    (select is_admin from public.profiles where id = auth.uid()) = true
  );

create policy "Admins can insert redemption codes"
  on public.redemption_codes for insert
  to authenticated
  with check (
    (select is_admin from public.profiles where id = auth.uid()) = true
  );

create policy "Admins can update redemption codes"
  on public.redemption_codes for update
  to authenticated
  using (
    (select is_admin from public.profiles where id = auth.uid()) = true
  );
