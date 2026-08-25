-- =============================================================
-- CREATOR REWARDS CATALOGUE
-- =============================================================
-- Jamie, 2026-08-25: "we need a place to add what the rewards
-- are — some are physical items, so images and what the reward
-- actually is, not just points."
--
-- A step points at ONE of these (plus optional points, plus an
-- optional member-catalogue reward_id). The free-text
-- product_name / product_sku on steps are superseded; the award
-- function derives both from the reward when present.
-- =============================================================

create table if not exists public.creator_rewards (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  image_url    text,
  kind         text not null default 'physical'
                 check (kind in ('physical','digital','experience')),
  sku          text,
  value_label  text,           -- "Worth £45", shown to creators
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

comment on table public.creator_rewards is
  'What a creator step actually gives — a physical item, a digital thing or an experience, with an image. Fulfilled by an admin via creator_milestones; nothing ships itself.';

alter table public.creator_program_steps
  add column if not exists creator_reward_id uuid references public.creator_rewards(id) on delete set null;
alter table public.creator_milestones
  add column if not exists creator_reward_id uuid references public.creator_rewards(id) on delete set null;

-- Award fn: carry the reward through; owed if ANY thing is attached.
create or replace function public.creator_award_steps(p_creator_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_creator  public.creators;
  v_prog     public.creator_programs;
  v_count    integer;
  v_step     public.creator_program_steps;
  v_reward   public.creator_rewards;
  v_paid     integer;
  v_earning  uuid;
  v_status   text;
begin
  select * into v_creator from public.creators where id = p_creator_id;
  if v_creator.id is null or v_creator.status <> 'active' then return; end if;
  v_prog := public.creator_effective_program(p_creator_id);
  if v_prog.id is null then return; end if;

  if v_prog.step_counting = 'signups' then
    select count(*) into v_count from public.referrals where creator_id = p_creator_id;
  else
    select count(*) into v_count from public.referrals
     where creator_id = p_creator_id and converted_at is not null;
  end if;

  -- Loop so a creator moved to a richer programme catches up on every
  -- rung they've already passed, not just the top one.
  loop
    select * into v_step
      from public.creator_program_steps s
     where s.program_id = v_prog.id and s.active and s.n <= v_count
       and not exists (select 1 from public.creator_milestones m
                        where m.creator_id = p_creator_id and m.step_id = s.id)
     order by s.n limit 1;
    exit when v_step.id is null;

    v_reward := null;
    if v_step.creator_reward_id is not null then
      select * into v_reward from public.creator_rewards where id = v_step.creator_reward_id;
    end if;

    v_status := case when v_step.creator_reward_id is null and v_step.reward_id is null
                      and v_step.product_sku is null and v_step.product_name is null
                     then 'not_applicable' else 'owed' end;

    insert into public.creator_milestones
      (creator_id, step_id, program_id, n, label, converted_count, points_paid,
       product_sku, product_name, reward_id, creator_reward_id, fulfilment_status)
    values
      (p_creator_id, v_step.id, v_prog.id, v_step.n, v_step.label, v_count, v_step.points,
       coalesce(v_step.product_sku, v_reward.sku),
       coalesce(v_step.product_name, v_reward.name),
       v_step.reward_id, v_step.creator_reward_id, v_status)
    on conflict (creator_id, step_id) do nothing;
    get diagnostics v_paid = row_count;

    if v_paid = 1 and v_step.points > 0 then
      insert into public.creator_earnings (creator_id, kind, points_amount, note, step_id)
      values (p_creator_id, 'milestone', v_step.points,
              v_step.label || ' — ' || v_step.n || ' ' || v_prog.step_counting, v_step.id)
      on conflict do nothing
      returning id into v_earning;
      if v_earning is not null and v_creator.member_user_id is not null then
        insert into public.point_transactions (user_id, amount, type, source, description)
        values (v_creator.member_user_id, v_step.points, 'bonus', 'creator_milestone',
                v_step.n || ' ' || v_prog.step_counting || ' — ' || v_step.label);
        update public.creator_earnings set credited_at = now() where id = v_earning;
      end if;
    end if;
  end loop;
end;
$$;
revoke all on function public.creator_award_steps(uuid) from public, anon, authenticated;

-- RLS: admins manage; any signed-in creator can read active rewards (it's
-- the prize list — marketing, not PII).
alter table public.creator_rewards enable row level security;
drop policy if exists "Admins manage creator rewards" on public.creator_rewards;
create policy "Admins manage creator rewards"
  on public.creator_rewards for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Creators read active rewards" on public.creator_rewards;
create policy "Creators read active rewards"
  on public.creator_rewards for select to authenticated
  using (active and public.current_creator_id() is not null);
