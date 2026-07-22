-- ── Vault launch countdown ──────────────────────────────────────────────────
--
-- One new lever: `vault_launch_at` (system_config, ISO-8601 UTC). It is the
-- moment the Vault opens for EVERYONE — the scheduled end of the staged
-- rollout, so nobody has to be at the switch at midnight.
--
--   Pre-launch   rollout mode 'targeted' (or 'none'): users outside the
--                cohort see the app's COMING SOON state, counting down to
--                this timestamp. POWR keeps banking for them throughout, as
--                it always has (the rollout is surface-only).
--   At launch    vault_has_access() starts answering TRUE for everyone the
--                instant now() passes the timestamp — no admin action, no
--                cron tick. The client invalidates its access query as its
--                own countdown hits zero, so the door appears live.
--   After        flipping rollout mode to 'all' from the panel is optional
--                hygiene; access is already universal via the timestamp.
--
-- Ordering inside vault_has_access, deliberately:
--   mode 'none'  → still FALSE. The kill switch outranks the schedule, so an
--                  emergency "Nobody" on launch morning doesn't need a second
--                  knob cleared to actually hold the doors. (The admin panel
--                  warns that the app keeps counting down while a launch date
--                  is set with mode 'none' — clear the date too unless the
--                  plan is to re-open.)
--   launch check → then, before the targeted rules: a passed launch admits
--                  users no targeted rule matches, which is the whole point.
--
-- WHY ITS OWN ROW, not a field in the vault_rollout blob: the client needs to
-- read the date to draw the countdown, and vault_rollout is deliberately
-- excluded from the authenticated read policy (it lists cohort uuids — see
-- 20260721000001 §4). A separate vault_% key is served by the existing policy
-- as-is. It is also invisible to the numeric-config parser in
-- vault_level_up_check, which whitelists the five numeric keys and skips
-- everything else BEFORE any cast (incident 2026-07-20) — a timestamp string
-- here cannot touch the award path.
--
-- No seed: absence (or blank) means "no launch scheduled", and the app shows
-- exactly what it shows today — nothing.

-- ── 1. vault_has_access honours the schedule ────────────────────────────────
-- Body is the 20260721000001 definition verbatim plus the launch check; same
-- fail-open posture throughout (a junk date is no rule, never an exception —
-- this runs on the app-load path and inside the notify sweep).
create or replace function public.vault_has_access(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cfg    jsonb;
  v_mode   text;
  v_launch text;
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

  -- Scheduled launch: once vault_launch_at passes, 'targeted' opens to
  -- everyone. Checked after 'none' (the kill switch wins) and before the
  -- cohort rules (a passed launch admits people no rule matches).
  begin
    select nullif(trim(value), '') into v_launch
      from system_config where key = 'vault_launch_at';
    if v_launch is not null and v_launch::timestamptz <= now() then
      return true;
    end if;
  exception when others then
    null; -- unparseable date: no launch rule; the cohort rules below still apply
  end;

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

comment on function public.vault_has_access(uuid) is
  'Who can SEE the Vault (surface only — POWR banks regardless). mode all/none/targeted from vault_rollout, plus vault_launch_at: once that timestamp passes, targeted mode answers true for everyone (the scheduled launch). none still wins. Fails open on malformed config; junk cohort entries and junk dates are rules that match nobody, never exceptions.';

-- ── 2. Admin setter ─────────────────────────────────────────────────────────
-- NULL clears the schedule (row deleted — absence is the "no launch" state
-- the client and resolver both already understand). Stored as strict UTC ISO
-- with the T and Z, because the app's JS Date parsing is only guaranteed for
-- that shape — not for Postgres' default `2026-07-25 18:00:00+00` rendering.
create or replace function public.admin_set_vault_launch(p_launch_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_iso   text;
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  if p_launch_at is null then
    delete from system_config where key = 'vault_launch_at';
    return jsonb_build_object('launch_at', null);
  end if;

  v_iso := to_char(p_launch_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  update system_config set value = v_iso where key = 'vault_launch_at';
  if not found then
    insert into system_config (key, value, description)
    values (
      'vault_launch_at', v_iso,
      'When the Vault opens for everyone (UTC). Countdown target for the app''s coming-soon state; vault_has_access answers true for all users once this passes. Absent/blank = no launch scheduled. Edited from admin → Vault.'
    );
  end if;

  return jsonb_build_object('launch_at', v_iso);
end;
$$;

revoke all on function public.admin_set_vault_launch(timestamptz) from public, anon;
grant execute on function public.admin_set_vault_launch(timestamptz) to authenticated;

-- ── 3. Panel read-back carries the schedule ─────────────────────────────────
-- Body is the 20260719000008 definition plus `launch_at` — additive, so the
-- currently-deployed panel keeps working against the new shape.
create or replace function public.admin_get_vault_rollout()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin  uuid := auth.uid();
  v_cfg    jsonb;
  v_launch text;
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  select nullif(trim(value), '') into v_launch
    from system_config where key = 'vault_launch_at';

  select value::jsonb into v_cfg from system_config where key = 'vault_rollout';
  if v_cfg is null then
    return jsonb_build_object('mode', 'all', 'emails', '[]'::jsonb,
                              'levels', '[]'::jsonb, 'activities', '[]'::jsonb,
                              'launch_at', v_launch);
  end if;

  return jsonb_build_object(
    'mode', coalesce(v_cfg->>'mode', 'all'),
    'emails', coalesce((
      select jsonb_agg(u.email order by u.email)
        from auth.users u
       where u.id::text in (
         select x from jsonb_array_elements_text(coalesce(v_cfg->'user_ids', '[]'::jsonb)) x)
    ), '[]'::jsonb),
    'levels', coalesce(v_cfg->'levels', '[]'::jsonb),
    'activities', coalesce(v_cfg->'activities', '[]'::jsonb),
    'launch_at', v_launch
  );
end;
$$;

revoke all on function public.admin_get_vault_rollout() from public, anon;
grant execute on function public.admin_get_vault_rollout() to authenticated;
