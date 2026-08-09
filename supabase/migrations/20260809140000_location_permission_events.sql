-- ---------------------------------------------------------------------------
-- location_permission_events — the history profiles.location_permission never kept.
--
-- WHY. profiles.location_permission is UPDATEd in place by every client, so the
-- single transition that actually matters — a user who was on 'always' and
-- earning passively dropping to 'while_using' — is overwritten and gone. Today
-- that regression is invisible server-side: we can see WHO is mis-configured but
-- never that anyone BECAME mis-configured, which is the only cohort worth
-- reaching (they were earning, they still have notifications on, and they have
-- no idea their check-ins stopped).
--
-- ⚠ NOT A COLUMN ON profiles. Verified live 2026-08-09: profiles carries the
-- policy "Profiles are publicly readable" — cmd SELECT, roles {public}, qual
-- `true`. Anything written there is world-readable, and "this user's background
-- location is off" is a fact about someone's phone, not public profile data.
--
-- ⚠ 'undetermined' IS RECORDED BUT IS NEVER A DOWNGRADE. iOS reports
-- notDetermined before its location manager finishes initialising, and
-- lib/locationPermission.ts dedupes in MODULE scope — so the first (wrong)
-- reading of a cold launch gets pinned for that whole process. A naive reader
-- therefore sees always → undetermined → always and calls the middle row a
-- regression. Every consumer MUST ignore transitions into or out of
-- 'undetermined'; `location_permission_regressions` below is the one that does.
-- ---------------------------------------------------------------------------

create table if not exists public.location_permission_events (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  level          text not null check (level in ('always', 'while_using', 'denied', 'undetermined')),
  -- The value being replaced. Null only for a user's first-ever observation,
  -- which is a BASELINE, not a change — 29 of 70 profiles have no telemetry at
  -- all today, so without this distinction every existing 'while_using' user
  -- would read as a fresh downgrade the moment they first report in.
  previous_level text check (previous_level in ('always', 'while_using', 'denied', 'undetermined')),
  accuracy_m     integer,
  created_at     timestamptz not null default now()
);

comment on table public.location_permission_events is
  'Append-only transitions of a user''s location-permission level. One row per CHANGE, never per report. See 20260809140000 for why ''undetermined'' must never be read as a downgrade.';

create index if not exists location_permission_events_user_time_idx
  on public.location_permission_events (user_id, created_at desc);

alter table public.location_permission_events enable row level security;

-- Read-your-own + admin. Deliberately no client INSERT policy: rows are written
-- exclusively by the security-definer RPC below, so a client can never forge a
-- transition history for itself.
create policy location_permission_events_select_own
  on public.location_permission_events for select
  using (auth.uid() = user_id);

create policy location_permission_events_admin_read
  on public.location_permission_events for select
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- record_location_permission — replaces the client's bare UPDATE on profiles.
--
-- Does both halves atomically: keeps profiles current (the admin panel and every
-- existing consumer still read it) AND appends a history row, but ONLY when the
-- level is actually different. `is distinct from` rather than `<>` so a first
-- observation against a NULL column counts as a change instead of vanishing.
-- ---------------------------------------------------------------------------

create or replace function public.record_location_permission(
  p_level      text,
  p_accuracy_m integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid := auth.uid();
  v_previous text;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_level is null or p_level not in ('always', 'while_using', 'denied', 'undetermined') then
    raise exception 'invalid level: %', p_level;
  end if;

  -- Lock the row so two contexts reporting at once (the auth listener and a
  -- foreground re-check race routinely) cannot both read the old value and
  -- write two rows for one transition.
  select location_permission into v_previous
  from public.profiles
  where id = v_user_id
  for update;

  if v_previous is distinct from p_level then
    insert into public.location_permission_events (user_id, level, previous_level, accuracy_m)
    values (v_user_id, p_level, v_previous, p_accuracy_m);
  end if;

  update public.profiles
  set location_permission            = p_level,
      location_permission_checked_at = now(),
      -- Mirrors the client's rule exactly: a failed accuracy sample on a granted
      -- permission keeps the previous reading (a transient miss is not signal),
      -- while a revoked permission nulls it (any stored value describes nothing).
      location_accuracy_m = case
        when p_accuracy_m is not null then p_accuracy_m
        when p_level in ('denied', 'undetermined') then null
        else location_accuracy_m
      end
  where id = v_user_id;
end;
$$;

revoke all on function public.record_location_permission(text, integer) from public;
-- ⚠ `revoke from public` does NOT remove Supabase's explicit default grant to
-- `anon` — the SECURITY DEFINER lint catches this every time. The function
-- already raises on a null auth.uid(), so this is defence in depth, but the
-- grant must be revoked by name. See project_security_definer_lint.
revoke execute on function public.record_location_permission(text, integer) from anon;
grant execute on function public.record_location_permission(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- location_permission_regressions — the only correct way to read the table.
--
-- Encodes the two rules that keep this honest, so no caller has to remember them:
--   1. 'undetermined' is inconclusive on BOTH sides of a transition (see above).
--   2. A row with previous_level null is a baseline, not a regression.
-- ---------------------------------------------------------------------------

-- ⚠ security_invoker: a Postgres view defaults to running with its OWNER's
-- rights, which would silently bypass the RLS on the table beneath it and let
-- any authenticated user read everyone's regressions. See project_security_definer_lint.
create or replace view public.location_permission_regressions
with (security_invoker = true) as
select
  e.user_id,
  e.previous_level,
  e.level,
  e.created_at
from public.location_permission_events e
where e.previous_level = 'always'
  and e.level in ('while_using', 'denied');

comment on view public.location_permission_regressions is
  'Genuine losses of passive earning: always -> while_using/denied only. Excludes ''undetermined'' on both sides and first-observation baselines.';
