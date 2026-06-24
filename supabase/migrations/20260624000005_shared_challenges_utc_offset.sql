-- The creator's UTC offset (minutes) at creation, used as the representative
-- offset when the CRON backstop evaluates day-boundary rules (distinct_days,
-- daily step aggregation, before-9am windows) for app-closed participants.
-- The client completion path passes each user's own live offset, which is
-- authoritative; this is the fallback for participants who never open the app.
alter table public.shared_challenges
  add column if not exists utc_offset_minutes int not null default 0;
