/**
 * The test the 2026-08-07 fix needed and did not have.
 *
 * That fix asserted, in source-scan form, that a heal existed:
 *
 *   expect(source).toMatch(/void SecureStore\.setItemAsync\(key, value, KEYCHAIN\)/)
 *
 * The line was present. The heal did nothing — because expo-secure-store's
 * write falls back to SecItemUpdate for an existing key, and SecItemUpdate is
 * handed [kSecValueData] only, so kSecAttrAccessible survives untouched. A scan
 * for the call could never see that; only a fake with the real native semantics
 * can. So the fake below is the interesting part of this file:
 *
 *   - add succeeds only when (service, key) is free
 *   - a collision degrades to update, which replaces the VALUE and PRESERVES
 *     the accessibility (this is the entire bug)
 *   - a WHEN_UNLOCKED item is unreadable and unwritable while locked
 *   - an AFTER_FIRST_UNLOCK item is readable and writable while locked
 *
 * Verified to fail against the pre-2026-08-17 adapter: "heals a device that was
 * already signed in" and "the migrated item is readable while the phone is
 * locked" both go red, which is exactly the field symptom.
 *
 * (The `mock*` prefixes are jest's hoisting rule, not a style choice — the
 * module factory runs before any non-`mock` module-scope binding exists.)
 */

import * as SecureStoreModule from 'expo-secure-store';
import {
  __resetKeychainMigrationState,
  AFU_SERVICE,
  readSecure,
  removeSecure,
  writeSecure,
} from '@/lib/secureKeychain';

/** The mock defined below — jest.mock is hoisted above this import, so what
 *  lands here is the fake, not the real module. */
const secureStore = SecureStoreModule as unknown as {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
};

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const mockAFU = 'kAfterFirstUnlock';
const mockWhenUnlocked = 'kWhenUnlocked';
const mockDefaultService = 'app';

interface MockItem { value: string; accessible: string }

/** The keychain, keyed the way iOS keys it: service + account. Accessibility is
 *  NOT part of that key, which is why an add collides and degrades to update. */
const mockStore = new Map<string, MockItem>();
const mockDevice = { locked: false };

const mockId = (service: string, key: string) => `${service} ${key}`;

/** errSecInteractionNotAllowed, as expo-secure-store surfaces it. */
class MockKeyChainError extends Error {
  code = 'ERR_KEY_CHAIN';
  constructor() {
    super('Calling the function has failed\n→ Caused by: User interaction is not allowed.');
  }
}

const mockReachable = (item: MockItem | undefined): boolean =>
  !mockDevice.locked || item?.accessible === mockAFU;

jest.mock('expo-secure-store', () => ({
  // Literals, not the consts above: this factory runs while the module under
  // test is being required, which is BEFORE the test file's own module-scope
  // bindings are assigned. The function bodies below are fine — they only run
  // at call time — but these two are read during that require.
  AFTER_FIRST_UNLOCK: 'kAfterFirstUnlock',
  WHEN_UNLOCKED: 'kWhenUnlocked',

  getItemAsync: jest.fn(async (key: string, opts?: { keychainService?: string }) => {
    const item = mockStore.get(mockId(opts?.keychainService ?? mockDefaultService, key));
    if (item === undefined) return null;          // errSecItemNotFound, never a throw
    if (!mockReachable(item)) throw new MockKeyChainError();
    return item.value;
  }),

  setItemAsync: jest.fn(async (
    key: string,
    value: string,
    opts?: { keychainService?: string; keychainAccessible?: string },
  ) => {
    const service = opts?.keychainService ?? mockDefaultService;
    const accessible = opts?.keychainAccessible ?? mockWhenUnlocked;
    const existing = mockStore.get(mockId(service, key));

    if (existing === undefined) {
      // SecItemAdd. Accessibility is applied here and only here.
      if (mockDevice.locked && accessible !== mockAFU) throw new MockKeyChainError();
      mockStore.set(mockId(service, key), { value, accessible });
      return true;
    }
    // errSecDuplicateItem → update(): SecItemUpdate with [kSecValueData] only.
    // THE BUG: `accessible` from the options is dropped on the floor.
    if (!mockReachable(existing)) throw new MockKeyChainError();
    mockStore.set(mockId(service, key), { value, accessible: existing.accessible });
    return true;
  }),

  deleteItemAsync: jest.fn(async (key: string, opts?: { keychainService?: string }) => {
    mockStore.delete(mockId(opts?.keychainService ?? mockDefaultService, key));
  }),
}));

const KEY = 'sb-wjvvujnicwkruaeibttt-auth-token';

/** A device signed in before the migration shipped: WHEN_UNLOCKED, default service. */
function seedLegacyInstall(value = 'legacy-token'): void {
  mockStore.set(mockId(mockDefaultService, KEY), { value, accessible: mockWhenUnlocked });
}

const migratedItem = () => mockStore.get(mockId(AFU_SERVICE, KEY));
const legacyItem = () => mockStore.get(mockId(mockDefaultService, KEY));

