-- =============================================================
-- Member ID — profiles.referral_code becomes findable from the admin side.
--
-- Every profile already carries a UNIQUE NOT NULL 8-char code
-- (generate_referral_code: A–Z minus I/O, 2–9). It is what a member can
-- read off their own screen — it's on the friend QR, the event ticket and
-- now the Settings > Account row as "POWR ID". Until this migration none
-- of the admin lookups matched on it, so a member reading their ID to
-- staff at an event was reading it to a search box that couldn't hear it.
--
-- No new column, no backfill: the identifier is the one they already have.
-- Doubling as the invite code is fine — it is an identifier, not a secret.
--
--   normalize_member_id            — what a human typed → the stored form
--   admin_get_users                — returns member_id (portal filters client-side)
--   admin_search_event_candidates  — exact member_id match ranks first
--   admin_get_event_registrations  — participants carry member_id
--   admin_liveops_history          — user query accepts a member id
-- =============================================================

-- Uppercase, whitespace/hyphens stripped: "abcd 2345", "ABCD-2345" and
-- "ABCD2345" are the same ID. Nothing cleverer — the alphabet has no
-- 0/1/I/O so there is no look-alike to correct.
create or replace function public.normalize_member_id(p_raw text)
returns text
language sql
immutable
as $$
  select nullif(upper(regexp_replace(coalesce(p_raw, ''), '[\s\-]+', '', 'g')), '');
$$;

-- =============================================================
-- admin_get_users v6 — + member_id
-- =============================================================
-- ⚠ DROP discards the function's ACL. Supabase's default privileges then
-- grant EXECUTE to anon and PUBLIC on the recreated function — the grants
-- at the bottom of this block put the lockdown back. Any future signature
-- change must repeat them.
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
  permission_regressed_at timestamptz,
  member_id text
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
      p.id, p.username, p.display_name, p.avatar_url,
      p.is_admin, p.is_pro, p.location_granted, p.created_at,
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
      reg.regressed_at,
      p.referral_code                        as member_id
    from public.profiles p
    join auth.users u on u.id = p.id
    left join lateral (
      select array_agg(distinct prov_name) as providers
      from (
        select lower(tc.provider) as prov_name
        from public.terra_connections tc
        where tc.user_id = p.id and tc.deauthed_at is null
        union
        select hpc.key from jsonb_each(coalesce(p.health_provider_connections, '{}'::jsonb)) hpc
      ) s
    ) prov on true
    left join lateral (
      select array_agg(distinct a.type::text) as types, count(*) as session_count, max(a.started_at) as last_active_at
      from public.activity_sessions a where a.user_id = p.id
    ) act on true
    left join lateral (
      select sum(pt.amount)::bigint as balance, sum(pt.amount) filter (where pt.amount > 0)::bigint as earned
      from public.point_transactions pt where pt.user_id = p.id
    ) pts on true
    left join lateral (
      select sum(vd.amount)::bigint as pending
      from public.vault_deposits vd where vd.user_id = p.id and vd.released_at is null
    ) vlt on true
    left join lateral (
      select array_agg(distinct trim(t.token) order by trim(t.token)) as devices
      from public.health_snapshots hs
      cross join lateral unnest(string_to_array(hs.source_detail, ',')) as t(token)
      where hs.user_id = p.id and hs.source_detail is not null and trim(t.token) <> ''
    ) dev on true
    left join lateral (
      -- ONE row: the most recent sweep, graded (see v5 for why it never counts rows).
      select
        case e.detail->>'outcome'
          when 'no_permission' then 'broken'
          when 'handoff'       then 'ok'
          when 'exit_backstop' then 'ok'
          else 'unknown'
        end as verdict,
        e.created_at as observed_at
      from public.geofence_region_events e
      where e.user_id = p.id and e.event = 'sweep'
      order by e.created_at desc
      limit 1
    ) bg on true
    left join lateral (
      select max(r.created_at) as regressed_at
      from public.location_permission_regressions r
      where r.user_id = p.id
    ) reg on true
    order by p.created_at desc;
end;
$function$;

revoke execute on function public.admin_get_users() from public, anon;
grant execute on function public.admin_get_users() to authenticated;

