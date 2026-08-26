-- ============================================================================
-- Affiliate reward notifications
-- ============================================================================
-- Until now an affiliate found out they'd reached a rung by opening the
-- screen. Two pushes, both fired from the database write so they work with
-- the app closed, both routing to /affiliate:
--   affiliate_milestone   — once per rung reached (creator_milestones INSERT)
--   affiliate_conversion  — a signup converted (+points); daily_cap 1 so a
--                           busy affiliate gets one a day carrying the count
-- Receipts: no user toggle, admin kill-switch + copy override as usual.

insert into public.notification_config (type, category, description, class, daily_cap) values
  ('affiliate_milestone', 'rewards',
   'Sent to an affiliate the moment they reach a step on their ladder — names the reward (and asks for an address if a parcel is owed and none is on file)', 'receipt', null),
  ('affiliate_conversion', 'rewards',
   'Sent to an affiliate when a signup from their link logs its first verified workout and earns them points. Once a day at most; says how many to the next step', 'receipt', 1)
on conflict (type) do nothing;

create or replace function public.notify_affiliate_milestone()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_creator public.creators;
  v_reward  text;
  v_ships   boolean;
begin
  select * into v_creator from public.creators where id = new.creator_id;
  if v_creator.member_user_id is null then return new; end if;

  select r.name into v_reward from public.creator_rewards r where r.id = new.creator_reward_id;
  v_reward := coalesce(v_reward, new.product_name);
  v_ships  := new.fulfilment_status <> 'not_applicable'
              and (new.creator_reward_id is not null or new.product_sku is not null or new.product_name is not null or new.reward_id is not null);

  perform net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := jsonb_build_object(
      'target_user_id', v_creator.member_user_id,
      'type', 'affiliate_milestone',
      'payload', jsonb_build_object(
        'label', new.label,
        'n', new.n,
        'reward_name', v_reward,
        'points', coalesce(new.points_paid, 0),
        'ships', v_ships,
        'needs_address', v_ships and (v_creator.shipping_address is null or coalesce(v_creator.shipping_address->>'line1', '') = '')
      )
    ),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  raise warning '[notify_affiliate_milestone] %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_notify_affiliate_milestone on public.creator_milestones;
create trigger trg_notify_affiliate_milestone
  after insert on public.creator_milestones
  for each row execute function public.notify_affiliate_milestone();

create or replace function public.notify_affiliate_conversion()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_creator public.creators;
  v_prog    public.creator_programs;
  v_count   integer;
  v_next    public.creator_program_steps;
  v_next_name text;
begin
  if new.kind <> 'conversion' then return new; end if;
  select * into v_creator from public.creators where id = new.creator_id;
  if v_creator.member_user_id is null then return new; end if;

  -- Where they now stand: the just-converted referral is already counted
  -- (converted_at is set before this earning is written).
  v_prog := public.creator_effective_program(new.creator_id);
  if v_prog.step_counting = 'signups' then
    select count(*) into v_count from public.referrals where creator_id = new.creator_id;
  else
    select count(*) into v_count from public.referrals where creator_id = new.creator_id and converted_at is not null;
  end if;
  select s.* into v_next
    from public.creator_program_steps s
   where s.program_id = v_prog.id and s.active and s.n > v_count
     and not exists (select 1 from public.creator_milestones m where m.creator_id = new.creator_id and m.step_id = s.id)
   order by s.n limit 1;
  if v_next.id is not null then
    select r.name into v_next_name from public.creator_rewards r where r.id = v_next.creator_reward_id;
    v_next_name := coalesce(v_next_name, v_next.label);
  end if;

  perform net.http_post(
    url := 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-resolve-token', (select decrypted_secret from vault.decrypted_secrets where name = 'shared_resolve_token')
    ),
    body := jsonb_build_object(
      'target_user_id', v_creator.member_user_id,
      'type', 'affiliate_conversion',
      'payload', jsonb_build_object(
        'points', coalesce(new.points_amount, 0),
        'basis', v_count,
        'basis_word', case when v_prog.step_counting = 'signups' then 'signups' else 'converted signups' end,
        'remaining', case when v_next.id is null then null else v_next.n - v_count end,
        'next_name', v_next_name
      )
    ),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  raise warning '[notify_affiliate_conversion] %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_notify_affiliate_conversion on public.creator_earnings;
create trigger trg_notify_affiliate_conversion
  after insert on public.creator_earnings
  for each row
  when (new.kind = 'conversion')
  execute function public.notify_affiliate_conversion();

revoke execute on function public.notify_affiliate_milestone()  from public, anon, authenticated;
revoke execute on function public.notify_affiliate_conversion() from public, anon, authenticated;
