-- ── app_errors: uncaught JavaScript errors from the app ────────────────────
--
-- An uncaught JS error in a release build is currently ONE HARD NATIVE CRASH.
-- reportException is a VOID TurboModule method, so RCTFatal's NSException is
-- converted to a C++ exception on a bare dispatch block and terminates the
-- process. The native crash report then names com.meta.react.turbomodulemanager
-- .queue and never the JavaScript that threw — six TestFlight crash logs on
-- 2026-08-06 all resolved to that one queue and told us nothing else. This
-- table is where the JS half finally lands.
--
-- WHY NOT app_events, which exists and already has a writer:
--  1. app_events.user_id is NOT NULL FK auth.users, so a throw before sign-in
--     cannot be recorded there at all — and nobody in that class ever gets far
--     enough to tell us. Here user_id is nullable.
--  2. Analytics is sampled and kill-switchable. The day someone sets the sample
--     to 10 they must not lose nine crashes in ten along with it.
--  3. app_events promises no free text and no PII by construction. A message
--     and a stack trace are the opposite of that on both counts.
--  4. admin_usage_overview counts app_events wholesale, and screens-per-session
--     divides by that session count, which a crashing launch inflates.
--
-- NOTE ON CONSTRAINTS: every constraint below is a LENGTH cap, never a value
-- CHECK. A value CHECK on `source` or `phase` is a way to lose the report you
-- needed, because a later OTA adds a vocabulary word the constraint has never
-- heard of and PostgREST rejects the row with 23514. The client does not read
-- the response body, so that loss would be silent — the one failure mode a
-- crash reporter must not have.

create table if not exists public.app_errors (
  id              uuid primary key default gen_random_uuid(),

  -- NULLABLE on purpose, unlike every other user-scoped table here. A crash
  -- before a session exists is still a crash, and the report is worth more
  -- anonymous than not at all. Resolved at SEND time rather than capture time,
  -- so a report spooled across a device transfer or an account deletion cannot
  -- come back as a 42501 or a 23503 and wedge the spool.
  user_id         uuid references auth.users(id) on delete cascade,

  -- The ANALYTICS launch id, not the auth session. This is the join to
  -- app_events: it recovers the screens the member walked through in the
  -- seconds before the throw, which a stack trace never has. Null headlessly.
  session_id      text check (length(session_id) <= 64),

  -- Our own per-bundle-execution id, ALWAYS present including headlessly.
  -- This is what groups a cascade when session_id does not exist.
  launch_id       text check (length(launch_id) <= 64),
  -- Index of this report within its launch. `where seq = 0` is the CULPRIT:
  -- guardedLoadModule returns undefined after it swallows a module-init throw,
  -- so seq > 0 is usually the downstream TypeError victim, not the cause.
  seq             smallint,
  -- Within-launch dedupe count: a storm reads as one row with repeat = 400.
  repeat          integer not null default 1,

  -- 'global_handler' | 'decorator' | 'error_boundary' | 'manual'
  source          text check (length(source) <= 32),
  fatal           boolean not null default true,

  name            text check (length(name) <= 128),
  message         text not null check (length(message) <= 1024),
  stack           text check (length(stack) <= 8192),
  -- React's componentStack NAMES the component that threw. It is absent from
  -- `stack`, and on a minified release bundle it is often the only line a
  -- human can read.
  component_stack text check (length(component_stack) <= 4096),

  -- Client-computed stable key. Raw messages carry ids and numbers, so
  -- grouping by message alone splits one bug into fifty rows.
  fingerprint     text check (length(fingerprint) <= 64),
  route           text check (length(route) <= 128),
  -- Which background executor was running, when we know. Headless triage lives
  -- on this: a stack from a wake has no route to place it.
  task            text check (length(task) <= 64),
  -- 'foreground' | 'background' | 'headless' | 'unknown'. A headless boot has
  -- no React tree, and its fix looks nothing like an on-screen one.
  phase           text check (length(phase) <= 16),

  platform        text check (length(platform) <= 16),
  os_version      text check (length(os_version) <= 32),
  app_version     text check (length(app_version) <= 48),
  runtime_version text check (length(runtime_version) <= 64),
  -- The OTA identity. TestFlight build numbers drift at upload and one
  -- app_version serves several update groups, so update_id is the only field
  -- that answers "did my fix ship, or is this still the old bundle?".
  update_id       text check (length(update_id) <= 64),

  props           jsonb,

  -- WHEN IT THREW, stamped on the device. Separate from created_at because a
  -- report can be spooled across a process kill and inserted hours later:
  -- (created_at - occurred_at) is exactly how you spot the spooled ones.
  occurred_at     timestamptz not null default now(),
  -- WHEN IT LANDED, server-stamped, never sent by the client.
  created_at      timestamptz not null default now()
);

create index if not exists app_errors_created_idx on public.app_errors (created_at desc);
create index if not exists app_errors_fp_idx      on public.app_errors (fingerprint, occurred_at desc) where fingerprint is not null;
create index if not exists app_errors_launch_idx  on public.app_errors (launch_id, seq) where launch_id is not null;
create index if not exists app_errors_update_idx  on public.app_errors (update_id, occurred_at desc) where update_id is not null;
create index if not exists app_errors_user_idx    on public.app_errors (user_id, occurred_at desc) where user_id is not null;

alter table public.app_errors enable row level security;

-- Append-only from the client, exactly like app_events: no member select, and
-- no update or delete policy for anyone — with RLS on, a command with no policy
-- is denied, so a client can never edit or erase its own crash report.
drop policy if exists "app_errors insert own" on public.app_errors;
create policy "app_errors insert own"
  on public.app_errors for insert to authenticated
  with check (user_id is null or user_id = auth.uid());

-- The anonymous half. The anon key is public by design, so this is a genuinely
-- open write endpoint, and that is accepted deliberately: the crash we most
-- need to see is the one that stops a member ever reaching a session, and it
-- can only ever arrive as anon. Bounded by the length caps above, admin-only
-- read, and the purge below.
drop policy if exists "app_errors insert anonymous" on public.app_errors;
create policy "app_errors insert anonymous"
  on public.app_errors for insert to anon
  with check (user_id is null);

drop policy if exists "app_errors admin read" on public.app_errors;
create policy "app_errors admin read"
  on public.app_errors for select to authenticated
  using (exists (select 1 from admin_roles where admin_roles.user_id = auth.uid()));

-- Belt and braces over Supabase's default grants, which hand anon and
-- authenticated full DML on every public table with RLS as the only guard.
revoke update, delete, truncate on public.app_errors from anon, authenticated;

comment on table public.app_errors is
  'Uncaught JavaScript errors from the mobile app: global handler, exception decorator and React error boundaries. Written by lib/crashReporter.ts, read by admins for triage. Unlike app_events this table DOES hold free text (messages, stacks) — scrubbing happens on the client and the 90-day purge is part of the privacy posture, not just housekeeping.';

-- cron.schedule ERRORS on a duplicate job name rather than replacing it, so the
-- unschedule guard is what makes this migration re-runnable.
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('purge-app-errors');
exception when others then null;
end $$;

select cron.schedule(
  'purge-app-errors',
  '20 4 * * *',
  $$delete from public.app_errors where created_at < now() - interval '90 days'$$
);
