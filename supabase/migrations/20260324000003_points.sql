-- =============================================================
-- POINT TRANSACTIONS
-- Inserts only via Edge Function (service role) — never direct
-- =============================================================

create type public.point_transaction_type as enum (
  'earn', 'redeem', 'bonus', 'streak', 'penalty', 'adjustment'
);

create table public.point_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  session_id  uuid references public.activity_sessions(id) on delete set null,
  amount      int not null,    -- positive = earn, negative = spend
  type        public.point_transaction_type not null,
  description text,
  multiplier  float not null default 1.0,
  created_at  timestamptz not null default now()
);

create index on public.point_transactions (user_id, created_at desc);

-- RLS
alter table public.point_transactions enable row level security;

create policy "Users can read their own transactions"
  on public.point_transactions for select
  using (auth.uid() = user_id);

-- No client-side insert, update, or delete — service role only

-- =============================================================
-- CONVENIENCE VIEW: current balance per user
-- =============================================================

create or replace view public.user_balances as
  select
    user_id,
    coalesce(sum(amount), 0)::int as balance
  from public.point_transactions
  group by user_id;
