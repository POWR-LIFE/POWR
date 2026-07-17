-- Manual vault unlock: the user cracks the door themselves.
--
-- Matured deposits no longer auto-release at vests_at — they sit "ready"
-- so the user gets the press-and-hold unlock moment in the app. The cron
-- sweep becomes a backstop: it only auto-releases deposits overdue by
-- vault_auto_release_grace_days (admin-tunable, default 7), so a user who
-- never opens the Vault still gets paid out (with the vault_unlocked push).
--
-- claim_my_vault_deposits(): the app-facing release, auth.uid()-scoped.
-- Both paths take the per-user advisory lock (same key as spend_points)
-- and re-check released_at INSIDE the lock, so a manual claim racing the
-- cron (or a double-tap racing itself) can never double-credit.

insert into public.system_config (key, value, description) values
  ('vault_auto_release_grace_days', '7',
   'Days after a Vault deposit matures before the cron auto-releases it. Within the window the user unlocks it themselves in the app (press & hold). 0 = auto-release immediately.')
on conflict (key) do nothing;

-- ── App-facing claim ─────────────────────────────────────────────────────────

create or replace function public.claim_my_vault_deposits()
returns table (points int, deposits int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_pts int;
  v_cnt int;
  v_tx  uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
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

  insert into point_transactions (user_id, amount, type, source, description, multiplier)
  values (v_uid, v_pts, 'bonus', 'vault_release', 'Vault unlocked', 1.0)
  returning id into v_tx;

  update vault_deposits
     set released_at = now(), released_tx = v_tx
   where id = any(v_ids);

  points := v_pts; deposits := v_cnt;
  return next;
end;
$$;

revoke all on function public.claim_my_vault_deposits() from public, anon;
grant execute on function public.claim_my_vault_deposits() to authenticated;

-- ── Cron sweep: grace window + per-user lock ─────────────────────────────────

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
begin
  perform pg_advisory_xact_lock(hashtextextended('vault_release_sweep', 0));

  select coalesce(nullif(regexp_replace(value, '\D', '', 'g'), '')::int, 7)
    into v_grace from system_config where key = 'vault_auto_release_grace_days';
  if v_grace is null or v_grace < 0 then
    v_grace := 7;
  end if;

  for r in
    select distinct vd.user_id as uid
      from vault_deposits vd
     where vd.released_at is null
       and vd.vests_at <= now() - make_interval(days => v_grace)
  loop
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
