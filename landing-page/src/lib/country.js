// Rendering for profiles.country_code — an ISO 3166-1 alpha-2 code the app
// derives rather than asks for (migration 20260822090000_user_country).
//
// No country-name table lives here on purpose: Intl.DisplayNames ships with
// every browser the portal supports and stays correct as names change, which a
// hand-maintained list would not.

const displayNames = (() => {
    try {
        return new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
        return null;
    }
})();

/** "United Kingdom" for "GB". Falls back to the code itself, never to blank. */
export function countryName(code) {
    if (!code) return null;
    try {
        return displayNames?.of(code) || code;
    } catch {
        return code; // a code Intl doesn't recognise (or a malformed one)
    }
}

/**
 * 🇬🇧 for "GB", via regional-indicator symbols. Returns '' rather than a
 * tofu box when the code isn't two ASCII letters.
 */
export function countryFlag(code) {
    if (!/^[A-Za-z]{2}$/.test(code || '')) return '';
    return String.fromCodePoint(
        ...code.toUpperCase().split('').map(c => 0x1f1e6 + c.charCodeAt(0) - 65),
    );
}

// How we came to believe it. Shown wherever the country is, because a phone's
// timezone is a weaker claim than a coordinate and staff should be able to see
// which one they're acting on.
export const COUNTRY_SOURCE_META = {
    gps: {
        label: 'GPS',
        title: 'Reverse-geocoded from a real location fix — where the phone actually was.',
    },
    timezone: {
        label: 'Timezone',
        title: "Derived from the device's IANA timezone. Right for almost everyone, but it's the phone's clock setting, not its position — a traveller who never changed it reads as home.",
    },
};

/** Sorted [code, count] pairs for a filter dropdown, most members first. */
export function countryCounts(users) {
    const counts = new Map();
    for (const u of users) {
        if (!u.country_code) continue;
        counts.set(u.country_code, (counts.get(u.country_code) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
