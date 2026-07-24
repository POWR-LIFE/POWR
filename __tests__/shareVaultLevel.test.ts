/**
 * vaultTowardLevel — the vault half of the share card's canonical earned basis
 * (get_my_points_summary.total_earned = positive ledger + vault still counting
 * toward level). This is the one bit of genuinely new, non-obvious logic the
 * level-basis fix added to the share path, and it feeds the public og:title /
 * powr.life/s/<id> preview — so the as-of branch is worth pinning.
 *
 * Level thresholds under test (constants/levels): L2 at 500.
 */

import { vaultTowardLevel } from '@/lib/api/share';
import { getLevelInfo } from '@/constants/levels';

const deposit = (amount: number, released_at: string | null = null) => ({ amount, released_at });

test('no deposits contribute nothing', () => {
  expect(vaultTowardLevel([])).toBe(0);
});

test('unreleased deposits count in full', () => {
  expect(vaultTowardLevel([deposit(10), deposit(50)])).toBe(60);
});

test('a released deposit is excluded — it already lives in the ledger as a vault_release credit', () => {
  // Without asOf, "released" means released as of now: any non-null released_at.
  expect(vaultTowardLevel([deposit(10), deposit(50, '2026-07-20T00:00:00Z')])).toBe(10);
});

describe('historical card (asOf) — count vault as it stood on the card date', () => {
  const cardDate = new Date('2026-07-15T00:00:00Z');

  test('a deposit released AFTER the card date was still unreleased then, so it counts', () => {
    expect(vaultTowardLevel([deposit(10, '2026-07-20T00:00:00Z')], cardDate)).toBe(10);
  });

  test('a deposit released ON/BEFORE the card date is excluded (its vault_release credit is already in the ledger by then)', () => {
    expect(vaultTowardLevel([deposit(10, '2026-07-10T00:00:00Z')], cardDate)).toBe(0);
    expect(vaultTowardLevel([deposit(10, '2026-07-15T00:00:00Z')], cardDate)).toBe(0); // exactly on the boundary
  });

  test('still-unreleased deposits count regardless of the card date', () => {
    expect(vaultTowardLevel([deposit(10, null)], cardDate)).toBe(10);
  });
});

test('a stray non-positive amount cannot pull the total down', () => {
  expect(vaultTowardLevel([deposit(10), deposit(-5)])).toBe(10);
});

test('regression: vault tips a member over a level boundary credits-only would miss', () => {
  // The reported bug: credits alone leave the member one level low; the pending
  // vault bonus is what actually crossed the threshold on home + the push.
  const creditsEarned = 495;
  const vault = vaultTowardLevel([deposit(10)]); // unreleased Level-2 bonus

  expect(getLevelInfo(creditsEarned).current.level).toBe(1);           // credits-only: still L1
  expect(getLevelInfo(creditsEarned + vault).current.level).toBe(2);   // canonical: L2, matching home + push
});
