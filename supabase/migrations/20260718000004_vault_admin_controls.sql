-- Vault economy → admin-tunable via system_config.
--
-- Every vault knob becomes a live setting editable from admin → System
-- Config (the page renders all rows generically: 'true'/'false' values as
-- toggles, stepper-registered numerics as +/- steppers):
--
--   vault_vest_days            (existing) days a deposit vests
--   vault_bonus_recruit/…      per-tier level-up bonus amounts
--   vault_level_up_enabled     master switch for level-up deposits
--   vault_cap_overflow_enabled master switch for cap-overflow deposits
--                              (read by claim-points)
--
-- The trigger reads config on every crossing with hardcoded fallbacks
-- (10/50/150/400, 60 days, enabled) so a deleted row can never break earns.
-- A tier bonus set to 0 skips the deposit entirely — vault_deposits has an
-- amount > 0 check, and a failed trigger insert would abort the user's earn.

insert into public.system_config (key, value, description) values
  ('vault_bonus_recruit', '10',  'POWR banked into the Vault when a Recruit level (2-5) is reached. 0 disables Recruit bonuses.'),
  ('vault_bonus_athlete', '50',  'POWR banked into the Vault when an Athlete level (6-10) is reached. 0 disables Athlete bonuses.'),
  ('vault_bonus_elite',   '150', 'POWR banked into the Vault when an Elite level (11-15) is reached. 0 disables Elite bonuses.'),
  ('vault_bonus_legend',  '400', 'POWR banked into the Vault when a Legend level (16-20) is reached. 0 disables Legend bonuses.'),
  ('vault_level_up_enabled',     'true', 'Master switch: bank a Vault bonus when a user reaches a new level.'),
  ('vault_cap_overflow_enabled', 'true', 'Master switch: bank points clamped by the daily cap (streak overflow) into the Vault instead of dropping them.')
on conflict (key) do nothing;

-- The app reads the vault settings to render the Vault explainer with live
-- numbers. One like-pattern policy replaces the single-key vest-days policy.
drop policy if exists "Authenticated can read vault vest days" on public.system_config;
create policy "Authenticated can read vault settings"
  on public.system_config for select
  to authenticated
  using (key like 'vault\_%');

-- Trigger: read schedule + switches from config on each crossing.
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
  -- Fallbacks hold the shipped schedule if config rows go missing.
  v_enabled       boolean := true;
  v_vest_days     int := 60;
  v_bonus_recruit int := 10;
  v_bonus_athlete int := 50;
  v_bonus_elite   int := 150;
  v_bonus_legend  int := 400;
  cfg record;
  parsed int;
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

  for cfg in
    select key, value from system_config where key like 'vault\_%'
  loop
    if cfg.key = 'vault_level_up_enabled' then
      v_enabled := lower(trim(cfg.value)) <> 'false';
      continue;
    end if;
    parsed := coalesce(nullif(regexp_replace(cfg.value, '\D', '', 'g'), '')::int, -1);
    if parsed < 0 then continue; end if;
    case cfg.key
      when 'vault_vest_days'     then if parsed > 0 then v_vest_days := parsed; end if;
      when 'vault_bonus_recruit' then v_bonus_recruit := parsed;
      when 'vault_bonus_athlete' then v_bonus_athlete := parsed;
      when 'vault_bonus_elite'   then v_bonus_elite   := parsed;
      when 'vault_bonus_legend'  then v_bonus_legend  := parsed;
      else null;
    end case;
  end loop;

  if not v_enabled then
    return new;
  end if;

  select coalesce(sum(amount), 0) into v_ledger
    from point_transactions where user_id = new.user_id and amount > 0;
  select coalesce(sum(amount), 0) into v_vault
    from vault_deposits where user_id = new.user_id and released_at is null;

  -- AFTER INSERT: both sums already include NEW.
  v_after  := v_ledger + v_vault;
  v_before := greatest(v_after - new.amount, 0);

  for i in 1 .. array_length(v_thresholds, 1) loop
    if v_before < v_thresholds[i] and v_after >= v_thresholds[i] then
      v_level := i + 1;
      v_bonus := case
        when v_level <= 5  then v_bonus_recruit
        when v_level <= 10 then v_bonus_athlete
        when v_level <= 15 then v_bonus_elite
        else v_bonus_legend
      end;
      -- amount has a > 0 check; a 0-bonus tier simply banks nothing.
      if v_bonus > 0 then
        insert into vault_deposits (user_id, amount, source, description, level, vests_at)
        values (
          new.user_id, v_bonus, 'level_up',
          'Level ' || v_level || ' bonus', v_level,
          now() + make_interval(days => v_vest_days)
        );
      end if;
    end if;
  end loop;

  return new;
end;
$$;
