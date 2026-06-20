-- =============================================================
-- BRAND PORTAL — PROMO CODE SELF-SERVICE
-- Let reward-brand users manage the redemption_codes pool for
-- their own brand's rewards (upload / generate / expire / view),
-- mirroring what admins do in the admin RewardManager.
--
-- Until now redemption_codes was admin + service-role only. We add
-- SELECT / INSERT / UPDATE policies scoped to rewards whose
-- brand_name matches a row in reward_brand_users for the caller.
-- (No DELETE: codes are retired by flipping status to 'expired',
--  same as the admin toggle — keeps the ledger intact.)
--
-- Mirrors the brand-keyed RLS established in
-- 20260612000001_rewards_only_portal.sql.
-- =============================================================

-- A reward "belongs" to the calling brand user when the reward's
-- brand_name (case-insensitive) maps to their reward_brand_users row.
create policy "Brand users read own codes"
  on public.redemption_codes for select
  to authenticated
  using (
    exists (
      select 1
        from public.rewards r
        join public.reward_brand_users u
          on lower(u.brand_name) = lower(r.brand_name)
       where r.id = redemption_codes.reward_id
         and u.user_id = (select auth.uid())
    )
  );

create policy "Brand users insert own codes"
  on public.redemption_codes for insert
  to authenticated
  with check (
    exists (
      select 1
        from public.rewards r
        join public.reward_brand_users u
          on lower(u.brand_name) = lower(r.brand_name)
       where r.id = redemption_codes.reward_id
         and u.user_id = (select auth.uid())
    )
  );

create policy "Brand users update own codes"
  on public.redemption_codes for update
  to authenticated
  using (
    exists (
      select 1
        from public.rewards r
        join public.reward_brand_users u
          on lower(u.brand_name) = lower(r.brand_name)
       where r.id = redemption_codes.reward_id
         and u.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.rewards r
        join public.reward_brand_users u
          on lower(u.brand_name) = lower(r.brand_name)
       where r.id = redemption_codes.reward_id
         and u.user_id = (select auth.uid())
    )
  );
