-- Minimum level to open the Vault.
--
-- `vault_unlock_min_level` seals the Vault below a level: deposits still bank,
-- still vest, still count toward level immediately — but nothing leaves the
-- Vault until the user reaches the floor. 1 = off (everyone is at least 1),
-- which is the shipped default.
--
-- ── The auto-release MUST be suspended below the floor ──────────────────────
-- This is what makes the gate real rather than cosmetic. release_due_vault_
-- deposits() auto-credits anything overdue by the grace window; if that kept
-- running for gated users they could simply wait ~grace days past vesting and
-- be paid out regardless of level. So the sweep now skips users under the
-- floor, and their POWR accumulates instead. Both doors — the manual claim and
-- the cron backstop — check the same threshold.
--
-- ── It can never self-lock ──────────────────────────────────────────────────
-- Vaulted POWR counts toward lifetime earned the moment it is banked (the
-- level basis is ledger positives + PENDING vault, unchanged here), so a gated
-- user's own sealed POWR still pushes them toward the level that frees it.
-- Being gated slows the payout; it cannot trap someone below the threshold.
--
-- ── Interaction with Vault Day ──────────────────────────────────────────────
-- Unlock events govern VESTING (they pull vests_at forward); the floor governs
-- CLAIMING. A scheduled unlock aimed at a gated user therefore makes their
-- deposits ready-but-sealed. Deliberate: an admin lowering the floor is the
-- lever for letting them out, not a special case buried in the event path.
--
-- Supersedes the level-as-early-unlock trigger built earlier the same day
-- (`vault_unlock_on_levels`): Jamie wanted a floor, not a shortcut. That key is
-- removed rather than left dormant — two adjacent config keys with near
-- identical names and OPPOSITE effects is a footgun, and putting a level in the
-- wrong box would do the reverse of what was intended.

delete from public.system_config where key = 'vault_unlock_on_levels';

insert into public.system_config (key, value, description) values
  ('vault_unlock_min_level', '1',
   'Minimum level before a user can take POWR out of their Vault. Below it deposits still bank, vest and count toward level, but neither the press-and-hold unlock nor the auto-release will pay out. 1 = off.')
on conflict (key) do nothing;

-- ── Trigger back to its pre-early-unlock shape ──────────────────────────────
-- Identical to 20260718000004 (the level bonus schedule + master switch); the
-- vault_unlock_on_levels event queueing is gone.

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

-- ── Shared threshold read ───────────────────────────────────────────────────
-- One definition for both doors, so the manual claim and the sweep can never
-- disagree about who is sealed. Clamped 1..20; junk or a missing row = 1 (off),
-- because a config typo must open the Vault, never lock it.

create or replace function public.vault_unlock_min_level()
returns int
language sql
stable
set search_path = public
as $$
  select greatest(1, least(20, coalesce(
    (select nullif(regexp_replace(value, '\D', '', 'g'), '')::int
       from system_config where key = 'vault_unlock_min_level'), 1)));
$$;

grant execute on function public.vault_unlock_min_level() to authenticated;

-- Lifetime earned → level, for a given user. Same basis as the level trigger
-- and get_my_points_summary.total_earned: ledger positives + PENDING vault.
create or replace function public.vault_user_level(p_user uuid)
returns int
language sql
stable
set search_path = public
as $$
  select public.vault_level_for_xp(
      coalesce((select sum(t.amount) from point_transactions t
                 where t.user_id = p_user and t.amount > 0), 0)
    + coalesce((select sum(d.amount) from vault_deposits d
                 where d.user_id = p_user and d.released_at is null), 0)
  );
$$;

grant execute on function public.vault_user_level(uuid) to authenticated;

-- ── Door 1: the manual press-and-hold claim ─────────────────────────────────
-- Raises rather than returning 0 deposits: a stale client that still offers the
-- control should surface a failure, not a silent no-op the user reads as the
-- vault being empty.

