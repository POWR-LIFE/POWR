import {
  extractInviteCode,
  clipboardMayHoldCode,
  readInviteCodeFromClipboard,
} from '../lib/social/inviteCodePaste';

describe('extractInviteCode', () => {
  it('accepts a bare POWR ID', () => {
    expect(extractInviteCode('ABCD2345')).toBe('ABCD2345');
  });

  it('accepts the display form with a gap or hyphen', () => {
    expect(extractInviteCode('abcd 2345')).toBe('ABCD2345');
    expect(extractInviteCode('ABCD-2345')).toBe('ABCD2345');
  });

  it('accepts a vanity code up to 10 chars', () => {
    expect(extractInviteCode('LUKE2026')).toBe('LUKE2026');
    expect(extractInviteCode('POWRTEST99')).toBe('POWRTEST99');
  });

  it('rejects codes outside the 6–10 bound the app can capture', () => {
    expect(extractInviteCode('LUKE5')).toBeNull();
    expect(extractInviteCode('WAYTOOLONGCODE1')).toBeNull();
  });

  it('pulls the code out of a smart-link URL', () => {
    expect(extractInviteCode('https://powr.life/app?ref=LUKE2026&c=story')).toBe('LUKE2026');
  });

  it('pulls the code out of the ready-made share message', () => {
    expect(extractInviteCode('Get paid to train. Download POWR and use my code LUKE2026 — https://powr.life/join/lukeb'))
      .toBe('LUKE2026');
  });

  it('prefers the explicit code over other words in a sentence', () => {
    expect(extractInviteCode('use code ABCD 2345 before FRIDAY')).toBe('ABCD2345');
  });

  it('does not turn an ordinary message into a code', () => {
    expect(extractInviteCode('see you at the gym tomorrow morning')).toBeNull();
    expect(extractInviteCode('use my code tomorrow at the gym')).toBeNull();
  });

  it('accepts a letters-only code when it is the whole clipboard', () => {
    // ~1 in 10 real POWR IDs has no digit; a bare token must not be refused.
    expect(extractInviteCode('ABCDEFGH')).toBe('ABCDEFGH');
  });

  it('accepts a letters-only POWR ID after an explicit carrier, but not a word', () => {
    expect(extractInviteCode('use code ABCDEFGH')).toBe('ABCDEFGH');
    // TOMORROW has an O — no minted POWR ID ever does.
    expect(extractInviteCode('use code TOMORROW')).toBeNull();
  });

  it('never joins a third word onto an explicit code', () => {
    expect(extractInviteCode('use code LUKE2026 today please')).toBe('LUKE2026');
  });

  it('handles empty input', () => {
    expect(extractInviteCode('')).toBeNull();
    expect(extractInviteCode(null)).toBeNull();
    expect(extractInviteCode(undefined)).toBeNull();
  });
});

describe('clipboard helpers', () => {
  it('reports presence without reading', async () => {
    const get = jest.fn(async () => 'ABCD2345');
    const has = jest.fn(async () => true);
    expect(await clipboardMayHoldCode({ hasStringAsync: has, getStringAsync: get })).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  it('reads and normalises on demand', async () => {
    const clip = { hasStringAsync: async () => true, getStringAsync: async () => 'abcd 2345' };
    expect(await readInviteCodeFromClipboard(clip)).toBe('ABCD2345');
  });

  it('never throws on a clipboard error', async () => {
    const clip = {
      hasStringAsync: async () => { throw new Error('denied'); },
      getStringAsync: async () => { throw new Error('denied'); },
    };
    expect(await clipboardMayHoldCode(clip)).toBe(false);
    expect(await readInviteCodeFromClipboard(clip)).toBeNull();
  });
});
