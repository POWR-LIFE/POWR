/**
 * @jest-environment jsdom
 *
 * Password-reset deep-link flow.
 *
 * The reset email points at the public smart-link page (https://powr.life/app
 * ?to=reset-password&code=<pkce>). Two hops have to carry that `code` all the
 * way to the in-app reset screen:
 *
 *   1. app.html (this page) turns the query into a powr://reset-password?code=…
 *      deep link (or an Android intent:// with the same payload).
 *   2. +native-intent's redirectSystemPath maps the launched URL onto the
 *      /reset-password route WITHOUT dropping the code — for both the powr://
 *      hop above and the case where the OS opens the https link directly
 *      (Universal / App Link).
 *
 * If either hop loses the code, reset-password.tsx can't exchange it and shows
 * "No recovery code found", so both are covered here end-to-end.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { redirectSystemPath } from '@/app/+native-intent';

const redirect = (path: string) => redirectSystemPath({ path, initial: true });

// ─── Hop 1: app.html builds the deep link ──────────────────────────────────────

const APP_HTML = readFileSync(
  join(__dirname, '../landing-page/public/app.html'),
  'utf8',
);
const SCRIPT = APP_HTML.match(/<script>([\s\S]*?)<\/script>/)![1];

/** Run app.html's inline script with a stubbed location + UA, return the URL it navigates to. */
function runSmartLink(search: string, userAgent: string): string {
  const replace = jest.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { search, replace, href: '', hash: '' },
  });
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  });
  // Elements the (deferred) store-fallback timeout touches — keep it from throwing.
  document.body.innerHTML =
    '<div id="spinner"></div><div id="title"></div>' +
    '<a id="ios-btn"></a><a id="android-btn"></a>';

  // eslint-disable-next-line no-new-func
  new Function(SCRIPT)();
  return replace.mock.calls[0][0] as string;
}

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36';

describe('app.html smart-link', () => {
  beforeEach(() => {
    jest.useFakeTimers(); // park the 1600ms store-fallback timeout; we never advance it
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('forwards the recovery code into the iOS deep link', () => {
    const url = runSmartLink('?to=reset-password&code=abc123', IOS_UA);
    expect(url).toBe('powr://reset-password?code=abc123');
  });

  it('forwards the recovery code into the Android intent URL', () => {
    const url = runSmartLink('?to=reset-password&code=abc123', ANDROID_UA);
    expect(url).toContain('intent://reset-password?code=abc123#Intent;scheme=powr');
    expect(url).toContain('package=com.powr.life');
  });

  it('still deep-links plain CTAs with no extra params', () => {
    expect(runSmartLink('?to=rewards', IOS_UA)).toBe('powr://rewards');
  });

  it('preserves params regardless of order in the incoming link', () => {
    expect(runSmartLink('?code=xyz789&to=reset-password', IOS_UA)).toBe(
      'powr://reset-password?code=xyz789',
    );
  });
});

// ─── Hop 2: redirectSystemPath delivers the code to the screen ──────────────────

describe('redirectSystemPath — reset-password routing', () => {
  it('maps the powr:// deep link to /reset-password with the code intact', () => {
    expect(redirect('powr://reset-password?code=abc123')).toBe(
      '/reset-password?code=abc123',
    );
  });

  it('maps a directly-opened https smart-link, forwarding the code past ?to=', () => {
    expect(redirect('https://powr.life/app?to=reset-password&code=abc123')).toBe(
      '/reset-password?code=abc123',
    );
  });

  it('forwards the code regardless of param order on the https link', () => {
    expect(redirect('https://powr.life/app?code=xyz789&to=reset-password')).toBe(
      '/reset-password?code=xyz789',
    );
  });

  it('surfaces an auth error (expired link) on the route for the screen to show', () => {
    expect(
      redirect('https://powr.life/app?to=reset-password&error=otp_expired'),
    ).toBe('/reset-password?error=otp_expired');
  });

  it('routes a bare reset link (no code) so the screen can show its error state', () => {
    expect(redirect('powr://reset-password')).toBe('/reset-password');
    expect(redirect('https://powr.life/app?to=reset-password')).toBe('/reset-password');
  });
});

// ─── End-to-end: the two hops compose without losing the code ───────────────────

describe('reset link end-to-end (app.html → redirectSystemPath)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('carries the code from the emailed page all the way to the in-app route', () => {
    const deepLink = runSmartLink('?to=reset-password&code=e2e-code', IOS_UA);
    expect(redirect(deepLink)).toBe('/reset-password?code=e2e-code');
  });
});
