-- =============================================================
-- REWARD PLACEMENTS → server-side redemption attribution
-- =============================================================
-- The client used to log a 'redeemed' placement event when the user TAPPED
-- redeem — i.e. on intent, before any points were spent, and even if they
-- backed out of the modal. That inflated the exact funnel metric the whole
-- system is meant to sell (verified footfall → redemption).
--
-- Redemptions are only ever inserted by the redeem-reward edge function
-- (service role; direct inserts are blocked by RLS), so the authoritative
-- moment to attribute a redemption is a trigger on that insert. We attribute
-- the redemption to the most recent placement that SURFACED this reward to
-- this user within the last 24h — that placement's campaign earned the
-- redemption. No surfacing in-window → no attribution (organic redemption).
-- =============================================================

create or replace function public.log_placement_redemption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.reward_placement_events (placement_id, user_id, event_type)
  select e.placement_id, new.user_id, 'redeemed'
  from public.reward_placement_events e
  join public.reward_placements pl on pl.id = e.placement_id
  where e.user_id = new.user_id
    and pl.reward_id = new.reward_id
    and e.event_type = 'surfaced'
    and e.created_at > now() - interval '24 hours'
  order by e.created_at desc
  limit 1;   -- attribute to the single most-recent surfacing campaign
  return new;
end;
$$;

-- Trigger-only function — never meant to be called directly as an RPC.
revoke all on function public.log_placement_redemption() from public, anon, authenticated;

drop trigger if exists trg_log_placement_redemption on public.redemptions;
create trigger trg_log_placement_redemption
  after insert on public.redemptions
  for each row execute function public.log_placement_redemption();
