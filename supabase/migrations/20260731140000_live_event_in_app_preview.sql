-- =============================================================
-- LIVE EVENTS — in-app test preview for draft events
-- =============================================================
-- Flipping an event to 'scheduled' makes it live for every updated
-- app instantly, so there was no way to see the home card / register
-- flow on a real device before launch. This adds a per-event preview
-- gate: while a draft has preview_enabled, the app RPCs treat it as
-- visible FOR THE LISTED EMAILS ONLY, with a simulated status
-- ('scheduled' before the window, 'live' inside it) and is_preview
-- flagged so the client can badge it. Real users still see nothing
-- until the row is actually scheduled. Archived stays hidden always.

alter table public.live_events
  add column if not exists preview_enabled boolean not null default false,
  add column if not exists preview_emails  text[]  not null default '{}';

-- Is this caller a preview tester for this event? Definer-only helper
-- (reads auth.users for the email); never granted to clients.
create or replace function public._live_event_previewer(p_event public.live_events, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_event.preview_enabled
     and exists (
       select 1 from auth.users u
       where u.id = p_uid
         and lower(u.email) = any (select lower(e) from unnest(p_event.preview_emails) e)
     )
$$;
revoke all on function public._live_event_previewer(public.live_events, uuid) from public, anon, authenticated;

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
    'status',            v_status,
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
    'is_preview',        v_preview,
    'viewer',            public._live_event_viewer(v_event, v_uid)
  );
end;
$$;

-- Candidate pick now includes drafts the caller can preview.
create or replace function public.get_active_live_event()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_slug text;
begin
  select e.slug into v_slug
    from public.live_events e
   where e.status <> 'archived'
     and (e.status <> 'draft' or public._live_event_previewer(e, v_uid))
     and e.window_end_at > now() - interval '7 days'
   order by (e.status = 'draft'), e.window_start_at
   limit 1;

  if v_slug is null then
    return null;
  end if;

  return public.get_live_event(v_slug);
end;
$$;

-- Previewers can exercise the full register flow against a draft.
-- A participant row on a draft is inert (scoring/settle only touch
-- launched events) and cascades away if the draft is deleted.
create or replace function public.join_live_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_event   public.live_events;
  v_preview boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if found and v_event.status = 'draft' then
    v_preview := public._live_event_previewer(v_event, v_uid);
  end if;
  if not found or v_event.status = 'archived' or (v_event.status = 'draft' and not v_preview) then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if v_event.scope <> 'opt_in' then
    raise exception 'This event does not require joining' using errcode = 'P0001';
  end if;
  if (v_event.status not in ('scheduled', 'live') and not v_preview) or now() >= v_event.window_end_at then
    raise exception 'This event can no longer be joined' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid
      and p.created_at < coalesce(v_event.eligibility_cutoff_at, v_event.window_start_at)
  ) then
    raise exception 'Your account was created after the eligibility cutoff' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.live_event_participants lp
    where lp.event_id = v_event.id and lp.user_id = v_uid
      and lp.disqualified_at is not null
  ) then
    raise exception 'You cannot rejoin this event' using errcode = 'P0001';
  end if;

  insert into public.live_event_participants (event_id, user_id)
  values (v_event.id, v_uid)
  on conflict (event_id, user_id) do nothing;

  return public._live_event_viewer(v_event, v_uid);
end;
$$;
