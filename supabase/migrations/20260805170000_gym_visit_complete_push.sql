-- Session-complete push: the walk-out closure notification, both platforms.
--
-- Android banks points mid-session but ended a visit in silence; swiped iOS
-- banks at the exit claim. This pass gives BOTH the same final banner:
--   "Session complete 💪 — {gym} · {total} min · +{pts} pts today"
-- On swiped iOS it lands right after the exit receipt; on Android it is the
-- closure moment (and the only place total duration is ever surfaced without
-- opening the app). Only CLAIMED visits qualify — a sub-threshold pop-in ends
-- silently, exactly as before.
alter table public.gym_visits
  add column if not exists completed_push_at timestamptz;

create index if not exists gym_visits_complete_push_idx
  on public.gym_visits (ended_at)
  where completed_push_at is null and ended_at is not null and claimed_session_id is not null;
