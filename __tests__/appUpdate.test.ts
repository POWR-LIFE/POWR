import { parseVersion, versionBelow } from '@/lib/appUpdate';

describe('parseVersion', () => {
  it('parses plain semver', () => {
    expect(parseVersion('1.4.11')).toEqual([1, 4, 11]);
  });

  it('parses the Expo Go suffix form reported by dev clients', () => {
    expect(parseVersion('1.4.11 (Expo Go)')).toEqual([1, 4, 11]);
  });

  it('rejects partial or junk versions', () => {
    expect(parseVersion('1.4')).toBeNull();
    expect(parseVersion('oops')).toBeNull();
    expect(parseVersion('')).toBeNull();
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });
});

describe('versionBelow', () => {
  const below = (a: string, b: string) =>
    versionBelow(parseVersion(a)!, parseVersion(b)!);

  it('orders on each component', () => {
    expect(below('1.4.10', '1.4.11')).toBe(true);
    expect(below('1.3.99', '1.4.0')).toBe(true);
    expect(below('0.9.9', '1.0.0')).toBe(true);
  });

  it('equal is not below — the running version never nags itself', () => {
    expect(below('1.4.11', '1.4.11')).toBe(false);
  });

  it('newer than published (TestFlight/dev ahead of store) is not below', () => {
    expect(below('1.4.12', '1.4.11')).toBe(false);
    expect(below('2.0.0', '1.9.9')).toBe(false);
  });

  it('compares numerically, not lexicographically', () => {
    expect(below('1.4.9', '1.4.10')).toBe(true);
    expect(below('1.10.0', '1.9.0')).toBe(false);
  });
});
