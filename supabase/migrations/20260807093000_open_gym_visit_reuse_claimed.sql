-- A live visit is one with ended_at IS NULL. The SELECT in open_gym_visit already
-- says so — status in ('open','claimed','upgraded') — but the reuse test then
-- demanded status = 'open', so the instant the 30-minute claim flipped a visit to
-- 'claimed', the very next openGymVisit call for the SAME live check-in fell
-- through to "supersede and create a new row".
--
-- Field, 2026-08-07: one continuous gym visit produced three rows, all stamped
-- started_at 08:54:42 — 3dc2d104 (claimed 09:25:05, superseded), 0ce2dc84
-- (claimed 09:31:02, superseded), 59a73477 — and each superseded row, being both
-- ended and claimed, matched the beacon's completion scan and fired "Session
-- complete" at 09:31 while the user was still standing in the gym. The same
-- mechanism produced ~25 duplicate rows on 2026-08-06.
--
-- The other guards (4-hour window, same partner, started_at within ±5 minutes)
-- already establish "this is the same check-in". Status was never the right
-- discriminator: claimed and upgraded are progress markers ON a live visit, not
-- reasons to abandon it.
--
-- The 4-hour ceiling is also restored to the CONDITIONAL form that
-- 20260803100000 introduced and the deployed function had since lost. It was
-- always a backstop for a caller that passes no started_at, never a rule:
-- applied to every caller it splits exactly the long visits this machinery
-- exists for (47% run past 4h), because the heartbeat's late-open retry
-- replays the SAME entryTimestamp and stops matching its own live row. Same
-- failure shape as the status bug above, on a different trigger. Caught in
-- review after I read the deployed definition and carried its drift forward.
create or replace function public.open_gym_visit(
  p_partner_id uuid, p_region_id text, p_started_at timestamp with time zone, p_platform text default null::text
) returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  c_same_checkin constant interval := interval '5 minutes';
  c_reuse_window constant interval := interval '4 hours';
  v_user       uuid := auth.uid();
  v_id         uuid;
  v_status     text;
  v_started_at timestamptz;
  v_partner_id uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  perform pg_advisory_xact_lock(hashtextextended('open_gym_visit:' || v_user::text, 0));

  select id, status, started_at, partner_id
    into v_id, v_status, v_started_at, v_partner_id
    from gym_visits
   where user_id = v_user and ended_at is null and status in ('open','claimed','upgraded')
   order by started_at desc
   limit 1;

  -- Re-use the row that is this very check-in, still live, at this gym —
  -- whatever progress it has already recorded.
  if v_id is not null
     and v_status in ('open','claimed','upgraded')
     and (p_started_at is not null or v_started_at > now() - c_reuse_window)
     and v_partner_id is not distinct from p_partner_id
     and v_started_at between coalesce(p_started_at, now()) - c_same_checkin
                          and coalesce(p_started_at, now()) + c_same_checkin
  then
    insert into gym_visit_events (visit_id, user_id, event, detail)
    values (v_id, v_user, 'reused', jsonb_build_object(
      'region_id', p_region_id,
      'age_min',   round(extract(epoch from (now() - v_started_at)) / 60),
      'status',    v_status
    ));
    return v_id;
  end if;

  if v_id is not null then
    update gym_visits
       set ended_at     = coalesce(last_confirmed_at, started_at),
           status       = 'closed',
           close_reason = 'superseded_by_new_check_in'
     where id = v_id and ended_at is null;

    if found then
      insert into gym_visit_events (visit_id, user_id, event, detail)
      values (v_id, v_user, 'closed_stale', jsonb_build_object(
        'reason',          'superseded_by_new_check_in',
        'prior_status',    v_status,
        'age_min',         round(extract(epoch from (now() - v_started_at)) / 60),
        'partner_changed', (v_partner_id is distinct from p_partner_id)
      ));
    end if;
    v_id := null;
  end if;

  for attempt in 1..2 loop
    insert into gym_visits (user_id, partner_id, region_id, started_at, platform)
    values (v_user, p_partner_id, p_region_id, coalesce(p_started_at, now()), p_platform)
    on conflict (user_id) where ended_at is null do nothing
    returning id into v_id;

    if v_id is not null then
      insert into gym_visit_events (visit_id, user_id, event, detail)
      values (v_id, v_user, 'check_in', jsonb_build_object('region_id', p_region_id));
      return v_id;
    end if;

    select id into v_id
      from gym_visits
     where user_id = v_user and ended_at is null
     order by started_at desc
     limit 1;

    if v_id is not null then return v_id; end if;
  end loop;

  raise exception 'open_gym_visit: could not open or adopt a live visit for %', v_user;
end;
$function$;
