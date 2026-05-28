/* Quick unit checks for the weekly-challenge rule engine + rotation.
   Run: node scripts/test-challenge-rules.js   (no deps) */

(async () => {
const { buildContext, evaluateChallenge } = await import('../shared/challengeRules.js');
const { CATALOG, getActiveChallengesForWeek, getChallengeById, getISOWeek, CATEGORY_ORDER } = await import('../shared/weeklyChallenges.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', name); }
}

// UTC offset 0 for deterministic local==UTC in fixtures.
const OFF = 0;
// Helper to make a session at a given local day/hour this fixture-week.
// Use a fixed Monday base: 2026-05-25 (Mon) .. 2026-05-31 (Sun).
const BASE = '2026-05-25'; // Monday
function day(offsetDays, hour = 9) {
  const d = new Date(Date.UTC(2026, 4, 25 + offsetDays, hour, 0, 0));
  return d.toISOString();
}
function S(type, offsetDays, { hour = 9, distance_m = 0, steps = 0, duration_sec = 1800, verification = 'gps' } = {}) {
  return { type, started_at: day(offsetDays, hour), distance_m, steps, duration_sec, verification };
}

function ctx(sessions, windows) { return buildContext(sessions, OFF, windows); }
function ev(id, c) { return evaluateChallenge(getChallengeById(id).rule, c); }

// ── session_count (plain) ──
check('Show Up met at 2 gym', ev('gym-show-up', ctx([S('gym', 0), S('gym', 1)])).met);
check('Show Up not met at 1 gym', !ev('gym-show-up', ctx([S('gym', 0)])).met);
check('manual excluded', !ev('gym-show-up', ctx([S('gym', 0, { verification: 'manual' }), S('gym', 1, { verification: 'manual' })])).met);

// ── dayOfWeek filter ──
check('Midweek met (Tue)', ev('gym-midweek-move', ctx([S('gym', 1)])).met);
check('Midweek not met (Thu)', !ev('gym-midweek-move', ctx([S('gym', 3)])).met);
check('Weekend met (Sat)', ev('gym-weekend', ctx([S('gym', 5)])).met);
check('Weekend not met (Fri)', !ev('gym-weekend', ctx([S('gym', 4)])).met);

// ── beforeHour ──
check('Early Doors met (3 before 8am)', ev('gym-early-doors', ctx([S('gym', 0, { hour: 6 }), S('gym', 1, { hour: 7 }), S('gym', 2, { hour: 5 })])).met);
check('Early Doors not met (8am exactly)', !ev('gym-early-doors', ctx([S('gym', 0, { hour: 8 }), S('gym', 1, { hour: 7 }), S('gym', 2, { hour: 5 })])).met);

// ── hourWindow ──
check('Lunchtime met (12-2pm x3)', ev('gym-lunchtime', ctx([S('gym', 0, { hour: 12 }), S('gym', 1, { hour: 13 }), S('gym', 2, { hour: 13 })])).met);
check('Lunchtime not met (2pm excluded)', !ev('gym-lunchtime', ctx([S('gym', 0, { hour: 14 }), S('gym', 1, { hour: 13 }), S('gym', 2, { hour: 13 })])).met);

// ── distinct_days ──
check('Perfect Week met (7 gym days)', ev('gym-perfect-week', ctx([0,1,2,3,4,5,6].map((d) => S('gym', d)))).met);
check('Perfect Week not met (6 days)', !ev('gym-perfect-week', ctx([0,1,2,3,4,5].map((d) => S('gym', d)))).met);

// ── daily_metric_days (steps) ──
check('First Steps met (5k one day)', ev('walk-first-steps', ctx([S('walking', 0, { steps: 5200 })])).met);
check('10K Days met (4 days >=10k)', ev('walk-10k-days', ctx([0,1,2,3].map((d) => S('walking', d, { steps: 10500 })))).met);
check('10K Days not met (3 days)', !ev('walk-10k-days', ctx([0,1,2].map((d) => S('walking', d, { steps: 10500 })))).met);

// ── weekly_sum steps ──
check('35K Week met', ev('walk-35k-week', ctx([0,1,2,3].map((d) => S('walking', d, { steps: 9000 })))).met); // 36k
check('35K Week not met', !ev('walk-35k-week', ctx([0,1,2].map((d) => S('walking', d, { steps: 10000 })))).met); // 30k

// ── weekend_sum ──
check('30K Weekend met (Sat+Sun)', ev('walk-30k-weekend', ctx([S('walking', 5, { steps: 16000 }), S('walking', 6, { steps: 15000 })])).met);
check('30K Weekend ignores weekdays', !ev('walk-30k-weekend', ctx([S('walking', 0, { steps: 30000 })])).met);

// ── weekly_sum distance (running) ──
check('20K Week run met', ev('run-20k-week', ctx([S('running', 0, { distance_m: 12000 }), S('running', 1, { distance_m: 9000 })])).met);

