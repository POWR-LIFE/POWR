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

    // Empty host → root
    if (!host) return '/';

    // powr://whoop-callback?code=X → /whoop-callback?code=X
    return `/${host}${rest}`;
  }

  return value;
};


