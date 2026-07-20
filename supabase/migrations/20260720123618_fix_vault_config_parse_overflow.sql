-- ── INCIDENT FIX: point awards have been failing since 2026-07-20 08:07 UTC ──
--
-- SYMPTOM. Every insert into point_transactions with a positive amount threw
--
--     22003: value "2344931894418740637244380" is out of range for type integer
--     CONTEXT: PL/pgSQL function vault_level_up_check() line 39
--
-- so nobody earned anything. Five activity_sessions landed in the first four
-- hours of the outage and none of them paid out. It surfaced as silence rather
-- than as errors anyone was watching, because the throw happens inside a
-- trigger on the write path: the session saves, the award dies.
--
-- CAUSE. vault_level_up_check() reads its tunables with a blanket sweep:
--
--     for cfg in select key, value from system_config where key like 'vault\_%'
--     ...
--     parsed := coalesce(nullif(regexp_replace(cfg.value, '\D', '', 'g'), '')::int, -1);
--
-- It strips non-digits from EVERY key matching vault_*, before ever looking at
-- which key it is holding. That was harmless while every vault_* value was a
-- small number. At 08:07 today vault_rollout was written as a JSON blob:
--
--     {"mode":"targeted","levels":[],"user_ids":["234d49f3-...-063e724e4380"],...}
--
-- Stripping non-digits from a UUID yields a 25-digit number. ::int overflows,
-- the exception propagates out of the trigger, and the INSERT is aborted.
--
-- THE REAL DEFECT is not the arithmetic — it is that a cosmetic config read
-- sits on the critical path of paying members, with no isolation. A typo in a
-- settings row should never be able to stop the app's core transaction. So this
-- fixes three things, narrowest to broadest:
--
--   1. Only the five numeric keys are parsed. Non-numeric vault_* config
--      (vault_rollout, and anything added later) is skipped before the cast,
--      not after.
--   2. The parse is done in bigint and range-checked before narrowing to int,
--      so an out-of-range value yields "ignore it, keep the default" rather
--      than an exception.
--   3. The whole config read is wrapped so that ANY unforeseen failure inside
--      it falls back to the compiled-in defaults and lets the award proceed.
--      Losing a tunable is a cosmetic problem; losing a member's points is not.
--
-- Everything below the config block is unchanged from the previous definition.

create or replace function public.vault_level_up_check()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
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
  v_enabled       boolean := true;
  v_vest_days     int := 60;
  v_bonus_recruit int := 10;
  v_bonus_athlete int := 50;
  v_bonus_elite   int := 150;
  v_bonus_legend  int := 400;
  cfg record;
  parsed bigint;
begin
  if tg_table_name = 'point_transactions' then
    if new.amount <= 0 or new.source = 'vault_release' then
      return new;
    end if;
  else
    if new.source = 'level_up' then
      return new;
    end if;
  end if;

  -- Reading the tunables must never be able to abort the award. If anything in
  -- here goes wrong the defaults above stand and the member still gets paid.
  begin
    for cfg in
      select key, value from system_config where key like 'vault\_%'
    loop
      if cfg.key = 'vault_level_up_enabled' then
        v_enabled := lower(trim(cfg.value)) <> 'false';
        continue;
      end if;

      -- Only these carry a number. Anything else under the vault_ prefix is
      -- skipped BEFORE the cast — vault_rollout is a JSON blob and stripping
      -- its UUIDs to digits is what overflowed int and stopped point awards.
      if cfg.key not in (
        'vault_vest_days', 'vault_bonus_recruit', 'vault_bonus_athlete',
        'vault_bonus_elite', 'vault_bonus_legend'
      ) then
        continue;
      end if;

      -- bigint first, then an explicit range check, so a fat-fingered value is
      -- ignored rather than raised.
      parsed := coalesce(nullif(regexp_replace(cfg.value, '\D', '', 'g'), '')::bigint, -1);
      if parsed < 0 or parsed > 2147483647 then continue; end if;

      case cfg.key
        when 'vault_vest_days'     then if parsed > 0 then v_vest_days := parsed::int; end if;
        when 'vault_bonus_recruit' then v_bonus_recruit := parsed::int;
        when 'vault_bonus_athlete' then v_bonus_athlete := parsed::int;
        when 'vault_bonus_elite'   then v_bonus_elite   := parsed::int;
        when 'vault_bonus_legend'  then v_bonus_legend  := parsed::int;
        else null;
      end case;
    end loop;
  exception when others then
    -- Keep the defaults declared above and carry on.
    null;
  end;

  if not v_enabled then
    return new;
  end if;

  select coalesce(sum(amount), 0) into v_ledger
    from point_transactions where user_id = new.user_id and amount > 0;
  select coalesce(sum(amount), 0) into v_vault
    from vault_deposits where user_id = new.user_id and released_at is null;

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
$function$;

comment on function public.vault_level_up_check() is
  'Awards vault level-up bonuses. Config reads are isolated: only the numeric vault_* keys are parsed, values are range-checked in bigint, and any failure falls back to defaults — a bad settings row must never abort a point award (incident 2026-07-20).';