// ── count_with_min_metric ──
check('Long One met (10km single)', ev('run-long-one', ctx([S('running', 0, { distance_m: 10200 })])).met);
check('Long One not met (9km)', !ev('run-long-one', ctx([S('running', 0, { distance_m: 9000 })])).met);
check('5K x3 met', ev('run-5k-x3', ctx([0,1,2].map((d) => S('running', d, { distance_m: 5100 })))).met);

// ── count_and_sum ──
check('3 Runs 10km met', ev('run-3-runs-10km', ctx([S('running', 0, { distance_m: 4000 }), S('running', 1, { distance_m: 4000 }), S('running', 2, { distance_m: 3000 })])).met);
check('3 Runs 10km not met (only 2 runs)', !ev('run-3-runs-10km', ctx([S('running', 0, { distance_m: 6000 }), S('running', 1, { distance_m: 6000 })])).met);
check('3 Runs 10km not met (3 runs <10km)', !ev('run-3-runs-10km', ctx([S('running', 0, { distance_m: 2000 }), S('running', 1, { distance_m: 2000 }), S('running', 2, { distance_m: 2000 })])).met);

// ── distinct_categories ──
check('Mix It Up met (2 cats)', ev('multi-mix-it-up', ctx([S('gym', 0), S('running', 1)])).met);
check('All Four met', ev('multi-all-four', ctx([S('gym', 0), S('running', 1), S('cycling', 2), S('walking', 3, { steps: 100 })])).met);
check('All Four not met (3 cats)', !ev('multi-all-four', ctx([S('gym', 0), S('running', 1), S('cycling', 2)])).met);
check('Triple Threat met (2 each in 3 cats)', ev('multi-triple', ctx([S('gym', 0), S('gym', 1), S('running', 2), S('running', 3), S('cycling', 4), S('cycling', 5)])).met);
check('Triple Threat not met (1 each)', !ev('multi-triple', ctx([S('gym', 0), S('running', 1), S('cycling', 2)])).met);

// ── same_day_combo ──
check('Gym and Go met (gym+run same day)', ev('multi-gym-and-go', ctx([S('gym', 0, { hour: 8 }), S('running', 0, { hour: 18 })])).met);
check('Gym and Go not met (different days)', !ev('multi-gym-and-go', ctx([S('gym', 0), S('running', 1)])).met);
check('Gym and Run met (2 days)', ev('multi-gym-and-run', ctx([S('gym', 0), S('running', 0), S('gym', 2), S('running', 2)])).met);

// ── distinct_days any ──
check('5 Days Active met', ev('multi-5-days', ctx([0,1,2,3,4].map((d) => S(['gym','running','cycling','walking','gym'][d], d, { steps: 50 })))).met);
check('10 Sessions met', ev('multi-10-sessions', ctx(Array.from({ length: 10 }, (_, i) => S(i % 2 ? 'gym' : 'running', i % 7)))).met);

// ── spaced_days ──
check('Run Every Other met (0,2,4,6)', ev('run-every-other', ctx([0,2,4,6].map((d) => S('running', d)))).met);
check('Run Every Other not met (4 consecutive)', !ev('run-every-other', ctx([0,1,2,3].map((d) => S('running', d)))).met);

// ── step_window (Phase D rule shape) ──
{
  const windows = [
    { date: '2026-05-25', midday: undefined, before_9am: 0, midday_12_14: 2100, after_6pm: 0 },
    { date: '2026-05-26', before_9am: 0, midday_12_14: 2200, after_6pm: 0 },
    { date: '2026-05-27', before_9am: 0, midday_12_14: 2500, after_6pm: 0 },
  ];
  check('Lunch Walk met (3 midday >=2k)', evaluateChallenge(getChallengeById('walk-lunch-walk').rule, ctx([], windows)).met);
}

// ── progress reporting ──
check('progress reports count', ev('gym-show-up', ctx([S('gym', 0)])).progress === 1);

// ── rotation ──
const wk = getActiveChallengesForWeek('2026-W22');
check('rotation returns 5', wk.length === 5);
check('rotation one per category', CATEGORY_ORDER.every((c) => wk.filter((x) => x.category === c).length === 1));
check('rotation excludes unsupported', wk.every((c) => c.supported !== false));
const wk2 = getActiveChallengesForWeek('2026-W23');
check('rotation advances week-to-week', JSON.stringify(wk.map((c) => c.id)) !== JSON.stringify(wk2.map((c) => c.id)));

// ── catalog integrity ──
check('catalog has 57', CATALOG.length === 57);
check('every challenge has positive points', CATALOG.every((c) => c.points > 0));
check('every challenge has a rule kind', CATALOG.every((c) => c.rule && c.rule.kind));
const counts = {};
CATALOG.forEach((c) => { counts[c.category] = (counts[c.category] || 0) + 1; });
check('category counts 12/12/12/12/9', counts.gym === 12 && counts.walking === 12 && counts.running === 12 && counts.cycling === 12 && counts.multi === 9);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();
