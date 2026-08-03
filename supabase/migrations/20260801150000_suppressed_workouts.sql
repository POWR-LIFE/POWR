-- Make the dropped workout visible.
--
-- THE LOSS. A geofence gym check-in is POWR's source of truth, so a wearable
-- workout overlapping one is the same time at the gym and must not be paid
-- twice. terra-webhook enforces that with a bare `continue` (index.ts:315-318):
-- the workout is never inserted at all. No session row, no points, no penalty,
-- no ledger trace — it simply never existed. A console.log is not a record.
-- That is the clearest breach of the project's "never drop a workout" rule,
-- and because the overlap window is the gym session's duration_sec it scales
-- with every inflated duration (see project_session_duration_integrity: a 12h
-- session swallows a whole day of wearable workouts).
--
-- WHY A SIDE TABLE AND NOT A SESSION ROW. The obvious fix — keep the workout as
-- an activity_sessions row at points=0 — was audited and rejected. Every
-- challenge evaluator reaches sessions through ONE builder (buildContext,
-- shared/challengeRules.js:209 and its Deno mirror _shared/challenges.ts:243)
-- whose only exclusions are `verification='manual'` and `type='sleep'`. A kept
-- row passes both and is counted like an independent workout by session_count,
-- distinct_categories, same_day_combo and pooled contributions. Prod holds live
-- shared challenges on exactly {session_count, category:'gym', target:3}, and
-- multi-gym-and-go would complete off a single visit because the suppressed
-- "running" row supplies the run. Those pay 'earn' rows that raise level and
-- can never be clawed back. Two INSERT triggers on activity_sessions also fire
-- regardless of points, one of which completes streak rescues.
--
-- So: record the workout OUTSIDE activity_sessions. Nothing counts this table,
-- nothing pays from it, and no existing reader changes behaviour. It turns a
-- silent discard into an auditable one, and gives a later client surface the
-- data it needs (including the vitals a geofence session can never carry on its
-- own) without touching the points economy.

create table if not exists public.suppressed_workouts (
    id                 uuid primary key default gen_random_uuid(),
    user_id            uuid not null references auth.users(id) on delete cascade,

    -- The check-in that outranked it. ON DELETE SET NULL: if the winning session
    -- is later removed (admin reject), the record of the loss must survive —
    -- that is the whole point of the table.
    winner_session_id  uuid references public.activity_sessions(id) on delete set null,

    -- The workout as the wearable reported it.
    type               text not null,
    started_at         timestamptz not null,
    ended_at           timestamptz not null,
    duration_sec       integer not null check (duration_sec > 0),
    distance_m         double precision,
    hr_avg             integer,
    hr_max             integer,
    calories_active    integer,
    source             text,
    raw_activity_name  text,

    -- Why it was dropped, and what it would have paid. `would_have_earned` is
    -- the honest size of the loss — it is NOT a debt and is never paid out.
    reason             text not null default 'overlaps_geofence_gym',
    would_have_earned  integer,

    created_at         timestamptz not null default now()
);

-- Terra re-delivers the same activity through terra-poll (it replays a ~2-day
-- window, deliberately idempotent), so the same suppression will arrive more
-- than once. Key on the workout's own identity, not on arrival.
create unique index if not exists suppressed_workouts_identity_uidx
    on public.suppressed_workouts (user_id, type, started_at);

create index if not exists idx_suppressed_workouts_user_started
    on public.suppressed_workouts (user_id, started_at desc);

create index if not exists idx_suppressed_workouts_winner
    on public.suppressed_workouts (winner_session_id)
    where winner_session_id is not null;

alter table public.suppressed_workouts enable row level security;

-- Read-only to the owner. Writes come from terra-webhook under the service role,
-- which bypasses RLS — there is deliberately no INSERT/UPDATE/DELETE policy, so
-- a client can never manufacture or edit a suppression record.
drop policy if exists "own suppressed workouts" on public.suppressed_workouts;
create policy "own suppressed workouts" on public.suppressed_workouts
    for select using (auth.uid() = user_id);

drop policy if exists "admins read suppressed workouts" on public.suppressed_workouts;
create policy "admins read suppressed workouts" on public.suppressed_workouts
    for select using (exists (select 1 from public.admin_roles where user_id = auth.uid()));

comment on table public.suppressed_workouts is
    'Wearable workouts dropped because they overlapped a higher-trust geofence check-in. '
    'An audit record ONLY: nothing counts these rows, nothing pays from them, and they are '
    'not activity_sessions. Exists so "never drop a workout" means never drop it silently.';
