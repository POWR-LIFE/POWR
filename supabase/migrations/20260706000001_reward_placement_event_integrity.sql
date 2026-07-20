-- =============================================================
-- REWARD PLACEMENTS → event-log integrity ('redeemed' is server-only)
-- =============================================================
-- The events INSERT policy allowed any event_type as long as
-- user_id = auth.uid() — so any authenticated user could insert 'redeemed'
-- rows directly and inflate the exact attribution funnel paid placements
-- are sold on. 'redeemed' is only ever legitimately written by the
-- redemptions AFTER-INSERT trigger (log_placement_redemption, SECURITY
-- DEFINER, bypasses RLS), so the client-facing policy now only accepts the
-- genuinely client-originated moments.
-- =============================================================

drop policy "Users log their own placement events" on public.reward_placement_events;

create policy "Users log their own placement events"
  on public.reward_placement_events for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and event_type in ('surfaced', 'presence_confirmed', 'notified')
  );
