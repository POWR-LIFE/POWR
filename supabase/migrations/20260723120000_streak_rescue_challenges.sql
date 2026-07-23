-- STREAK RESCUE CHALLENGES — admin-authored templates
--
-- "What earns a streak back" becomes data instead of two config numbers.
-- Each template = a requirement (kind + count) inside a window; the sweep
-- picks one at random from the ACTIVE set per offer and freezes its terms
-- onto the streak_rescues row, so editing templates never mutates an
-- in-flight rescue. No active templates → no offers (deactivating the last
-- one is a deliberate admin lever; the on/off toggle in /admin/config stays
-- the master switch).
--
-- Requirement kinds:
--   sessions     — any N verified (non-manual) sessions
--   gym_sessions — N verified gym sessions specifically
--   active_days  — N distinct days with at least one verified session
--   steps        — N steps total across verified sessions (walkers' path;
--                  the walking day-row's steps UPDATE also advances it)

create table if not exists public.streak_rescue_challenges (
  id                uuid primary key default gen_random_uuid(),
  label             text not null,
  requirement_type  text not null default 'sessions'
                    check (requirement_type in ('sessions', 'gym_sessions', 'active_days', 'steps')),
  requirement_count int  not null check (requirement_count > 0),
  window_hours      int  not null default 48 check (window_hours between 1 and 168),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users (id)
);

alter table public.streak_rescue_challenges enable row level security;

create policy "Admins manage streak rescue challenges"
  on public.streak_rescue_challenges
  for all
  using  (exists (select 1 from public.admin_roles where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_roles where user_id = auth.uid()));

-- Seed with the terms that were previously hardcoded config, so behaviour is
-- unchanged the moment this lands.
insert into public.streak_rescue_challenges (label, requirement_type, requirement_count, window_hours)
select 'Back on track', 'sessions', 2, 48
 where not exists (select 1 from public.streak_rescue_challenges);

-- The offer row carries its frozen terms + which template produced it.
alter table public.streak_rescues
  add column if not exists challenge_id     uuid references public.streak_rescue_challenges (id) on delete set null,
  add column if not exists label            text,
  add column if not exists requirement_type text not null default 'sessions';

-- Per-challenge terms replace the two global knobs (min-streak + cooldown
-- stay in system_config — they're eligibility, not challenge design).
delete from public.system_config
 where key in ('streak_rescue_window_hours', 'streak_rescue_sessions_required');

-- ── Shared progress counter ──────────────────────────────────────────────────
-- One place that knows how each requirement kind is measured; used by the
-- session trigger below and by the sweep's backstop recount (via RPC).

create or replace function public.streak_rescue_requirement_progress(
  p_user uuid, p_from timestamptz, p_requirement text
) returns int
language sql
stable
security definer
set search_path = public
as $$
  select case p_requirement
    when 'gym_sessions' then (
      select count(*)::int from activity_sessions
       where user_id = p_user and verification <> 'manual'
         and type = 'gym' and started_at >= p_from)
    when 'active_days' then (
      select count(distinct (started_at at time zone 'UTC')::date)::int from activity_sessions
       where user_id = p_user and verification <> 'manual'
         and started_at >= p_from)
    when 'steps' then (
      select coalesce(sum(steps), 0)::int from activity_sessions
       where user_id = p_user and verification <> 'manual'
         and started_at >= p_from)
    else (
      select count(*)::int from activity_sessions
       where user_id = p_user and verification <> 'manual'
         and started_at >= p_from)
  end
$$;

revoke all on function public.streak_rescue_requirement_progress(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.streak_rescue_requirement_progress(uuid, timestamptz, text) to service_role;

-- ── Type-aware progress trigger ──────────────────────────────────────────────
-- Replaces the sessions-only version from 20260723000002. Also fires on
-- UPDATE OF steps: the daily walking row is inserted once and then merged
-- upward as the phone/wearable reports more steps, and a steps-requirement
-- rescue must advance with it.

create or replace function public.streak_rescue_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r      public.streak_rescues%rowtype;
  v_done int;
begin
  select * into r
    from public.streak_rescues
   where user_id = new.user_id and status = 'offered'
   limit 1;
  if not found then return new; end if;

  -- Overdue offer: leave it for the sweep to expire; don't count toward it.
  if r.expires_at <= now() then return new; end if;

  v_done := public.streak_rescue_requirement_progress(new.user_id, r.count_from, r.requirement_type);

  if v_done >= r.sessions_required then
    update public.streak_rescues
       set sessions_done = v_done, status = 'completed', completed_at = now()
     where id = r.id and status = 'offered';

    -- Only the transition winner sends the push (idempotent under races).
    if found then
      begin
        perform net.http_post(
          url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
          ),
          body := jsonb_build_object(
            'target_user_id', new.user_id,
            'type', 'streak_rescued',
            'payload', jsonb_build_object('lost_streak', r.lost_streak)
          )
        );
      exception when others then null;
      end;
    end if;
  else
    update public.streak_rescues set sessions_done = v_done where id = r.id;
  end if;

  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_streak_rescue_progress on public.activity_sessions;
create trigger trg_streak_rescue_progress
  after insert or update of steps on public.activity_sessions
  for each row
  when (new.verification is distinct from 'manual')
  execute function public.streak_rescue_progress();
