-- REWARD UNLOCKED + LEVEL UP push wiring
--
-- Both fire from DB triggers at the ledger — the only place every award path
-- (claim-points, Terra, bonuses, referrals, vault releases, admin adjusts)
-- converges — so no edge function needs to remember to call them.

-- ── 1. Within-reach target memory ────────────────────────────────────────────
-- claim-points names ONE reward in the "Reward within reach" nudge (highest-
-- cost active reward the user is ≥85% toward). The unlock push must finish
-- that same story, so claim-points persists the named target here and the
-- unlock trigger prefers it. One row per user, newest target wins.

create table if not exists public.user_reward_targets (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  reward_id   uuid references public.rewards (id) on delete cascade,
  reward_name text not null,
  powr_cost   int  not null,
  named_at    timestamptz not null default now()
);

alter table public.user_reward_targets enable row level security;

create policy "Users can read own reward target"
  on public.user_reward_targets for select
  using (auth.uid() = user_id);
-- Writes come from service-role edge functions only (claim-points).

-- ── 2. reward_unlocked trigger ───────────────────────────────────────────────
-- Balance = signed sum of the ledger (same basis as the user_balances view).
-- "Unlocked" = an active reward whose cost the balance just crossed upward.
-- Single unlock → name it (preferring the within-reach target); several at
-- once → count copy ("You've unlocked N rewards") routed to the wallet —
-- naming one of several is a lose-lose. send-push owns the copy either way.

create or replace function public.notify_reward_unlocks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_after  bigint;
  v_before bigint;
  v_count  int;
  v_name   text;
  v_id     uuid;
begin
  select coalesce(sum(amount), 0) into v_after
    from public.point_transactions where user_id = new.user_id;
  v_before := v_after - new.amount;

  select count(*) into v_count
    from public.rewards
   where active = true and powr_cost > v_before and powr_cost <= v_after;
  if v_count = 0 then return new; end if;

  if v_count = 1 then
    select id, title into v_id, v_name
      from public.rewards
     where active = true and powr_cost > v_before and powr_cost <= v_after
     limit 1;
  else
    -- Several crossed at once: prefer the within-reach target if it's among
    -- them (the story we already told), else stay nameless and lead with count.
    select t.reward_id, t.reward_name into v_id, v_name
      from public.user_reward_targets t
      join public.rewards r on r.id = t.reward_id
     where t.user_id = new.user_id
       and r.active = true and r.powr_cost > v_before and r.powr_cost <= v_after;
  end if;

  begin
    perform net.http_post(
      url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'target_user_id', new.user_id,
        'type', 'reward_unlocked',
        'payload', jsonb_build_object(
          'count', v_count,
          'reward_name', v_name,
          'reward_id', v_id
        )
      )
    );
  exception when others then null;
  end;

  return new;
exception when others then
  return new;  -- push plumbing must never break a points award
end;
$$;

drop trigger if exists trg_notify_reward_unlocks on public.point_transactions;
create trigger trg_notify_reward_unlocks
  after insert on public.point_transactions
  for each row
  when (new.amount > 0 and new.type in ('earn', 'streak', 'bonus', 'adjustment'))
  execute function public.notify_reward_unlocks();

-- ── 3. level_up push trigger ─────────────────────────────────────────────────
-- vault_level_up_check() already detects every threshold crossing (positive
-- ledger + pending vault, the same basis the app's level display uses) and
-- banks a vault_deposits row with source='level_up' + the level reached. The
-- level-up EMAIL already hangs off that insert; the push does the identical
-- thing — proven detection, zero duplicate threshold math.

create or replace function public.notify_level_up_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'target_user_id', new.user_id,
      'type', 'level_up',
      'payload', jsonb_build_object('level', new.level)
    )
  );
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists vault_level_up_push on public.vault_deposits;
create trigger vault_level_up_push
  after insert on public.vault_deposits
  for each row
  when (new.source = 'level_up' and new.level is not null)
  execute function public.notify_level_up_push();
