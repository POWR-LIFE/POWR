-- =============================================================
-- get_live_event — carry the NIGHT and the PLACE, not just the window
-- =============================================================
-- The League hero card could only say when SCORING runs. For a venue
-- event that is the least useful of the three facts: scoring opens a
-- week before the night itself, so a card showing only the window tells
-- you nothing about when to turn up or where to go.
--
-- Two additions, both read-only:
--
--  * doors_open_at / doors_close_at — already on the table and already
--    editable in admin, but never reached the app. doors_open_at IS the
--    night at the venue; nothing else on the row records it, so rather
--    than add a redundant "event_at" column this makes the existing
--    field do the job it already describes. Null stays null — the card
--    hides the row rather than inventing a date.
--
--  * venue.id / address / lat / lng — enough for the card's location
--    row to deep-link into Discover and land on the venue. `id` is the
--    partners UUID, which is what Discover keys a partner on.
--
-- Coordinates come from locations->0: partners.locations is the jsonb
-- array behind Discover's composite "${dbId}-${locationIndex}" keys, and
-- a venue partner is single-location by construction (a multi-site brand
-- would need the admin to pick WHICH site hosts the event, which is a
-- different change). Index 0 is therefore the venue, and a partner with
-- an empty array yields nulls rather than an error.
--
-- Everything else in the payload is byte-identical to 20260812120000.

create or replace function public.get_live_event(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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

  -- Previewers see the draft as it would appear once launched.
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
$$;
