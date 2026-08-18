import { formatMemberId, normalizeMemberId } from '@/shared/memberId';

describe('memberId', () => {
  it('normalizes what a human typed to the stored form', () => {
    expect(normalizeMemberId('abcd 2345')).toBe('ABCD2345');
    expect(normalizeMemberId(' ABCD-2345 ')).toBe('ABCD2345');
    expect(normalizeMemberId('ABCD2345')).toBe('ABCD2345');
  });

  it('returns null for nothing', () => {
    expect(normalizeMemberId('')).toBeNull();
    expect(normalizeMemberId('   ')).toBeNull();
    expect(normalizeMemberId(null)).toBeNull();
    expect(normalizeMemberId(undefined)).toBeNull();
  });

  it('formats an 8-char code as two readable halves', () => {
    expect(formatMemberId('ABCD2345')).toBe('ABCD 2345');
    expect(formatMemberId('abcd 2345')).toBe('ABCD 2345');
  });

  it('leaves anything else alone rather than mangling it', () => {
    expect(formatMemberId('ABC')).toBe('ABC');
    expect(formatMemberId(null)).toBe('');
  });

  it('round-trips: format then normalize gives the stored form back', () => {
    expect(normalizeMemberId(formatMemberId('QWER5678'))).toBe('QWER5678');
  });
});
