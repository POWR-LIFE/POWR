-- ============================================================================
-- Creator programme: EARNED INVITE
-- ============================================================================
-- Decision (Jamie, 2026-08-26): the portal is never opened to everyone and a
-- referral count never auto-grants it. A member who has brought N people in
-- (converted referrals = verified first workouts, as referrer, inside a
-- window) is ASKED on Home whether they want to be a creator; tapping files a
-- request; an admin approves it in /admin/creators/requests; approval creates
-- the creator row + portal link through manage-creator-user exactly as a
-- hand-invited creator gets. The threshold is a setting, not a constant.
--
-- Notifications (all through the existing gates):
--   creator_invite_eligible  → the member, the moment their count CROSSES the
--                              threshold (referrals AFTER UPDATE OF converted_at)
--   Slack ping               → admins, when a request lands (notify-creator-request)
--   creator_invite_approved  → the member, when an admin approves
-- ============================================================================

-- ── Settings ────────────────────────────────────────────────────────────────
insert into public.system_config (key, value, description) values
  ('creator_invite_threshold', '3',
   'Earned creator invite: converted referrals (verified first workouts, counted as referrer) a member needs before Home asks whether they want to become a creator. 0 turns the prompt off.'),
  ('creator_invite_window_days', '90',
   'Earned creator invite: only conversions inside this many days count towards the threshold. 0 = all time.')
on conflict (key) do nothing;

-- The app reads these to render the card; system_config is otherwise admin-only.
drop policy if exists "Authenticated can read creator invite settings" on public.system_config;
create policy "Authenticated can read creator invite settings"
  on public.system_config for select
  to authenticated
  using (key in ('creator_invite_threshold', 'creator_invite_window_days'));

create or replace function public.creator_invite_threshold()
returns integer
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(regexp_replace(value, '[^0-9]', '', 'g'), '')::int
       from public.system_config where key = 'creator_invite_threshold'),
    3);
$$;

create or replace function public.creator_invite_window_days()
returns integer
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(regexp_replace(value, '[^0-9]', '', 'g'), '')::int
       from public.system_config where key = 'creator_invite_window_days'),
    90);
$$;

-- Converted referrals BY this member (referrer_id — creator-attributed rows
-- carry referrer_id null on purpose and must not count twice).
create or replace function public.creator_converted_referrals(p_user uuid)
returns integer
language sql stable security definer
set search_path = public
as $$
  select count(*)::int
    from public.referrals r
   where r.referrer_id = p_user
     and r.converted_at is not null
     and (public.creator_invite_window_days() <= 0
          or r.converted_at >= now() - make_interval(days => public.creator_invite_window_days()));
$$;

revoke all on function public.creator_invite_threshold()            from public, anon;
revoke all on function public.creator_invite_window_days()          from public, anon;
revoke all on function public.creator_converted_referrals(uuid)     from public, anon, authenticated;
grant execute on function public.creator_invite_threshold()   to authenticated;
grant execute on function public.creator_invite_window_days() to authenticated;

-- ── Requests ────────────────────────────────────────────────────────────────
create table if not exists public.creator_invite_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'declined')),
  -- Snapshot at request time: what they had and what the bar was, so a later
  -- threshold change doesn't rewrite history.
  converted_count integer not null default 0,
  threshold       integer not null default 0,
  note            text,
  creator_id      uuid references public.creators(id) on delete set null,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid references public.profiles(id)
);

comment on table public.creator_invite_requests is
  'A member asking to join the creator programme after earning the invite (Home card). Approved by an admin; approval creates the creators row via manage-creator-user and links creator_users.';

create unique index if not exists creator_invite_requests_one_pending
  on public.creator_invite_requests (user_id) where status = 'pending';
create index if not exists creator_invite_requests_status_idx
  on public.creator_invite_requests (status, created_at desc);

alter table public.creator_invite_requests enable row level security;

drop policy if exists "Members read own creator invite requests" on public.creator_invite_requests;
create policy "Members read own creator invite requests"
  on public.creator_invite_requests for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Admins manage creator invite requests" on public.creator_invite_requests;
create policy "Admins manage creator invite requests"
  on public.creator_invite_requests for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- No INSERT grant: members file requests through request_creator_invite(),
-- which re-checks eligibility server-side.
revoke all on public.creator_invite_requests from public, anon, authenticated;
grant select, update on public.creator_invite_requests to authenticated;

-- ── Member RPCs ─────────────────────────────────────────────────────────────
create or replace function public.creator_invite_eligibility()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_enabled   boolean;
  v_creator   boolean;
  v_threshold integer;
  v_window    integer;
  v_count     integer;
  v_req       record;
  v_eligible  boolean;
begin
  if v_uid is null then
    return jsonb_build_object('eligible', false, 'program_enabled', false);
  end if;

  v_enabled   := public.creator_program_enabled();
  v_creator   := exists (select 1 from public.creator_users where user_id = v_uid);
  v_threshold := public.creator_invite_threshold();
  v_window    := public.creator_invite_window_days();
  v_count     := public.creator_converted_referrals(v_uid);

  select id, status, created_at, decided_at
    into v_req
    from public.creator_invite_requests
   where user_id = v_uid
   order by created_at desc
   limit 1;

  v_eligible := v_enabled
            and not v_creator
            and v_threshold > 0
            and v_count >= v_threshold
            -- A decline is quiet, not a door slammed: they can ask again after 30 days.
            and not (v_req.status = 'declined' and v_req.decided_at > now() - interval '30 days');

  return jsonb_build_object(
    'program_enabled', v_enabled,
    'already_creator', v_creator,
    'converted',       v_count,
    'threshold',       v_threshold,
    'window_days',     v_window,
    'eligible',        v_eligible,
    'request_status',  v_req.status,
    'request_id',      v_req.id,
    'requested_at',    v_req.created_at,
    'decided_at',      v_req.decided_at
  );
