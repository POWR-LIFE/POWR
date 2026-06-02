-- Record WHY a session was flagged so the admin Session Review queue can show a
-- reason instead of a meaningless trust score. Set by the claim-points edge
-- function when it flags a session. Nullable: unflagged sessions and rows
-- flagged before this migration leave it null.
--
-- Expected values:
--   'duplicate'    — a second same-type session was already logged that day
--   'multi_device' — 3+ distinct devices used by this account in the last 7 days
alter table public.activity_sessions
  add column if not exists flag_reason text;
