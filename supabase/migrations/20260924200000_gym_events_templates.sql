-- =============================================================
-- Gym-run events, part 1: templates, presets and the rules they obey
-- =============================================================
-- Gyms create events from POWR-made templates. They never set scoring,
-- points or dates by hand: a template fixes the shape (length, what counts,
-- when the board seals, whether there's a finale night), and a points preset
-- fixes the only POWR a gym event can pay (the attendance reward). Gyms bring
-- their own prizes.
--
--   event_point_presets  POWR-set attendance rewards. v1: none / 25 / 50.
--                        Invite bonuses stay POWR-only (Jamie, 2026-09-24).
--   event_templates      Monthly challenge (gym-only, 28 days), Weekend sprint
--                        (3 days, any verified workout), Points week + finale
--                        night (7 days, then a night at the gym).
--   live_events          + managed_by ('powr' | 'gym'), template/preset keys,
--                        review state, reveal_at, auto-settle / safety-net
--                        reveal timings, results_cut_at, count_venue_only,
--                        attendance_paid_at.
--
-- Rules, enforced below whatever the caller:
--   · A gym event is opt-in, venue-audience, has no entry gate and runs no
--     invite programme of its own. It can't add referral / bonus / challenge
--     points to a score. Its attendance reward is exactly its preset's.
--   · Gym events never claim referrals (_live_event_referral_event skips
--     them): invites made during one pay the platform default, which is
--     what the app's invite card says (+20 each).
--   · count_venue_only: only sessions AT the venue count (new ledger reason
--     'not_at_venue').
--   · A gym's own staff preview its drafts in the app, like preview testers.

-- ── Presets ─────────────────────────────────────────────────────────────────
create table if not exists public.event_point_presets (
  key                      text primary key,
  label                    text not null,
  blurb                    text,
  attendance_bonus_points  integer not null default 0 check (attendance_bonus_points between 0 and 100),
  active                   boolean not null default true,
  sort_order               integer not null default 0
);

insert into public.event_point_presets (key, label, blurb, attendance_bonus_points, sort_order) values
  ('none',      'No bonus',         'Rank and your prizes only.',                                    0, 0),
  ('attend_25', '+25 for turning up', 'Everyone who comes to the finale night gets 25 POWR.',        25, 1),
  ('attend_50', '+50 for turning up', 'Everyone who comes to the finale night gets 50 POWR.',        50, 2)
on conflict (key) do nothing;

alter table public.event_point_presets enable row level security;
drop policy if exists "Signed-in users read presets" on public.event_point_presets;
create policy "Signed-in users read presets" on public.event_point_presets
  for select to authenticated using (active);
drop policy if exists "Admins manage presets" on public.event_point_presets;
create policy "Admins manage presets" on public.event_point_presets
  for all to authenticated
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

-- ── Templates ───────────────────────────────────────────────────────────────
-- Times are the gym's local time (Europe/London unless its board says
-- otherwise). With a finale night, scoring ends at midnight before it and
-- the board stays sealed until someone reveals it at the night.
create table if not exists public.event_templates (
  key                      text primary key,
  name                     text not null,
  blurb                    text not null,
  duration_days            integer not null check (duration_days between 1 and 42),
  night_start_hour         integer check (night_start_hour between 0 and 23),
  night_hours              integer check (night_hours between 1 and 8),
  included_activities      text[],
  count_manual             boolean not null default false,
  count_walking            boolean not null default false,
  count_streak             boolean not null default false,
  count_venue_only         boolean not null default false,
  board_size               integer not null default 20 check (board_size between 3 and 100),
  default_rules            jsonb not null default '[]'::jsonb,
  allowed_presets          text[] not null default '{none}',
  default_preset           text not null default 'none',
  radius_choices           integer[] not null default '{}',
  settle_grace_hours       integer not null default 12 check (settle_grace_hours between 0 and 72),
  auto_reveal_after_hours  integer check (auto_reveal_after_hours between 1 and 336),
  active                   boolean not null default true,
  sort_order               integer not null default 0,
  check ((night_start_hour is null) = (night_hours is null))
);

insert into public.event_templates
  (key, name, blurb, duration_days, night_start_hour, night_hours,
   included_activities, count_manual, count_walking, count_streak, count_venue_only,
   board_size, default_rules, allowed_presets, default_preset, radius_choices,
   settle_grace_hours, auto_reveal_after_hours, sort_order)
