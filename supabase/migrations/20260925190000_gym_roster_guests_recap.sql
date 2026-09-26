-- =============================================================
-- Gym portal: guests on the roster, the weekly recap, the event mails
-- =============================================================
-- 1. gym_event_roster says who is a GUEST: joined the event without having
--    picked this gym as theirs in the app. Names and POWR IDs the gym already
--    sees; never who invited whom. Re-stated from prod
--    (md5 ff4523903f7b3c0aed34c840b9d03b1f, body in 20260924200100).
-- 2. Each of the gym's team chooses the Monday recap for themselves:
--    gym_staff.recap_email, read through gym_profile (re-stated from prod,
--    md5 374c2b9a45ccee76194c837b522f40b9, body in 20260925160000) and set
--    with gym_set_recap_email. gym_portal_settings.recap_email stays the
--    gym-wide master that admins hold.
-- 3. get_gym_weekly_recaps(): every gym's week, for send-gym-email. Service
--    role only; it reads staff emails from auth.users.
-- 4. get_gym_event_mail(): one event's facts and the team's emails, for the
--    results-ready and review-result mails. Service role only.
-- 5. Trigger live_events_gym_mail: at settle (results_cut_at set while the
--    board is sealed) and on POWR's decision (review_status approved,
--    rejected or pulled), ask send-gym-email to write to the team. pg_net
--    sends after commit; the function re-reads the event then, so a gym's
--    own reveal (cut + reveal in one transaction) never mails.
-- The Monday cron is a separate migration, switched on once the sample has
-- been seen: 20260925190100_gym_weekly_recap_cron.sql.

-- ── 1. Guests on the roster ─────────────────────────────────────────────
create or replace function public.gym_event_roster(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event public.live_events;
begin
  select * into v_event from public.live_events where id = p_event_id;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if public._gym_role(v_event.venue_partner_id) is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', lp.user_id, 'display_name', p.display_name, 'username', p.username,
             'avatar_url', p.avatar_url, 'member_id', p.referral_code,
             'joined_at', lp.joined_at, 'disqualified', lp.disqualified_at is not null,
             'guest', p.preferred_gym_id is distinct from v_event.venue_partner_id)
           order by lp.disqualified_at is not null, lp.joined_at)
      from public.live_event_participants lp
      join public.profiles p on p.id = lp.user_id
     where lp.event_id = v_event.id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.gym_event_roster(uuid) from public, anon;
grant execute on function public.gym_event_roster(uuid) to authenticated;

-- ── 2. The recap is each person's choice ────────────────────────────────
alter table public.gym_staff add column if not exists recap_email boolean not null default true;
comment on column public.gym_staff.recap_email is 'This person gets the gym''s Monday recap email (gym_portal_settings.recap_email is the gym-wide master).';

create or replace function public.gym_profile(p_partner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  p      public.partners;
begin
  v_role := public._gym_role(p_partner_id);
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select * into p from public.partners where id = p_partner_id;
  if not found then
    raise exception 'Gym not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id',            p.id,
    'name',          p.name,
    'description',   p.description,
    'address',       p.address,
    'phone',         p.phone,
    'website',       p.website,
    'logo_url',      p.logo_url,
    'logo_bg',       p.logo_bg,
    'image_url',     p.image1_url,
    'opening_hours', p.opening_hours,
    'lat',           nullif(p.locations->0->>'lat', '')::double precision,
    'lng',           nullif(p.locations->0->>'lng', '')::double precision,
    'can_edit',      v_role in ('owner', 'admin'),
    -- The caller's own Monday recap switch; null for an admin previewing.
    'recap_email',   (select s.recap_email from public.gym_staff s
                       where s.partner_id = p_partner_id and s.user_id = auth.uid())
  );
end;
$$;
revoke all on function public.gym_profile(uuid) from public, anon;
grant execute on function public.gym_profile(uuid) to authenticated;