create or replace function public.claim_my_vault_deposits()
returns table (points int, deposits int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_ids    uuid[];
  v_pts    int;
  v_cnt    int;
  v_tx     uuid;
  v_min    int;
  v_claims text := current_setting('request.jwt.claims', true);
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  v_min := public.vault_unlock_min_level();
  if v_min > 1 and public.vault_user_level(v_uid) < v_min then
    raise exception 'VAULT_LOCKED_LEVEL_%', v_min;
  end if;

  -- Same per-user lock as spend_points: serialises against concurrent
  -- claims, spends, and the cron sweep.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  select array_agg(id), coalesce(sum(amount), 0)::int, count(*)::int
    into v_ids, v_pts, v_cnt
    from vault_deposits
   where user_id = v_uid and released_at is null and vests_at <= now();

  if v_cnt = 0 or v_pts <= 0 then
    points := 0; deposits := 0;
    return next;
    return;
  end if;

  -- Trusted award: elevate so enforce_point_award_cap passes this
  -- non-session bonus row through, exactly as it does for the cron sweep
  -- (which runs as service role). See 20260718000006.
  perform set_config(
    'request.jwt.claims',
    (coalesce(nullif(v_claims, '')::jsonb, '{}'::jsonb)
       || jsonb_build_object('role', 'service_role'))::text,
    true
  );

  insert into point_transactions (user_id, amount, type, source, description, multiplier)
  values (v_uid, v_pts, 'bonus', 'vault_release', 'Vault unlocked', 1.0)
  returning id into v_tx;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  update vault_deposits
     set released_at = now(), released_tx = v_tx
   where id = any(v_ids);

  points := v_pts; deposits := v_cnt;
  return next;
end;
$$;

revoke all on function public.claim_my_vault_deposits() from public, anon;
grant execute on function public.claim_my_vault_deposits() to authenticated;

-- ── Door 2: the grace-window auto-release ───────────────────────────────────
-- THE load-bearing half of the gate. Without this skip a gated user just waits
-- out the grace window and gets paid anyway.

create or replace function public.release_due_vault_deposits()
returns table (user_id uuid, points int, deposits int)
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_ids   uuid[];
  v_pts   int;
  v_cnt   int;
  v_tx    uuid;
  v_grace int := 7;
  v_min   int;
begin
  perform pg_advisory_xact_lock(hashtextextended('vault_release_sweep', 0));

  select coalesce(nullif(regexp_replace(value, '\D', '', 'g'), '')::int, 7)
    into v_grace from system_config where key = 'vault_auto_release_grace_days';
  if v_grace is null or v_grace < 0 then
    v_grace := 7;
  end if;

  v_min := public.vault_unlock_min_level();

  for r in
    select distinct vd.user_id as uid
      from vault_deposits vd
     where vd.released_at is null
       and vd.vests_at <= now() - make_interval(days => v_grace)
  loop
    -- Sealed below the floor: leave the deposits banked and move on. They
    -- stay due, so the next sweep after they level up pays out in full.
    if v_min > 1 and public.vault_user_level(r.uid) < v_min then
      continue;
    end if;

    -- Lock the user, then RE-SELECT inside the lock: a manual claim may have
    -- released these rows between the outer scan and here.
    perform pg_advisory_xact_lock(hashtextextended(r.uid::text, 0));

    select array_agg(id), coalesce(sum(amount), 0)::int, count(*)::int
      into v_ids, v_pts, v_cnt
      from vault_deposits
     where vault_deposits.user_id = r.uid
       and released_at is null
       and vests_at <= now() - make_interval(days => v_grace);

    if v_cnt = 0 or v_pts <= 0 then
      continue;
    end if;

    insert into point_transactions (user_id, amount, type, source, description, multiplier)
    values (r.uid, v_pts, 'bonus', 'vault_release', 'Vault unlocked', 1.0)
    returning id into v_tx;

    update vault_deposits
       set released_at = now(), released_tx = v_tx
     where id = any(v_ids);

    user_id  := r.uid;
    points   := v_pts;
    deposits := v_cnt;
    return next;
  end loop;
end;
$$;

revoke all on function public.release_due_vault_deposits() from public, anon, authenticated;

-- ── Outlook: the gate, stated ───────────────────────────────────────────────
-- Replaces next_unlock_level (the early-unlock shortcut) with the floor. A
-- sealed vault MUST say why it is sealed and what opens it, or a user with
-- matured POWR and a dead control has no way to find out.

drop function if exists public.get_my_vault_outlook();

create function public.get_my_vault_outlook()
returns table (
  grace_days       int,
  auto_release_at  timestamptz,
  next_unlock_at   timestamptz,
  next_unlock_note text,
  min_level        int,
  current_level    int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_grace   int := 7;
  v_soonest timestamptz;
  v_pending boolean;
  v_gated   boolean;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select coalesce(nullif(regexp_replace(value, '\D', '', 'g'), '')::int, 7)
    into v_grace from system_config where key = 'vault_auto_release_grace_days';
  if v_grace is null or v_grace < 0 then
    v_grace := 7;
  end if;
  grace_days := v_grace;

  min_level     := public.vault_unlock_min_level();
  current_level := public.vault_user_level(v_uid);
  v_gated       := min_level > 1 and current_level < min_level;

  -- The backstop date is a promise the sweep will not keep while sealed, so
  -- a gated user is told nothing about auto-release. Their matured POWR waits.
  select min(vests_at) into v_soonest
    from vault_deposits
   where user_id = v_uid and released_at is null and vests_at <= now();
  auto_release_at := case
    when v_gated or v_soonest is null then null
    else v_soonest + make_interval(days => v_grace)
  end;

  select exists (
    select 1 from vault_deposits
     where user_id = v_uid and released_at is null and vests_at > now()
  ) into v_pending;

  select e.unlock_at, e.note
    into next_unlock_at, next_unlock_note
    from vault_unlock_events e
   where e.applied_at is null
     and e.unlock_at > now()
     and e.notify
     and (e.target = 'all' or v_uid = any (e.user_ids))
   order by e.unlock_at
   limit 1;

  -- An unlock the user has nothing to gain from is noise, not anticipation:
  -- nothing vesting, or sealed by the floor so the event cannot pay out.
  if next_unlock_at is not null and (not v_pending or v_gated) then
    next_unlock_at := null;
    next_unlock_note := null;
  end if;

  return next;
end;
$$;

revoke all on function public.get_my_vault_outlook() from public, anon;
grant execute on function public.get_my_vault_outlook() to authenticated;
