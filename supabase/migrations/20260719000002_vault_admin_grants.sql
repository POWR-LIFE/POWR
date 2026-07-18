-- Admin vault grants: put bonus POWR straight into users' vaults.
--
-- A grant banks a normal vault deposit (source 'admin_grant') that vests
-- like any other — counts toward level immediately via the existing
-- trigger, becomes spendable via press-and-hold (or the grace cron) when
-- it matures. Vest window per grant: null = the system default
-- (vault_vest_days), 0 = READY immediately (an instant drop).
--
-- Called from admin → Vault (emails) and admin → user profile (user id).

alter table public.vault_deposits drop constraint vault_deposits_source_check;
alter table public.vault_deposits add constraint vault_deposits_source_check
  check (source in ('level_up', 'cap_overflow', 'admin_grant'));

create or replace function public.admin_grant_vault_deposit(
  p_amount int,
  p_emails text[] default null,
  p_user_ids uuid[] default null,
  p_note text default null,
  p_vest_days int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin     uuid := auth.uid();
  v_ids       uuid[] := '{}';
  v_missing   text[];
  v_vest_days int;
  v_vests_at  timestamptz;
  v_count     int;
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000 then
    raise exception 'amount must be between 1 and 100000';
  end if;

  -- Resolve email targets (typos reported back), then merge explicit ids
  -- (profile page path) — validated so a stale id can't silently no-op.
  if p_emails is not null and coalesce(array_length(p_emails, 1), 0) > 0 then
    select coalesce(array_agg(u.id), '{}') into v_ids
      from auth.users u
     where lower(u.email) = any (select lower(trim(e)) from unnest(p_emails) e where trim(e) <> '');
    select array_agg(e) into v_missing
      from (select lower(trim(e)) as e from unnest(p_emails) e where trim(e) <> '') src
     where not exists (select 1 from auth.users u where lower(u.email) = src.e);
  end if;
  if p_user_ids is not null then
    select array(select distinct x from unnest(v_ids || (
      select coalesce(array_agg(p.id), '{}') from profiles p where p.id = any (p_user_ids)
    )) x) into v_ids;
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'NO_USERS_RESOLVED';
  end if;

  if p_vest_days is null then
    select coalesce(nullif(regexp_replace(value, '\D', '', 'g'), '')::int, 60)
      into v_vest_days from system_config where key = 'vault_vest_days';
    if v_vest_days is null or v_vest_days <= 0 then v_vest_days := 60; end if;
  else
    v_vest_days := greatest(0, least(p_vest_days, 365));
  end if;
  v_vests_at := now() + make_interval(days => v_vest_days);

  insert into vault_deposits (user_id, amount, source, description, vests_at)
  select uid, p_amount, 'admin_grant',
         coalesce(nullif(trim(coalesce(p_note, '')), ''), 'POWR drop'),
         v_vests_at
    from unnest(v_ids) uid;
  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'granted_users', v_count,
    'points_each', p_amount,
    'total_points', v_count * p_amount,
    'vest_days', v_vest_days,
    'missing_emails', to_jsonb(coalesce(v_missing, array[]::text[]))
  );
end;
$$;

revoke all on function public.admin_grant_vault_deposit(int, text[], uuid[], text, int) from public, anon;
grant execute on function public.admin_grant_vault_deposit(int, text[], uuid[], text, int) to authenticated;