values
  ('monthly', 'Monthly challenge',
   'Four weeks. Every verified session at {gym} counts. Winners revealed after the last day.',
   28, null, null,
   null, false, false, false, true,
   20,
   '["Only sessions at {gym} count. Check in with POWR when you arrive.", "Manually logged workouts don''t count.", "Anyone gaming the board can be removed by {gym} or POWR."]'::jsonb,
   '{none}', 'none', '{1,2,5}',
   12, 72, 0),
  ('sprint', 'Weekend sprint',
   'Three days, any verified workout anywhere. Fridays make a good start.',
   3, null, null,
   null, false, false, false, false,
   20,
   '["Any verified workout counts, wherever you train.", "Manually logged workouts and walking don''t count.", "Anyone gaming the board can be removed by {gym} or POWR."]'::jsonb,
   '{none}', 'none', '{1,2,5}',
   12, 72, 1),
  ('finale', 'Points week + finale night',
   'Seven days of verified workouts anywhere, then a night at {gym} where the winners are revealed.',
   7, 18, 3,
   null, false, false, false, false,
   20,
   '["Any verified workout counts, wherever you train, for seven days.", "The board is sealed after the last day and revealed at the finale night at {gym}.", "Manually logged workouts and walking don''t count.", "Anyone gaming the board can be removed by {gym} or POWR."]'::jsonb,
   '{none,attend_25,attend_50}', 'attend_25', '{1,2,5}',
   12, 72, 2)
on conflict (key) do nothing;

alter table public.event_templates enable row level security;
drop policy if exists "Signed-in users read templates" on public.event_templates;
create policy "Signed-in users read templates" on public.event_templates
  for select to authenticated using (active);
drop policy if exists "Admins manage templates" on public.event_templates;
create policy "Admins manage templates" on public.event_templates
  for all to authenticated
  using (exists (select 1 from public.admin_roles where user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_roles where user_id = (select auth.uid())));

-- ── live_events: who runs it, and how it runs itself ────────────────────────
alter table public.live_events
  add column if not exists managed_by              text not null default 'powr',
  add column if not exists template_key            text references public.event_templates(key),
  add column if not exists points_preset_key       text references public.event_point_presets(key),
  add column if not exists review_status           text,
  add column if not exists submitted_at            timestamptz,
  add column if not exists reviewed_at             timestamptz,
  add column if not exists reviewed_by             uuid references auth.users(id) on delete set null,
  add column if not exists review_note             text,
  add column if not exists published_at            timestamptz,
  add column if not exists reveal_at               timestamptz,
  add column if not exists auto_settle             boolean not null default false,
  add column if not exists settle_grace_hours      integer not null default 12,
  add column if not exists auto_reveal_after_hours integer,
  add column if not exists results_cut_at          timestamptz,
  add column if not exists count_venue_only        boolean not null default false,
  add column if not exists attendance_paid_at      timestamptz;

alter table public.live_events
  drop constraint if exists live_events_managed_by_check,
  add  constraint live_events_managed_by_check check (managed_by in ('powr', 'gym')),
  drop constraint if exists live_events_review_status_check,
  add  constraint live_events_review_status_check
       check (review_status is null or review_status in ('pending', 'approved', 'rejected', 'pulled')),
  drop constraint if exists live_events_gym_venue_check,
  add  constraint live_events_gym_venue_check check (managed_by = 'powr' or venue_partner_id is not null),
  drop constraint if exists live_events_settle_grace_check,
  add  constraint live_events_settle_grace_check check (settle_grace_hours between 0 and 72),
  drop constraint if exists live_events_auto_reveal_check,
  add  constraint live_events_auto_reveal_check
       check (auto_reveal_after_hours is null or auto_reveal_after_hours between 1 and 336);

create index if not exists live_events_venue_idx on public.live_events (venue_partner_id) where venue_partner_id is not null;
create index if not exists live_events_review_pending_idx on public.live_events (submitted_at) where review_status = 'pending';

comment on column public.live_events.managed_by is
  'powr = run from /admin/events. gym = created by the venue''s team in the gym portal from a template; the guard trigger keeps its points and scoring inside the template''s rules.';
comment on column public.live_events.count_venue_only is
  'Only sessions at the venue (activity_sessions.partner_id = venue_partner_id) count. Ledger reason not_at_venue.';

