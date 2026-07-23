-- STREAK RESCUE
--
-- When a streak dies, the user gets 48h (tunable) to earn it back: complete N
-- sessions and the missed day becomes a "bridge day" — every streak recompute
-- (claim-points bonus math, push copy, the app card) consults completed
-- rescues and counts missed_day as active, so the streak restores everywhere
-- without faking a session row. POWR's version of Duolingo streak repair,
-- except the currency is effort, not gems.
--
-- Lifecycle:
--   streak-rescue-sweep (cron, ~09:00 local) detects yesterday's deaths and
--   INSERTs an 'offered' row + fires the streak_lost push.
--   ↓
--   trg_streak_rescue_progress (below) watches every non-manual session
--   insert — geofence claims, Terra wearable syncs, AND the client's direct
--   walking writes all land on activity_sessions, so one trigger sees every
--   qualifying effort regardless of which code path recorded it.
--   ↓
--   sessions_done >= sessions_required before expiry → status 'completed',
--   streak_rescued push. The sweep expires overdue offers.
--
-- All knobs admin-editable in /admin/config (system_config):

insert into public.system_config (key, value, description) values
  ('streak_rescue_enabled',           'true', 'Offer a rescue challenge when a qualifying streak is lost'),
  ('streak_rescue_window_hours',      '48',   'Hours the user has to complete the rescue challenge'),
  ('streak_rescue_sessions_required', '2',    'Verified sessions needed inside the window to restore the streak'),
  ('streak_rescue_min_streak',        '3',    'Minimum lost-streak length that qualifies for a rescue offer'),
  ('streak_rescue_cooldown_days',     '30',   'Days after any rescue offer before the user can receive another')
on conflict (key) do nothing;

create table if not exists public.streak_rescues (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  lost_streak       int  not null,
  missed_day        date not null,             -- the day that broke the chain; bridges when completed
  sessions_required int  not null,             -- frozen from config at offer time
  sessions_done     int  not null default 0,
  count_from        timestamptz not null default now(),  -- local midnight of the offer day: a session done BEFORE the morning offer still counts
  status            text not null default 'offered'
                    check (status in ('offered', 'completed', 'expired')),
  offered_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  completed_at      timestamptz,
  created_at        timestamptz not null default now()
);

-- One live offer per user; fast existence probe for the session trigger.
create unique index if not exists streak_rescues_one_offered_idx
  on public.streak_rescues (user_id) where status = 'offered';
create index if not exists streak_rescues_user_status_idx
  on public.streak_rescues (user_id, status);

alter table public.streak_rescues enable row level security;

-- Client reads its own rescue (home card + bridge-day recompute); all writes
-- come from service-role paths (sweep fn + the trigger below).
create policy "Users can read own streak rescues"
  on public.streak_rescues for select
  using (auth.uid() = user_id);

create policy "Admins can read streak rescues"
  on public.streak_rescues for select
  using (exists (select 1 from public.admin_roles where user_id = auth.uid()));

-- ── Progress: every qualifying session advances the live offer ───────────────
-- AFTER INSERT so the new row is visible to the recount. sessions_done is
-- recounted (not incremented) so replays/idempotent inserts can't overshoot.
-- The completion push is fire-and-forget via pg_net (the shared cron secret),
-- and the whole body is exception-guarded: rescue plumbing must never break a
-- session write.

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

  select count(*) into v_done
    from public.activity_sessions
   where user_id = new.user_id
     and verification <> 'manual'
     and started_at >= r.count_from;

  if v_done >= r.sessions_required then
    update public.streak_rescues
       set sessions_done = v_done, status = 'completed', completed_at = now()
     where id = r.id and status = 'offered';

    -- Only the transition winner sends the push (idempotent under races).
    if found then
      begin
        -- send-push-notification (verify_jwt=false) authorizes callers itself:
        -- service-role bearer, the shared cron token, or a user JWT targeting
        -- self. DB triggers authenticate with the cron token.
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
  after insert on public.activity_sessions
  for each row
  when (new.verification is distinct from 'manual')
  execute function public.streak_rescue_progress();
