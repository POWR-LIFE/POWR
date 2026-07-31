/**
 * Pacer math (lib/social/pacer.ts) — the elapsed-window pace line solo
 * challenge runs race against.
 */

import { pacerState } from '@/lib/social/pacer';

const START = '2026-07-30T00:00:00Z';
const END = '2026-08-01T00:00:00Z'; // 48h window
const at = (hours: number) => Date.parse(START) + hours * 3_600_000;

describe('pacerState', () => {
  it('is the elapsed fraction of the window', () => {
    const p = pacerState(START, END, 0, at(12));
    expect(p?.fraction).toBeCloseTo(0.25);
    expect(p?.pct).toBe(25);
  });

  it('ahead when your progress meets or beats the pace', () => {
    expect(pacerState(START, END, 0.25, at(12))?.ahead).toBe(true);
    expect(pacerState(START, END, 0.24, at(12))?.ahead).toBe(false);
  });

  it('clamps outside the window', () => {
    expect(pacerState(START, END, 0, at(-5))?.fraction).toBe(0);
    expect(pacerState(START, END, 0.5, at(72))?.fraction).toBe(1);
  });

  it('null while forming or on bad input', () => {
    expect(pacerState(null, END, 0)).toBeNull();
    expect(pacerState(START, null, 0)).toBeNull();
    expect(pacerState(END, START, 0)).toBeNull(); // inverted window
    expect(pacerState('garbage', END, 0)).toBeNull();
  });
});
