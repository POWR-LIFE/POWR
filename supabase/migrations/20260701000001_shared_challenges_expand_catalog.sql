-- ============================================================================
-- SHARED CHALLENGE CATALOG — expand to 15 presets per mode.
-- The browse page (app/challenges.tsx) splits templates into two tabs by `mode`:
--   solo   → each member hits their OWN goal (parallel co-op)
--   pooled → contributions SUM toward one shared "Together" total
-- We shipped with 5 solo + 3 pooled; this brings each tab to a full 15 so there's
-- real variety across categories (gym/walking/running/cycling/multi) and tiers.
-- Icons + category labels are derived client-side from `category`, and each
-- `measure` maps to a real Rule via templateRule()/pooledRule() at creation, so
-- every row below is fully playable end-to-end.
-- ============================================================================

-- A QA leftover that leaked into the live Together tab — retire it (reversible)
-- so the 15 pooled presets are all genuine.
update public.shared_challenge_templates
  set active = false, updated_at = now()
  where title = 'Test Shared Challenge' and mode = 'pooled';

-- ── Solo presets (each does their own part) → +10, total 15 ──────────────────
insert into public.shared_challenge_templates (category, title, tier, base_points, goal, measure, mode, sort_order)
values
  ('gym',     'Early Bird',     'medium', 45, 'Check in 3× before 9am',
     '{"measure":"checkins","target":3,"unit":null,"days":null,"window":"before_9am"}'::jsonb, 'solo', 6),
  ('gym',     'Full House',     'hard',   60, 'Check in 6× this week',
     '{"measure":"checkins","target":6,"unit":null,"days":null,"window":"any"}'::jsonb, 'solo', 7),
  ('walking', 'Step It Up',     'easy',   25, '8,000 steps a day, 3 days',
     '{"measure":"steps_day","target":8000,"unit":null,"days":3,"window":"any"}'::jsonb, 'solo', 8),
  ('walking', '50K Week',       'hard',   60, '50,000 steps this week',
     '{"measure":"steps_week","target":50000,"unit":null,"days":null,"window":null}'::jsonb, 'solo', 9),
  ('running', 'Three Runs',     'medium', 40, 'Log 3 runs this week',
     '{"measure":"runs","target":3,"unit":null,"days":null,"window":null}'::jsonb, 'solo', 10),
  ('running', '10K Runner',     'hard',   55, 'Run 10km this week',
     '{"measure":"distance","target":10,"unit":"km","days":null,"window":null}'::jsonb, 'solo', 11),
  ('cycling', 'Wheels Up',      'easy',   20, 'Log 1 ride this week',
     '{"measure":"rides","target":1,"unit":null,"days":null,"window":null}'::jsonb, 'solo', 12),
  ('cycling', 'Saddle Time',    'medium', 40, 'Log 3 rides this week',
     '{"measure":"rides","target":3,"unit":null,"days":null,"window":null}'::jsonb, 'solo', 13),
  ('cycling', 'Century Split',  'hard',   55, 'Ride 50km this week',
     '{"measure":"distance","target":50,"unit":"km","days":null,"window":null}'::jsonb, 'solo', 14),
  ('multi',   'Mix It Up',      'medium', 45, '3 different activities this week',
     '{"measure":"categories","target":3,"unit":null,"days":null,"window":null}'::jsonb, 'solo', 15)
on conflict do nothing;

-- ── Pooled presets ("Together" — effort sums) → +12, total 15 ────────────────
insert into public.shared_challenge_templates (category, title, tier, base_points, goal, measure, mode, sort_order)
values
  ('walking', 'Step Squad',      'easy',   25, 'Together: 50,000 steps',
     '{"measure":"steps_week","target":50000,"unit":null,"days":null,"window":null}'::jsonb, 'pooled', 20),
  ('walking', 'Miles Together',  'medium', 40, 'Together: 50km walking',
     '{"measure":"distance","target":50,"unit":"km","days":null,"window":null}'::jsonb, 'pooled', 21),
  ('walking', 'Quarter Million', 'hard',   55, 'Together: 250,000 steps',
     '{"measure":"steps_week","target":250000,"unit":null,"days":null,"window":null}'::jsonb, 'pooled', 22),
  ('gym',     'Gym Grind',       'medium', 40, 'Together: 40 gym check-ins',
     '{"measure":"checkins","target":40,"unit":null,"days":null,"window":"any"}'::jsonb, 'pooled', 23),
  ('gym',     'Full Gym',        'hard',   55, 'Together: 75 gym check-ins',
     '{"measure":"checkins","target":75,"unit":null,"days":null,"window":"any"}'::jsonb, 'pooled', 24),
  ('running', 'Run Club',        'easy',   25, 'Together: 15 runs',
     '{"measure":"runs","target":15,"unit":null,"days":null,"window":null}'::jsonb, 'pooled', 25),
  ('running', 'Marathon Pool',   'hard',   60, 'Together: 200km running',
     '{"measure":"distance","target":200,"unit":"km","days":null,"window":null}'::jsonb, 'pooled', 26),
  ('cycling', 'Pedal Party',     'easy',   30, 'Together: 15 rides',
     '{"measure":"rides","target":15,"unit":null,"days":null,"window":null}'::jsonb, 'pooled', 27),
  ('cycling', 'Peloton Pool',    'medium', 45, 'Together: 250km cycling',
     '{"measure":"distance","target":250,"unit":"km","days":null,"window":null}'::jsonb, 'pooled', 28),
  ('cycling', 'Everest Ride',    'hard',   60, 'Together: 500km cycling',
     '{"measure":"distance","target":500,"unit":"km","days":null,"window":null}'::jsonb, 'pooled', 29),
  ('multi',   'All In',          'medium', 45, 'Together: 30 sessions',
     '{"measure":"sessions","target":30,"unit":null,"days":null,"window":null}'::jsonb, 'pooled', 30),
  ('multi',   'Mega Mix',        'hard',   55, 'Together: 60 sessions',
     '{"measure":"sessions","target":60,"unit":null,"days":null,"window":null}'::jsonb, 'pooled', 31)
on conflict do nothing;
