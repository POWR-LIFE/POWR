-- ============================================================================
-- TEMPLATE-OWNED RUN LENGTH.
-- A challenge's duration is part of its design — "check in 3×" is a different
-- game (difficulty, fair points) over 24h vs 2 weeks — so it moves onto the
-- template next to target/tier/points, replacing the global run-length menu +
-- member picker. Members now make zero timing decisions: the card states the
-- run length and the countdown does the rest. Admins can author genuinely
-- quick challenges (24h) without re-timing the whole catalog.
--
-- Backfill = 168h: the catalog was authored week-shaped ("…this week"), so a
-- week is what every existing goal was balanced against. Tune per template in
-- the admin editor. config.duration_options/default_duration_hours stay for
-- old clients that still read them, but new code ignores both.
-- ============================================================================

alter table public.shared_challenge_templates
  add column if not exists duration_hours int not null default 168
  check (duration_hours > 0);
