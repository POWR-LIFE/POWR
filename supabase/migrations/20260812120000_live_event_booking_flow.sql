-- =============================================================
-- LIVE EVENTS — guided registration: rules + venue booking handoff
-- =============================================================
-- Registration becomes a guided flow: confirm → "you're in" (the
-- event rules + your invite QR/link) → book your physical spot on
-- the venue's own site. Two new event knobs and one participant
-- stamp carry it:
--
--   * live_events.rules        — admin-authored list of the rules a
--     registrant agrees to (jsonb array of strings; [] = none).
--     Shown at registration and on the League ticket.
--   * live_events.booking_url  — the venue's external booking page
--     (One LDN books via oneldn.com, a third-party system). NULL
--     hides every booking surface — the URL typically arrives weeks
--     after registrations open, and surfaces self-reveal when the
--     admin sets it. May contain {email} / {name} placeholders the
--     client substitutes so the external form can prefill.
--   * live_event_participants.booking_link_opened_at — when this
--     user FIRST tapped through to the booking site (the funnel
--     fact: "we handed them off at T"). Set-if-null; re-opens are
--     not news.
--
-- Whether they actually BOOKED is deliberately not a stored flag —
-- the 20260805140000 header explains why (a participant flag needs
-- syncing every time either side moves and has nowhere to put
-- booked-but-no-account emails). The viewer payload instead derives
-- 'confirmed' at read time from live_event_bookings (the venue's
-- uploaded export) by email match. Positive-only signal: absence
-- means "not in the export we have", never "did not book" — someone
-- may book under a different email; copy must not assert not-booked.
-- =============================================================

alter table public.live_events
  add column if not exists booking_url text,
  add column if not exists rules jsonb not null default '[]'::jsonb;

alter table public.live_events
  drop constraint if exists live_events_booking_url_check;
alter table public.live_events
  add constraint live_events_booking_url_check
    check (booking_url is null or booking_url ~* '^https?://');

alter table public.live_events
  drop constraint if exists live_events_rules_array_check;
alter table public.live_events
  add constraint live_events_rules_array_check
    check (jsonb_typeof(rules) = 'array');

alter table public.live_event_participants
  add column if not exists booking_link_opened_at timestamptz;

-- =============================================================
-- mark_event_booking_opened — stamp the handoff
-- =============================================================
-- Fired (and forgotten) by the client right before it opens the
-- booking URL. Set-if-null: the first open is the funnel fact and
-- the stamp never moves after that. Zero rows updated (not joined,
-- already stamped, DQ'd) is a silent no-op — a stale client must
-- never be able to error a user out of the booking handoff.
-- No status gate beyond archived: previewers stamp their draft
-- rows, and reset_live_event_preview deletes the row (stamp
-- included) so the join → reset → rejoin test loop stays clean.
-- Participants have SELECT-own-row RLS but no write policy — this
-- definer RPC is the only client write path to the stamp.
create or replace function public.mark_event_booking_opened(p_event_id uuid)
returns jsonb
language plpgsql
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
   where id = p_event_id and status <> 'archived';
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  update public.live_event_participants
     set booking_link_opened_at = now()
   where event_id = v_event.id
     and user_id  = v_uid
     and disqualified_at is null
     and booking_link_opened_at is null;

  return public._live_event_viewer(v_event, v_uid);
end;
$$;

revoke all on function public.mark_event_booking_opened(uuid) from public, anon;
grant execute on function public.mark_event_booking_opened(uuid) to authenticated;

-- =============================================================
-- _live_event_viewer — carries the viewer's booking state
-- =============================================================
-- Body identical to 20260804150000 plus the always-present
-- 'booking' block. Always present (unlike 'gate') because
-- 'confirmed' can be legitimately true after an export upload even
-- if booking_url is later cleared — feature visibility keys on
-- event.booking_url, not on this block. Both lookups are indexed
-- (participants PK, bookings (event_id, email) unique) — cheap
-- enough to ride the 60s board poll, which also calls this.
create or replace function public._live_event_viewer(p_event public.live_events, p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'eligible',
      exists (
        select 1 from public.profiles p
        where p.id = p_uid
          and p.created_at < coalesce(p_event.eligibility_cutoff_at, p_event.window_start_at)
          and (p_event.scope <> 'global' or p.show_on_leaderboard = true)
      )
      and not exists (
        select 1 from public.live_event_participants lp
        where lp.event_id = p_event.id and lp.user_id = p_uid
          and lp.disqualified_at is not null
      ),
    'joined',
      exists (
        select 1 from public.live_event_participants lp
        where lp.event_id = p_event.id and lp.user_id = p_uid
          and lp.disqualified_at is null
      ),
    'disqualified',
      exists (
        select 1 from public.live_event_participants lp
        where lp.event_id = p_event.id and lp.user_id = p_uid
          and lp.disqualified_at is not null
      ),
    'gate',
      case when p_event.entry_gate_n <= 0 then null else (
        select jsonb_build_object(
          'required', p_event.entry_gate_n,
          'counting', p_event.entry_gate_counting,
          'count',    g.n,
          'met',      g.n >= p_event.entry_gate_n
        )
        from (select public._live_event_gate_count(p_event.id, p_uid) as n) g
      ) end,
    'booking',
      jsonb_build_object(
        'opened_at',
          (select lp.booking_link_opened_at
             from public.live_event_participants lp
            where lp.event_id = p_event.id and lp.user_id = p_uid
              and lp.disqualified_at is null),
        'confirmed',
          exists (
            select 1
              from public.live_event_bookings b
              join auth.users u on u.id = p_uid
             where b.event_id = p_event.id
               and b.email = lower(u.email)
          )
      )
  )
$$;

revoke all on function public._live_event_viewer(public.live_events, uuid) from public, anon, authenticated;

-- =============================================================
-- get_live_event — rules + booking_url ride the payload
-- =============================================================
-- Body identical to 20260731190000 plus the two new keys.
-- get_active_live_event delegates here and join_live_event returns
-- _live_event_viewer, so both pick the additions up for free.
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

-- =============================================================
-- admin_get_event_registrations — the joined → opened → booked funnel
-- =============================================================
-- Body identical to 20260731160000 plus two per-participant keys:
-- booking_opened_at (the handoff stamp) and booked (derived from
-- the venue export, same email-match as the viewer). The
-- BookingsPanel keeps the list-level reconciliation; this is the
-- per-user funnel read.
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

revoke all on function public.admin_get_event_registrations(uuid) from public, anon;
grant execute on function public.admin_get_event_registrations(uuid) to authenticated;
