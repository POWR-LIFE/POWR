-- Every reward is an event prize.
-- Jamie, 2026-09-26: "we should just be offering all rewards as standard,
-- they should not need to be marked as we already have the discount."
--
-- The per-reward flag from 20260926120000 goes. A reward can be a prize
-- whenever it is active and has a code to give: a shared promo code, or a
-- pool with stock. Affiliate links stay out, because there is no code to win.
--
-- The prize's name follows the app's reward value, discount first, the way
-- the Rewards tab reads it (getRewardDisplayValue): "REP · 20% off", never
-- "REP · REP" as the title-based name gave five of today's rewards.

create or replace function public._reward_prize_label(r public.rewards)
returns text
language sql
immutable
set search_path = public
as $$
  with v as (
    select nullif(btrim(coalesce(r.brand_name, '')), '') as brand,
           case
             when r.discount_type = 'percentage' and r.discount_value is not null
               then trim_scale(r.discount_value)::text || '% off'
             when r.discount_type = 'fixed_amount' and r.discount_value is not null
               then '£' || trim_scale(r.discount_value)::text || ' off'
             else coalesce(nullif(btrim(coalesce(r.value_label, '')), ''),
                           nullif(btrim(coalesce(r.title, '')), ''))
           end as val
  )
  select left(case
                when v.brand is null then coalesce(v.val, 'Partner prize')
                when v.val is null or lower(v.val) = lower(v.brand) then v.brand
                else v.brand || ' · ' || v.val
              end, 60)
    from v
$$;
revoke all on function public._reward_prize_label(public.rewards) from public, anon, authenticated;

create or replace function public._reward_offerable(r public.rewards)
returns boolean
language sql
stable
set search_path = public
as $$
  select r.active
     and r.integration_type <> 'AFFILIATE'
     and (nullif(btrim(coalesce(r.promo_code, '')), '') is not null
          or exists (select 1 from public.redemption_codes c
                      where c.reward_id = r.id and c.status = 'available' and c.expires_at > now()))
$$;
revoke all on function public._reward_offerable(public.rewards) from public, anon, authenticated;

-- Nothing reads it now, and it was never set.
alter table public.rewards drop column if exists event_prize;
