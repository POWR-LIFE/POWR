-- =============================================================
-- LIVE EVENTS — event model + scoring (Live Events ticket 1)
-- =============================================================
-- Platform for windowed points-week events (first: One LDN, Fri 4
-- Sept 2026). Spec: context/LIVE_EVENTS_PLAN.md §2–§3.
--
-- Core principles baked in here:
--
--   * NEVER a points reset. An event score is a windowed sum over
--     point_transactions — balances, levels and the vault are
--     untouched. A config change re-scores retroactively because
--     scores are always computed from the ledger, never stored
--     (until Settle snapshots them).
--
--   * Every mechanic parameter is a column on live_events, edited
--     in admin, effective immediately. Nothing event-specific is
--     hardcoded anywhere.
--
--   * The blur is SERVER-SIDE. While an event is locked or hidden
--     no RPC returns a score to a non-admin — a client or proxy
--     must see nothing. Client-side blur is readable.
--
--   * display_token gates the big-screen venue URL and must never
--     reach an app client, so live_events has NO user-facing
--     select policy: the app reads through get_live_event(),
--     which omits the token. Admin portal uses direct table
--     access under the admin policy.
--
--   * Tie-break is "first to reach the final score": rank by
--     score DESC, then timestamp of last counted transaction ASC,
--     then user_id. Daily caps compress top scores so exact ties
--     are likely; this is fully resolvable from the ledger with
--     no manual adjudication on the night.
--
--   * type='bonus' NEVER counts toward an event score (referral /
--     signup bonuses must not buy rank). type='penalty' rows are
--     stored negative and DO subtract — see the companion view
--     migration for the same fix to the global boards.
-- =============================================================

-- ── Tables ────────────────────────────────────────────────────

create table if not exists public.live_events (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,
  name                  text not null,
  venue_partner_id      uuid references public.partners(id) on delete set null,

  -- Settle (snapshot results) and Reveal (show them) are separate
  -- admin actions so vetting always completes before anything is
  -- shown anywhere. Settle does NOT change status; Reveal flips
  -- locked → revealed.
  status                text not null default 'draft'
                          check (status in ('draft','scheduled','live','locked',
                                            'revealed','settled','archived')),

  window_start_at       timestamptz not null,
  window_end_at         timestamptz not null,
  -- Signup before this to compete. Null = window_start_at.
  eligibility_cutoff_at timestamptz,
  scope                 text not null default 'opt_in'
                          check (scope in ('global','opt_in')),

  -- Scoring knobs (D2–D5). included_activities is the session-type
  -- allowlist; null = every type. Default is all current types
  -- minus sleep ("you have to train"). Walking sits in the list
  -- AND has its own kill-switch so it can be pulled without
  -- retyping the list.
  included_activities   text[] default '{gym,running,cycling,hiit,yoga,swimming,sports,walking}',
  count_manual          boolean not null default true,
  count_streak          boolean not null default false,
  count_walking         boolean not null default true,

  -- Lock / reveal. lock_at auto-hides the board (checked at read
  -- time — no cron needed); hidden is the instant admin override.
  lock_at               timestamptz,
  hidden                boolean not null default false,
  revealed_at           timestamptz,

  -- Invites (ticket 2 consumes these; knobs live here from day 1).
  invite_bonus_points   integer not null default 20,
  invite_milestone_n    integer not null default 5,
  invite_milestone_bonus integer not null default 100,
  conversion_deadline_at timestamptz,
  conversion_verifications text[] not null default '{geofence,wearable}',

  -- Display
  prizes                jsonb not null default '[]'::jsonb,  -- [{rank:1, label:'…'}]
  board_size            integer not null default 50,
  -- Gates the big-screen URL (§5a). Regenerate to kill old links.
  -- Grants *display* access only, never through-blur.
  display_token         text not null
                          default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),

  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint live_events_window check (window_end_at > window_start_at)
);

create or replace function public.live_events_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists live_events_updated_at on public.live_events;
create trigger live_events_updated_at
  before update on public.live_events
  for each row execute function public.live_events_set_updated_at();

