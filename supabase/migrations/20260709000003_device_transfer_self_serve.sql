-- Self-service device transfer.
--
-- The one-account-per-device lock (20260706000001) binds a physical device to
-- the first account that signs in on it, and until now the ONLY way to move that
-- binding was an admin pressing "Release Lock". That turns every legitimate phone
-- upgrade / hand-me-down into a support ticket, which does not scale.
--
-- The insight: a legitimate transfer (one account moving to a new device) and an
-- alt-farm attempt (many accounts onto one device) both LOOK like "an account
-- binding a new device_id" — the difference is intent and history, which we can
-- read from the account's existing bindings:
--
--   * The farm pattern is many accounts -> one device. That is already blocked by
--     claim_device: a device already owned by account A refuses account B. Nothing
--     here weakens that — confirm_device_transfer only ever touches the CALLER's
--     OWN bindings, so a farmer gains nothing (still one account per device).
--
--   * The transfer pattern is one account -> a NEW device, abandoning the old one.
--     When the caller is already bound to some device X, is now trying to bind a
--     different device Y, and X is STALE (not seen in `device_transfer_stale_days`),
--     that's an upgrade: migrate the binding silently. If X was seen RECENTLY it's
--     ambiguous, so we don't move it silently — we return 'transfer_available' and
--     the app asks the user to confirm ("Move POWR to this device?"). Either way
--     the user, already authenticated as the account owner, unblocks themselves.
--
-- A rate limit (`device_transfer_max_per_30d`) stops self-transfer from becoming
-- a rotating-device farm: too many moves in 30 days -> 'rate_limited', which the
-- app surfaces as "contact support", i.e. the rare admin case. admin_release_*
-- stays exactly as-is for those.
--
-- Everything is server-side (SECURITY DEFINER) so a client can't spoof the
-- policy, and every path FAILS OPEN — a transfer bug must never lock a user out
-- of their own account.

-- ---------------------------------------------------------------------------
-- Tunable knobs (system_config), so thresholds move without a deploy — same
-- pattern as min_gym_dwell_minutes.
-- ---------------------------------------------------------------------------
insert into public.system_config (key, value, description)
values
  (
    'device_transfer_stale_days',
    '14',
    'A device binding not seen in this many days is treated as abandoned: signing the SAME account into a new device silently migrates the binding (a phone upgrade). Below this it needs a user "Move to this device" confirmation.'
  ),
  (
    'device_transfer_max_per_30d',
    '2',
    'Max self-service device transfers an account may make per rolling 30 days before claim_device returns "rate_limited" (falls through to an admin release). Guards self-transfer against becoming a rotating-device farm.'
  )
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Transfer audit: one row per successful self-serve migration. Backs the rate
-- limit and gives admin a "recent transfers" read to spot abuse of the path.
-- ---------------------------------------------------------------------------
create table if not exists public.device_transfers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  from_device_id text,                                     -- device left behind (null if none / unknown)
  to_device_id   text not null,                            -- device moved to
  kind          text not null,                             -- 'auto' (stale silent) | 'confirmed' (user tapped)
  platform      text,
  created_at    timestamptz not null default now()
);

alter table public.device_transfers enable row level security;

-- Owner may read their own transfer history (diagnostics); all writes go through
-- the definer RPCs. Service role bypasses RLS for admin tooling.
drop policy if exists "users read own device transfers" on public.device_transfers;
create policy "users read own device transfers"
  on public.device_transfers
  for select
  using (auth.uid() = user_id);

create index if not exists idx_device_transfers_user_created
  on public.device_transfers (user_id, created_at desc);

-- Small helpers to read the knobs with safe fallbacks (config row deleted / bad
-- value must not break sign-in).
create or replace function public.device_transfer_stale_days()
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(
    nullif(regexp_replace((select value from public.system_config where key = 'device_transfer_stale_days'), '\D', '', 'g'), '')::int,
    14
  );
$$;

create or replace function public.device_transfer_max_per_30d()
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(
    nullif(regexp_replace((select value from public.system_config where key = 'device_transfer_max_per_30d'), '\D', '', 'g'), '')::int,
    2
  );
$$;