-- =============================================================
-- admin_search_event_candidates — member id is a rank-0 exact match
-- =============================================================
-- Same signature, so create-or-replace keeps the existing ACL.
create or replace function public.admin_search_event_candidates(
  p_event_id uuid,
  p_query    text,
  p_limit    int default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event   public.live_events;
  v_q       text;
  v_code    text;
  v_esc     text;
  v_pattern text;
  v_prefix  text;
  v_limit   int := least(greatest(coalesce(p_limit, 10), 1), 25);
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  v_q := lower(btrim(coalesce(p_query, '')));
  -- One character matches most of the user table — that's a table scan
  -- rendered as a dropdown, not a search.
  if length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  -- % and _ in a typed query are literal characters, not wildcards.
  v_esc     := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  v_pattern := '%' || v_esc || '%';
  v_prefix  := v_esc || '%';
  -- The member id as staff would type it off a ticket — "abcd 2345" is
  -- ABCD2345. Whole-code only: a partial id is not an id.
  v_code    := public.normalize_member_id(p_query);

  -- Ordering answers "which of these did you mean": addable before
  -- already-on-roster, exact identifier before prefix before a match
  -- buried mid-string, then alphabetical.
  return coalesce((
    select jsonb_agg(to_jsonb(m) order by m.on_roster, m.rank_hint, m.name)
      from (
        select p.id                                              as user_id,
               coalesce(p.display_name, p.username, 'POWR member') as name,
               p.username,
               u.email,
               p.referral_code                                   as member_id,
               lp.user_id is not null                            as on_roster,
               lp.disqualified_at is not null                    as disqualified,
               lp.joined_at,
               case
                 when p.referral_code = v_code
                   or lower(coalesce(u.email, '')) = v_q
                   or lower(coalesce(p.username, '')) = v_q then 0
                 when lower(coalesce(p.display_name, '')) like v_prefix escape '\'
                   or lower(coalesce(p.username, ''))     like v_prefix escape '\'
                   or lower(coalesce(u.email, ''))        like v_prefix escape '\' then 1
                 else 2
               end                                               as rank_hint
          from public.profiles p
          left join auth.users u on u.id = p.id
          left join public.live_event_participants lp
            on lp.event_id = v_event.id and lp.user_id = p.id
         where p.referral_code = v_code
            or lower(coalesce(p.display_name, '')) like v_pattern escape '\'
            or lower(coalesce(p.username, ''))     like v_pattern escape '\'
            or lower(coalesce(u.email, ''))        like v_pattern escape '\'
         order by (lp.user_id is not null),
                  (case
                     when p.referral_code = v_code
                       or lower(coalesce(u.email, '')) = v_q
                       or lower(coalesce(p.username, '')) = v_q then 0
                     when lower(coalesce(p.display_name, '')) like v_prefix escape '\'
                       or lower(coalesce(p.username, ''))     like v_prefix escape '\'
                       or lower(coalesce(u.email, ''))        like v_prefix escape '\' then 1
                     else 2
                   end),
                  coalesce(p.display_name, p.username)
         limit v_limit
      ) m
  ), '[]'::jsonb);
end;
$$;

-- =============================================================
-- admin_get_event_registrations — participants carry member_id
-- =============================================================
-- Same signature; body identical to 20260812120000 except the one key.
create or replace function public.admin_get_event_registrations(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    -- Who's in: the raw opt-in roster, newest first.
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id',         lp.user_id,
               'name',            coalesce(p.display_name, p.username, 'POWR member'),
               'username',        p.username,
               'email',           u.email,
               'member_id',       p.referral_code,
               'joined_at',       lp.joined_at,
               'disqualified_at', lp.disqualified_at,
               'booking_opened_at', lp.booking_link_opened_at,
               'booked',          exists (
                                    select 1 from public.live_event_bookings b
                                     where b.event_id = v_event.id
                                       and b.email = lower(u.email)
                                  )
             ) order by lp.joined_at desc)
        from (select * from public.live_event_participants
               where event_id = v_event.id
               order by joined_at desc limit 500) lp
        join public.profiles p on p.id = lp.user_id
        left join auth.users u on u.id = lp.user_id
    ), '[]'::jsonb),

    -- The invite pipeline: conversions attributed to THIS event plus
    -- still-pending signups (they can convert into it until the deadline).
    'referrals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'referrer_name', coalesce(pr.display_name, pr.username, 'POWR member'),
               'referred_name', coalesce(pd.display_name, pd.username, 'POWR member'),
               'referred_email', u.email,
               'created_at',    r.created_at,
               'converted_at',  r.converted_at,
               'attributed',    r.event_id = v_event.id
             ) order by coalesce(r.converted_at, r.created_at) desc)
        from (select * from public.referrals
               where event_id = v_event.id or converted_at is null
               order by coalesce(converted_at, created_at) desc limit 200) r
        join public.profiles pr on pr.id = r.referrer_id
        join public.profiles pd on pd.id = r.referred_id
        left join auth.users u on u.id = r.referred_id
    ), '[]'::jsonb),

    -- Milestone payouts for this event.
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'referrer_name',   coalesce(p.display_name, p.username, 'POWR member'),
               'converted_count', m.converted_count,
               'points_paid',     m.points_paid,
               'created_at',      m.created_at
             ) order by m.created_at desc)
        from public.live_event_invite_milestones m
        join public.profiles p on p.id = m.referrer_id
       where m.event_id = v_event.id
    ), '[]'::jsonb),

    -- The actual money: latest invite-bonus ledger rows. Transactions
    -- carry no event tag, so this is a global feed — labelled as such
    -- in the UI; during a preview run yours are the newest rows.
    'bonus_ledger', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name',        coalesce(p.display_name, p.username, 'POWR member'),
               'email',       u.email,
               'amount',      t.amount,
               'source',      t.source,
               'description', t.description,
               'created_at',  t.created_at
             ) order by t.created_at desc)
        from (select * from public.point_transactions
               where source in ('referral_sent', 'referral_received', 'invite_milestone')
               order by created_at desc limit 100) t
        join public.profiles p on p.id = t.user_id
        left join auth.users u on u.id = t.user_id
    ), '[]'::jsonb)
  );
