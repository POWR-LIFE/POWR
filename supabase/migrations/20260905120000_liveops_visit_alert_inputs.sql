-- Live Ops drill-in: give the visit document the alert inputs the board already has.
--
-- The drawer and the board render their badges through ONE function —
-- visitAlerts() in shared/liveops.ts — but admin_liveops_visit built its 'visit'
-- object by hand and never included the four fields that function reads. In the
-- drawer that showed as "140m in, no claim (threshold undefinedm)", and silently
-- suppressed WAKE STARVED and PUSH NEVER DREW, whose tests are `>= 3` and `> 0`
-- against a field that was not there.
--
-- Only the 'visit' object changes. Every other key is byte-identical to
-- 20260812170000_admin_liveops.sql.
create or replace function public.admin_liveops_visit(
  p_visit_id    uuid,
  p_event_limit integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_visit   public.gym_visits%rowtype;
  v_limit   integer := greatest(least(coalesce(p_event_limit, 600), 2000), 50);
  v_from    timestamptz;
  v_to      timestamptz;
  v_total   integer;
  v_dwell   integer;
  v_upgrade integer;
  v_result  jsonb;
begin
  if not is_admin() then
    raise exception 'Access denied: admin only';
  end if;

  select * into v_visit from public.gym_visits where id = p_visit_id;
  if not found then
    return null;
  end if;

  select t.dwell_minutes, t.upgrade_minutes into v_dwell, v_upgrade from public.liveops_thresholds() t;

  -- Reach back before the visit was minted: the ENTER that started it, and the
  -- arm burst that preceded it, are the interesting part of a check-in failure.
  v_from := least(v_visit.started_at, v_visit.created_at) - interval '20 minutes';
  v_to   := coalesce(v_visit.ended_at, now()) + interval '15 minutes';

  select count(*)::integer into v_total
  from (
    select e.created_at from public.geofence_region_events e
      where e.user_id = v_visit.user_id and e.created_at between v_from and v_to
    union all
    select e.created_at from public.gym_visit_events e
      where e.visit_id = v_visit.id
  ) c;

  select jsonb_build_object(
    -- Enumerated, not to_jsonb(v_visit): the row carries wake_nonce_hash, which
    -- is a wake credential and has no business crossing to a client.
    'visit', jsonb_build_object(
        'id',                 v_visit.id,
        'user_id',            v_visit.user_id,
        'partner_id',         v_visit.partner_id,
        'region_id',          v_visit.region_id,
        'platform',           v_visit.platform,
        'status',             v_visit.status,
        'started_at',         v_visit.started_at,
        'checked_in_at',      v_visit.created_at,
        'announced_at',       v_visit.announced_at,
        'claimed_at',         v_visit.claimed_at,
        'upgraded_at',        v_visit.upgraded_at,
        'ended_at',           v_visit.ended_at,
        'close_reason',       v_visit.close_reason,
        'last_proven_at',     v_visit.last_proven_at,
        'last_confirmed_at',  v_visit.last_confirmed_at,
        'completed_push_at',  v_visit.completed_push_at,
        'claimed_session_id', v_visit.claimed_session_id,
        'nudge_count',        v_visit.nudge_count,
        'nudge_count_upgrade',v_visit.nudge_count_upgrade,
        'venue_name',    (select pt.name from public.partners pt where pt.id = v_visit.partner_id),
        'username',      (select p.username from public.profiles p where p.id = v_visit.user_id),
        'display_name',  (select p.display_name from public.profiles p where p.id = v_visit.user_id),
        'email',         (select u.email::text from auth.users u where u.id = v_visit.user_id),

        -- Alert inputs. visitAlerts() in shared/liveops.ts renders the SAME badges
        -- from a board row or from this document, so the document has to carry the
        -- same four fields the board's SELECT does. Without them the drawer printed
        -- "threshold undefinedm" and — worse, because nothing showed — dropped the
        -- WAKE STARVED and PUSH NEVER DREW badges entirely: `undefined >= 3` and
        -- `undefined > 0` are both false, so the alert simply never appeared on the
        -- one screen you open when a visit looks stuck.
        'dwell_minutes',   v_dwell,
        'upgrade_minutes', v_upgrade,
        -- Both derivations are copied VERBATIM from admin_liveops_board so the
        -- badge cannot say one thing on the board and another in the drawer.
        'unanswered_nudge_streak', coalesce((
          select coalesce(min(x.rn) filter (where x.answered) - 1, count(*))::integer
          from (
            select
              row_number() over (order by n.created_at desc) as rn,
              exists (
                select 1 from public.geofence_region_events g
                where g.user_id = v_visit.user_id and g.event = 'sweep'
                  and g.created_at > n.created_at
                  and g.created_at < n.created_at + interval '5 minutes'
              ) or exists (
                select 1 from public.gym_visit_events w
                where w.visit_id = v_visit.id and w.event = 'wake_received'
                  and w.created_at > n.created_at
                  and w.created_at < n.created_at + interval '5 minutes'
              ) as answered
            from public.gym_visit_events n
            where n.visit_id = v_visit.id and n.event = 'nudge_sent'
            order by n.created_at desc
            limit 10
          ) x
        ), 0),
        'undrawn_push_count', (
          select count(*)::integer
          from public.push_send_log l
          where l.user_id = v_visit.user_id
            and l.type <> 'fence_refresh'
            and l.status = 'accepted'
            and l.transport = 'fcm_direct'
            and l.delivered_at is null
            and l.created_at >= v_visit.created_at - interval '5 minutes'
            and l.created_at <= coalesce(v_visit.ended_at, now()) + interval '10 minutes'
            and l.created_at < now() - interval '5 minutes'
        )
      ),
    'thresholds', jsonb_build_object('dwell_minutes', v_dwell, 'upgrade_minutes', v_upgrade),

    -- The OS-delivered ENTER for this region that preceded the check-in, if the
    -- OS delivered one at all. Its absence is a finding, not a gap: on iOS the
    -- region crossing routinely never arrives and the check-in comes from the
    -- arm-time burst or a poll instead.
    'entered_at', (
      select min(e.created_at) from public.geofence_region_events e
      where e.user_id = v_visit.user_id and e.event = 'enter'
        and e.region_id = v_visit.region_id
        and e.created_at between v_from and coalesce(v_visit.created_at, now()) + interval '2 minutes'
    ),
    -- Which path actually produced the check-in. NULL 'via' is not "unknown
    -- because we failed to look" — the foreground check-in path logs no region
    -- event at all, so absence names it.
    'checkin_via', (
      select e.detail->>'via' from public.geofence_region_events e
      where e.user_id = v_visit.user_id and e.event = 'checked_in'
        and e.created_at between v_from and coalesce(v_visit.created_at, now()) + interval '5 minutes'
      order by e.created_at desc limit 1
    ),
    'exit_detected_at', (
      select max(e.created_at) from public.geofence_region_events e
      where e.user_id = v_visit.user_id and e.event = 'exit'
        and e.region_id = v_visit.region_id
        and v_visit.ended_at is not null
        and e.created_at between v_visit.created_at and v_visit.ended_at + interval '5 minutes'
    ),

    -- Device header. app_version / ota_update_id come from the push token because
    -- that is the row the device rewrites every launch — the closest thing we
    -- have to "what build is this human running right now".
    'device', (
      select to_jsonb(d) from (
        select
          t.platform, t.app_version, t.app_build, t.ota_update_id, t.ota_channel,
          t.updated_at as token_updated_at,
          (select t2.ota_update_id
             from public.user_push_tokens t2
            where t2.platform = t.platform
              and t2.ota_channel is not distinct from t.ota_channel
              and t2.ota_update_id is not null
            order by t2.updated_at desc limit 1) as newest_ota_on_channel
        from public.user_push_tokens t
        where t.user_id = v_visit.user_id
        order by t.updated_at desc nulls last
        limit 1
      ) d
    ),
    'last_heard', (
      select to_jsonb(h) from (
        select x.at, x.kind from (
          select max(e.created_at) as at, 'region event'::text as kind
            from public.geofence_region_events e where e.user_id = v_visit.user_id
          union all
          select max(e.created_at), 'visit event'
            from public.gym_visit_events e where e.user_id = v_visit.user_id
          union all
          select max(l.delivered_at), 'push displayed'
            from public.push_send_log l where l.user_id = v_visit.user_id
          union all
          select max(t.updated_at), 'push token'
            from public.user_push_tokens t where t.user_id = v_visit.user_id
        ) x
        where x.at is not null
        order by x.at desc limit 1
      ) h
    ),

    'events_total', v_total,
    'events_limit', v_limit,
    'events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at asc, e.src asc)
      from (
        select * from (
          select 'geo'::text as src, g.event, g.region_id, g.detail, g.created_at
            from public.geofence_region_events g
           where g.user_id = v_visit.user_id and g.created_at between v_from and v_to
          union all
          select 'visit', w.event, null, w.detail, w.created_at
            from public.gym_visit_events w
           where w.visit_id = v_visit.id
        ) u
        order by u.created_at desc
        limit v_limit
      ) e
    ), '[]'::jsonb),

    -- fence_refresh is excluded: it is the wake loop talking to itself, it never
    -- draws a banner, and at ~2.6k rows/30d it would bury every push that did.
    'pushes', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at asc)
      from (
        select l.id, l.type, l.title, l.status, l.skip_reason, l.error,
               l.transport, l.delivered_at, l.created_at
        from public.push_send_log l
        where l.user_id = v_visit.user_id
          and l.type <> 'fence_refresh'
          and l.created_at between v_from and v_to
        order by l.created_at asc
        limit 100
      ) l
    ), '[]'::jsonb),

    'session', (
      select to_jsonb(s) from (
        select a.id, a.type::text, a.started_at, a.ended_at, a.duration_sec,
               a.verification::text, a.trust_score, a.partner_id, a.flagged, a.flag_reason
        from public.activity_sessions a
        where a.id = v_visit.claimed_session_id
      ) s
    ),
    'points', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at asc)
      from (
        select pt.amount, pt.type::text, pt.description, pt.source, pt.created_at
        from public.point_transactions pt
        where pt.user_id = v_visit.user_id
          and pt.created_at between v_from and v_to
        order by pt.created_at asc
        limit 50
      ) t
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.admin_liveops_visit(uuid, integer) from public, anon;
grant execute on function public.admin_liveops_visit(uuid, integer) to authenticated;
