-- ---------------------------------------------------------------------------
-- health_sync earn race guard — the second identical write loses, at the DB.
--
-- The walking sync writes point_transactions from the CLIENT (source =
-- 'health_sync', null description), and two of it can run at once: the
-- foreground hook and the ~15-minute background task are different JS
-- contexts, so the single-flight guard added on 2026-05-29 (walkingSync.ts
-- `_walkingSyncInFlight`) can only ever cover one of them. Both read "no
-- award yet", both insert. The database is the only place both contexts meet.
--
-- System Health, day one (2026-08-25): 21 sessions carry a same-amount earn
-- pair written under 5 s apart — 20 of them health_sync walking sessions, four
-- of those AFTER the client guard (06-21, 06-28, 07-10, 08-18). 40 excess rows,
-- 106 excess points. Those rows are left exactly as they are: this is our
-- fault, not the members', and nothing here touches an existing balance.
--
-- WHAT THIS DOES NOT BLOCK. A walking session is legitimately topped up as the
-- day's steps grow (2 → +1 → +1 …) — enforce_point_award_cap's bound 1 exists
-- to allow exactly that. Those top-ups are minutes or hours apart and usually
-- differ in amount. The race signature is SAME session, SAME amount, within
-- seconds; that is all this refuses. Only source = 'health_sync' — the
-- service-role earn paths (claim-points, upgrade-gym-tier, terra-webhook) are
-- deliberately out of scope here; the 07-02 claim/upgrade overpayment is the
-- W2 cap-race workstream, not this guard.
--
-- HOW IT IS RACE-SAFE. Two concurrent inserts would both pass a plain EXISTS
-- check (neither can see the other's uncommitted row). The per-session
-- advisory lock serialises them: the second insert waits until the first has
-- committed, and its check — a fresh READ COMMITTED snapshot — then sees the
-- row. Same pattern spend_points uses per user. The lock is released at
-- transaction end; each PostgREST insert is its own transaction.
--
-- HOW THE CLIENT SEES IT. RETURN NULL drops the row silently — an insert with
-- zero rows and no error, exactly what enforce_point_award_cap already does
-- when a session is fully paid, so lib/api/activity.ts needs no change and
-- nothing retries into a wall.
-- ---------------------------------------------------------------------------

create or replace function public.health_sync_earn_race_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.type <> 'earn' or new.source is distinct from 'health_sync' or new.session_id is null then
    return new;
  end if;

  -- Serialise same-session health_sync writes so the check below is not a
  -- read-then-write race of its own.
  perform pg_advisory_xact_lock(hashtextextended(new.session_id::text, 1));

  if exists (
    select 1
    from public.point_transactions pt
    where pt.session_id = new.session_id
      and pt.type = 'earn'
      and pt.source = 'health_sync'
      and pt.amount = new.amount
      and pt.created_at >= now() - interval '5 seconds'
  ) then
    raise notice 'health_sync_earn_race_guard: dropped duplicate earn (session %, amount %)', new.session_id, new.amount;
    return null;
  end if;

  return new;
end;
$function$;

revoke all on function public.health_sync_earn_race_guard() from public, anon, authenticated;

-- Named to sort BEFORE trg_enforce_point_award_cap (BEFORE triggers fire in
-- name order): a duplicate is refused before the cap trigger spends two
-- ledger scans on it.
drop trigger if exists trg_aa_health_sync_earn_race_guard on public.point_transactions;
create trigger trg_aa_health_sync_earn_race_guard
  before insert on public.point_transactions
  for each row
  execute function public.health_sync_earn_race_guard();
