/**
 * The beacon must never pay a visit the device has contradicted, and must close
 * a visit the device has disowned. Both read gym_visit_events; both are pure.
 */
import { deviceContradictsPresence, disownedAnswers } from '@/supabase/functions/_shared/settleGuards';

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
