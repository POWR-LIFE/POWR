-- =============================================================
-- WALLET + ATOMIC REDEEM
--
-- Two changes that together enable the "redemption loop" (redeem code after
-- code, points permitting) plus a wallet surface that holds active codes:
--
-- 1. spend_points() — an atomic balance-check-and-debit. redeem-reward used to
--    read the balance (sum of point_transactions) and insert the debit as two
--    separate statements. With the loop encouraging rapid repeat redemption,
--    two concurrent calls could both pass the check and both deduct, letting a
--    user overspend. point_transactions is an append-only ledger with no single
--    per-user row to lock, so we serialise spends with a per-user advisory lock
--    (same approach the gym/claim-points idempotency work relies on).
--
-- 2. Denormalised receipt fields on redemptions — the wallet shows a code even
--    after its reward is deactivated or edited. rewards/partners are exposed via
--    RLS only while active, so a nested join would blank out pulled rewards.
--    Snapshotting title/partner/image/checkout at redeem time makes each wallet
--    entry a self-contained receipt.
-- =============================================================

-- ── 1. Receipt snapshot columns ──────────────────────────────────────────────
alter table public.redemptions
  add column if not exists reward_title     text,
  add column if not exists partner_name     text,
  add column if not exists reward_image_url text,
  add column if not exists checkout_url     text;

-- Best-effort backfill from the current catalogue for pre-existing redemptions.
update public.redemptions r
   set reward_title     = coalesce(r.reward_title, rw.title),
       partner_name     = coalesce(r.partner_name, p.name),
       reward_image_url = coalesce(r.reward_image_url, rw.image_url, p.logo_url)
  from public.rewards rw
  left join public.partners p on p.id = rw.partner_id
 where rw.id = r.reward_id
   and (r.reward_title is null or r.partner_name is null or r.reward_image_url is null);

-- ── 2. Atomic spend ──────────────────────────────────────────────────────────
create or replace function public.spend_points(
  p_user_id     uuid,
  p_amount      int,
  p_description text
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  -- Serialise concurrent spends for this user: the balance read and the debit
  -- insert below must be atomic, else two simultaneous redeems race and both
  -- pass the check. The lock is released automatically at transaction end.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select coalesce(sum(amount), 0)::int
    into v_balance
    from point_transactions
   where user_id = p_user_id;

  if v_balance < p_amount then
    raise exception 'INSUFFICIENT_POINTS';
  end if;

  insert into point_transactions (user_id, amount, type, description)
  values (p_user_id, -p_amount, 'redeem', p_description);

  return v_balance - p_amount;
end;
$$;

-- Service role only — same posture as claim_pool_code.
revoke all on function public.spend_points(uuid, int, text) from public, anon, authenticated;