create or replace function public.gym_set_recap_email(p_partner_id uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on boolean;
begin
  update public.gym_staff
     set recap_email = coalesce(p_on, true)
   where partner_id = p_partner_id and user_id = auth.uid()
  returning recap_email into v_on;
  if v_on is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return v_on;
end;
$$;
revoke all on function public.gym_set_recap_email(uuid, boolean) from public, anon;
grant execute on function public.gym_set_recap_email(uuid, boolean) to authenticated;

-- ── 3. Every gym's week, for the Monday email ───────────────────────────
-- One object per gym with the portal on and the master switch on. The week
-- is the gym's local Monday-to-Monday that has just closed (or the one that
-- starts on p_week_start). The team's addresses come from auth.users, so
-- only the service role may call this. quiet_week tells the sender to skip.
create or replace function public.get_gym_weekly_recaps(p_week_start date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out     jsonb := '[]'::jsonb;
  g         record;
  v_tz      text;
  v_end_l   timestamp;
  v_start   timestamptz;
  v_end     timestamptz;
  v_prev    timestamptz;
  v_this    jsonb;
  v_last    jsonb;
  v_events  jsonb;
  v_feat    jsonb;
  v_quiet   integer;
  v_row     jsonb;
begin
  for g in
    select s.partner_id, p.name
      from public.gym_portal_settings s
      join public.partners p on p.id = s.partner_id
     where s.enabled and s.suspended_at is null and s.recap_email
     order by p.name
  loop
    v_tz    := public._gym_tz(g.partner_id);
    v_end_l := case when p_week_start is null
                    then date_trunc('week', now() at time zone v_tz)
                    else (p_week_start + 7)::timestamp end;
    v_end   := v_end_l at time zone v_tz;
    v_start := (v_end_l - interval '7 days') at time zone v_tz;
    v_prev  := (v_end_l - interval '14 days') at time zone v_tz;
    v_feat  := public._gym_features(coalesce(public._gym_level(g.partner_id), 0));
    v_this  := public._gym_window_totals(g.partner_id, v_start, v_end);
    v_last  := public._gym_window_totals(g.partner_id, v_prev, v_start);

    -- The Members page's "gone quiet", across members who picked this gym:
    -- at least six active days in weeks 3–8, none in the last two. Only
    -- for packages with the dashboard (Clash+ and up), as the page is.
    v_quiet := null;
    if coalesce((v_feat ->> 'insights')::boolean, false)
       and (select count(*) from public.profiles pr where pr.preferred_gym_id = g.partner_id) >= 5 then
      v_quiet := (
        with m as (select id from public.profiles where preferred_gym_id = g.partner_id),
        s as (
          select * from (
            select s.user_id, s.type::text as type, s.started_at,
                   greatest(0, coalesce(s.duration_sec, extract(epoch from (s.ended_at - s.started_at))::integer, 0)) as dur,
                   (s.started_at at time zone v_tz)::date as d
              from public.activity_sessions s
              join m on m.id = s.user_id
             where s.type::text <> 'sleep'
               and not coalesce(s.flagged, false)
               and s.started_at >= now() - interval '56 days'
          ) x
          where not (type = 'walking' and dur < 300)
        ),
        pace as (
          select m.id,
                 count(distinct s.d) filter (where s.started_at >= now() - interval '14 days') as recent,
                 count(distinct s.d) filter (where s.started_at <  now() - interval '14 days') as base
            from m left join s on s.user_id = m.id
           group by m.id
        )
        select count(*)::integer from pace where base >= 6 and recent = 0
      );
    end if;

    -- Events worth a line: in flight, waiting on POWR or the gym, or
    -- revealed this week (the prizes still need handing over).
    v_events := (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id',              e.id,
               'name',            e.name,
               'status',          e.status,
               'review_status',   e.review_status,
               'managed_by',      e.managed_by,
               'participants',    (select count(*) from public.live_event_participants lp
                                    where lp.event_id = e.id and lp.disqualified_at is null),
               'window_start_at', e.window_start_at,
               'window_end_at',   e.window_end_at,
               'revealed_at',     e.revealed_at
             ) order by e.window_start_at), '[]'::jsonb)
        from (
          select * from public.live_events e
           where e.venue_partner_id = g.partner_id
             and (e.status in ('scheduled', 'live', 'locked')
                  or (e.status = 'draft' and e.review_status in ('pending', 'rejected'))
                  or (e.status = 'revealed' and e.revealed_at >= v_start))
           order by e.window_start_at
           limit 5
        ) e
    );

    v_row := jsonb_build_object(
      'partner_id', g.partner_id,
      'name',       g.name,
      'tz',         v_tz,
      'week_start', v_start,
      'week_end',   v_end,
      'recipients', coalesce((
                      select jsonb_agg(distinct lower(u.email))
                        from public.gym_staff s
                        join auth.users u on u.id = s.user_id
                       where s.partner_id = g.partner_id
                         and s.recap_email
                         and u.email is not null
                         and u.deleted_at is null
                         and (u.banned_until is null or u.banned_until < now())
                    ), '[]'::jsonb),
      'features',   v_feat,
      'this',       v_this,
      'last',       v_last,
      'new_faces',  (select count(*) from (
                       select s.user_id, min(s.started_at) as first_at
                         from public.activity_sessions s
                        where s.partner_id = g.partner_id
                        group by s.user_id) f
                      where f.first_at >= v_start and f.first_at < v_end),
      'members',    (select count(*) from public.profiles pr where pr.preferred_gym_id = g.partner_id),
      -- Last week's top three exactly as the wall showed them.
      'top',        (select coalesce(jsonb_agg(jsonb_build_object(
                              'name',     coalesce(pr.display_name, pr.username, 'A member'),
                              'points',   sc.score,
                              'sessions', sc.sessions) order by sc.rank), '[]'::jsonb)
                       from (select * from public._gym_board_scores(g.partner_id, v_start, v_end, v_tz)
                              where score > 0 order by rank limit 3) sc
                       join public.profiles pr on pr.id = sc.user_id),
      'busiest',    (select jsonb_build_object('dow', x.d, 'sessions', x.n)
                       from (select extract(isodow from s.started_at at time zone v_tz)::integer as d, count(*)::integer as n
                               from public.activity_sessions s
                              where s.partner_id = g.partner_id
                                and s.started_at >= v_start and s.started_at < v_end
                              group by 1 order by n desc, d limit 1) x),
      'quiet',      v_quiet,
      'events',     v_events,
      'quiet_week', coalesce((v_this ->> 'sessions')::integer, 0) = 0
                    and coalesce((v_last ->> 'sessions')::integer, 0) = 0
                    and jsonb_array_length(v_events) = 0
    );
    v_out := v_out || jsonb_build_array(v_row);
  end loop;
  return v_out;
