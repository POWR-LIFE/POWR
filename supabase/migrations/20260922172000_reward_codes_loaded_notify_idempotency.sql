alter table public.rewards
  add column if not exists codes_loaded_notified_at timestamptz;

comment on column public.rewards.codes_loaded_notified_at is
  'First successful team nudge timestamp for inactive reward code loads; used as an atomic idempotency latch.';
