-- Gym visit beacon + lifecycle log.
--
-- WHY: the dwell state machine is time-based but only ever runs from a location
-- callback, and both Android (setSmallestDisplacement) and iOS (distanceFilter)
-- suppress callbacks entirely for a STATIONARY device. A checked-in user standing
-- still therefore receives no fixes, so the 30-min claim and the 40-min upgrade
-- never fire in the background — they only land when the app is next opened
-- (t+33 on 2026-07-03, t+36 on 2026-07-13, both verified against prod).
--
-- The device cannot be relied on to wake ITSELF. So the server holds the timer and
-- WAKES the device with a silent push at each threshold. The device then takes a
-- fresh GPS fix and decides.
--
-- TRUST MODEL — unchanged: the server NEVER credits on a timer. It can only ask.
-- Points are awarded exclusively by claim-points / upgrade-gym-tier, called by the
-- device only after it has confirmed it is still inside the partner radius. No fix,
-- no credit. A device that never answers gets no credit here; the existing exit
-- path and pending-claim queue resolve the visit later, exactly as today.
--
-- last_confirmed_at is a location-PROVEN checkpoint. It turns session duration from
-- an unverified (entry, exit) pair into an evidence-backed chain, so a late-reported
-- exit can be bounded at the last proven presence instead of inflating the session.

create table public.gym_visits (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  partner_id         uuid references public.partners(id) on delete set null,
  region_id          text,
  platform           text,
  started_at         timestamptz not null,
  last_confirmed_at  timestamptz,   -- last time the DEVICE proved it was inside
  claimed_session_id uuid references public.activity_sessions(id) on delete set null,
  claimed_at         timestamptz,
  upgraded_at        timestamptz,
  ended_at           timestamptz,
  status             text not null default 'open'
                       check (status in ('open','claimed','upgraded','closed','abandoned')),
  nudge_count        int not null default 0,
  last_nudge_at      timestamptz,
  created_at         timestamptz not null default now()
);

-- The cron scans on these; keep them cheap.
create index gym_visits_due_idx on public.gym_visits (status, started_at)
  where ended_at is null;
create index gym_visits_user_idx on public.gym_visits (user_id, started_at desc);

