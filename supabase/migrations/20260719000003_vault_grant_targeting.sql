-- Vault grant targeting: all users, specific levels, specific activities.
--
-- Extends admin_grant_vault_deposit beyond emails/ids:
--   p_all        → every profile
--   p_levels     → users whose CURRENT level (ledger positive sum + pending
--                  vault — the same lifetime formula the app and the level
--                  trigger use) is in the list
--   p_activities → users whose activity_preferences overlap the list (the
--                  same text[] the admin Broadcast targeting uses)
-- Targets union with emails/ids when several are supplied; p_all wins.

create or replace function public.admin_grant_vault_deposit(
  p_amount int,
  p_emails text[] default null,
  p_user_ids uuid[] default null,
  p_note text default null,
  p_vest_days int default null,
  p_all boolean default false,
  p_levels int[] default null,
  p_activities text[] default null
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

revoke all on function public.admin_grant_vault_deposit(int, text[], uuid[], text, int, boolean, int[], text[]) from public, anon;
grant execute on function public.admin_grant_vault_deposit(int, text[], uuid[], text, int, boolean, int[], text[]) to authenticated;

-- The 5-arg predecessor is superseded — drop so PostgREST doesn't face an
-- ambiguous overload when the panel calls with named params.
drop function if exists public.admin_grant_vault_deposit(int, text[], uuid[], text, int);
