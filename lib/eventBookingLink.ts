import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

import { markEventBookingOpened } from '@/lib/api/liveEvents';

/**
 * The venue booking URL an event hands off to (live_events.booking_url).
 *
 * The URL is admin-authored and may carry {email} / {name} placeholders so
 * the third-party form can prefill — whether that works depends entirely on
 * the booking platform, so substitution is best-effort: a URL with no
 * placeholders passes through untouched, and a missing value substitutes to
 * an empty string rather than leaking the literal brace token to the venue.
 */
export function eventBookingUrl(
    raw: string,
    viewer: { email?: string | null; name?: string | null },
): string {
    return raw
        .split('{email}').join(encodeURIComponent(viewer.email ?? ''))
        .split('{name}').join(encodeURIComponent(viewer.name ?? ''));
}

/**
 * The one way any surface opens the booking site: stamp the funnel fact
 * (fire-and-forget — never between the user and the page), substitute the
 * prefill placeholders, then present the in-app browser sheet so dismissing
 * it lands back where they were. Falls back to a plain open if presenting
 * from inside an RN Modal misbehaves on some OS/browser combination.
 */
export function openEventBooking(
    event: { id: string; booking_url?: string | null },
    viewer: { email?: string | null; name?: string | null },
): void {
    if (!event.booking_url) return;
    void markEventBookingOpened(event.id);
    const url = eventBookingUrl(event.booking_url, viewer);
    WebBrowser.openBrowserAsync(url).catch(() => {
        Linking.openURL(url).catch(() => {});
    });
}
