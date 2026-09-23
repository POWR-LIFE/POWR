/**
 * The beacon must never pay a visit the device has contradicted, and must close
 * a visit the device has disowned. Both read gym_visit_events; both are pure.
 */
import {
  deviceContradictsPresence, disownedAnswers, lastInsideWordIso, sweepCorroboratesPresence,
  sweepWitnessesOutside,
} from '@/supabase/functions/_shared/settleGuards';

const T0 = '2026-09-07T11:19:08.078Z';   // started_at
const T1 = '2026-09-07T11:50:02.951Z';   // first wake answer
const T2 = '2026-09-07T12:06:02.358Z';

const outside = (created_at: string, reason: string | null = 'no_active_session') =>
  ({ event: 'confirmed_outside', created_at, detail: reason ? { reason } : {} });
const inside = (created_at: string) => ({ event: 'confirmed_inside', created_at, detail: {} });

describe('disownedAnswers', () => {
  it('counts only the "no active session" answers', () => {
    expect(disownedAnswers([outside(T1), outside(T2), outside(T2, null), inside(T1)])).toBe(2);
  });

  it('is zero for a visit the device never disowned', () => {
    expect(disownedAnswers([inside(T1), outside(T2, 'fix_outside')])).toBe(0);
    expect(disownedAnswers([])).toBe(0);
  });
});

describe('deviceContradictsPresence', () => {
  it('flags an outside answer after the last proof, whatever the reason', () => {
    expect(deviceContradictsPresence([outside(T2, 'no_active_session')], T1)).toBe(true);
    expect(deviceContradictsPresence([outside(T2, null)], T1)).toBe(true);
  });

  it('ignores an outside answer that predates the last proof — the member came back in', () => {
    expect(deviceContradictsPresence([outside(T1), inside(T2)], T2)).toBe(false);
  });

  it('measures from the start when the visit never proved anything', () => {
    expect(deviceContradictsPresence([outside(T1)], null)).toBe(true);
    expect(deviceContradictsPresence([outside(T1)], undefined)).toBe(true);
  });

  it('inside answers are not contradictions', () => {
    expect(deviceContradictsPresence([inside(T1), inside(T2)], T0)).toBe(false);
  });

  it('fails closed on a timestamp it cannot read', () => {
    expect(deviceContradictsPresence([outside('garbage')], T0)).toBe(true);
    expect(deviceContradictsPresence([outside(T2)], 'garbage')).toBe(true);
  });
});

// Field 2026-09-19: visit 9587b7e4, Mayflower Gym (radius 25), Android, no push
// token. Check-in proof 11:17:29; the rows below are the device's own sweeps.
describe('sweepWitnessesOutside', () => {
  const PROOF = '2026-09-19T11:17:29.217Z';
  const BOUND = 25 + 50;
  const sweep = (created_at: string, nearest_m: number | null, acc_m: number | null = 10, age_s: number | null = 0, outcome = 'handoff') =>
    ({ created_at, detail: { outcome, nearest_m, acc_m, age_s } });

  it('counts the field case: two sharp fixes, kilometres out, after the proof', () => {
    const rows = [
      sweep('2026-09-19T11:24:05.861Z', 471, 4, 1),
      sweep('2026-09-19T11:42:07.346Z', 2232, 4, 0),
      sweep('2026-09-19T12:08:38.381Z', 5260, 4, 111),
    ];
    expect(sweepWitnessesOutside(rows, PROOF, BOUND)).toBe(3);
  });

  it('does not count a member still training — sweeps a few metres from the pin', () => {
    const rows = [sweep('2026-09-19T11:32:00Z', 18), sweep('2026-09-19T11:47:00Z', 37, 6)];
    expect(sweepWitnessesOutside(rows, PROOF, BOUND)).toBe(0);
  });

  it('holds the margin: just outside the exit bound is not a witness', () => {
    // bound 75 + margin 150 = 225 m of clearance needed AFTER the error bar.
    expect(sweepWitnessesOutside([sweep('2026-09-19T11:40:00Z', 230, 10)], PROOF, BOUND)).toBe(0);
    expect(sweepWitnessesOutside([sweep('2026-09-19T11:40:00Z', 235, 10)], PROOF, BOUND)).toBe(1);
  });

  it('refuses coarse fixes — the 300–1500 m cell fixes this device also logged', () => {
    const rows = [sweep('2026-09-19T12:25:56Z', 4222, 300, 395), sweep('2026-09-19T12:38:51Z', 9714, 100, 115)];
    expect(sweepWitnessesOutside(rows, PROOF, BOUND)).toBe(0);
  });

  it('judges the FIX time, not the row time: a cached fix from before the proof is no witness', () => {
    // Logged 3 min after the proof, but the fix is 5 min old — taken on the approach.
    expect(sweepWitnessesOutside([sweep('2026-09-19T11:20:29Z', 900, 5, 300)], PROOF, BOUND)).toBe(0);
  });

  it('counts one cached fix reported by two sweeps once', () => {
    const rows = [
      sweep('2026-09-19T13:24:00Z', 9226, 4, 100),   // fix 13:22:20
      sweep('2026-09-19T13:24:40Z', 9226, 4, 140),   // same fix, reported again
    ];
    expect(sweepWitnessesOutside(rows, PROOF, BOUND)).toBe(1);
  });

  it('ignores rows it cannot read, and sweeps that found no fix', () => {
    const rows = [
      sweep('2026-09-19T12:00:00Z', null),
      sweep('2026-09-19T12:05:00Z', 5000, null),
      sweep('2026-09-19T12:10:00Z', 5000, 10, null),
      sweep('not-a-date', 5000),
      sweep('2026-09-19T12:15:00Z', 5000, 10, 0, 'no_fix'),
      { created_at: '2026-09-19T12:20:00Z', detail: null },
    ];
    expect(sweepWitnessesOutside(rows, PROOF, BOUND)).toBe(0);
  });

  it('refuses non-finite and negative numbers rather than doing arithmetic on them', () => {
    const rows = [
      sweep('2026-09-19T12:00:00Z', Infinity), sweep('2026-09-19T12:05:00Z', 5000, NaN),
      sweep('2026-09-19T12:10:00Z', 5000, -1), sweep('2026-09-19T12:15:00Z', 5000, 10, -30),
    ];
    expect(sweepWitnessesOutside(rows, PROOF, BOUND)).toBe(0);
  });

  it('fails open (no witnesses) when the clock or the bound is unreadable', () => {
    const rows = [sweep('2026-09-19T12:00:00Z', 5000)];
    expect(sweepWitnessesOutside(rows, null, BOUND)).toBe(0);
    expect(sweepWitnessesOutside(rows, 'garbage', BOUND)).toBe(0);
    expect(sweepWitnessesOutside(rows, PROOF, NaN)).toBe(0);
  });
});

