-- ---------------------------------------------------------------------------
-- Earn race guard: match ANY client-sourced pair, not only health_sync × health_sync.
--
-- The 2026-08-25 guard (20260825190100) refused a second identical
-- source='health_sync' earn on the same session within 5 s, and only compared
-- it against EXISTING health_sync rows. System Health, 2026-09-05: the two
-- duplicate-earn sessions since then were both a `manual_log` row followed by
-- a `health_sync` row for the same amount, 0.3 s and 2.8 s apart —
-- lib/api/activity.ts logActivity() (the health-import path stamps its earn
-- `manual_log`) and the sync top-up (`health_sync`) crediting the same
-- freshly-imported session from two JS contexts. 5 excess points; they stay,
-- by rule.
--
-- Scope stays CLIENT-ONLY: source in ('health_sync', 'manual_log'). Service-role
-- writers stamp source null (claim-points, upgrade-gym-tier) or their own
-- sources (cap_overflow, terra) and are untouched — the claim/upgrade cap race
-- is the W2 workstream, not this guard. The function name is kept so the
-- trigger (trg_aa_health_sync_earn_race_guard) needs no change.
--
-- Race safety unchanged: per-session advisory xact lock, fresh READ COMMITTED
-- snapshot for the EXISTS. RETURN NULL = silent zero-row insert, exactly what
-- enforce_point_award_cap already does; no client change.
-- ---------------------------------------------------------------------------

create or replace function public.health_sync_earn_race_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.type <> 'earn'
     or new.session_id is null
     or new.source is null
     or new.source not in ('health_sync', 'manual_log') then
    return new;
  end if;

  -- Serialise same-session client writes so the check below is not a
  -- read-then-write race of its own.
  perform pg_advisory_xact_lock(hashtextextended(new.session_id::text, 1));

  if exists (
    select 1
    from public.point_transactions pt
    where pt.session_id = new.session_id
      and pt.type = 'earn'
      and pt.source in ('health_sync', 'manual_log')
      and pt.amount = new.amount
      and pt.created_at >= now() - interval '5 seconds'
  ) then
    raise notice 'health_sync_earn_race_guard: dropped duplicate client earn (session %, amount %, source %)', new.session_id, new.amount, new.source;
    return null;
  end if;

  return new;
end;
$function$;

revoke all on function public.health_sync_earn_race_guard() from public, anon, authenticated;