end;
$$;

create or replace function public.request_creator_invite()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_e   jsonb;
  v_row public.creator_invite_requests;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  v_e := public.creator_invite_eligibility();
  if (v_e->>'request_status') = 'pending' then raise exception 'already_requested'; end if;
  if not coalesce((v_e->>'eligible')::boolean, false) then raise exception 'not_eligible'; end if;

  insert into public.creator_invite_requests (user_id, converted_count, threshold)
  values (v_uid, (v_e->>'converted')::int, (v_e->>'threshold')::int)
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.creator_invite_eligibility() from public, anon;
revoke all on function public.request_creator_invite()     from public, anon;
grant execute on function public.creator_invite_eligibility() to authenticated;
grant execute on function public.request_creator_invite()     to authenticated;

-- ── Admin RPC: the queue with who they are ──────────────────────────────────
create or replace function public.admin_creator_invite_requests()
returns table (
  id uuid, user_id uuid, status text,
  converted_count integer, converted_now integer, threshold integer,
  note text, creator_id uuid, created_at timestamptz, decided_at timestamptz,
  display_name text, username text, avatar_url text, member_id text, email text
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
    select r.id, r.user_id, r.status,
           r.converted_count, public.creator_converted_referrals(r.user_id), r.threshold,
           r.note, r.creator_id, r.created_at, r.decided_at,
           p.display_name, p.username, p.avatar_url, p.referral_code, u.email::text
      from public.creator_invite_requests r
      join public.profiles p on p.id = r.user_id
      left join auth.users u on u.id = r.user_id
     order by (r.status = 'pending') desc, r.created_at desc;
end;
$$;
revoke all on function public.admin_creator_invite_requests() from public, anon;
grant execute on function public.admin_creator_invite_requests() to authenticated;

-- ── Notifications ───────────────────────────────────────────────────────────
insert into public.notification_config (type, category, description, class, daily_cap) values
  ('creator_invite_eligible', 'rewards',
   'Sent once when a member''s converted referrals cross the creator-invite threshold — invites them to ask to join the creator programme', 'receipt', 1),
  ('creator_invite_approved', 'rewards',
   'Sent when an admin approves a member''s creator programme request — their portal is ready', 'receipt', null)
on conflict (type) do nothing;

-- 1. Member crosses the line → push. Fires on the conversion write itself
--    (referral_conversion_check updates converted_at), so it works however
--    the workout arrived and with the app closed. Exactly-equals = once per
--    crossing; a request or an existing creator link silences it.
create or replace function public.notify_creator_invite_eligible()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_threshold integer;
  v_count     integer;
begin
  if new.referrer_id is null then return new; end if;
  if not public.creator_program_enabled() then return new; end if;
  v_threshold := public.creator_invite_threshold();
  if v_threshold <= 0 then return new; end if;
  v_count := public.creator_converted_referrals(new.referrer_id);
  if v_count <> v_threshold then return new; end if;
  if exists (select 1 from public.creator_users where user_id = new.referrer_id) then return new; end if;
  if exists (select 1 from public.creator_invite_requests where user_id = new.referrer_id) then return new; end if;

  perform net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := jsonb_build_object(
      'target_user_id', new.referrer_id,
      'type', 'creator_invite_eligible',
      'payload', jsonb_build_object('converted', v_count, 'threshold', v_threshold)
    ),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  raise warning '[notify_creator_invite_eligible] %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_notify_creator_invite_eligible on public.referrals;
create trigger trg_notify_creator_invite_eligible
  after update of converted_at on public.referrals
  for each row
  when (old.converted_at is null and new.converted_at is not null)
  execute function public.notify_creator_invite_eligible();

-- 2. Request lands → Slack (same channel as new signups; notify-creator-request).
create or replace function public.notify_creator_invite_request()
returns trigger
language plpgsql security definer
set search_path = public, extensions, vault
as $$
begin
  begin
    perform net.http_post(
      url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/notify-creator-request',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'db_webhook_secret')
      ),
      body := jsonb_build_object('type', 'INSERT', 'table', 'creator_invite_requests', 'record', to_jsonb(new)),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning '[notify_creator_invite_request] dispatch failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_notify_creator_invite_request on public.creator_invite_requests;
create trigger trg_notify_creator_invite_request
  after insert on public.creator_invite_requests
  for each row execute function public.notify_creator_invite_request();

-- 3. Approved → push to the member.
create or replace function public.notify_creator_invite_approved()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := jsonb_build_object(
      'target_user_id', new.user_id,
      'type', 'creator_invite_approved',
      'payload', jsonb_build_object('creator_id', new.creator_id)
    ),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  raise warning '[notify_creator_invite_approved] %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_notify_creator_invite_approved on public.creator_invite_requests;
create trigger trg_notify_creator_invite_approved
  after update of status on public.creator_invite_requests
  for each row
  when (old.status = 'pending' and new.status = 'approved')
  execute function public.notify_creator_invite_approved();

revoke execute on function public.notify_creator_invite_eligible() from public, anon, authenticated;
revoke execute on function public.notify_creator_invite_request()  from public, anon, authenticated;
revoke execute on function public.notify_creator_invite_approved() from public, anon, authenticated;
