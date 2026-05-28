import { getRouteFromNotification } from '@/lib/notifications';

// Builds the minimal NotificationResponse shape that getRouteFromNotification reads.
function responseWithRoute(route: unknown) {
  return {
    notification: {
      request: { content: { data: route === undefined ? {} : { route } } },
    },
  } as any;
}

describe('getRouteFromNotification', () => {
  it('returns plain in-app route paths unchanged', () => {
    expect(getRouteFromNotification(responseWithRoute('/(tabs)/rewards'))).toBe('/(tabs)/rewards');
    expect(
      getRouteFromNotification(responseWithRoute('/share-stats?mode=check-in&sessionId=abc')),
    ).toBe('/share-stats?mode=check-in&sessionId=abc');
  });

  // Regression: powr:// links were parsed with new URL(), which throws in Hermes.
  // These must resolve to a path, never fall through to home.
  describe('powr:// deep links', () => {
    it('maps host-only links to a path', () => {
      expect(getRouteFromNotification(responseWithRoute('powr://rewards'))).toBe('/rewards');
    });

    it('preserves a query string', () => {
      expect(getRouteFromNotification(responseWithRoute('powr://share-stats?sessionId=abc'))).toBe(
        '/share-stats?sessionId=abc',
      );
    });

    it('preserves a sub-path and query', () => {
      expect(getRouteFromNotification(responseWithRoute('powr://gym/check-in?id=42'))).toBe(
        '/gym/check-in?id=42',
      );
    });

    it('treats a bare scheme as root', () => {
      expect(getRouteFromNotification(responseWithRoute('powr://'))).toBe('/');
      expect(getRouteFromNotification(responseWithRoute('powr:///'))).toBe('/');
    });
  });

  it('returns null when there is no usable route', () => {
    expect(getRouteFromNotification(responseWithRoute(undefined))).toBeNull();
    expect(getRouteFromNotification(responseWithRoute(''))).toBeNull();
    expect(getRouteFromNotification(responseWithRoute('   '))).toBeNull();
    expect(getRouteFromNotification(responseWithRoute('https://example.com'))).toBeNull();
    expect(getRouteFromNotification(responseWithRoute(42))).toBeNull();
  });
});