/** Let a fire-and-forget migration (write → delete) settle. */
const settle = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  mockStore.clear();
  mockDevice.locked = false;
  __resetKeychainMigrationState();
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the fake models the native semantics we were wrong about', () => {
  it('an add applies the requested accessibility', async () => {
    await writeSecure(KEY, 'fresh');
    expect(migratedItem()).toEqual({ value: 'fresh', accessible: mockAFU });
  });

  it('a rewrite of an EXISTING key does NOT change its accessibility', async () => {
    // The exact reason the 2026-08-07 heal was a no-op. If this ever fails with
    // the accessibility upgraded, expo-secure-store changed its write path and
    // this whole migration can be simplified away.
    seedLegacyInstall();
    await secureStore.setItemAsync(KEY, 'rewritten', { keychainAccessible: mockAFU });
    expect(legacyItem()).toEqual({ value: 'rewritten', accessible: mockWhenUnlocked });
  });
});

describe('migrating a device that was already signed in', () => {
  it('heals a device that was already signed in', async () => {
    seedLegacyInstall();

    await expect(readSecure(KEY)).resolves.toBe('legacy-token');
    await settle();

    expect(migratedItem()).toEqual({ value: 'legacy-token', accessible: mockAFU });
    expect(legacyItem()).toBeUndefined();
  });

  it('the migrated item is readable while the phone is locked', async () => {
    seedLegacyInstall();
    await readSecure(KEY);
    await settle();

    // The field scenario: pocket, screen off, background wake at the dwell mark.
    mockDevice.locked = true;
    await expect(readSecure(KEY)).resolves.toBe('legacy-token');
  });

  it('still reads as absent — never throws — before the migration has run', async () => {
    seedLegacyInstall();
    mockDevice.locked = true;
    await expect(readSecure(KEY)).resolves.toBeNull();
  });

  it('does not re-read the legacy service once migrated', async () => {
    seedLegacyInstall();
    await readSecure(KEY);
    await settle();

    secureStore.getItemAsync.mockClear();
    await readSecure(KEY);
    const services = secureStore.getItemAsync.mock.calls.map(
      (c: unknown[]) => (c[1] as { keychainService?: string })?.keychainService,
    );
    expect(services).toEqual([AFU_SERVICE]);
  });
});

describe('no ordering can lose the token', () => {
  it('keeps the legacy copy when the migrating write fails', async () => {
    seedLegacyInstall();
    secureStore.setItemAsync.mockRejectedValueOnce(new MockKeyChainError());

    await expect(readSecure(KEY)).resolves.toBe('legacy-token');
    await settle();

    expect(legacyItem()).toEqual({ value: 'legacy-token', accessible: mockWhenUnlocked });
  });

  it('retries the migration on the next read after a failed write', async () => {
    seedLegacyInstall();
    secureStore.setItemAsync.mockRejectedValueOnce(new MockKeyChainError());
    await readSecure(KEY);
    await settle();

    await readSecure(KEY);
    await settle();
    expect(migratedItem()).toEqual({ value: 'legacy-token', accessible: mockAFU });
  });

  it('leaves a readable copy when the legacy delete fails', async () => {
    seedLegacyInstall();
    secureStore.deleteItemAsync.mockRejectedValueOnce(new MockKeyChainError());

    await readSecure(KEY);
    await settle();

    expect(migratedItem()?.accessible).toBe(mockAFU);
    // Both exist; the migrated one wins on read, so this is litter, not a fault.
    await expect(readSecure(KEY)).resolves.toBe('legacy-token');
  });

  it('prefers the migrated copy when both exist and they disagree', async () => {
    seedLegacyInstall('stale-token');
    mockStore.set(mockId(AFU_SERVICE, KEY), { value: 'current-token', accessible: mockAFU });
    await expect(readSecure(KEY)).resolves.toBe('current-token');
  });
});

describe('writes and erases', () => {
  it('a fresh sign-in writes AFTER_FIRST_UNLOCK with no migration needed', async () => {
    await writeSecure(KEY, 'new-session');
    expect(migratedItem()).toEqual({ value: 'new-session', accessible: mockAFU });
    expect(legacyItem()).toBeUndefined();
  });

  it('a write retires a legacy copy so no stale refresh token lingers', async () => {
    seedLegacyInstall('stale-token');
    await writeSecure(KEY, 'rotated-token');
    await settle();
    expect(legacyItem()).toBeUndefined();
  });

  it('a write still throws, so a failed token persist is never silent', async () => {
    // Deliberate: silently failing to persist a rotated refresh token is what
    // produces the token-family revocation in lib/authFresh.ts.
    secureStore.setItemAsync.mockRejectedValueOnce(new MockKeyChainError());
    await expect(writeSecure(KEY, 'v')).rejects.toThrow(/User interaction is not allowed/);
  });

  it('an erase removes BOTH copies', async () => {
    seedLegacyInstall();
    mockStore.set(mockId(AFU_SERVICE, KEY), { value: 'migrated', accessible: mockAFU });

    await removeSecure(KEY);

    expect(migratedItem()).toBeUndefined();
    expect(legacyItem()).toBeUndefined();
    await expect(readSecure(KEY)).resolves.toBeNull();
  });

  it('an erase that does not land reports failure', async () => {
    secureStore.deleteItemAsync.mockRejectedValueOnce(new MockKeyChainError());
    await expect(removeSecure(KEY)).rejects.toThrow(/User interaction is not allowed/);
  });
});
