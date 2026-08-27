-- ---------------------------------------------------------------------------
-- W1, shadow phase — a stored points balance that NOTHING reads yet.
--
-- WHY. Two AFTER INSERT triggers on point_transactions (notify_reward_unlocks,
-- vault_level_up_check) each re-sum a member's ENTIRE ledger on every earn.
-- That cost grows with how long a member has been with us, not with how many
-- members there are: 33–52 ms mean per insert at 3,000 rows, and a member three
-- years in will pay ten times that on every check-in. Materialising the balance
-- makes both triggers O(1).
--
-- WHY SHADOW FIRST. Jamie's rule: nothing that can touch a member's balance.
-- This phase is additive — a new table, kept in step by a trigger that writes
-- ONLY to that table, and a reconcile function that proves it matches the
-- ledger. No trigger, view or RPC is repointed. The cutover (a later migration)
-- happens only after the System Health signal ledger.balance_drift has read
-- zero for a week; this phase is what produces that evidence.
--
-- ⚠ TWO AGGREGATES, NOT ONE. The two readers do not want the same number:
--   notify_reward_unlocks  → sum(amount)                    (net: earns − spends)
--   vault_level_up_check   → sum(amount) filter (amount > 0) + unreleased vault
-- A single "balance" column would silently change how levels are reached for
-- anyone who has ever spent points. net_balance and lifetime_earned are both
-- kept; the vault part stays a live read of vault_deposits at cutover.
--
-- ⚠ TRIGGER ORDER IS LOAD-BEARING (for the cutover, not for today). Same-event
-- triggers fire in NAME order. This maintainer is an AFTER trigger named to sort
-- before trg_notify_reward_unlocks and vault_level_up_on_earn, so that when they
-- are repointed at this table they read the row that already includes NEW.
-- Renaming it breaks that silently.
--
-- ⚠ EVERY WRITE PATH. INSERT, UPDATE of amount/user_id, and DELETE all adjust
-- the row — admin repairs over MCP, session-review rejects and the pending
-- duplicate cleanup all reach the ledger without going through an edge
-- function. If a path is ever added that bypasses this trigger, the reconcile
-- shows it as drift.
--
-- NEVER BLOCK AN AWARD. The maintainer swallows its own errors (WARNING, not
-- EXCEPTION): a bug here must cost a reconcile finding, never a member's points.
-- ---------------------------------------------------------------------------

create table if not exists public.user_point_balances (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  net_balance      bigint      not null default 0,
  lifetime_earned  bigint      not null default 0,
  updated_at       timestamptz not null default now()
);

alter table public.user_point_balances enable row level security;
revoke all on table public.user_point_balances from public, anon, authenticated;

create or replace function public.user_point_balances_maintain()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid;
  v_net   bigint;
  v_earn  bigint;
begin
  begin
    if tg_op = 'INSERT' then
      v_uid  := new.user_id;
      v_net  := new.amount;
      v_earn := greatest(new.amount, 0);
    elsif tg_op = 'DELETE' then
      v_uid  := old.user_id;
      v_net  := -old.amount;
      v_earn := -greatest(old.amount, 0);
    else -- UPDATE
      if new.user_id is distinct from old.user_id then
        -- Moved between members: take it off one, put it on the other.
        insert into public.user_point_balances (user_id, net_balance, lifetime_earned, updated_at)
        values (old.user_id, -old.amount, -greatest(old.amount, 0), now())
        on conflict (user_id) do update
          set net_balance     = public.user_point_balances.net_balance     + excluded.net_balance,
              lifetime_earned = public.user_point_balances.lifetime_earned + excluded.lifetime_earned,
              updated_at      = now();
        v_uid  := new.user_id;
        v_net  := new.amount;
        v_earn := greatest(new.amount, 0);
      else
        v_uid  := new.user_id;
        v_net  := new.amount - old.amount;
        v_earn := greatest(new.amount, 0) - greatest(old.amount, 0);
      end if;
    end if;

    if v_uid is not null and (v_net <> 0 or v_earn <> 0) then
      insert into public.user_point_balances (user_id, net_balance, lifetime_earned, updated_at)
      values (v_uid, v_net, v_earn, now())
      on conflict (user_id) do update
        set net_balance     = public.user_point_balances.net_balance     + excluded.net_balance,
            lifetime_earned = public.user_point_balances.lifetime_earned + excluded.lifetime_earned,
            updated_at      = now();
    end if;
  exception when others then
    raise warning 'user_point_balances_maintain: % (op %, user %)', sqlerrm, tg_op, coalesce(v_uid::text, '?');
  end;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function public.user_point_balances_maintain() from public, anon, authenticated;

-- Reconcile: the ledger is the authority; this reports every member whose stored
-- row disagrees with it (or who has ledger rows and no stored row at all).
-- Read by system_health_facts for ledger.balance_drift. Owner-only.
create or replace function public.user_point_balances_drift()
returns table (user_id uuid, stored_net bigint, actual_net bigint, stored_earned bigint, actual_earned bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with actual as (
    select pt.user_id,
           coalesce(sum(pt.amount), 0)::bigint as net,
           coalesce(sum(pt.amount) filter (where pt.amount > 0), 0)::bigint as earned
    from public.point_transactions pt
    group by pt.user_id
  )
  select coalesce(a.user_id, b.user_id),
         coalesce(b.net_balance, 0), coalesce(a.net, 0),
         coalesce(b.lifetime_earned, 0), coalesce(a.earned, 0)
  from actual a
  full outer join public.user_point_balances b on b.user_id = a.user_id
  where coalesce(b.net_balance, 0) <> coalesce(a.net, 0)
     or coalesce(b.lifetime_earned, 0) <> coalesce(a.earned, 0)
$function$;

revoke all on function public.user_point_balances_drift() from public, anon, authenticated;

-- Repair: rewrite the stored rows from the ledger. Only ever needed if drift
-- appears; the ledger itself is never touched. Owner-only, called by hand.
create or replace function public.user_point_balances_rebuild()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer;
begin
  lock table public.point_transactions in share row exclusive mode;
  delete from public.user_point_balances;
  insert into public.user_point_balances (user_id, net_balance, lifetime_earned, updated_at)
  select user_id,
         coalesce(sum(amount), 0),
         coalesce(sum(amount) filter (where amount > 0), 0),
         now()
  from public.point_transactions
  group by user_id;
  get diagnostics n = row_count;
  return n;
end;
$function$;

revoke all on function public.user_point_balances_rebuild() from public, anon, authenticated;

-- ── Attach + backfill, atomically ─────────────────────────────────────────
-- The lock holds concurrent ledger writes for the instant the backfill takes
-- (3k rows), so a row cannot be both counted by the backfill AND added by the
-- new trigger. Released at the end of this migration's transaction.
lock table public.point_transactions in share row exclusive mode;

drop trigger if exists trg_a0_user_point_balances_maintain on public.point_transactions;
create trigger trg_a0_user_point_balances_maintain
  after insert or update or delete on public.point_transactions
  for each row
  execute function public.user_point_balances_maintain();

select public.user_point_balances_rebuild();
