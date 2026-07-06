-- One-account-per-device lock.
--
-- Anti alt-account farming: once a device signs in with an account, that
-- physical device is bound to that account. Logging out and signing in with a
-- DIFFERENT account on the same device is refused. This complements the existing
-- one-device-per-account rule (auth: new login revokes other sessions) — that
-- one stops account sharing across phones; this one stops many accounts on one
-- phone.
--
-- Enforcement is server-side via claim_device() (SECURITY DEFINER) so a client
-- can never read/spoof another user's binding. The client calls it right after
-- sign-in and signs the session back out on a 'locked' result.

create table if not exists public.device_accounts (
  device_id     text primary key,                                   -- durable per-device id (IDFV / SSAID / stored fallback)
  user_id       uuid not null references auth.users(id) on delete cascade,
  platform      text,
  locked_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

alter table public.device_accounts enable row level security;

-- The owner can read their own binding (UX / diagnostics). All writes go through
-- the definer RPCs below — no direct client insert/update/delete. Service role
-- bypasses RLS for admin tooling.
drop policy if exists "users read own device binding" on public.device_accounts;
create policy "users read own device binding"
  on public.device_accounts
  for select
  using (auth.uid() = user_id);

create index if not exists idx_device_accounts_user on public.device_accounts (user_id);

-- Emails exempt from the device lock (dev/test rigs that intentionally run many
-- accounts across builds). Mirrors DEV_TEST_EMAILS on the edge-function side.
-- Single place to edit.
create or replace function public.is_device_lock_exempt(p_email text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_email, '')) in (
    'jamiemasonwright@gmail.com',
    'bluegigsolutions@gmail.com'
  );
$$;

-- Bind the calling device to the current user, or report a conflict.
--   status 'ok'             -> device is (now) bound to the caller
--   status 'locked'         -> device already belongs to a DIFFERENT account
--   status 'unauthenticated'-> no auth.uid() (defensive)
-- Fails OPEN on a missing/blank device id so a bad client id can never lock a
-- user out of their own account.
create or replace function public.claim_device(p_device_id text, p_platform text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_owner uuid;
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

  -- Serialise concurrent first-logins for the same device_id.
  select user_id into v_owner
  from public.device_accounts
  where device_id = p_device_id
  for update;

  if v_owner is null then
    begin
      insert into public.device_accounts (device_id, user_id, platform)
      values (p_device_id, v_uid, p_platform);
      return jsonb_build_object('status', 'ok', 'bound', true);
    exception when unique_violation then
      -- Lost a race — re-read who won.
      select user_id into v_owner from public.device_accounts where device_id = p_device_id;
    end;
  end if;

  if v_owner = v_uid then
    update public.device_accounts
      set last_seen_at = now(),
          platform = coalesce(p_platform, platform)
      where device_id = p_device_id;
    return jsonb_build_object('status', 'ok', 'bound', true);
  end if;

  return jsonb_build_object('status', 'locked');
end;
$$;

revoke all on function public.claim_device(text, text) from anon;
grant execute on function public.claim_device(text, text) to authenticated;

-- Admin: release a device so a new account can bind to it (new phone / sold /
-- mistaken first login). Self-gated via is_admin().
create or replace function public.admin_release_device(p_device_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  delete from public.device_accounts where device_id = p_device_id;
  return found;
end;
$$;

revoke all on function public.admin_release_device(text) from anon, authenticated;
grant execute on function public.admin_release_device(text) to authenticated;

-- Admin: release every device bound to a user (the by-user entry point the admin
-- panel uses — an admin has a user in front of them, not a device id). Returns
-- the number of bindings cleared.
create or replace function public.admin_release_user_devices(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  with deleted as (
    delete from public.device_accounts where user_id = p_user_id returning 1
  )
  select count(*) into v_count from deleted;
  return v_count;
end;
$$;

revoke all on function public.admin_release_user_devices(uuid) from anon, authenticated;
grant execute on function public.admin_release_user_devices(uuid) to authenticated;

-- Admin read: the device binding(s) for a user, for the admin panel to display.
create or replace function public.admin_get_user_devices(p_user_id uuid)
returns setof public.device_accounts
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return query
    select * from public.device_accounts where user_id = p_user_id order by last_seen_at desc;
end;
$$;

revoke all on function public.admin_get_user_devices(uuid) from anon, authenticated;
grant execute on function public.admin_get_user_devices(uuid) to authenticated;
