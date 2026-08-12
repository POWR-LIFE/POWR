/**
 * Two guards for one crash.
 *
 * On 2026-08-07 the crash capture named a fatal that six native crash reports
 * never could: an `Invariant Violation: 'new NativeEventEmitter()' requires a
 * non-null argument`, thrown from `await import('react-native')` in
 * flushBreadcrumbs(). Metro compiles a dynamic import() to asyncRequire ->
 * importAll, and importAll copies every property off the module — firing React
 * Native's deprecated PushNotificationIOS getter, whose module scope builds a
 * NativeEventEmitter from a native module that is not in an Expo build.
 *
 * The breadcrumb that made flushBreadcrumbs run in the first place was written
 * because the auth token could not be read while the phone was locked. So the
 * crash needed BOTH bugs; these tests hold both of them shut.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');

/** Comment lines are prose, not code — and the warning comment in authFresh.ts
 *  quotes the very pattern this scans for. Only strips whole comment lines, so
 *  a real dynamic import can never be hidden by it. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*');
    })
    .join('\n');
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('react-native is never imported dynamically', () => {
  it('has no `import("react-native")` anywhere in the app source', () => {
    // The whole crash in one line. A named static import costs nothing and
    // cannot trigger the getters, so there is never a reason to write this.
    const offenders: string[] = [];
    for (const dir of ['app', 'lib', 'components', 'context', 'hooks']) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const source = codeOnly(readFileSync(file, 'utf8'));
        if (/import\s*\(\s*['"`]react-native['"`]\s*\)/.test(source)) {
          offenders.push(file.replace(`${ROOT}/`, ''));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reads Platform in authFresh from a static import', () => {
    const source = readFileSync(join(ROOT, 'lib/authFresh.ts'), 'utf8');
    expect(source).toMatch(/^import \{ (?:[A-Za-z]+, )*Platform(?:, [A-Za-z]+)* \} from 'react-native';$/m);
  });
});

describe('the auth token stays readable in the background', () => {
  it('writes the keychain item as AFTER_FIRST_UNLOCK', () => {
    // The default, WHEN_UNLOCKED, makes every locked-device background wake
    // fail with errSecInteractionNotAllowed — no check-in, no claim, and a
    // breadcrumb that arms the crash above on the next app open.
    const source = readFileSync(join(ROOT, 'lib/supabase.ts'), 'utf8');
    expect(source).toMatch(/keychainAccessible:\s*SecureStore\.AFTER_FIRST_UNLOCK/);
  });

  it('passes the accessibility option on every keychain call', () => {
    const source = readFileSync(join(ROOT, 'lib/supabase.ts'), 'utf8');
    for (const call of ['getItemAsync', 'setItemAsync', 'deleteItemAsync']) {
      const match = source.match(new RegExp(`SecureStore\\.${call}\\([^)]*\\)`, 'g')) ?? [];
      expect(match.length).toBeGreaterThan(0);
      for (const site of match) expect(site).toContain('KEYCHAIN');
    }
  });

  it('rewrites an existing token so devices already signed in are healed', () => {
    // iOS applies the accessibility attribute at WRITE time, so the option
    // alone would fix new sign-ins only and leave every current install
    // permanently broken in the background.
    const source = readFileSync(join(ROOT, 'lib/supabase.ts'), 'utf8');
    expect(source).toMatch(/accessibilityUpgraded/);
    expect(source).toMatch(/void SecureStore\.setItemAsync\(key, value, KEYCHAIN\)/);
  });
});

describe('the session-erase gate (2026-08-12)', () => {
  // auth-js reaches removeItem from seven internal failure paths — any refresh
  // that fails non-retryably (400 invalid_grant / "Already Used" / 401) wipes
  // the keychain and signs the user out with zero user action. Field
  // 2026-08-12: two complete iOS credential re-entries in one afternoon. The
  // gate makes the ONLY session-destroying operation require explicit intent.
  const supabaseSrc = readFileSync(join(ROOT, 'lib/supabase.ts'), 'utf8');
  const authCtxSrc = readFileSync(join(ROOT, 'context/AuthContext.tsx'), 'utf8');

  it('removeItem refuses to erase the auth session without authorization', () => {
    expect(supabaseSrc).toMatch(/key === AUTH_STORAGE_KEY && !consumeSessionEraseAuthorization\(\)/);
    expect(supabaseSrc).toMatch(/export function authorizeSessionErase/);
  });

  it('the authorization is single-shot and time-boxed', () => {
    expect(supabaseSrc).toMatch(/_sessionEraseAuthorizedAt = 0;\s*\n\s*return ok;/);
    expect(supabaseSrc).toMatch(/SESSION_ERASE_WINDOW_MS = 30 \* 1000/);
  });

  it('every deliberate sign-out path authorizes its erase', () => {
    // user signOut, session kicker, device lock, transfer-failed, transfer-cancelled
    const count = (authCtxSrc.match(/authorizeSessionErase\(\)/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(5);
  });

  it('SIGNED_OUT restores from a surviving stored session instead of tearing down', () => {
    expect(authCtxSrc).toMatch(/userInitiated = forcedSignOutRef.current \|\| deviceLockedRef.current \|\| userSignOutRef.current/);
    expect(authCtxSrc).toMatch(/synthetic sign-out, restoring/);
  });

  it('the session kicker never fires without knowing its own session id', () => {
    expect(authCtxSrc).toMatch(/incomingId && currentSessionIdRef.current && incomingId !== currentSessionIdRef.current/);
  });
});
