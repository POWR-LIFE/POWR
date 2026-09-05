-- ---------------------------------------------------------------------------
-- Per-table autovacuum for the two small, hot tables System Health watches.
--
-- Postgres' default trigger is 50 rows + 20 % of the table. On gym_visits
-- (~355 live rows) that is 121 dead tuples — 25 % of the table — before
-- autovacuum runs at all, so `db.dead_tuple_pct` (watch line 20 %) sat orange
-- most of 28 Aug → 5 Sep with nothing actually wrong. activity_sessions
-- (~4.1 k) churned the same way under the beacon's settle retry loop (fixed the
-- same day in gym-visit-beacon).
--
-- These settings make autovacuum run at ~5 % dead on both tables: gym_visits at
-- 20 + 5 % ≈ 38 rows, activity_sessions at 50 + 5 % ≈ 255. Both tables are tiny;
-- the extra vacuum passes cost nothing measurable on Micro. Behaviour-neutral
-- for the app. Reversible: `alter table … reset (autovacuum_vacuum_scale_factor,
-- autovacuum_vacuum_threshold, autovacuum_analyze_scale_factor)`.
-- ---------------------------------------------------------------------------

alter table public.gym_visits set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 20,
  autovacuum_analyze_scale_factor = 0.05
);

alter table public.activity_sessions set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 50,
  autovacuum_analyze_scale_factor = 0.05
);