-- ---------------------------------------------------------------------------
-- claim_device v2: same contract as before plus two new stati.
--
--   'ok'                 -> device is (now) bound to the caller
--   'locked'             -> device belongs to a DIFFERENT account (unchanged)
--   'transfer_available' -> device is free/claimable and the CALLER already owns
--                           another, RECENTLY-seen device; the app should offer
--                           "Move to this device?" (confirm_device_transfer)
--   'rate_limited'       -> a transfer is warranted but the account is over the
--                           30-day self-transfer cap; route to support/admin
--   'unauthenticated'    -> no auth.uid() (defensive)
--
-- Auto-migration: if the caller's OTHER binding(s) are all stale, we migrate
-- silently here and return 'ok' — the common phone-upgrade path never surfaces a
-- prompt. Still fails open on a blank/bad device id.
-- ---------------------------------------------------------------------------
create or replace function public.claim_device(p_device_id text, p_platform text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_email        text;
  v_owner        uuid;
  v_stale_days   integer := public.device_transfer_stale_days();
  v_max_30d      integer := public.device_transfer_max_per_30d();
  v_other_count  integer;       -- caller's other bindings (device_id <> this one)
  v_fresh_count  integer;       -- of those, how many seen within the stale window
  v_recent_xfers integer;
  v_from_device  text;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;

  if p_device_id is null or length(trim(p_device_id)) = 0 then
    return jsonb_build_object('status', 'ok', 'bound', false, 'reason', 'no_device_id');
  end if;

  select email into v_email from auth.users where id = v_uid;
  if public.is_device_lock_exempt(v_email) then
    return jsonb_build_object('status', 'ok', 'bound', false, 'reason', 'exempt');
  end if;

  -- Serialise concurrent first-logins for THIS device_id.
  select user_id into v_owner
  from public.device_accounts
  where device_id = p_device_id
  for update;

  -- Case 1: device belongs to a different account -> locked (unchanged behaviour).
  if v_owner is not null and v_owner <> v_uid then
    return jsonb_build_object('status', 'locked');
  end if;

  -- Case 2: device already ours -> refresh + ok.
  if v_owner = v_uid then
    update public.device_accounts
      set last_seen_at = now(),
          platform = coalesce(p_platform, platform)
      where device_id = p_device_id;
    return jsonb_build_object('status', 'ok', 'bound', true);
  end if;

  -- Case 3: device is unclaimed. Does the caller already own OTHER device(s)?
  select
    count(*),
    count(*) filter (where last_seen_at > now() - make_interval(days => v_stale_days))
    into v_other_count, v_fresh_count
  from public.device_accounts
  where user_id = v_uid and device_id <> p_device_id;

  if v_other_count = 0 then
    -- No prior binding — first device for this account. Bind it (grandfather path).
    begin
      insert into public.device_accounts (device_id, user_id, platform)
      values (p_device_id, v_uid, p_platform);
      return jsonb_build_object('status', 'ok', 'bound', true);
    exception when unique_violation then
      -- Lost a race for this device_id — re-read the winner.
      select user_id into v_owner from public.device_accounts where device_id = p_device_id;
      if v_owner = v_uid then
        return jsonb_build_object('status', 'ok', 'bound', true);
      end if;
      return jsonb_build_object('status', 'locked');
    end;
  end if;

  -- Caller owns other device(s) and is now on a new one -> a transfer.
  -- Rate-limit first: too many recent moves routes to admin/support.
  select count(*) into v_recent_xfers
  from public.device_transfers
  where user_id = v_uid and created_at > now() - interval '30 days';

  if v_recent_xfers >= v_max_30d then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  if v_fresh_count = 0 then
    -- All prior devices are stale -> genuine upgrade. Migrate silently.
    select device_id into v_from_device
    from public.device_accounts
    where user_id = v_uid and device_id <> p_device_id
    order by last_seen_at desc
    limit 1;

    delete from public.device_accounts where user_id = v_uid and device_id <> p_device_id;
    begin
      insert into public.device_accounts (device_id, user_id, platform)
      values (p_device_id, v_uid, p_platform);
    exception when unique_violation then
      -- Someone else grabbed this device id in the meantime.
      select user_id into v_owner from public.device_accounts where device_id = p_device_id;
      if v_owner <> v_uid then
        return jsonb_build_object('status', 'locked');
      end if;
    end;

    insert into public.device_transfers (user_id, from_device_id, to_device_id, kind, platform)
    values (v_uid, v_from_device, p_device_id, 'auto', p_platform);

    return jsonb_build_object('status', 'ok', 'bound', true, 'reason', 'auto_transfer');
  end if;

  -- A prior device was seen recently -> ambiguous. Don't move silently; ask the
  -- user to confirm. Surface the recent device's platform + last-seen for copy.
  return (
    select jsonb_build_object(
      'status', 'transfer_available',
      'from_platform', platform,
      'from_last_seen', last_seen_at
    )
    from public.device_accounts
    where user_id = v_uid and device_id <> p_device_id
    order by last_seen_at desc
    limit 1
  );
end;
$$;

revoke all on function public.claim_device(text, text) from anon;
grant execute on function public.claim_device(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- confirm_device_transfer: the user tapped "Move to this device". Releases the
-- caller's OWN prior binding(s) and binds this device. Only ever touches the
-- caller's own rows, so it can't take a device from another account. Honours the
-- same rate limit. Fails open shape-wise (returns a status, never raises for a
-- normal outcome).
-- ---------------------------------------------------------------------------
create or replace function public.confirm_device_transfer(p_device_id text, p_platform text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_email        text;
  v_owner        uuid;
  v_max_30d      integer := public.device_transfer_max_per_30d();
  v_recent_xfers integer;
  v_from_device  text;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;

  if p_device_id is null or length(trim(p_device_id)) = 0 then
    return jsonb_build_object('status', 'ok', 'bound', false, 'reason', 'no_device_id');
  end if;

  select email into v_email from auth.users where id = v_uid;
  if public.is_device_lock_exempt(v_email) then
    return jsonb_build_object('status', 'ok', 'bound', false, 'reason', 'exempt');
  end if;

  -- Lock this device_id row (if any) to serialise against claim_device.
  select user_id into v_owner
  from public.device_accounts
  where device_id = p_device_id
  for update;

  -- Never take a device owned by a different account, even on explicit confirm.
  if v_owner is not null and v_owner <> v_uid then
    return jsonb_build_object('status', 'locked');
  end if;

  select count(*) into v_recent_xfers
  from public.device_transfers
  where user_id = v_uid and created_at > now() - interval '30 days';

  if v_recent_xfers >= v_max_30d then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  select device_id into v_from_device
  from public.device_accounts
  where user_id = v_uid and device_id <> p_device_id
  order by last_seen_at desc
  limit 1;

  delete from public.device_accounts where user_id = v_uid and device_id <> p_device_id;

  if v_owner is null then
    begin
      insert into public.device_accounts (device_id, user_id, platform)
      values (p_device_id, v_uid, p_platform);
    exception when unique_violation then
      select user_id into v_owner from public.device_accounts where device_id = p_device_id;
      if v_owner <> v_uid then
        return jsonb_build_object('status', 'locked');
      end if;
    end;
  else
    -- Already ours — just refresh.
    update public.device_accounts
      set last_seen_at = now(), platform = coalesce(p_platform, platform)
      where device_id = p_device_id;
  end if;

  -- Only log a real move (there was a prior device to leave behind).
  if v_from_device is not null then
    insert into public.device_transfers (user_id, from_device_id, to_device_id, kind, platform)
    values (v_uid, v_from_device, p_device_id, 'confirmed', p_platform);
  end if;

  return jsonb_build_object('status', 'ok', 'bound', true, 'reason', 'confirmed_transfer');
end;
$$;

revoke all on function public.confirm_device_transfer(text, text) from anon;
grant execute on function public.confirm_device_transfer(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin read: recent self-serve transfers for a user, for the admin panel to
-- eyeball abuse of the self-serve path. Self-gated via is_admin().
-- ---------------------------------------------------------------------------
create or replace function public.admin_get_user_device_transfers(p_user_id uuid, p_limit integer default 10)
returns setof public.device_transfers
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return query
    select * from public.device_transfers
    where user_id = p_user_id
    order by created_at desc
    limit greatest(1, coalesce(p_limit, 10));
end;
$$;

revoke all on function public.admin_get_user_device_transfers(uuid, integer) from anon, authenticated;
grant execute on function public.admin_get_user_device_transfers(uuid, integer) to authenticated;
