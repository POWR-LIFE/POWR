-- Tell users when an admin drops POWR into their Vault.
--
-- Before this, a grant was silent: admin_grant_vault_deposit inserted the
-- deposit and nothing else. The only triggers on vault_deposits are the
-- level_up email (source-gated) and the level check, so the user found out
-- either by opening the Vault or — up to `vest_days + grace` later — when the
-- release sweep auto-credited it. An instant drop (vest_days 0) was the worst
-- case: ready to claim immediately, announced 7 days after the fact.
--
-- Grants now carry a batch id and fire a `vault_granted` push, mirroring the
-- p_notify switch the scheduled-unlock path already has. The batch is the
-- handle the notifier reads back (constant-size pg_net body regardless of
-- audience) and doubles as an audit grouping for "which drop was this".

alter table public.vault_deposits add column if not exists grant_batch uuid;
create index if not exists vault_deposits_grant_batch_idx
  on public.vault_deposits (grant_batch) where grant_batch is not null;

create or replace function public.admin_grant_vault_deposit(
  p_amount int,
  p_emails text[] default null,
  p_user_ids uuid[] default null,
  p_note text default null,
  p_vest_days int default null,
  p_all boolean default false,
  p_levels int[] default null,
  p_activities text[] default null,
  p_notify boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- xpMin per level 2..20 — MUST mirror constants/levels.ts LEVELS[].xpMin.
  v_thresholds constant bigint[] := array[
    500, 1200, 2500, 4500, 7000, 10000, 14000, 19000, 25000, 32500,
    41000, 51000, 63000, 77000, 93000, 111000, 132000, 156000, 182000
  ];
  v_admin     uuid := auth.uid();
  v_ids       uuid[] := '{}';
  v_more      uuid[];
  v_missing   text[];
  v_vest_days int;
  v_vests_at  timestamptz;
  v_count     int;
  v_batch     uuid := gen_random_uuid();
  v_token     text;
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000 then
    raise exception 'amount must be between 1 and 100000';
  end if;

  if p_all then
    select coalesce(array_agg(id), '{}') into v_ids from profiles;
  else
    if p_emails is not null and coalesce(array_length(p_emails, 1), 0) > 0 then
      select coalesce(array_agg(u.id), '{}') into v_ids
        from auth.users u
       where lower(u.email) = any (select lower(trim(e)) from unnest(p_emails) e where trim(e) <> '');
      select array_agg(e) into v_missing
        from (select lower(trim(e)) as e from unnest(p_emails) e where trim(e) <> '') src
       where not exists (select 1 from auth.users u where lower(u.email) = src.e);
    end if;

    if p_user_ids is not null and coalesce(array_length(p_user_ids, 1), 0) > 0 then
      select coalesce(array_agg(p.id), '{}') into v_more from profiles p where p.id = any (p_user_ids);
      v_ids := v_ids || v_more;
    end if;

    if p_levels is not null and coalesce(array_length(p_levels, 1), 0) > 0 then
      with lifetime as (
        select p.id as uid,
               coalesce((select sum(t.amount) from point_transactions t
                          where t.user_id = p.id and t.amount > 0), 0)
             + coalesce((select sum(d.amount) from vault_deposits d
                          where d.user_id = p.id and d.released_at is null), 0) as xp
          from profiles p
      )
      select coalesce(array_agg(uid), '{}') into v_more
        from lifetime
       where (1 + (select count(*) from unnest(v_thresholds) th where th <= lifetime.xp))::int = any (p_levels);
      v_ids := v_ids || v_more;
    end if;

    if p_activities is not null and coalesce(array_length(p_activities, 1), 0) > 0 then
      -- activity_preferences is an activity_type[] enum array — compare as text.
      select coalesce(array_agg(p.id), '{}') into v_more
        from profiles p
       where p.activity_preferences::text[] && p_activities;
      v_ids := v_ids || v_more;
    end if;

    select array(select distinct x from unnest(v_ids) x) into v_ids;
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

  insert into vault_deposits (user_id, amount, source, description, vests_at, grant_batch)
  select uid, p_amount, 'admin_grant',
         coalesce(nullif(trim(coalesce(p_note, '')), ''), 'POWR drop'),
         v_vests_at, v_batch
    from unnest(v_ids) uid;
  get diagnostics v_count = row_count;

  -- Fire-and-forget push fan-out. pg_net queues the request, so a slow or
  -- down notifier can never hold up (or roll back) the grant itself.
  if p_notify then
    begin
      select decrypted_secret into v_token
        from vault.decrypted_secrets where name = 'shared_resolve_token';

      perform net.http_post(
        url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/notify-vault-grant',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-resolve-token', coalesce(v_token, '')
        ),
        body := jsonb_build_object('batch_id', v_batch)
      );
    exception when others then
      -- Never let push plumbing break the grant.
      null;
    end;
  end if;

  return jsonb_build_object(
    'granted_users', v_count,
    'points_each', p_amount,
    'total_points', v_count * p_amount,
    'vest_days', v_vest_days,
    'batch_id', v_batch,
    'notified', p_notify,
    'missing_emails', to_jsonb(coalesce(v_missing, array[]::text[]))
  );
end;
$$;

revoke all on function public.admin_grant_vault_deposit(int, text[], uuid[], text, int, boolean, int[], text[], boolean) from public, anon;
grant execute on function public.admin_grant_vault_deposit(int, text[], uuid[], text, int, boolean, int[], text[], boolean) to authenticated;

-- The 8-arg predecessor is superseded — drop so PostgREST doesn't face an
-- ambiguous overload when the panel calls with named params.
drop function if exists public.admin_grant_vault_deposit(int, text[], uuid[], text, int, boolean, int[], text[]);

-- Register the vault push family in notification_config so the admin
-- Notifications tab can see, disable, and re-word them. That tab lists rows
-- (it does not carry a hardcoded type list) and edits with UPDATE ... eq(type),
-- so an unseeded type is invisible and unmanageable. vault_unlocked and
-- vault_ready shipped without rows — backfill them here alongside the new one.
-- enabled defaults true, so seeding changes no behaviour, only visibility.
insert into public.notification_config (type, category, description) values
  ('vault_granted',  'rewards', 'Sent when an admin banks a POWR drop into a user''s Vault'),
  ('vault_ready',    'rewards', 'Sent when vault deposits finish vesting and can be press-and-hold unlocked'),
  ('vault_unlocked', 'rewards', 'Sent when matured deposits auto-release onto the spendable balance')
on conflict (type) do nothing;