-- Rows exist for opt_in scope (joining IS the leaderboard consent);
-- for global scope only disqualifications are stored.
create table if not exists public.live_event_participants (
  event_id        uuid not null references public.live_events(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  -- Event-scoped only: removes from board + results, never touches
  -- the user's points.
  disqualified_at timestamptz,
  disqualified_by uuid references public.profiles(id) on delete set null,
  primary key (event_id, user_id)
);

-- Written by admin_settle_event: a frozen snapshot the winners card
-- reads forever — later point changes can't drift a settled event.
create table if not exists public.live_event_results (
  event_id     uuid not null references public.live_events(id) on delete cascade,
  rank         integer not null,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  final_points integer not null,
  prize_label  text,
  primary key (event_id, rank),
  unique (event_id, user_id)
);

-- ── RLS ───────────────────────────────────────────────────────
-- App clients read everything through the definer RPCs below, so
-- users get NO direct select on live_events (display_token) or
-- live_event_results (server-side blur: the RPC decides when
-- results become visible, a table policy can't see event status
-- without punching through live_events RLS). Participants may see
-- their own membership row.

alter table public.live_events enable row level security;
alter table public.live_event_participants enable row level security;
alter table public.live_event_results enable row level security;

drop policy if exists "Admins manage live events" on public.live_events;
create policy "Admins manage live events"
  on public.live_events for all
  to authenticated
  using      (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));

drop policy if exists "Users read own event participation" on public.live_event_participants;
create policy "Users read own event participation"
  on public.live_event_participants for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Admins manage event participants" on public.live_event_participants;
create policy "Admins manage event participants"
  on public.live_event_participants for all
  to authenticated
  using      (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));

drop policy if exists "Admins manage event results" on public.live_event_results;
create policy "Admins manage event results"
  on public.live_event_results for all
  to authenticated
  using      (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));

-- =============================================================
-- _live_event_scores — the single scoring definition (§2)
-- =============================================================
-- Everything that ranks (public board, admin through-blur board,
-- Settle) calls this one function so the numbers can never
-- disagree between surfaces.
--
-- A transaction counts toward user U's event score when:
--   * created_at ∈ [window_start_at, window_end_at)  — ingest-time
--     bound; a watch that syncs after the window misses it (T&Cs).
--   * type 'adjustment' or 'penalty' — always (penalties are
--     stored negative and subtract, so a session rejected in
--     review correctly lowers the event score);
--     type 'streak' — only if count_streak (D2);
--     type 'earn'  — subject to the session filters below;
--     type 'bonus' — never;
--     'redeem' — never (spending is not negative earning).
--   * Earn-row session filters: manual-verified sessions and
--     manual_log source rows drop when count_manual is off;
--     walking drops when count_walking is off; the session type
--     must be in included_activities (null list = all). Legacy
--     earn rows with no session count unless excluded by source.
--
-- Eligibility: account created before the cutoff (default: window
-- start). Global scope respects show_on_leaderboard; opt_in scope
-- requires a join row (joining is the consent). Disqualified users
-- are out either way.
create or replace function public._live_event_scores(p_event_id uuid)
returns table (user_id uuid, score integer, last_counted_tx_at timestamptz, rank bigint)
language sql
stable
security definer
set search_path = public
as $$
  with ev as (
    select * from public.live_events where id = p_event_id
  ),
  eligible as (
    select p.id as user_id
    from public.profiles p
    cross join ev
    where p.created_at < coalesce(ev.eligibility_cutoff_at, ev.window_start_at)
      and not exists (
        select 1 from public.live_event_participants lp
        where lp.event_id = ev.id
          and lp.user_id  = p.id
          and lp.disqualified_at is not null
      )
      and (
        (ev.scope = 'global' and p.show_on_leaderboard = true)
        or
        (ev.scope = 'opt_in' and exists (
          select 1 from public.live_event_participants lp
          where lp.event_id = ev.id and lp.user_id = p.id
        ))
      )
  ),
  counted as (
    select pt.user_id, pt.amount, pt.created_at
    from public.point_transactions pt
    cross join ev
    left join public.activity_sessions s on s.id = pt.session_id
    where pt.created_at >= ev.window_start_at
      and pt.created_at <  ev.window_end_at
      and (
        pt.type in ('adjustment', 'penalty')
        or (pt.type = 'streak' and ev.count_streak)
        or (
          pt.type = 'earn'
          and (ev.count_manual  or coalesce(s.verification::text, '') <> 'manual')
          and (ev.count_manual  or coalesce(pt.source, '')            <> 'manual_log')
          and (ev.count_walking or coalesce(s.type::text, '')         <> 'walking')
          and (s.id is null
               or ev.included_activities is null
               or s.type::text = any (ev.included_activities))
        )
      )
  )
  select
    e.user_id,
    coalesce(sum(c.amount), 0)::integer as score,
    max(c.created_at)                   as last_counted_tx_at,
    rank() over (
      order by coalesce(sum(c.amount), 0) desc,
               max(c.created_at) asc nulls last,
               e.user_id asc
    ) as rank
  from eligible e
  left join counted c on c.user_id = e.user_id
  group by e.user_id
