-- ── Vault pre-launch hardening ──────────────────────────────────────────────
--
-- Six closures from the 2026-07-21 top-to-bottom audit. Nothing here changes
-- the economy; each item closes a trap found on the launch path.
--
--   1. One level bonus per level, enforced in the schema (+ the trigger made
--      conflict-safe so the index can never abort a point award).
--   2. The maturity stamper respects the vault_ready kill-switch — flipping
--      the rollout on before re-enabling the push types no longer swallows
--      the launch announcements permanently.
--   3. vault_has_access no longer raises (fails CLOSED) on a non-integer
--      levels[] entry in the rollout JSON.
--   4. The authenticated vault-settings read policy stops exposing the
--      vault_rollout blob (it lists the targeted cohort's user uuids).
--   5. admin_vault_stats partitions "vesting" and "ready" instead of
--      double-counting matured POWR in both cards.
--   6. vault_deposits.grant_notified_at — notify-vault-grant claims a batch
--      by stamping it, so a replayed batch_id no-ops instead of re-pushing
--      the whole audience.

-- ── 1a. Schema guard: a user can bank each level's bonus once ───────────────
-- vault_level_up_check computes its crossing from a snapshot sum with no
-- per-user serialization, so two concurrent qualifying credits could each see
-- the same "before" total and both bank the same level's deposit. Only
-- level_up rows carry `level`, so the partial index pins exactly that.
create unique index if not exists vault_deposits_one_bonus_per_level
  on public.vault_deposits (user_id, level)
  where source = 'level_up';

-- ── 1b. The trigger must treat the index as "already banked", not an error ──
-- ⚠ Without ON CONFLICT the loser of the race would RAISE inside a trigger on
-- point_transactions — aborting the member's point award, which is precisely
-- the failure class of the 2026-07-20 outage. Body is the 20260720123618
-- definition verbatim except for the conflict clause on the insert.
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
        )
        -- The concurrent loser (or a re-crossing after a reversal) banks
        -- nothing extra and — critically — raises nothing into the award.
        on conflict (user_id, level) where source = 'level_up' do nothing;
      end if;
    end if;
  end loop;

  return new;
end;
$function$;

comment on function public.vault_level_up_check() is
  'Awards vault level-up bonuses. Config reads are isolated: only the numeric vault_* keys are parsed, values are range-checked in bigint, and any failure falls back to defaults — a bad settings row must never abort a point award (incident 2026-07-20). One bonus per level is schema-enforced (vault_deposits_one_bonus_per_level) with ON CONFLICT DO NOTHING so the guard can never abort an award either.';

-- Hygiene: a trigger function has no business being EXECUTE-able over the API
-- surface. (PostgREST can't actually run it — calling a trigger function
-- raises — but there is no reason to leave the grant lying around.)
revoke all on function public.vault_level_up_check() from public, anon, authenticated;

