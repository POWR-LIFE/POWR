-- Tracks which users have completed a weekly challenge and what they earned.
-- One row per (user, challenge, ISO week) — idempotent by unique constraint.

create table public.user_challenge_completions (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references public.profiles(id) on delete cascade,
  challenge_id    text        not null,
  challenge_week  text        not null,  -- ISO week, e.g. '2026-W19'
  session_id      uuid        references public.activity_sessions(id) on delete set null,
  activity_type   text        not null,
  points_awarded  integer     not null default 0,
  completed_at    timestamptz not null default now(),

  constraint user_challenge_completions_unique
    unique (user_id, challenge_id, challenge_week)
);

create index user_challenge_completions_user_idx
  on public.user_challenge_completions (user_id, completed_at desc);

alter table public.user_challenge_completions enable row level security;

-- Users can read their own completions
create policy "Users can read own challenge completions"
  on public.user_challenge_completions for select
  using (auth.uid() = user_id);