-- ── The rules a gym event can't leave ───────────────────────────────────────
create or replace function public.live_events_gym_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_attend integer;
begin
  if new.managed_by <> 'gym' then
    return new;
  end if;

  if new.scope <> 'opt_in' or new.audience_mode <> 'venue' then
    raise exception 'A gym event is opt-in and shown to the venue''s people' using errcode = 'P0001';
  end if;
  if coalesce(new.entry_gate_n, 0) <> 0
     or coalesce(new.invite_milestone_n, 0) <> 0
     or coalesce(new.invite_milestone_bonus, 0) <> 0
     or new.reward_referrals_on_signup
     or new.count_referrals or new.count_bonuses or new.count_challenges then
    raise exception 'A gym event runs no invite programme and can''t count bonus points' using errcode = 'P0001';
  end if;

  select p.attendance_bonus_points into v_attend
    from public.event_point_presets p where p.key = coalesce(new.points_preset_key, 'none');
  if coalesce(new.attendance_bonus_points, 0) <> coalesce(v_attend, 0) then
    raise exception 'A gym event''s attendance reward comes from its points preset' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists live_events_gym_guard on public.live_events;
create trigger live_events_gym_guard
  before insert or update on public.live_events
  for each row execute function public.live_events_gym_guard();

-- ── Venue-only scoring ──────────────────────────────────────────────────────
-- Re-stated from prod (pg_get_functiondef, 2026-09-24). Changes: the session
-- row carries its partner, and count_venue_only rejects sessions elsewhere
-- (reason not_at_venue, labelled in shared/eventScoring.ts).
create or replace function public._live_event_ledger(p_event_id uuid, p_uid uuid default null::uuid)
returns table(tx_id uuid, user_id uuid, amount integer, tx_type text, source text, description text, created_at timestamp with time zone, session_id uuid, activity text, verification text, started_at timestamp with time zone, ended_at timestamp with time zone, bucket text, counted boolean, counted_at timestamp with time zone, reason text)
language sql
stable security definer
set search_path to 'public'
as $$
  with ev as (
    select * from public.live_events where id = p_event_id
  ),
  rows as (
    select pt.id                              as tx_id,
           pt.user_id,
           pt.amount,
           pt.type::text                      as tx_type,
           pt.source,
           pt.description,
           pt.created_at,
           s.id                               as session_id,
           s.type::text                       as s_type,
           s.verification::text               as s_verif,
           s.partner_id                       as s_partner,
           s.started_at,
           coalesce(s.ended_at, s.started_at) as ended_at
    from public.point_transactions pt
    cross join ev
    left join public.activity_sessions s on s.id = pt.session_id
    where (p_uid is null or pt.user_id = p_uid)
      and pt.type::text <> 'redeem'
      and (
        (pt.created_at >= ev.window_start_at and pt.created_at < ev.window_end_at)
        or (s.id is not null
            and coalesce(s.ended_at, s.started_at) > ev.window_start_at
            and s.started_at                       < ev.window_end_at)
      )
  ),
  sess as (
    -- session-backed: in the window when the ACTIVITY overlaps it.
    -- "manual" = the session's verification, never the ledger source
    -- (native HealthKit rows are source = 'manual_log').
    select r.*,
           case when r.tx_type = 'streak' then 'streak'
                when r.tx_type = 'earn'   then 'activity'
                else r.tx_type end as bucket,
           case
             when not (r.ended_at > ev.window_start_at and r.started_at < ev.window_end_at)
                                                                              then 'outside_window'
             when r.tx_type = 'streak' and not ev.count_streak                then 'streak_off'
             when r.tx_type = 'streak'                                        then null
             when r.tx_type <> 'earn'                                         then 'type_not_scored'
             when not ev.count_manual  and coalesce(r.s_verif, '') = 'manual' then 'manual_off'
             when not ev.count_walking and coalesce(r.s_type, '')  = 'walking' then 'walking_off'
             when ev.included_activities is not null
                  and not (r.s_type = any (ev.included_activities))           then 'activity_not_included'
             when ev.count_venue_only
                  and r.s_partner is distinct from ev.venue_partner_id        then 'not_at_venue'
             else null
           end as reason
    from rows r
    cross join ev
    where r.session_id is not null
  ),
  other as (
    -- sessionless rows credited in the window. Which ones count is the
    -- event's choice, with two fixed rules the editor promises: penalties
    -- always reduce a score; the attendance reward never adds to one.
    -- Invite rewards (both sides of a conversion + the milestone) are a
    -- switch like the others — count_referrals — and need no anchor: they
    -- are paid at the moment the friend converts, so an in-window row IS
    -- in-window effort, never a backfill. Sessionless earn / streak rows
    -- ride on in-window activity the member had already banked (a counted
    -- session row credited at or before them).
    select r.*,
           case
             when r.tx_type = 'penalty'    then 'penalty'
             when r.tx_type = 'adjustment' then 'adjustment'
             when coalesce(r.source, '') in ('weekly_challenge', 'shared_challenge', 'shared_challenge_bonus')
                                           then 'challenge'
             when coalesce(r.source, '') in ('referral_received', 'referral_sent', 'invite_milestone')
                                           then 'invite'
             when coalesce(r.source, '') = 'event_attendance'
                                           then 'attendance'
             when r.tx_type = 'bonus'      then 'bonus'
             when r.tx_type = 'streak'     then 'streak'
             else 'other'
           end as bucket,
           case
             when coalesce(r.source, '') = 'event_attendance'                 then 'never_counts'
             when coalesce(r.source, '') in ('referral_received', 'referral_sent', 'invite_milestone')
                  then case when ev.count_referrals then null else 'referrals_off' end
             when r.tx_type = 'penalty'                                       then null
             when r.tx_type = 'adjustment'
                  then case when ev.count_adjustments then null else 'adjustments_off' end
             when coalesce(r.source, '') in ('weekly_challenge', 'shared_challenge', 'shared_challenge_bonus')
                  then case when ev.count_challenges then null else 'challenges_off' end
             when r.tx_type = 'bonus'
                  then case when ev.count_bonuses then null else 'bonuses_off' end
             when r.tx_type = 'streak' and not ev.count_streak                then 'streak_off'
             when r.tx_type in ('earn', 'streak')
                  then case when exists (
                         select 1 from sess x
                         where x.user_id = r.user_id
                           and x.reason is null
                           and x.created_at <= r.created_at
                       ) then null else 'no_anchor' end
             else 'type_not_scored'
           end as reason
    from rows r
    cross join ev
    where r.session_id is null
  )
  select s.tx_id, s.user_id, s.amount, s.tx_type, s.source, s.description, s.created_at,
         s.session_id, s.s_type, s.s_verif, s.started_at, s.ended_at,
         s.bucket, (s.reason is null),
         case when s.reason is null then s.ended_at end, s.reason
  from sess s
  union all
  select o.tx_id, o.user_id, o.amount, o.tx_type, o.source, o.description, o.created_at,
         o.session_id, o.s_type, o.s_verif, o.started_at, o.ended_at,
         o.bucket, (o.reason is null),
         case when o.reason is null then o.created_at end, o.reason
  from other o
