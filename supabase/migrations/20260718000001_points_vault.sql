-- =============================================================
-- THE VAULT — bonus POWR that vests over time
--
-- Bonus value (level-up rewards + merit the per-activity daily cap clamps
-- away) is banked into vault_deposits instead of being dropped. Vaulted
-- points count toward LIFETIME EARNED (level) immediately, but are not
-- spendable until they vest; a cron sweep releases matured deposits into
-- point_transactions and pushes a "vault unlocked" notification.
--
-- Deliberate boundaries:
--   * Base session earnings are NEVER vaulted — only bonus value. Locking
--     core earnings would read as withheld wages.
--   * Deposits live OUTSIDE point_transactions, so balance (sum(amount)),
--     spend_points(), user_balances and every existing consumer stay
--     correct with zero changes — vault points simply aren't in the ledger
--     until they vest.
--   * total_earned (the level basis) = ledger positive sum + PENDING vault.
--     On release the deposit leaves "pending" in the same transaction its
--     ledger row lands, so lifetime earned never moves at release time —
--     no phantom level-up celebrations.
-- =============================================================

-- ── 1. Deposits ──────────────────────────────────────────────────────────────

create table public.vault_deposits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  amount      int not null check (amount > 0),
  source      text not null check (source in ('level_up', 'cap_overflow')),
  description text,
  session_id  uuid references public.activity_sessions(id) on delete set null,
  level       int,             -- set for level_up deposits
  created_at  timestamptz not null default now(),
  vests_at    timestamptz not null,
  released_at timestamptz,     -- null = still vesting
  released_tx uuid references public.point_transactions(id) on delete set null
);

create index on public.vault_deposits (user_id, created_at desc);
create index on public.vault_deposits (vests_at) where released_at is null;

alter table public.vault_deposits enable row level security;

create policy "Users can read their own vault deposits"
  on public.vault_deposits for select
  using (auth.uid() = user_id);

-- No client-side insert, update, or delete — service role + triggers only.

-- ── 2. Tunable vesting window ────────────────────────────────────────────────

insert into public.system_config (key, value, description)
values (
  'vault_vest_days',
  '30',
  'Days a vault deposit (level-up bonus or daily-cap overflow) vests before it is released into the spendable balance.'
)
on conflict (key) do nothing;

-- ── 3. Level-up detection → vault bonus ──────────────────────────────────────
-- Fires on every positive credit in EITHER table so any earn path (claim-points,
-- award-bonus, challenges, referral trigger, admin adjustments, cap-overflow
-- deposits) can trip a level. Lifetime = ledger positive sum + pending vault —
-- the exact formula get_my_points_summary reports as total_earned, so the level
-- awarded here is the level the app shows.

create or replace function public.vault_level_up_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- xpMin per level 2..20 — MUST mirror constants/levels.ts LEVELS[].xpMin.
  v_thresholds constant bigint[] := array[
    500, 1200, 2500, 4500, 7000, 10000, 14000, 19000, 25000, 32500,
    41000, 51000, 63000, 77000, 93000, 111000, 132000, 156000, 182000
  ];
  v_ledger    bigint;
  v_vault     bigint;
  v_after     bigint;
  v_before    bigint;
  v_level     int;
  v_bonus     int;
  v_vest_days int;
begin
  if tg_table_name = 'point_transactions' then
    -- Releases are a vault→ledger swap, not new merit; negatives never level.
    if new.amount <= 0 or new.source = 'vault_release' then
      return new;
    end if;
  else
    -- Never re-check on our own level_up inserts (recursion guard); the next
    -- credit picks up any level a bonus itself tipped.
    if new.source = 'level_up' then
      return new;
    end if;
  end if;

  select coalesce(sum(amount), 0) into v_ledger
    from point_transactions where user_id = new.user_id and amount > 0;
  select coalesce(sum(amount), 0) into v_vault
    from vault_deposits where user_id = new.user_id and released_at is null;

  -- AFTER INSERT: both sums already include NEW.
  v_after  := v_ledger + v_vault;
  v_before := greatest(v_after - new.amount, 0);

  select coalesce(nullif(regexp_replace(value, '\D', '', 'g'), '')::int, 30)
    into v_vest_days from system_config where key = 'vault_vest_days';
  if v_vest_days is null or v_vest_days <= 0 then
    v_vest_days := 30;
  end if;

  for i in 1 .. array_length(v_thresholds, 1) loop
    if v_before < v_thresholds[i] and v_after >= v_thresholds[i] then
      v_level := i + 1;
      -- Tier-scaled bonus: recruit 10, athlete 25, elite 50, legend 100.
      v_bonus := case
        when v_level <= 5  then 10
        when v_level <= 10 then 25
        when v_level <= 15 then 50
        else 100
      end;
      insert into vault_deposits (user_id, amount, source, description, level, vests_at)
      values (
        new.user_id, v_bonus, 'level_up',
        'Level ' || v_level || ' bonus', v_level,
        now() + make_interval(days => v_vest_days)
      );
    end if;
  end loop;

  return new;