end;
$$;

-- =============================================================
-- admin_liveops_history — the user query accepts a member id
-- =============================================================
-- Same signature and return type; body identical to 20260813160000 except
-- the one extra predicate. Comments explaining the outcome filters live in
-- that file — they are still the authority.
create or replace function public.admin_liveops_history(
  p_from         timestamptz default now() - interval '30 days',
  p_to           timestamptz default now(),
  p_user_query   text        default null,
  p_outcome      text        default 'all',
  p_platform     text        default null,
  p_partner_id   uuid        default null,
  p_include_test boolean     default false,
  p_limit        integer     default 100,
  p_offset       integer     default 0
)
returns table (
  visit_id uuid, user_id uuid, username text, display_name text, email text,
  partner_id uuid, venue_name text, platform text, is_test boolean,
  started_at timestamptz, ended_at timestamptz, close_reason text,
  claimed_at timestamptz, upgraded_at timestamptz, completed_push_at timestamptz,
  native_enter_at timestamptz, checkin_via text, exit_detected_at timestamptz,
  evidence_complete boolean,
  nudge_count integer, nudge_count_upgrade integer, wakes_received integer,
  proofs integer, settled_stages text[],
  pushes_sent integer, pushes_displayed integer, pushes_receiptable integer,
  session_duration_sec integer, points_earned integer,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_q    text := nullif(trim(coalesce(p_user_query, '')), '');
  v_code text := public.normalize_member_id(p_user_query);
begin
  if not is_admin() then
    raise exception 'Access denied: admin only';
  end if;

  return query
    with filtered as (
      select j.*, p.username, p.display_name, u.email::text as email, pt.name as venue_name
      from public.gym_visit_journeys j
      join public.profiles p   on p.id = j.user_id
      join auth.users u        on u.id = j.user_id
      left join public.partners pt on pt.id = j.partner_id
      where j.started_at >= p_from
        and j.started_at <= p_to
        and (p_include_test or not j.is_test)
        and (p_platform is null or j.platform = p_platform)
        and (p_partner_id is null or j.partner_id = p_partner_id)
        and (v_q is null
             or u.email ilike '%' || v_q || '%'
             or p.username ilike '%' || v_q || '%'
             or p.display_name ilike '%' || v_q || '%'
             or p.referral_code = v_code
             or j.user_id::text = v_q
             or j.visit_id::text = v_q)
        and case coalesce(p_outcome, 'all')
              when 'all'                 then true
              when 'claimed'             then j.claimed_at is not null
              when 'never_claimed'       then j.claimed_at is null
              when 'upgraded'            then j.upgraded_at is not null
              when 'claimed_not_upgraded' then j.claimed_at is not null and j.upgraded_at is null
              when 'full_chain'          then j.claimed_at is not null and j.upgraded_at is not null
                                              and j.completed_push_at is not null
              when 'no_os_enter'         then j.evidence_complete and j.native_enter_at is null
              when 'no_exit_detected'    then j.evidence_complete and j.ended_at is not null
                                              and j.exit_detected_at is null
              when 'no_proof'            then j.proofs = 0
              when 'wake_starved'        then (j.nudge_count + j.nudge_count_upgrade) >= 3
                                              and j.wakes_received = 0
              when 'push_never_drew'     then j.pushes_receiptable > 0 and j.pushes_displayed = 0
              when 'no_completion_push'  then j.ended_at is not null and j.claimed_at is not null
                                              and j.completed_push_at is null
              when 'server_settled'      then array_length(j.settled_stages, 1) > 0
              when 'reaper_closed'       then j.close_reason in ('stale_after_upgrade', 'max_open_after_upgrade')
              when 'evidence_expired'    then not j.evidence_complete
              else true
            end
    )
    select
      f.visit_id, f.user_id, f.username, f.display_name, f.email,
      f.partner_id, f.venue_name, f.platform, f.is_test,
      f.started_at, f.ended_at, f.close_reason,
      f.claimed_at, f.upgraded_at, f.completed_push_at,
      f.native_enter_at, f.checkin_via, f.exit_detected_at,
      f.evidence_complete,
      f.nudge_count, f.nudge_count_upgrade, f.wakes_received,
      f.proofs, f.settled_stages,
      f.pushes_sent, f.pushes_displayed, f.pushes_receiptable,
      f.session_duration_sec, f.points_earned,
      count(*) over () as total_count
    from filtered f
    order by f.started_at desc
    limit greatest(coalesce(p_limit, 100), 1)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$function$;
