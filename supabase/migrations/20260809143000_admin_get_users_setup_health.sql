-- ---------------------------------------------------------------------------
-- admin_get_users v5 — setup health.
--
-- The Location column in the admin users table reads profiles.location_granted,
-- which is a WRITE-ONCE onboarding-bonus flag: it says whether the user ever
-- tapped allow, and goes stale the instant they touch system settings. So the
-- one screen we use to answer "is this user's setup working?" has been showing
-- a value that cannot answer it.
--
-- Three real signals replace it:
--   location_permission     — the live level (always | while_using | denied | undetermined)
--   background_verdict      — what the DEVICE's headless context last managed to do
--   permission_regressed_at — when they last fell OUT of 'always'
--
-- ⚠ background_verdict GRADES THE LAST OUTCOME. It deliberately does not count
-- rows, because presence of background telemetry is not evidence of health: the
-- single most common background event in production is
-- sweep{outcome:'no_permission'} (486 rows / 30 days) — the wake fired, and then
-- hard-returned because background location was not granted. A detector that
-- counted rows would score exactly the broken devices as the healthiest ones.
-- Absence is equally uninformative (iOS emits nothing for days while perfectly
-- healthy), so no rows yields NULL — "no data", never "fine" and never "broken".
-- ---------------------------------------------------------------------------

-- ⚠ DROP discards the function's ACL. Supabase's default privileges then grant
-- EXECUTE to anon and PUBLIC on the recreated function, silently undoing any
-- prior lockdown — the grants at the BOTTOM of this file put it back. The
-- is_admin() gate means it is never exploitable, but the lint regression is not
-- free. Any future signature change to this function must repeat them.
drop function if exists public.admin_get_users();

create or replace function public.admin_get_users()
returns table (
  id uuid, username text, display_name text, avatar_url text,
  is_admin boolean, is_pro boolean, location_granted boolean,
  created_at timestamptz, email text, connected_providers text[],
  activity_types text[], session_count bigint, last_active_at timestamptz,
  total_points bigint, total_earned bigint, seen_devices text[],
  location_permission text, location_accuracy_m integer,
  background_verdict text, background_checked_at timestamptz,
  permission_regressed_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not is_admin() then
    raise exception 'Access denied: admin only';
  end if;

  return query
    select
      p.id,
      p.username,
      p.display_name,
      p.avatar_url,
      p.is_admin,
      p.is_pro,
      p.location_granted,
      p.created_at,
      u.email::text,
      coalesce(prov.providers, '{}'::text[]) as connected_providers,
      coalesce(act.types, '{}'::text[])      as activity_types,
      coalesce(act.session_count, 0)         as session_count,
      act.last_active_at,
      coalesce(pts.balance, 0)               as total_points,
      coalesce(pts.earned, 0) + coalesce(vlt.pending, 0) as total_earned,
      coalesce(dev.devices, '{}'::text[])    as seen_devices,
      p.location_permission,
      p.location_accuracy_m,
      bg.verdict,
      bg.observed_at,
      reg.regressed_at
    from public.profiles p
    join auth.users u on u.id = p.id
    left join lateral (
      select array_agg(distinct prov_name) as providers
      from (
        select lower(tc.provider) as prov_name
        from public.terra_connections tc
        where tc.user_id = p.id and tc.deauthed_at is null
        union
        select hpc.key
        from jsonb_each(coalesce(p.health_provider_connections, '{}'::jsonb)) hpc
      ) s
    ) prov on true
    left join lateral (
      select
        array_agg(distinct a.type::text) as types,
        count(*)                         as session_count,
        max(a.started_at)                as last_active_at
      from public.activity_sessions a
      where a.user_id = p.id
    ) act on true
    left join lateral (
      select
        sum(pt.amount)::bigint                                as balance,
        sum(pt.amount) filter (where pt.amount > 0)::bigint   as earned
      from public.point_transactions pt
      where pt.user_id = p.id
    ) pts on true
    left join lateral (
      select sum(vd.amount)::bigint as pending
      from public.vault_deposits vd
      where vd.user_id = p.id and vd.released_at is null
    ) vlt on true
    left join lateral (
      -- source_detail is a comma-joined label list per snapshot row
      -- ("iPhone, Apple Watch") — split, trim, and dedupe across rows.
      select array_agg(distinct trim(t.token) order by trim(t.token)) as devices
      from public.health_snapshots hs
      cross join lateral unnest(string_to_array(hs.source_detail, ',')) as t(token)
      where hs.user_id = p.id
        and hs.source_detail is not null
        and trim(t.token) <> ''
    ) dev on true
    left join lateral (
      -- ONE row: the most recent sweep, graded. Ordered by created_at desc with
      -- limit 1 so this stays an index seek per user rather than a scan.
      select
        case e.detail->>'outcome'
          when 'no_permission' then 'broken'
          when 'handoff'       then 'ok'
          when 'exit_backstop' then 'ok'
          -- session_active (a correct no-op), no_fix (stale OS cache) and error
          -- (a transient throw) all say nothing about whether the setup works.
          else 'unknown'
        end as verdict,
        e.created_at as observed_at
      from public.geofence_region_events e
      where e.user_id = p.id and e.event = 'sweep'
      order by e.created_at desc
      limit 1
    ) bg on true
    left join lateral (
      -- Reads the regressions VIEW, not the raw table, so the 'undetermined'
      -- exclusion is applied in exactly one place.
      select max(r.created_at) as regressed_at
      from public.location_permission_regressions r
      where r.user_id = p.id
    ) reg on true
    order by p.created_at desc;
end;
$function$;

revoke execute on function public.admin_get_users() from anon;
revoke execute on function public.admin_get_users() from public;

-- The verdict lateral filters on event='sweep', but the table's only index is
-- (user_id, created_at desc) — without this it walks every event row per user
-- and throws the non-sweeps away. Partial, so it stays small.
create index if not exists geofence_region_events_user_sweep_idx
  on public.geofence_region_events (user_id, created_at desc)
  where event = 'sweep';
