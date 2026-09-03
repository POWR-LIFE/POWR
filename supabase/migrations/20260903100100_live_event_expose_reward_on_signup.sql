-- Expose reward_referrals_on_signup on the client event payload so invite copy
-- can state WHEN the referrer is paid instead of hardcoding "first verified
-- workout" (lib/liveEventDisplay.ts inviteRewardLine).
--
-- Purely additive: one extra key on get_live_event's jsonb. The rest of the
-- body is the CURRENT PROD body fetched via pg_get_functiondef 2026-09-03,
-- unchanged — see 20260903100000 for the behaviour this describes.
--
-- The client type marks the field OPTIONAL on purpose: a payload cached before
-- this landed has no such key, and `undefined` must read as the old
-- pay-on-conversion promise rather than claiming money the server won't pay.
create or replace function public.get_live_event(p_slug text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_event   public.live_events;
  v_preview boolean := false;
  v_status  text;
begin
  if v_uid is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events
   where slug = p_slug and status <> 'archived';
  if not found then
    return null;
  end if;

  if v_event.status = 'draft' then
    v_preview := public._live_event_previewer(v_event, v_uid);
    if not v_preview then
      return null;
    end if;
  end if;

  v_status := case
    when not v_preview then v_event.status
    when now() >= v_event.window_start_at and now() < v_event.window_end_at then 'live'
    else 'scheduled'
  end;

  return jsonb_build_object(
    'id',                v_event.id,
    'slug',              v_event.slug,
    'name',              v_event.name,
    'logo_url',          v_event.logo_url,
    'logo_only',         v_event.logo_only,
    'status',            v_status,
    'scope',             v_event.scope,
    'window_start_at',   v_event.window_start_at,
    'window_end_at',     v_event.window_end_at,
    'lock_at',           v_event.lock_at,
    'doors_open_at',     v_event.doors_open_at,
    'doors_close_at',    v_event.doors_close_at,
    'is_locked',         (v_event.status = 'locked'
                          or v_event.hidden
                          or (v_event.lock_at is not null and now() >= v_event.lock_at)),
    'revealed_at',       v_event.revealed_at,
    'prizes',            v_event.prizes,
    'board_size',        v_event.board_size,
    'invite_bonus_points',    v_event.invite_bonus_points,
    'invite_milestone_n',     v_event.invite_milestone_n,
    'invite_milestone_bonus', v_event.invite_milestone_bonus,
    'reward_referrals_on_signup', v_event.reward_referrals_on_signup,
    'attendance_bonus_points', v_event.attendance_bonus_points,
    'conversion_deadline_at', v_event.conversion_deadline_at,
    'promo_headline',    v_event.promo_headline,
    'promo_media_url',   v_event.promo_media_url,
    'rules',             coalesce(v_event.rules, '[]'::jsonb),
    'booking_url',       v_event.booking_url,
    'venue',             (select jsonb_build_object(
                            'id',       p.id,
                            'name',     p.name,
                            'logo_url', p.logo_url,
                            'logo_bg',  p.logo_bg,
                            'address',  p.address,
                            'lat',      nullif(p.locations->0->>'lat', '')::double precision,
                            'lng',      nullif(p.locations->0->>'lng', '')::double precision
                          ) from public.partners p
                          where p.id = v_event.venue_partner_id),
    'is_preview',        v_preview,
    'viewer',            public._live_event_viewer(v_event, v_uid)
  );
end;
$function$;
