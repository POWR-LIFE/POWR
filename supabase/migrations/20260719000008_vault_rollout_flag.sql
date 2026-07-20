-- Vault rollout flag — who can SEE the Vault.
--
-- Staged rollout for an unshipped feature: hide the whole Vault surface (the
-- /vault route, the Rewards widget, vault pushes) from users who are not in the
-- rollout, while the economy underneath keeps running for everyone.
--
-- ── SURFACE ONLY. Deposits keep banking for users who are switched OFF ──────
-- The single most important property here, and the reason the flag lives at the
-- read layer rather than in claim-points or the level trigger. Someone outside
-- the rollout still banks cap-overflow and level bonuses; they simply cannot
-- see them yet. Switching them on later hands over everything they already
-- accrued, so a late invite reads as a reward rather than as three weeks of
-- POWR they missed. Gating the economy instead would make every rollout stage
-- permanently lossy for the people not yet in it.
--
-- ── The rule is LIVE, not a resolved snapshot ──────────────────────────────
-- Unlike grants and unlock events (which resolve their targets to a fixed user
-- list at call time, because they fire once), this is evaluated per request. A
-- user who reaches Legend tomorrow is inside a levels-based rollout tomorrow,
-- with no admin action. That is what makes cohort targeting useful for a
-- rollout rather than just a one-off blast.
--
-- Stored as one JSON blob in system_config so the shape can grow without a
-- migration per field. It is edited from admin → Vault (a real UI with the same
-- chips as the Grant panel), NOT from the System Config text box — that page
-- links out to it via its MANAGED map, the same way weekly_challenges does.
--
--   {"mode": "none" | "all" | "targeted",
--    "user_ids":   [uuid, ...],
--    "levels":     [int, ...],
--    "activities": [text, ...]}
--
-- Seeded to 'targeted' holding ONLY the dev account, resolved by email at apply
-- time rather than hardcoded: the Vault is pre-launch, so the safe default is
-- "nobody but the person building it". Ship-day is a one-click switch to 'all'.

insert into public.system_config (key, value, description)
select
  'vault_rollout',
  jsonb_build_object(
    'mode', 'targeted',
    'user_ids', coalesce(
      (select jsonb_agg(u.id) from auth.users u
        where lower(u.email) = 'jamiemasonwright@gmail.com'), '[]'::jsonb),
    'levels', '[]'::jsonb,
    'activities', '[]'::jsonb
  )::text,
  'Who can see the Vault. Surface only — POWR still banks for everyone, so switching a user on later hands them everything already accrued. Edited from admin → Vault.'
on conflict (key) do nothing;

-- ── The rule ────────────────────────────────────────────────────────────────
-- STABLE so a query calling it per row can cache it. Fails OPEN on malformed
-- JSON: a broken config row should not black out a shipped feature for the
-- whole userbase. (The opposite default to vault_unlock_min_level, which fails
-- open in the sense of UNLOCKING — both err toward the user keeping access.)

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
       where lv::int = public.vault_user_level(p_user)
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

-- ── App-facing read ─────────────────────────────────────────────────────────
-- Deliberately its own tiny RPC rather than a field on get_my_vault_outlook:
-- the answer is needed on the Rewards tab and at the route guard, i.e. before
-- anything vault-shaped is fetched, and it must stay cheap enough to sit on the
-- app-load path.

create or replace function public.get_my_vault_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.vault_has_access(auth.uid());
$$;

revoke all on function public.get_my_vault_access() from public, anon;
grant execute on function public.get_my_vault_access() to authenticated;

-- ── Admin setter ────────────────────────────────────────────────────────────
-- Validates and normalises rather than trusting the panel: this row is read by
-- a STABLE function on the app-load path, so junk in it is expensive.

create or replace function public.admin_set_vault_rollout(
  p_mode text,
  p_emails text[] default null,
  p_levels int[] default null,
  p_activities text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin   uuid := auth.uid();
  v_ids     uuid[] := '{}';
  v_missing text[];
  v_cfg     jsonb;
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;
  if p_mode is null or p_mode not in ('none', 'all', 'targeted') then
    raise exception 'mode must be none, all or targeted';
  end if;

  if p_mode = 'targeted' and p_emails is not null and coalesce(array_length(p_emails, 1), 0) > 0 then
    select coalesce(array_agg(u.id), '{}') into v_ids
      from auth.users u
     where lower(u.email) = any (select lower(trim(e)) from unnest(p_emails) e where trim(e) <> '');
    select array_agg(e) into v_missing
      from (select lower(trim(e)) as e from unnest(p_emails) e where trim(e) <> '') src
     where not exists (select 1 from auth.users u where lower(u.email) = src.e);
  end if;

  v_cfg := jsonb_build_object(
    'mode', p_mode,
    'user_ids', case when p_mode = 'targeted'
      then coalesce((select jsonb_agg(x) from unnest(v_ids) x), '[]'::jsonb) else '[]'::jsonb end,
    'levels', case when p_mode = 'targeted'
      then coalesce((select jsonb_agg(x) from unnest(coalesce(p_levels, '{}')) x
                      where x between 1 and 20), '[]'::jsonb) else '[]'::jsonb end,
    'activities', case when p_mode = 'targeted'
      then coalesce((select jsonb_agg(x) from unnest(coalesce(p_activities, '{}')) x), '[]'::jsonb)
      else '[]'::jsonb end
  );

  update system_config set value = v_cfg::text where key = 'vault_rollout';
  if not found then
    insert into system_config (key, value, description)
    values ('vault_rollout', v_cfg::text, 'Who can see the Vault.');
  end if;

  return jsonb_build_object(
    'config', v_cfg,
    'resolved_users', coalesce(array_length(v_ids, 1), 0),
    'missing_emails', to_jsonb(coalesce(v_missing, array[]::text[]))
  );
end;
$$;

revoke all on function public.admin_set_vault_rollout(text, text[], int[], text[]) from public, anon;
grant execute on function public.admin_set_vault_rollout(text, text[], int[], text[]) to authenticated;

-- Admins need to read back who is currently in the rollout to render the panel
-- (emails, not raw ids — the panel edits by email).
create or replace function public.admin_get_vault_rollout()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_cfg   jsonb;
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;

  select value::jsonb into v_cfg from system_config where key = 'vault_rollout';
  if v_cfg is null then
    return jsonb_build_object('mode', 'all', 'emails', '[]'::jsonb,
                              'levels', '[]'::jsonb, 'activities', '[]'::jsonb);
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
    'activities', coalesce(v_cfg->'activities', '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_get_vault_rollout() from public, anon;
grant execute on function public.admin_get_vault_rollout() to authenticated;