end;
$$;

create trigger vault_level_up_on_earn
  after insert on public.point_transactions
  for each row execute function public.vault_level_up_check();

create trigger vault_level_up_on_deposit
  after insert on public.vault_deposits
  for each row execute function public.vault_level_up_check();

-- ── 4. Points summary: vault-aware ───────────────────────────────────────────
-- Return type gains columns, so drop + recreate. total_earned now includes
-- pending vault (level basis); balance/today/week/month are untouched —
-- spendability stays ledger-only.

drop function if exists public.get_my_points_summary(timestamptz, timestamptz, timestamptz);

create or replace function public.get_my_points_summary(
  p_today_start timestamptz,
  p_week_start timestamptz,
  p_month_start timestamptz default null
)
returns table (
  balance bigint,
  today_earned bigint,
  weekly_earned bigint,
  monthly_earned bigint,
  total_earned bigint,
  vault_pending bigint,
  vault_next_vest_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with tx as (
    select
      coalesce(sum(amount), 0)::bigint as balance,
      coalesce(sum(amount) filter (
        where type in ('earn', 'adjustment') and created_at >= p_today_start
      ), 0)::bigint as today_earned,
      coalesce(sum(amount) filter (
        where type in ('earn', 'adjustment') and created_at >= p_week_start
      ), 0)::bigint as weekly_earned,
      coalesce(sum(amount) filter (
        where p_month_start is not null
          and type in ('earn', 'adjustment')
          and created_at >= p_month_start
      ), 0)::bigint as monthly_earned,
      coalesce(sum(amount) filter (where amount > 0), 0)::bigint as ledger_earned
    from public.point_transactions
    where user_id = auth.uid()
  ),
  v as (
    select
      coalesce(sum(amount), 0)::bigint as pending,
      min(vests_at) as next_vest
    from public.vault_deposits
    where user_id = auth.uid() and released_at is null
  )
  select
    tx.balance,
    tx.today_earned,
    tx.weekly_earned,
    tx.monthly_earned,
    tx.ledger_earned + v.pending as total_earned,
    v.pending as vault_pending,
    v.next_vest as vault_next_vest_at
  from tx, v;
$$;

revoke execute on function public.get_my_points_summary(timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_my_points_summary(timestamptz, timestamptz, timestamptz) to authenticated;

-- ── 5. Release sweep ─────────────────────────────────────────────────────────
-- One spendable 'bonus' ledger row per user per sweep (source 'vault_release' —
-- the level trigger skips it), deposits stamped with the row that paid them
-- out. Advisory lock so overlapping cron runs can't double-credit.

create or replace function public.release_due_vault_deposits()
returns table (user_id uuid, points int, deposits int)
language plpgsql
security definer
set search_path = public
as $$
declare
  r    record;
  v_tx uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('vault_release_sweep', 0));

  for r in
    select vd.user_id as uid,
           array_agg(vd.id) as ids,
           sum(vd.amount)::int as pts,
           count(*)::int as cnt
      from vault_deposits vd
     where vd.released_at is null
       and vd.vests_at <= now()
     group by vd.user_id
  loop
    insert into point_transactions (user_id, amount, type, source, description, multiplier)
    values (r.uid, r.pts, 'bonus', 'vault_release', 'Vault unlocked', 1.0)
    returning id into v_tx;

    update vault_deposits
       set released_at = now(), released_tx = v_tx
     where id = any(r.ids);

    user_id  := r.uid;
    points   := r.pts;
    deposits := r.cnt;
    return next;
  end loop;
end;
$$;

revoke all on function public.release_due_vault_deposits() from public, anon, authenticated;

-- ── 6. Cron sweep every 15 minutes ───────────────────────────────────────────
-- Same shape as terra-poll-freshness: pg_cron → edge function guarded by a
-- shared token. The edge function runs the release RPC then sends the
-- vault_unlocked push per user.

create extension if not exists pg_cron;

do $job$
begin
  perform cron.unschedule('vault-release-sweep');
exception when others then
  null; -- job did not exist yet
end
$job$;

select cron.schedule(
  'vault-release-sweep',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/release-vault-deposits',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Was a hardcoded x-vault-token literal, which leaked to the public repo
      -- (GitGuardian 34903903). Redacted here and superseded by
      -- 20260727120000_cron_tokens_to_vault.sql, which re-points this job at
      -- the Vault-backed shared token; on a fresh replay this line already
      -- creates the job in its final form.
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := '{}'::jsonb
  )
  $cron$
);
