-- ============================================================================
-- SHARED CHALLENGE COPY — a goal never names a timeframe.
-- Challenge length is picked at creation (duration_hours) and shown as a live
-- countdown, but the catalog's goal strings were authored week-shaped ("Check
-- in 3× this week") — so a 24h/48h run contradicted its own copy on every
-- card. The timeframe now lives in exactly one place (the clock); the goal
-- line only says WHAT you do.
--   • solo catalog: strip "this week"; cumulative goals say "in total" so a
--     bare number isn't read as a single effort
--   • retitle the week-named presets (35K/50K Week → Steps; "4 From 7" loses
--     its 7-day frame → "Four of a Kind", pairing with "Full House")
--   • pooled goals ("Together: …") are already timeframe-free — untouched
--   • in-flight (forming/active) challenges render a template SNAPSHOT, so
--     strip the phrase there too; goals/rules stay untouched (an edit must
--     never re-scope a game already in play)
-- ============================================================================

update public.shared_challenge_templates as t
set title = v.new_title, goal = v.new_goal, updated_at = now()
from (values
  ('Back Again',    'Back Again',     'Check in on 7 different days'),
  ('Just Run',      'Just Run',       'Log 1 run'),
  ('4 From 7',      'Four of a Kind', 'Check in 4×'),
  ('35K Week',      '35K Steps',      '35,000 steps in total'),
  ('Full House',    'Full House',     'Check in 6×'),
  ('50K Week',      '50K Steps',      '50,000 steps in total'),
  ('Three Runs',    'Three Runs',     'Log 3 runs'),
  ('10K Runner',    '10K Runner',     'Run 10km in total'),
  ('Wheels Up',     'Wheels Up',      'Log 1 ride'),
  ('Saddle Time',   'Saddle Time',    'Log 3 rides'),
  ('Century Split', 'Century Split',  'Ride 50km in total'),
  ('Mix It Up',     'Mix It Up',      'Try 3 different activities')
) as v(old_title, new_title, new_goal)
where t.mode = 'solo' and t.title = v.old_title;

-- Live cards read the snapshot, not the catalog — drop the phrase there too so
-- an active "Check in 3× this week · 1h left" stops arguing with itself.
update public.shared_challenges
set template = jsonb_set(
      template, '{goal}',
      to_jsonb(regexp_replace(template->>'goal', '\s+this week', '', 'gi')))
where status in ('forming', 'active')
  and template->>'goal' ~* 'this week';