describe('lastInsideWordIso', () => {
  it('takes the newest of start, proof and loose confirm', () => {
    expect(lastInsideWordIso({ started_at: T0 })).toBe(T0);
    expect(lastInsideWordIso({ started_at: T0, last_proven_at: T1, last_confirmed_at: null })).toBe(T1);
    expect(lastInsideWordIso({ started_at: T0, last_proven_at: T1, last_confirmed_at: T2 })).toBe(T2);
  });
});

// Field 2026-09-22: visit 38cbbc7d, The Gym Group Cheltenham (radius 25), Android,
// notifications denied, no push token. Rows are the device's own sweeps.
describe('sweepCorroboratesPresence', () => {
  const START = '2026-09-22T19:17:56.674Z';
  const BOUND = 25 + 50;
  const sweep = (
    created_at: string, distance_m: number | null, acc_m: number | null = 4,
    fix_age_s: number | null = 0, outcome = 'exit_check', trusted: boolean | null = true,
  ) => ({ created_at, detail: { outcome, distance_m, acc_m, fix_age_s, trusted } });

  it('corroborates the field case: sharp fixes metres from the pin, well after check-in', () => {
    expect(sweepCorroboratesPresence([sweep('2026-09-22T20:06:49.494Z', 15, 16, 34)], START, BOUND)).toBe(true);
    expect(sweepCorroboratesPresence([sweep('2026-09-22T20:22:11.913Z', 35, 4, 57)], START, BOUND)).toBe(true);
  });

  it('does not count the check-in moment itself — a drive-by has that too', () => {
    // presence_pass at 19:21:33, fix 72 s old: 2.4 min after the start.
    expect(sweepCorroboratesPresence([sweep('2026-09-22T19:21:33.393Z', 9, 5, 72, 'presence_pass')], START, BOUND)).toBe(false);
  });

  it('judges the FIX time: a stale cached fix logged late does not count', () => {
    // Logged 12 min in, but the fix is 5 min old — taken 7 min in.
    expect(sweepCorroboratesPresence([sweep('2026-09-22T19:29:56.674Z', 9, 5, 300)], START, BOUND)).toBe(false);
  });

  it('needs the whole error bar inside the exit bound', () => {
    expect(sweepCorroboratesPresence([sweep('2026-09-22T20:00:00Z', 60, 15)], START, BOUND)).toBe(true);
    expect(sweepCorroboratesPresence([sweep('2026-09-22T20:00:00Z', 60, 16)], START, BOUND)).toBe(false);
  });

  it('refuses coarse, untrusted and far fixes', () => {
    const rows = [
      sweep('2026-09-22T20:00:00Z', 10, 100),
      sweep('2026-09-22T20:05:00Z', 10, 4, 0, 'exit_check', false),
      sweep('2026-09-22T20:10:00Z', 423, 4, 0, 'handoff'),
    ];
    expect(sweepCorroboratesPresence(rows, START, BOUND)).toBe(false);
  });

  it('ignores rows it cannot read — the acquire_stale pass carries no distance', () => {
    const rows = [
      sweep('2026-09-22T19:36:22.470Z', null, null, null, 'presence_pass'),
      sweep('2026-09-22T20:00:00Z', NaN), sweep('2026-09-22T20:00:00Z', -1),
      sweep('2026-09-22T20:00:00Z', 10, 4, -5), sweep('not-a-date', 10),
      { created_at: '2026-09-22T20:00:00Z', detail: null },
    ];
    expect(sweepCorroboratesPresence(rows, START, BOUND)).toBe(false);
  });

  it('fails closed (no settle) when the clock or the bound is unreadable', () => {
    const rows = [sweep('2026-09-22T20:06:49Z', 15, 16, 34)];
    expect(sweepCorroboratesPresence(rows, null, BOUND)).toBe(false);
    expect(sweepCorroboratesPresence(rows, 'garbage', BOUND)).toBe(false);
    expect(sweepCorroboratesPresence(rows, START, NaN)).toBe(false);
  });
});