$$;

-- ── A gym's staff preview their own drafts in the app ───────────────────────
-- Re-stated from prod; the staff clause is new. Drafts only: once an event
-- is scheduled everyone in its audience sees it anyway.
create or replace function public._live_event_previewer(p_event public.live_events, p_uid uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select (p_event.preview_enabled
          and exists (
            select 1 from auth.users u
            where u.id = p_uid
              and lower(u.email) = any (select lower(e) from unnest(p_event.preview_emails) e)
          ))
      or (p_event.managed_by = 'gym'
          and p_event.status = 'draft'
          and exists (
            select 1 from public.gym_staff s
            where s.partner_id = p_event.venue_partner_id
              and s.user_id = p_uid
          ))
$$;

-- ── Gym events never claim referrals ────────────────────────────────────────
-- Re-stated from 20260924160100; the managed_by filter is new.
create or replace function public._live_event_referral_event(p_referrer uuid)
returns public.live_events
language sql
stable
security definer
set search_path = public
as $$
  select e.*
    from public.live_events e
    left join public.live_event_participants lp
           on lp.event_id = e.id
          and lp.user_id = p_referrer
          and lp.disqualified_at is null
   where e.status in ('scheduled', 'live')
     and e.managed_by = 'powr'
     and now() <= coalesce(e.conversion_deadline_at, e.window_end_at)
     and (e.audience_mode = 'all' or lp.user_id is not null)
   order by (lp.user_id is not null) desc, e.window_start_at
   limit 1
$$;

-- ── Freeze the results (the admin's Settle, callable from other functions) ──
create or replace function public._live_event_cut_results(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
  v_count integer;
begin
  select * into v_event from public.live_events where id = p_event_id;
  if not found then
    return 0;
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
  update public.live_events set results_cut_at = now() where id = p_event_id;
  return v_count;
end;
$$;

revoke all on function public._live_event_cut_results(uuid) from public, anon, authenticated;
revoke all on function public.live_events_gym_guard() from public, anon, authenticated;
