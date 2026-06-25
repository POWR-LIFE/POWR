-- ============================================================================
-- SHARED CHALLENGE CONFIG + TEMPLATES (admin-authored catalog).
-- Config is a single tunable row (bonus maths + timer options + concurrency cap)
-- the admin panel edits. Templates are the presets members pick from. Both are
-- READABLE by every authenticated user (catalog data) and WRITABLE only by
-- admins (is_admin()). The structured `measure` is translated to a real rule
-- engine Rule server-side at challenge creation, not stored here.
-- ============================================================================

-- ── Tunable config (single row) ─────────────────────────────────────────────
create table if not exists public.shared_challenge_config (
  id                      int primary key default 1 check (id = 1),
  per_head                int not null default 5,    -- bonus per co-completer
  max_bonus               int not null default 30,   -- hard cap on the bonus
  accept_window_hours     int not null default 48,   -- invitees' response window
  duration_options        jsonb not null default '[48, 72, 168]'::jsonb, -- run-length menu (hours)
  default_duration_hours  int not null default 72,
  challenge_cap           int not null default 3,    -- max OPEN challenges per user
  updated_at              timestamptz not null default now()
);

insert into public.shared_challenge_config (id) values (1)
  on conflict (id) do nothing;

alter table public.shared_challenge_config enable row level security;

create policy "read config (authenticated)"
  on public.shared_challenge_config for select
  to authenticated using (true);

create policy "admins write config"
  on public.shared_challenge_config for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── Templates (presets) ─────────────────────────────────────────────────────
create table if not exists public.shared_challenge_templates (
  id          uuid primary key default gen_random_uuid(),
  category    text not null check (category in ('gym','walking','running','cycling','multi')),
  title       text not null,
  tier        text not null check (tier in ('easy','medium','hard')),
  base_points int not null check (base_points > 0),
  goal        text not null,            -- generated human "what you each do" line
  measure     jsonb not null,           -- {measure, target, unit, days, window} → derives the Rule
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_shared_templates_active on public.shared_challenge_templates (active, sort_order);

alter table public.shared_challenge_templates enable row level security;

create policy "read templates (authenticated)"
  on public.shared_challenge_templates for select
  to authenticated using (true);

create policy "admins write templates"
  on public.shared_challenge_templates for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- Seed with the v1 preset set (mirrors the mock the UI shipped against).
insert into public.shared_challenge_templates (category, title, tier, base_points, goal, measure, sort_order)
values
  ('gym',     'Back Again', 'easy',   25, 'Check in 3× this week',
     '{"measure":"checkins","target":3,"unit":null,"days":null,"window":"any"}'::jsonb, 1),
  ('walking', '10K Days',   'medium', 40, '10,000 steps a day, 4 days',
     '{"measure":"steps_day","target":10000,"unit":null,"days":4,"window":"any"}'::jsonb, 2),
  ('running', 'Just Run',   'easy',   15, 'Log 1 run this week',
     '{"measure":"runs","target":1,"unit":null,"days":null,"window":null}'::jsonb, 3),
  ('gym',     '4 From 7',   'medium', 40, 'Check in 4× this week',
     '{"measure":"checkins","target":4,"unit":null,"days":null,"window":"any"}'::jsonb, 4),
  ('walking', '35K Week',   'medium', 45, '35,000 steps this week',
     '{"measure":"steps_week","target":35000,"unit":null,"days":null,"window":null}'::jsonb, 5)
on conflict do nothing;