$$;

-- Internal: only ever called from inside the definer RPCs below.
revoke all on function public._live_event_scores(uuid) from public, anon, authenticated;

-- Shared "who am I in this event" fragment: participation +
-- eligibility, never any score.
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
      )
  )
$$;

revoke all on function public._live_event_viewer(public.live_events, uuid) from public, anon, authenticated;

-- =============================================================
-- get_live_event — event config + viewer state for the app
-- =============================================================
-- Deliberately omits display_token (big-screen credential) and the
-- raw hidden flag; the client only ever needs "is the board
-- visible". Draft and archived events don't exist as far as the
-- app is concerned.
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
    'viewer',            public._live_event_viewer(v_event, v_uid)
  );
end;
$$;

-- =============================================================
-- get_event_leaderboard — the ONLY score path for app users
-- =============================================================
-- States, decided server-side:
--   scheduled            → no scores (board hasn't started)
--   live & visible       → standings (top board_size) + your row
--   locked / hidden      → status + your participation, NO scores
--                          anywhere in the payload (not even your
--                          own rank — rank leaks others' totals)
--   revealed / settled   → frozen live_event_results winners card
create or replace function public.get_event_leaderboard(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_event     public.live_events;
  v_locked    boolean;
  v_standings jsonb;
  v_results   jsonb;
  v_viewer    jsonb;
begin
  if v_uid is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events
   where id = p_event_id and status not in ('draft', 'archived');
  if not found then
    return null;
  end if;

  v_locked := v_event.status = 'locked'
              or v_event.hidden
              or (v_event.lock_at is not null and now() >= v_event.lock_at);
  v_viewer := public._live_event_viewer(v_event, v_uid);

  if v_event.status in ('revealed', 'settled') then
    select jsonb_agg(jsonb_build_object(
             'rank',         r.rank,
             'user_id',      r.user_id,
             'display_name', p.display_name,
             'username',     p.username,
             'avatar_url',   p.avatar_url,
             'is_pro',       p.is_pro,
             'points',       r.final_points,
             'prize_label',  r.prize_label
           ) order by r.rank)
      into v_results
      from public.live_event_results r
      join public.profiles p on p.id = r.user_id
     where r.event_id = v_event.id;

    return jsonb_build_object(
      'event_id', v_event.id,
      'status',   v_event.status,
      'is_locked', true,
      'results',  coalesce(v_results, '[]'::jsonb),
      'viewer',   v_viewer || coalesce((
        select jsonb_build_object('rank', r.rank, 'points', r.final_points,
                                  'prize_label', r.prize_label)
        from public.live_event_results r
        where r.event_id = v_event.id and r.user_id = v_uid
      ), '{}'::jsonb)
    );
  end if;

  if v_event.status <> 'live' or v_locked then
    -- Scheduled, locked or hidden: the server returns nothing
    -- score-shaped. This is the blur.
    return jsonb_build_object(
      'event_id', v_event.id,
      'status',   v_event.status,
      'is_locked', v_locked,
      'viewer',   v_viewer
    );
  end if;

  select jsonb_agg(jsonb_build_object(
           'rank',         r.rank,
           'user_id',      r.user_id,
           'display_name', p.display_name,
           'username',     p.username,
           'avatar_url',   p.avatar_url,
           'is_pro',       p.is_pro,
           'points',       r.score
         ) order by r.rank)
    into v_standings
    from (
      select * from public._live_event_scores(v_event.id)
      order by rank
      limit v_event.board_size
    ) r
    join public.profiles p on p.id = r.user_id;

  return jsonb_build_object(
    'event_id', v_event.id,
    'status',   v_event.status,
    'is_locked', false,
    'standings', coalesce(v_standings, '[]'::jsonb),
    'viewer',   v_viewer || coalesce((
      select jsonb_build_object('rank', r.rank, 'points', r.score)
      from public._live_event_scores(v_event.id) r
      where r.user_id = v_uid
    ), '{}'::jsonb)
  );
end;
$$;

-- =============================================================
-- join_live_event — opt-in scope only
-- =============================================================
create or replace function public.join_live_event(p_event_id uuid)
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

  select * into v_event from public.live_events where id = p_event_id;
  if not found or v_event.status in ('draft', 'archived') then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if v_event.scope <> 'opt_in' then
    raise exception 'This event does not require joining' using errcode = 'P0001';
  end if;
  if v_event.status not in ('scheduled', 'live') or now() >= v_event.window_end_at then
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

-- =============================================================
-- admin_get_event_leaderboard — sees through the blur
-- =============================================================
-- The list whoever hands out prizes reads from, at any status,
-- hidden or not. Adds the vetting signals per user: sessions in
-- window, verification mix ('health' buckets with wearable — same
-- semantics as lib/health/dataSource.ts; legacy gps/hr rows count
-- only in the total), and flagged-session count.
create or replace function public.admin_get_event_leaderboard(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
  v_rows  jsonb;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  select jsonb_agg(jsonb_build_object(
           'rank',               r.rank,
           'user_id',            r.user_id,
           'display_name',       p.display_name,
           'username',           p.username,
           'avatar_url',         p.avatar_url,
           'is_pro',             p.is_pro,
           'points',             r.score,
           'last_counted_tx_at', r.last_counted_tx_at,
           'sessions_in_window', coalesce(st.total, 0),
           'geofence_sessions',  coalesce(st.geofence, 0),
           'wearable_sessions',  coalesce(st.wearable, 0),
           'manual_sessions',    coalesce(st.manual, 0),
           'flagged_sessions',   coalesce(st.flagged, 0),
           'disqualified',       (lp.disqualified_at is not null)
         ) order by r.rank)
    into v_rows
    from (
      select * from public._live_event_scores(v_event.id)
      where score <> 0
      order by rank
      limit 500
    ) r
    join public.profiles p on p.id = r.user_id
    left join public.live_event_participants lp
           on lp.event_id = v_event.id and lp.user_id = r.user_id
    left join lateral (
      select count(*)                                                          as total,
             count(*) filter (where s.verification = 'geofence')               as geofence,
             count(*) filter (where s.verification in ('wearable', 'health'))  as wearable,
             count(*) filter (where s.verification = 'manual')                 as manual,
             count(*) filter (where s.flagged)                                 as flagged
      from public.activity_sessions s
      where s.user_id = r.user_id
        and s.started_at >= v_event.window_start_at
        and s.started_at <  v_event.window_end_at
    ) st on true;

  return jsonb_build_object(
    'event_id',  v_event.id,
    'status',    v_event.status,
    'hidden',    v_event.hidden,
    'standings', coalesce(v_rows, '[]'::jsonb)
  );
end;
$$;

-- =============================================================
-- admin_settle_event — freeze the final ranking
-- =============================================================
-- Snapshots top board_size (score > 0) into live_event_results and
-- attaches prize labels by rank. Does NOT change status or reveal
-- anything: Reveal is a separate admin action so vetting always
-- precedes showing. Re-settling while still locked is deliberate —
-- Friday-morning review may reject sessions (penalty rows) and the
-- snapshot must be re-cut afterwards. Once revealed, frozen.
create or replace function public.admin_settle_event(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
  v_count integer;
begin
  if not exists (select 1 from public.admin_roles where user_id = auth.uid()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select * into v_event from public.live_events where id = p_event_id for update;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if v_event.status in ('revealed', 'settled') then
    raise exception 'Event already revealed — results are frozen' using errcode = 'P0001';
  end if;
  if now() < coalesce(v_event.lock_at, v_event.window_end_at) then
    raise exception 'Cannot settle before the board locks' using errcode = 'P0001';
  end if;

  delete from public.live_event_results where event_id = p_event_id;

  insert into public.live_event_results (event_id, rank, user_id, final_points, prize_label)
  select p_event_id,
         r.rank,
         r.user_id,
         r.score,
         (select pz->>'label'
          from jsonb_array_elements(coalesce(v_event.prizes, '[]'::jsonb)) pz
          where (pz->>'rank')::integer = r.rank
          limit 1)
  from public._live_event_scores(p_event_id) r
  where r.score > 0
  order by r.rank
  limit v_event.board_size;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── Grants ────────────────────────────────────────────────────
revoke all on function public.get_live_event(text)                 from public, anon;
revoke all on function public.get_event_leaderboard(uuid)          from public, anon;
revoke all on function public.join_live_event(uuid)                from public, anon;
revoke all on function public.admin_get_event_leaderboard(uuid)    from public, anon;
revoke all on function public.admin_settle_event(uuid)             from public, anon;

grant execute on function public.get_live_event(text)              to authenticated;
grant execute on function public.get_event_leaderboard(uuid)       to authenticated;
grant execute on function public.join_live_event(uuid)             to authenticated;
grant execute on function public.admin_get_event_leaderboard(uuid) to authenticated;
grant execute on function public.admin_settle_event(uuid)          to authenticated;
