-- =============================================================
-- LIVE EVENTS — promo/venue marketing fields in the app RPC
-- =============================================================
-- The home-screen event card renders the same assets as the public
-- promo page (promo media, headline, venue branding). Those fields
-- were only served by the `event-promo` edge fn; the app discovers
-- events through get_active_live_event() → get_live_event(), so the
-- marketing fields now ride that payload too. Nothing score-shaped
-- is added — the locked-board blur contract is untouched.

create or replace function public.get_live_event(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_event public.live_events;
begin
  if v_uid is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events
   where slug = p_slug and status not in ('draft', 'archived');
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id',                v_event.id,
    'slug',              v_event.slug,
    'name',              v_event.name,
    'status',            v_event.status,
    'scope',             v_event.scope,
    'window_start_at',   v_event.window_start_at,
    'window_end_at',     v_event.window_end_at,
    'lock_at',           v_event.lock_at,
    'is_locked',         (v_event.status = 'locked'
                          or v_event.hidden
                          or (v_event.lock_at is not null and now() >= v_event.lock_at)),
    'revealed_at',       v_event.revealed_at,
    'prizes',            v_event.prizes,
    'board_size',        v_event.board_size,
    'invite_bonus_points',    v_event.invite_bonus_points,
    'invite_milestone_n',     v_event.invite_milestone_n,
    'invite_milestone_bonus', v_event.invite_milestone_bonus,
    'conversion_deadline_at', v_event.conversion_deadline_at,
    'promo_headline',    v_event.promo_headline,
    'promo_media_url',   v_event.promo_media_url,
    'venue',             (select jsonb_build_object(
                            'name',     p.name,
                            'logo_url', p.logo_url,
                            'logo_bg',  p.logo_bg
                          ) from public.partners p
                          where p.id = v_event.venue_partner_id),
    'viewer',            public._live_event_viewer(v_event, v_uid)
  );
end;
$$;
