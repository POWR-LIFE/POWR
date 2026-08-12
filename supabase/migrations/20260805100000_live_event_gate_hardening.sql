-- =============================================================
-- Entry gate hardening — review follow-ups to 20260804150000
-- =============================================================
-- Two contract/perf gaps found in review of the entry gate:
--
-- 1. referrals has no index on referrer_id. _live_event_gate_count
--    filters on (referrer_id, created_at) and the scorer calls it
--    once per candidate user inside the eligible CTE — so a gated
--    event costs one sequential scan of referrals PER USER. The
--    table is ~empty today, which is exactly why nobody noticed:
--    this event's entire purpose is to grow it, and the scorer
--    runs on every board poll, every admin load and every settle.
--
--    Composite (referrer_id, created_at) so the entry_gate_since
--    floor is served by the same index. converted_at stays a heap
--    filter — a single referrer's row count is small once we've
--    seeked to them, so the 'conversions' mode costs nothing extra.
--
-- 2. entry_gate_n is documented as a non-negative knob (0 = off)
--    but nothing enforced it. A negative value would silently
--    behave like "no gate" — the failure mode where a mistyped
--    config opens the board to everyone is the wrong direction to
--    fail in, so make it a constraint rather than a convention.
-- =============================================================

create index if not exists referrals_referrer_created_idx
  on public.referrals (referrer_id, created_at);

alter table public.live_events
  drop constraint if exists live_events_entry_gate_n_check;
alter table public.live_events
  add constraint live_events_entry_gate_n_check
    check (entry_gate_n >= 0);
