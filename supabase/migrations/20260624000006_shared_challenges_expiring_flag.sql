-- One-shot guard so the "ends soon, finish your part" nudge fires once per
-- challenge instead of every cron tick while it's inside the reminder window.
alter table public.shared_challenges
  add column if not exists expiring_notified boolean not null default false;
