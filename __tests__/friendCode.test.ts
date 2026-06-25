/**
 * Friend-QR code parsing.
 *
 * The scanner hands `parseReferralCode` whatever raw string sat in the QR. It
 * must pull the referral code out of every legitimate shape (full smart-link,
 * custom-scheme deep link, bare printed code) and reject anything else, so a
 * stray QR (a Wi-Fi code, a random URL) can never resolve to a phantom "ref".
 */

import { parseReferralCode } from '@/lib/social/friendCode';

describe('parseReferralCode', () => {
  it('pulls the code out of the https smart-link', () => {
    expect(parseReferralCode('https://powr.life/app?to=add-friend&ref=ABC123ZZ')).toBe('ABC123ZZ');
  });

  it('pulls the code out of the custom-scheme deep link', () => {
    expect(parseReferralCode('powr://add-friend?ref=ABC123ZZ')).toBe('ABC123ZZ');
  });

  it('accepts a bare code printed on its own', () => {
    expect(parseReferralCode('ABC123ZZ')).toBe('ABC123ZZ');
  });

  it('is order-independent on the query string', () => {
    expect(parseReferralCode('https://powr.life/app?ref=ABC123ZZ&to=add-friend')).toBe('ABC123ZZ');
  });

  it('upper-cases to match the stored code form', () => {
    expect(parseReferralCode('powr://add-friend?ref=abc123zz')).toBe('ABC123ZZ');
    expect(parseReferralCode('abc123zz')).toBe('ABC123ZZ');
  });

  it('trims surrounding whitespace', () => {
    expect(parseReferralCode('  ABC123ZZ  ')).toBe('ABC123ZZ');
  });

  it('returns null for an empty or missing payload', () => {
    expect(parseReferralCode('')).toBeNull();
    expect(parseReferralCode('   ')).toBeNull();
    expect(parseReferralCode(null)).toBeNull();
    expect(parseReferralCode(undefined)).toBeNull();
  });

  it('returns null for a link with no ref param', () => {
    expect(parseReferralCode('https://powr.life/app?to=add-friend')).toBeNull();
    expect(parseReferralCode('https://example.com/some/page')).toBeNull();
  });

  it('returns null for unrelated QR payloads', () => {
    expect(parseReferralCode('WIFI:S:mynetwork;T:WPA;P:hunter2;;')).toBeNull();
    expect(parseReferralCode('hello world')).toBeNull();
  });

  it('rejects codes of the wrong length', () => {
    expect(parseReferralCode('ABC12')).toBeNull();        // too short (5)
    expect(parseReferralCode('ABC123ZZ901')).toBeNull();  // too long (11)
  });
});