-- Lifecycle log — the "why did nothing happen" record. Same lesson as push_send_log:
-- edge logs age out in 24h, so without this an iOS visit is unobservable after the fact.
create table public.gym_visit_events (
  id         uuid primary key default gen_random_uuid(),
  visit_id   uuid not null references public.gym_visits(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  event      text not null,   -- check_in | nudge_sent | confirmed_inside | confirmed_outside
                              -- | claimed | upgraded | exit | nudge_failed | abandoned
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index gym_visit_events_visit_idx on public.gym_visit_events (visit_id, created_at);
create index gym_visit_events_user_idx on public.gym_visit_events (user_id, created_at desc);

alter table public.gym_visits enable row level security;
alter table public.gym_visit_events enable row level security;

-- Reads: a user sees their own; admins see all. All WRITES go through the
-- SECURITY DEFINER RPCs below (or the service-role cron), never direct DML — the
-- RPCs are what pin every row to auth.uid().
create policy "Users read own gym visits" on public.gym_visits
  for select using (user_id = auth.uid());
create policy "Admins read all gym visits" on public.gym_visits
  for select using (exists (select 1 from admin_roles where admin_roles.user_id = auth.uid()));

create policy "Users read own gym visit events" on public.gym_visit_events
  for select using (user_id = auth.uid());
create policy "Admins read all gym visit events" on public.gym_visit_events
  for select using (exists (select 1 from admin_roles where admin_roles.user_id = auth.uid()));

-- ─── RPCs (device-facing) ────────────────────────────────────────────────────
-- Every one is owner-locked to auth.uid(): a caller can only ever touch its own
-- visit, and can never set points/session state — that stays with claim-points.

create or replace function public.open_gym_visit(
  p_partner_id uuid,
  p_region_id  text,
  p_started_at timestamptz,
  p_platform   text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id   uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  -- Re-use the live visit if the client re-reports the same check-in (app restart,
  -- headless context) so a visit is never duplicated mid-session.
  select id into v_id from gym_visits
   where user_id = v_user and ended_at is null and status in ('open','claimed','upgraded')
   order by started_at desc limit 1;

  if v_id is not null then return v_id; end if;

  insert into gym_visits (user_id, partner_id, region_id, started_at, platform)
  values (v_user, p_partner_id, p_region_id, coalesce(p_started_at, now()), p_platform)
  returning id into v_id;

  insert into gym_visit_events (visit_id, user_id, event, detail)
  values (v_id, v_user, 'check_in', jsonb_build_object('region_id', p_region_id));

  return v_id;
end;
$$;

-- The device reporting what it SAW. `p_inside` is the device's verdict from a real
-- fix; the server records it but never infers presence on its own.
create or replace function public.confirm_gym_visit(
  p_visit_id uuid,
  p_inside   boolean,
  p_detail   jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  update gym_visits
     set last_confirmed_at = case when p_inside then now() else last_confirmed_at end
   where id = p_visit_id and user_id = v_user;

  if not found then raise exception 'visit not found'; end if;

  insert into gym_visit_events (visit_id, user_id, event, detail)
  values (p_visit_id, v_user,
          case when p_inside then 'confirmed_inside' else 'confirmed_outside' end,
          coalesce(p_detail, '{}'::jsonb));
end;
$$;

-- Called AFTER claim-points/upgrade-gym-tier succeeded. Records the outcome; it
-- cannot itself award anything.
create or replace function public.mark_gym_visit_progress(
  p_visit_id   uuid,
  p_stage      text,              -- 'claimed' | 'upgraded'
  p_session_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_stage not in ('claimed','upgraded') then raise exception 'bad stage'; end if;

  update gym_visits
     set status             = p_stage,
         claimed_session_id = coalesce(p_session_id, claimed_session_id),
         claimed_at         = case when p_stage = 'claimed'  then coalesce(claimed_at, now()) else claimed_at end,
         upgraded_at        = case when p_stage = 'upgraded' then coalesce(upgraded_at, now()) else upgraded_at end,
         last_confirmed_at  = now()
   where id = p_visit_id and user_id = v_user;

  if not found then raise exception 'visit not found'; end if;

  insert into gym_visit_events (visit_id, user_id, event, detail)
  values (p_visit_id, v_user, p_stage, jsonb_build_object('session_id', p_session_id));
end;
$$;

create or replace function public.close_gym_visit(
  p_visit_id uuid,
  p_ended_at timestamptz default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  update gym_visits
     set ended_at = coalesce(p_ended_at, now()),
         status   = 'closed'
   where id = p_visit_id and user_id = v_user and ended_at is null;

  insert into gym_visit_events (visit_id, user_id, event, detail)
  values (p_visit_id, v_user, 'exit', jsonb_build_object('ended_at', coalesce(p_ended_at, now())));
end;
$$;

-- Definer RPCs: grant to the roles that actually call them, never PUBLIC.
revoke all on function public.open_gym_visit(uuid, text, timestamptz, text) from public;
revoke all on function public.confirm_gym_visit(uuid, boolean, jsonb) from public;
revoke all on function public.mark_gym_visit_progress(uuid, text, uuid) from public;
revoke all on function public.close_gym_visit(uuid, timestamptz) from public;

grant execute on function public.open_gym_visit(uuid, text, timestamptz, text) to authenticated;
grant execute on function public.confirm_gym_visit(uuid, boolean, jsonb) to authenticated;
grant execute on function public.mark_gym_visit_progress(uuid, text, uuid) to authenticated;
grant execute on function public.close_gym_visit(uuid, timestamptz) to authenticated;

-- ─── Cron: wake the device at each threshold ─────────────────────────────────
-- Every minute; the function itself reads the admin-tunable thresholds from
-- system_config so the client and server can never drift apart.
select cron.schedule(
  'gym-visit-beacon',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/gym-visit-beacon',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- Safety net: a visit whose device never reported an exit (phone died, app
-- force-quit) is abandoned after 12h so it can't sit open forever and keep
-- attracting nudges. It is NOT credited — the existing 12h session backstop and
-- the pending-claim queue own that.
select cron.schedule(
  'abandon-stale-gym-visits',
  '20 * * * *',
  $cron$
  update public.gym_visits
     set status = 'abandoned', ended_at = coalesce(ended_at, last_confirmed_at, started_at + interval '12 hours')
   where ended_at is null and started_at < now() - interval '12 hours'
  $cron$
);
