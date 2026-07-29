-- =============================================================
-- LIVE EVENTS — app-facing discovery + invite progress (ticket 3)
-- =============================================================
-- The app must never hardcode an event slug: it asks "what's the
-- current event?" and renders whatever comes back (or nothing).
-- Invite progress backs the "2 of 5 converted" card — served by a
-- definer RPC so the client needs no direct profiles/referrals
-- joins, and pending invitees' names come through without
-- widening any table's RLS.
-- =============================================================

-- The one event the app should currently care about: not draft or
-- archived, and not long over (a 7-day tail keeps the winners card
-- around after settle; ticket 5 renders those states). Nearest
-- upcoming window first.
create or replace function public.get_active_live_event()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_slug text;
begin
  select slug into v_slug
    from public.live_events
   where status not in ('draft', 'archived')
     and window_end_at > now() - interval '7 days'
   order by window_start_at
   limit 1;

  if v_slug is null then
    return null;
  end if;

  return public.get_live_event(v_slug);
end;
$$;

-- Invite progress for the calling user. `event` mirrors the
-- conversion trigger's active-event pick (scheduled/live, inside
-- the deadline) so the numbers here always agree with what a
-- conversion would actually pay.
create or replace function public.get_my_invite_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_event public.live_events;
  v_friends jsonb;
begin
  if v_uid is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event
    from public.live_events
   where status in ('scheduled', 'live')
     and now() <= coalesce(conversion_deadline_at, window_end_at)
   order by window_start_at
   limit 1;

  select jsonb_agg(jsonb_build_object(
           'display_name', p.display_name,
           'username',     p.username,
           'avatar_url',   p.avatar_url,
           'converted',    r.converted_at is not null,
           'converted_at', r.converted_at
         ) order by r.created_at desc)
    into v_friends
    from public.referrals r
    join public.profiles p on p.id = r.referred_id
   where r.referrer_id = v_uid;

  return jsonb_build_object(
    'friends',         coalesce(v_friends, '[]'::jsonb),
    'total',           (select count(*) from public.referrals r where r.referrer_id = v_uid),
    'converted_total', (select count(*) from public.referrals r
                         where r.referrer_id = v_uid and r.converted_at is not null),
    'event', case when v_event.id is null then null else jsonb_build_object(
      'event_id',            v_event.id,
      'invite_bonus_points', v_event.invite_bonus_points,
      'milestone_n',         v_event.invite_milestone_n,
      'milestone_bonus',     v_event.invite_milestone_bonus,
      'converted_for_event', (select count(*) from public.referrals r
                               where r.referrer_id = v_uid
                                 and r.event_id = v_event.id
                                 and r.converted_at is not null),
      'milestone_paid',      exists (select 1 from public.live_event_invite_milestones m
                                      where m.event_id = v_event.id and m.referrer_id = v_uid)
    ) end
  );
end;
$$;

revoke all on function public.get_active_live_event()   from public, anon;
revoke all on function public.get_my_invite_progress()  from public, anon;
grant execute on function public.get_active_live_event()  to authenticated;
grant execute on function public.get_my_invite_progress() to authenticated;
