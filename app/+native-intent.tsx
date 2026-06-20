import type { NativeIntent } from 'expo-router';

export const redirectSystemPath: NonNullable<NativeIntent['redirectSystemPath']> = ({ path }) => {
  const value = (path ?? '').trim();

  if (!value || value === '/') return '/';

  // Already a plain route path — pass straight through.
  if (value.startsWith('/')) return value;

  // Deep link: powr://host?query  or  powr://host/path?query
  if (value.startsWith('powr://')) {
    const withoutScheme = value.slice('powr://'.length);

    // Bare scheme (powr:// or powr:///) → root
    if (!withoutScheme || withoutScheme === '/') return '/';

    // Isolate the host segment (everything before the first '/' or '?')
    const queryIdx = withoutScheme.indexOf('?');
    const slashIdx = withoutScheme.indexOf('/');
    let hostEnd: number;
    if (slashIdx >= 0 && queryIdx >= 0) {
      hostEnd = Math.min(slashIdx, queryIdx);
    } else if (slashIdx >= 0) {
      hostEnd = slashIdx;
    } else if (queryIdx >= 0) {
      hostEnd = queryIdx;
    } else {
      hostEnd = withoutScheme.length;
    }

    const host = withoutScheme.slice(0, hostEnd);
    const rest = withoutScheme.slice(hostEnd); // '' | '?...' | '/path?...'

    // Empty host = bare powr:// scheme → root
    if (!host) return '/';

    // auth-callback carries the Google OAuth code — let Linking listener handle it, don't navigate.
    if (host === 'auth-callback') return '/';

    // powr://terra-callback?user_id=X → /terra-callback?user_id=X
    return `/${host}${rest}`;
  }

  // Universal Link (iOS) / App Link (Android): https://powr.life/app[/...][?to=...]
  // These open the app from email CTAs. Strip the scheme+host and the /app marker;
  // a ?to= param or a /app/<route> tail selects a screen, otherwise land on home.
  // (String-sliced, not new URL(): RN's URL is unreliable for our links.)
  if (value.startsWith('https://') || value.startsWith('http://')) {
    const afterScheme = value.slice(value.indexOf('://') + 3);
    const firstSlash = afterScheme.indexOf('/');
    const pathAndQuery = firstSlash >= 0 ? afterScheme.slice(firstSlash) : '/';
    const qIdx = pathAndQuery.indexOf('?');
    const pathname = qIdx >= 0 ? pathAndQuery.slice(0, qIdx) : pathAndQuery;
    const query = qIdx >= 0 ? pathAndQuery.slice(qIdx) : '';

    // ?to=<route> wins (matches the web smart-link's contract).
    const toMatch = query.match(/[?&]to=([^&]+)/);
    if (toMatch) {
      const to = decodeURIComponent(toMatch[1]).replace(/^\/+/, '');
      return to ? `/${to}` : '/';
    }

    // Drop the leading /app segment; whatever remains is the route (default home).
    const route = pathname.replace(/^\/app(?=\/|$)/, '');
    if (!route || route === '/') return '/';
    return route.startsWith('/') ? route : `/${route}`;
  }

  return value;
};


