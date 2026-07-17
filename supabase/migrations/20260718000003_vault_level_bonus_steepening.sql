-- Steepen the Vault level-up bonus schedule: 10/25/50/100 → 10/50/150/400.
--
-- Product decision (2026-07-17): instead of gating the Vault behind a level,
-- the bonus curve makes it visibly matter more as you climb — Recruit levels
-- bank a taste, Legend levels bank real reward money. Lifetime total across
-- all 19 level-ups: 4×10 + 5×50 + 5×150 + 5×400 = 3,040 pts over a 182k-pt
-- journey. Existing level_up deposits keep the amount they were banked with.
--
-- MUST stay in sync with constants/levels.ts VAULT_LEVEL_BONUS (client copy
-- of this schedule for the Vault info modal).

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
      -- Tier-scaled bonus: recruit 10, athlete 50, elite 150, legend 400.
      v_bonus := case
        when v_level <= 5  then 10
        when v_level <= 10 then 50
        when v_level <= 15 then 150
        else 400
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
