-- ── Tell people when their Vault opens ──────────────────────────────────────
--
-- THE GAP THIS CLOSES. Three vault pushes already existed — vault_granted (an
-- admin banks POWR), vault_ready (an admin unlock EVENT pulls deposits early),
-- and vault_unlocked (the grace-window sweep auto-credits). Between them they
-- covered every path except the ordinary one: a deposit whose vest window
-- simply runs out.
--
-- process_vault_unlock_events() only ever touches rows with vests_at > now(),
-- so natural maturity fired nothing at all. The user's POWR became claimable
-- in silence, and the first they heard of it was `vault_grace_days` later,
-- when vault_unlocked told them it had already been credited — announcing the
-- end of a ceremony they were never invited to.
--
-- ── Design notes ──
--
--  * Idempotency is per DEPOSIT, not per user: `ready_notified_at` is stamped
--    on the exact rows a notification covered. A second deposit maturing next
--    week is a genuinely new event and gets its own push, while the 15-minute
--    cron re-reading the same matured row does not.
--
--  * Gated users are SKIPPED AND LEFT UNSTAMPED, on BOTH gates:
--
--      - below vault_unlock_min_level, the POWR is real but cannot leave, so
--        "your Vault is ready, come and unlock it" would be false;
--      - outside vault_rollout, there is no Vault surface to send them to,
--        and send-push-notification drops vault_* for them anyway.
--
--    In both cases leaving the stamp null means the push fires later, on the
--    first tick after they qualify — which is the moment it becomes true.
--    Checking the rollout HERE rather than relying on the push-path skip is
--    the whole point: that skip happens after this sweep has stamped the row,
--    so it would be permanent, and a user switched on at launch would never
--    hear about POWR that matured while they were outside.
--
--  * Deposits pulled forward by an admin event are stamped by that path too
--    (see the process_vault_unlock_events redefinition below), so the two
--    never double-notify — but again only for users who could have RECEIVED
--    that event's push. Events with notify = false stamp as well: the admin
--    chose silence, and this must not undo that choice a tick later.

alter table public.vault_deposits
  add column if not exists ready_notified_at timestamptz;

comment on column public.vault_deposits.ready_notified_at is
  'When the user was told this deposit had matured. Null = not yet told. Stamped by notify_matured_vault_deposits() and by process_vault_unlock_events().';

-- Partial index matching the sweep's predicate exactly — the cron runs this
-- every 15 minutes forever, and it must never degrade into a seq scan as the
-- deposits table grows.
create index if not exists vault_deposits_ready_unnotified_idx
  on public.vault_deposits (vests_at)
  where released_at is null and ready_notified_at is null;

-- ── Backfill: everything already matured counts as "already told" ───────────
-- ⚠ LOAD-BEARING. Without this, the first cron tick after deploy would treat
-- every historically matured deposit as breaking news and push to every user
-- holding one at once. Nobody is owed a notification about POWR that matured
-- last month, so the slate starts stamped and only NEW maturities notify.
update public.vault_deposits
   set ready_notified_at = now()
 where released_at is null
   and vests_at <= now()
   and ready_notified_at is null;

-- ── The sweep ───────────────────────────────────────────────────────────────

create or replace function public.notify_matured_vault_deposits()
returns table (user_id uuid, points int, deposits int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min int;
begin
  -- Same advisory lock discipline as the other vault cron paths: two
  -- overlapping ticks must not both claim the same rows and double-push.
  perform pg_advisory_xact_lock(hashtextextended('vault_ready_notify', 0));

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

revoke all on function public.notify_matured_vault_deposits() from public, anon, authenticated;

comment on function public.notify_matured_vault_deposits() is
  'Cron sweep: finds deposits that have matured without the user being told, stamps them, and returns per-user totals for the vault_ready push. Skips users below vault_unlock_min_level, leaving them unstamped so they are notified once they qualify.';

-- ── Stamp the admin-event path too, so the two never double-notify ──────────
-- Unchanged from 20260719000001 except for the ready_notified_at stamp on the
-- rows it pulls forward. Those rows land at vests_at = now(), which makes them
-- indistinguishable from natural maturity to the sweep above — without this
-- they would be announced twice, once by each path.

create or replace function public.process_vault_unlock_events()
returns table (user_id uuid, notify boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  ev       record;
  aff      record;
  v_users  int;
  v_points int;
begin
  perform pg_advisory_xact_lock(hashtextextended('vault_unlock_events', 0));

  for ev in
    select * from vault_unlock_events
     where applied_at is null and unlock_at <= now()
     order by unlock_at
  loop
    v_users := 0;
    v_points := 0;

    for aff in
      with hit as (
        update vault_deposits vd
           set vests_at = now(),
               -- This event IS the notification for these rows (or the
               -- admin's decision that there won't be one). Either way the
               -- maturity sweep must not speak for them afterwards.
               --
               -- ⚠ ...but only for users who could actually have RECEIVED it.
               -- An event fires a push through send-push-notification, which
               -- drops vault_* for anyone outside the rollout; stamping them
               -- here would silence the maturity sweep on their behalf too,
               -- and they would never learn the POWR was theirs. Leaving them
               -- null hands them back to the sweep, which notifies them the
               -- moment they are switched on. Existing stamps are preserved
               -- rather than cleared — belt and braces, since this update only
               -- ever touches vests_at > now() rows, which the sweep (matured
               -- rows only) cannot already have stamped.
               ready_notified_at = case
                 when public.vault_has_access(vd.user_id) then now()
                 else vd.ready_notified_at
               end
         where vd.released_at is null
           and vd.vests_at > now()
           and (ev.target = 'all' or vd.user_id = any (ev.user_ids))
        returning vd.user_id, vd.amount
      )
      select hit.user_id as uid, sum(hit.amount)::int as pts
        from hit group by hit.user_id
    loop
      v_users := v_users + 1;
      v_points := v_points + aff.pts;
      user_id := aff.uid;
      notify  := ev.notify;
      return next;
    end loop;

    -- Stamp what this event actually changed (a deposit pulled by an
    -- earlier event this tick can't be counted twice — the update above
    -- only touches vests_at > now()).
    update vault_unlock_events e
       set applied_at = now(), affected_users = v_users, affected_points = v_points
     where e.id = ev.id;
  end loop;
end;
$$;

revoke all on function public.process_vault_unlock_events() from public, anon, authenticated;