end;
$$;
revoke all on function public.get_gym_weekly_recaps(date) from public, anon, authenticated;

-- ── 4. One event's facts and the team's addresses ───────────────────────
create or replace function public.get_gym_event_mail(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  e public.live_events;
begin
  select * into e from public.live_events where id = p_event_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'event', jsonb_build_object(
      'id',              e.id,
      'name',            e.name,
      'status',          e.status,
      'review_status',   e.review_status,
      'review_note',     e.review_note,
      'managed_by',      e.managed_by,
      'participants',    (select count(*) from public.live_event_participants lp
                           where lp.event_id = e.id and lp.disqualified_at is null),
      'window_start_at', e.window_start_at,
      'window_end_at',   e.window_end_at,
      'doors_open_at',   e.doors_open_at,
      'results_cut_at',  e.results_cut_at,
      'auto_reveal_at',  case when e.auto_settle and e.auto_reveal_after_hours is not null
                              then coalesce(e.lock_at, e.window_end_at)
                                   + make_interval(hours => coalesce(e.settle_grace_hours, 0) + e.auto_reveal_after_hours)
                              end),
    'gym', (select jsonb_build_object(
                     'id',      p.id,
                     'name',    p.name,
                     'tz',      public._gym_tz(p.id),
                     'trusted', exists (select 1 from public.gym_portal_settings s
                                         where s.partner_id = p.id and s.trusted_at is not null))
              from public.partners p where p.id = e.venue_partner_id),
    'recipients', coalesce((
      select jsonb_agg(distinct lower(u.email))
        from public.gym_staff s
        join auth.users u on u.id = s.user_id
       where s.partner_id = e.venue_partner_id
         and u.email is not null
         and u.deleted_at is null
         and (u.banned_until is null or u.banned_until < now())
    ), '[]'::jsonb),
    -- The sealed podium: the cut results, top three.
    'top', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank',   r.rank,
               'name',   coalesce(pr.display_name, pr.username, 'A member'),
               'points', r.final_points,
               'prize',  r.prize_label) order by r.rank)
        from (select * from public.live_event_results x where x.event_id = e.id order by x.rank limit 3) r
        join public.profiles pr on pr.id = r.user_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_gym_event_mail(uuid) from public, anon, authenticated;

-- ── 5. Ask send-gym-email at settle and on POWR's decision ──────────────
create or replace function public._gym_event_mail_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_kind text;
begin
  if new.managed_by is distinct from 'gym' then
    return null;
  end if;
  if old.results_cut_at is null and new.results_cut_at is not null and new.status = 'locked' then
    v_kind := 'results_ready';
  elsif new.review_status is distinct from old.review_status
        and new.review_status in ('approved', 'rejected', 'pulled') then
    v_kind := 'review_result';
  else
    return null;
  end if;
  perform net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-gym-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := jsonb_build_object('kind', v_kind, 'event_id', new.id),
    timeout_milliseconds := 8000
  );
  return null;
exception when others then
  raise warning '[_gym_event_mail_trigger] %', sqlerrm;
  return null;
end;
$$;
revoke all on function public._gym_event_mail_trigger() from public, anon, authenticated;

drop trigger if exists live_events_gym_mail on public.live_events;
create trigger live_events_gym_mail
  after update of results_cut_at, review_status on public.live_events
  for each row
  when (new.managed_by = 'gym')
  execute function public._gym_event_mail_trigger();