-- ── 2. Maturity stamper respects the vault_ready kill-switch ────────────────
-- It stamped ready_notified_at whether or not the vault_ready type was
-- enabled, and send-push's admin_disabled skip is a 200 — so a user maturing
-- while the type is held (the pre-launch state) was stamped-and-muted
-- PERMANENTLY, and enabling the rollout before re-enabling the push types
-- would have swallowed the launch announcements wholesale. While the type is
-- off the sweep now leaves every row unstamped, exactly as it already does for
-- users outside the rollout: the first tick after the hold lifts is the one
-- that speaks. Fails OPEN (treats the type as enabled) on any config read
-- error, so a notification_config hiccup cannot mute maturity notices.
create or replace function public.notify_matured_vault_deposits()
returns table (user_id uuid, points int, deposits int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min int;
  v_ready_enabled boolean := true;
begin
  -- Same advisory lock discipline as the other vault cron paths: two
  -- overlapping ticks must not both claim the same rows and double-push.
  perform pg_advisory_xact_lock(hashtextextended('vault_ready_notify', 0));

  begin
    select nm.enabled into v_ready_enabled
      from notification_config nm where nm.type = 'vault_ready';
  exception when others then
    v_ready_enabled := true;
  end;
  if coalesce(v_ready_enabled, true) = false then
    return; -- held: stamp nothing, say nothing, and lose nothing
  end if;

  v_min := public.vault_unlock_min_level();

  -- ⚠ The RETURNING clause aliases to uid/amt rather than carrying user_id
  -- and amount through. Those two names are also this function's OUT
  -- parameters, and plpgsql resolves an ambiguous identifier by raising
  -- rather than guessing — the aliases keep the final select free of any
  -- name that could bind to a variable instead of a column.
  return query
  with due as (
    select vd.id
      from vault_deposits vd
     where vd.released_at is null
       and vd.ready_notified_at is null
       and vd.vests_at <= now()
       -- The gate. `v_min <= 1` short-circuits the per-user level lookup in
       -- the overwhelmingly common case where the Vault is open to everyone.
       and (v_min <= 1 or public.vault_user_level(vd.user_id) >= v_min)
       -- ⚠ The ROLLOUT gate, applied here rather than left to send-push.
       -- send-push-notification does skip vault_* for users outside the
       -- rollout — but by the time it does, this sweep has already stamped
       -- the row, so the skip is permanent. A user switched on at launch
       -- would never hear about POWR that matured while they were outside,
       -- which is precisely the promise the rollout makes ("switch someone
       -- on later and they get everything they already accrued").
       -- Same treatment as the level gate above: leave them UNSTAMPED, and
       -- the first tick after they gain access is the one that tells them.
       and public.vault_has_access(vd.user_id)
  ), stamped as (
    update vault_deposits vd
       set ready_notified_at = now()
      from due
     where vd.id = due.id
    returning vd.user_id as uid, vd.amount as amt
  )
  select s.uid, sum(s.amt)::int, count(*)::int
    from stamped s
   group by s.uid;
end;
$$;

-- ── 3. vault_has_access must not raise on a malformed levels[] entry ────────
-- The exception block only wrapped the ::jsonb cast, so well-formed JSON with
-- a non-integer levels entry ("abc") raised at lv::int — failing CLOSED for
-- the user and aborting whichever sweep RPC asked. Junk entries are now
-- filtered out rather than cast. Body otherwise the 20260719000008 definition.
create or replace function public.vault_has_access(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cfg  jsonb;
  v_mode text;
begin
  if p_user is null then
    return false;
  end if;

  begin
    select value::jsonb into v_cfg from system_config where key = 'vault_rollout';
  exception when others then
    return true; -- malformed JSON: fail open
  end;

  if v_cfg is null then
    return true; -- row missing entirely: fail open
  end if;

  v_mode := coalesce(v_cfg->>'mode', 'all');
  if v_mode = 'all'  then return true;  end if;
  if v_mode = 'none' then return false; end if;

  -- targeted: any rule matching is enough.
  if exists (
    select 1 from jsonb_array_elements_text(coalesce(v_cfg->'user_ids', '[]'::jsonb)) x
     where x = p_user::text
  ) then
    return true;
  end if;

  -- Only pay for the level maths when a levels rule actually exists — this
  -- function runs on app load, and vault_user_level sums two tables.
  if jsonb_array_length(coalesce(v_cfg->'levels', '[]'::jsonb)) > 0 then
    if exists (
      select 1 from jsonb_array_elements_text(v_cfg->'levels') lv
       -- Digits only, BEFORE the cast: a junk entry is a rule that matches
       -- nobody, not an exception that seals the vault and kills the sweep.
       where lv ~ '^\d+$'
         and lv::int = public.vault_user_level(p_user)
    ) then
      return true;
    end if;
  end if;

  if jsonb_array_length(coalesce(v_cfg->'activities', '[]'::jsonb)) > 0 then
    if exists (
      select 1 from profiles p
       where p.id = p_user
         and p.activity_preferences::text[] && (
           select array_agg(a) from jsonb_array_elements_text(v_cfg->'activities') a
         )
    ) then
      return true;
    end if;
  end if;

  return false;
end;
$$;

revoke all on function public.vault_has_access(uuid) from public, anon;
grant execute on function public.vault_has_access(uuid) to authenticated;

-- ── 4. Stop serving the rollout blob to every signed-in user ────────────────
-- The like-pattern policy matched vault_rollout too, exposing the targeted
-- cohort's user uuids to anyone authenticated. The app never reads the raw
-- row — access comes via get_my_vault_access() — and the explainer only needs
-- the numeric/boolean keys.
drop policy if exists "Authenticated can read vault settings" on public.system_config;
create policy "Authenticated can read vault settings"
  on public.system_config for select
  to authenticated
  using (key like 'vault\_%' and key <> 'vault_rollout');

-- ── 5. Stats cards partition instead of overlapping ─────────────────────────
-- "POWR Vesting" summed every unreleased row, so everything READY was counted
-- in both cards and the two numbers could never be read side by side. Vesting
-- now means "still counting down"; ready keeps meaning "matured, unclaimed".
create or replace function public.admin_vault_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_out   jsonb;
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  select jsonb_build_object(
    'vesting_points', coalesce(sum(amount) filter (where vests_at > now()), 0),
    'vesting_users',  count(distinct user_id) filter (where vests_at > now()),
    'ready_points',   coalesce(sum(amount) filter (where vests_at <= now()), 0),
    'ready_users',    count(distinct user_id) filter (where vests_at <= now()),
    -- The staged-rollout view: POWR banked for people who cannot see it yet.
    'hidden_points',  coalesce(sum(amount) filter (where not public.vault_has_access(user_id)), 0),
    'hidden_users',   count(distinct user_id) filter (where not public.vault_has_access(user_id))
  )
  into v_out
  from vault_deposits
  where released_at is null;

  return v_out;
end;
$$;

revoke all on function public.admin_vault_stats() from public, anon;
grant execute on function public.admin_vault_stats() to authenticated;

comment on function public.admin_vault_stats() is
  'Vault economy totals for the admin panel, aggregated in-database so the numbers do not silently cap at PostgREST''s 1000-row ceiling. vesting/ready partition on vests_at; hidden_* is the rollout split (POWR banked for users who cannot yet see the Vault).';

-- ── 6. Grant announcements become claim-once ────────────────────────────────
-- notify-vault-grant re-read the batch on every invocation, so a replayed
-- {batch_id} re-pushed the entire audience. The function now claims rows by
-- stamping this column and fans out only to what the stamp returned.
alter table public.vault_deposits
  add column if not exists grant_notified_at timestamptz;

comment on column public.vault_deposits.grant_notified_at is
  'Stamped by notify-vault-grant when the batch announcement went out. The fan-out claims rows by stamping first, so a replayed batch_id finds nothing and no-ops.';
