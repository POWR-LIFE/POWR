-- Unlock-event targeting parity with grants.
--
-- admin_grant_vault_deposit could aim at all / emails / ids / levels /
-- activities; admin_schedule_vault_unlock could only do all / emails. The
-- asymmetry meant the more dramatic lever — a scheduled Vault Day — was the
-- blunter one. This brings the two to the same targeting vocabulary.
--
-- RESOLUTION TIME: targets resolve when the event is SCHEDULED, not when it
-- fires. A user who reaches level 5 the day before a "level 5" Vault Day is
-- therefore not swept in. That is deliberate on two counts: it matches the
-- grant semantics an admin already knows, and — decisively — the app's
-- pre-announcement (get_my_vault_outlook) has to test membership BEFORE the
-- event fires, which is only possible if user_ids is settled upfront. Fire-time
-- resolution would buy fresher targeting at the cost of never being able to
-- tell anyone it was coming.

-- Shared level maths. The xpMin ladder was inline in three places (the level
-- trigger, the grant targeting, and now this) with a "MUST mirror
-- constants/levels.ts" comment on each — three chances to drift. The two admin
-- targeting paths now share one definition.
--
-- The trigger (vault_level_up_check) deliberately keeps its own inline copy:
-- it runs on the hot earn path for every positive credit in the system, and a
-- correct-but-riskier edit there buys nothing a user would notice.
create or replace function public.vault_level_for_xp(p_xp bigint)
returns int
language sql
immutable
set search_path = public
as $$
  -- xpMin per level 2..20 — MUST mirror constants/levels.ts LEVELS[].xpMin.
  select 1 + (
    select count(*) from unnest(array[
      500, 1200, 2500, 4500, 7000, 10000, 14000, 19000, 25000, 32500,
      41000, 51000, 63000, 77000, 93000, 111000, 132000, 156000, 182000
    ]::bigint[]) th where th <= coalesce(p_xp, 0)
  )::int;
$$;

grant execute on function public.vault_level_for_xp(bigint) to authenticated;

create or replace function public.admin_schedule_vault_unlock(
  p_unlock_at timestamptz,
  p_emails text[] default null,
  p_note text default null,
  p_notify boolean default true,
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
  v_admin   uuid := auth.uid();
  v_ids     uuid[] := '{}';
  v_more    uuid[];
  v_missing text[];
  v_target  text;
  v_id      uuid;
begin
  if v_admin is null or not exists (select 1 from admin_roles where user_id = v_admin) then
    raise exception 'ADMIN_ONLY';
  end if;
  if p_unlock_at is null then
    raise exception 'unlock_at required';
  end if;

  if p_all then
    -- 'all' stays a marker rather than a snapshot of every id: the event
    -- should catch users who join between scheduling and firing, and
    -- process_vault_unlock_events already reads target = 'all' that way.
    v_target := 'all';
  else
    if p_emails is not null and coalesce(array_length(p_emails, 1), 0) > 0 then
      select coalesce(array_agg(u.id), '{}') into v_ids
        from auth.users u
       where lower(u.email) = any (select lower(trim(e)) from unnest(p_emails) e where trim(e) <> '');
      select array_agg(e) into v_missing
        from (select lower(trim(e)) as e from unnest(p_emails) e where trim(e) <> '') src
       where not exists (select 1 from auth.users u where lower(u.email) = src.e);
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
       where public.vault_level_for_xp(lifetime.xp) = any (p_levels);
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

    if coalesce(array_length(v_ids, 1), 0) = 0 then
      raise exception 'NO_USERS_RESOLVED';
    end if;
    v_target := 'users';
  end if;

  insert into vault_unlock_events (unlock_at, target, user_ids, note, notify, created_by)
  values (p_unlock_at, v_target, nullif(v_ids, '{}'), nullif(trim(coalesce(p_note, '')), ''), p_notify, v_admin)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'target', v_target,
    'resolved_users', coalesce(array_length(v_ids, 1), 0),
    'missing_emails', to_jsonb(coalesce(v_missing, array[]::text[]))
  );
end;
$$;

revoke all on function public.admin_schedule_vault_unlock(timestamptz, text[], text, boolean, boolean, int[], text[]) from public, anon;
grant execute on function public.admin_schedule_vault_unlock(timestamptz, text[], text, boolean, boolean, int[], text[]) to authenticated;

-- The 4-arg predecessor is superseded — drop so PostgREST doesn't face an
-- ambiguous overload when the panel calls with named params.
drop function if exists public.admin_schedule_vault_unlock(timestamptz, text[], text, boolean);

-- Bring the grant path onto the shared level helper too, so the two targeting
-- RPCs cannot drift from each other. Body is otherwise unchanged from
-- 20260719000004.
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
       where public.vault_level_for_xp(lifetime.xp) = any (p_levels);
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
