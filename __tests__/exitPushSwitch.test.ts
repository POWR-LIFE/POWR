/**
 * The admin switch for the walk-out banner ("Session complete 💪"). The beacon
 * sends it outside send-push, so these helpers are its only kill-switch — and
 * because the beacon catches up on unstamped visits, switching it back on must
 * not release the backlog that built up while it was off.
 */
import { exitPushCopy, exitPushEndedWhileOff, exitPushPassOpen } from '@/supabase/functions/_shared/exitPushSwitch';

const COPY = { title: 'Session complete 💪', body: 'POWR Gym · 52 min · +30 pts today' };

describe('exitPushPassOpen', () => {
  it('runs when the switch is on', () => {
    expect(exitPushPassOpen({ enabled: true }, false)).toBe(true);
  });

  it('does not run when the switch is off', () => {
    expect(exitPushPassOpen({ enabled: false }, false)).toBe(false);
  });

  it('runs when there is no row yet — the banner behaves as it did before the switch', () => {
    expect(exitPushPassOpen(null, false)).toBe(true);
  });

  it('skips the tick on a failed read rather than sending past a switch that may be off', () => {
    expect(exitPushPassOpen(null, true)).toBe(false);
    expect(exitPushPassOpen({ enabled: true }, true)).toBe(false);
  });
});

describe('exitPushEndedWhileOff', () => {
  const switchedOnAt = '2026-10-02T14:00:00Z';

  it('holds back a visit that ended before the switch came back on', () => {
    expect(exitPushEndedWhileOff({ enabled: true, enabled_changed_at: switchedOnAt }, '2026-10-02T13:20:00Z')).toBe(true);
  });

  it('sends for a visit that ended after the switch came back on', () => {
    expect(exitPushEndedWhileOff({ enabled: true, enabled_changed_at: switchedOnAt }, '2026-10-02T14:03:00Z')).toBe(false);
  });

  it('holds back nothing when the switch has never been flipped', () => {
    expect(exitPushEndedWhileOff({ enabled: true, enabled_changed_at: null }, '2026-10-02T13:20:00Z')).toBe(false);
    expect(exitPushEndedWhileOff({ enabled: true }, '2026-10-02T13:20:00Z')).toBe(false);
    expect(exitPushEndedWhileOff(null, '2026-10-02T13:20:00Z')).toBe(false);
  });

  it('holds back nothing on an unparseable stamp', () => {
    expect(exitPushEndedWhileOff({ enabled: true, enabled_changed_at: 'garbage' }, '2026-10-02T13:20:00Z')).toBe(false);
  });
});

describe('exitPushCopy', () => {
  it('keeps the live copy without overrides', () => {
    expect(exitPushCopy(null, COPY)).toEqual(COPY);
    expect(exitPushCopy({ title_override: null, body_override: null }, COPY)).toEqual(COPY);
  });

  it('replaces only what the admin overrode', () => {
    expect(exitPushCopy({ title_override: 'Nice one', body_override: null }, COPY))
      .toEqual({ title: 'Nice one', body: COPY.body });
    expect(exitPushCopy({ title_override: null, body_override: 'See you next time' }, COPY))
      .toEqual({ title: COPY.title, body: 'See you next time' });
  });

  it('treats a blank override as no override', () => {
    expect(exitPushCopy({ title_override: '   ', body_override: '' }, COPY)).toEqual(COPY);
  });
});
