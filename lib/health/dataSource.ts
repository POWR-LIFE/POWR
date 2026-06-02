/**
 * Provenance classifier for native health data (Apple HealthKit / Health Connect).
 *
 * Both native stores attach the writing app + originating device to every sample.
 * This module inspects that metadata to decide whether a sample came from a worn
 * device (watch / band / ring / chest strap) or from the phone's own sensors, so
 * synced sessions can be stamped 'wearable' vs 'health' accurately.
 *
 * It's the middle ground between treating all native data as phone health and
 * building a per-vendor OAuth integration: no extra auth, just metadata we already
 * have access to. The result is used mainly for the admin overview of who is on a
 * wearable vs phone-only — it is not surfaced prominently in the user-facing UI.
 *
 * Caveats:
 *  - This identifies the WRITING APP / DEVICE, not verified content. The OS
 *    guarantees the app id / package name is genuine (an app can't impersonate
 *    another's identifier), so "who wrote it" is trustworthy — but the values
 *    themselves aren't. For tamper-resistance use the direct OAuth providers
 *    (Fitbit / Whoop / Garmin); see `verificationForProvider` in providers/index.
 *  - The allowlists are best-effort and will need new entries as devices appear.
 *    Anything unrecognised defaults to 'phone' so we never over-claim "wearable".
 */

export type IOSProvenance = {
    platform: 'ios';
    /** Writing app bundle id, e.g. 'com.apple.health', 'com.garmin.connect.mobile'. */
    sourceBundleId?: string;
    /** Writing app display name, e.g. 'Garmin Connect'. */
    sourceName?: string;
    /** HKDevice fields — present when the sample names its originating hardware. */
    deviceName?: string;        // e.g. "Apple Watch"
    deviceModel?: string;       // e.g. "Watch"
    deviceHardware?: string;    // e.g. "Watch6,2"
    deviceManufacturer?: string;
};

export type AndroidProvenance = {
    platform: 'android';
    /** Health Connect dataOrigin package, e.g. 'com.sec.android.app.shealth'. */
    dataOrigin?: string;
    /** Health Connect Metadata.device.type enum (see WEARABLE_HC_DEVICE_TYPES). */
    deviceType?: number;
};

export type HealthDataProvenance = IOSProvenance | AndroidProvenance;

export type SourceClass = 'wearable' | 'phone';

/**
 * Substrings that unambiguously identify a dedicated wearable brand, matched
 * against the lowercased app id / name (iOS) or package (Android). Deliberately
 * excludes 'samsung'/'shealth', 'apple', and 'google' — those aggregators report
 * phone *and* watch data, so we rely on the per-sample device field to tell them
 * apart, not the writing app.
 */
const WEARABLE_VENDOR_TOKENS = [
    'garmin', 'fitbit', 'whoop', 'oura', 'polar', 'wahoo',
    'coros', 'suunto', 'huami', 'zepp', 'amazfit', 'withings',
] as const;

/**
 * Health Connect Metadata.Device.type values that denote a worn device.
 * From the Health Connect SDK: 1=WATCH, 4=RING, 5=HEAD_MOUNTED, 6=FITNESS_BAND,
 * 7=CHEST_STRAP. (2=PHONE, 3=SCALE, 8=SMART_DISPLAY are not worn.) Note: WATCH=1
 * isn't in the bundled enum but is a valid runtime value, so we match it directly.
 */
const WEARABLE_HC_DEVICE_TYPES = new Set<number>([1, 4, 5, 6, 7]);

function matchesWearableVendor(...haystacks: (string | undefined)[]): boolean {
    const hay = haystacks.filter(Boolean).join(' ').toLowerCase();
    if (!hay) return false;
    return WEARABLE_VENDOR_TOKENS.some(token => hay.includes(token));
}

function classifyIOS(p: IOSProvenance): SourceClass {
    // 1. A named Apple worn device (Apple Watch) — the discriminator within the
    //    Apple ecosystem, since both iPhone and Watch write under com.apple.health.
    const hw = (p.deviceHardware ?? '').toLowerCase();
    const model = (p.deviceModel ?? '').toLowerCase();
    const dname = (p.deviceName ?? '').toLowerCase();
    if (hw.startsWith('watch') || model === 'watch' || dname.includes('watch')) {
        return 'wearable';
    }
    // 2. A third-party wearable companion app wrote the sample.
    if (matchesWearableVendor(p.sourceBundleId, p.sourceName)) return 'wearable';
    return 'phone';
}

function classifyAndroid(p: AndroidProvenance): SourceClass {
    // 1. Device type explicitly names a worn form factor (covers Galaxy Watch etc.).
    if (p.deviceType !== undefined && WEARABLE_HC_DEVICE_TYPES.has(p.deviceType)) {
        return 'wearable';
    }
    // 2. The writing package belongs to a dedicated wearable brand.
    if (matchesWearableVendor(p.dataOrigin)) return 'wearable';
    return 'phone';
}

/** Classify a single sample's provenance as wearable- or phone-sourced. */
export function classifyProvenance(p: HealthDataProvenance): SourceClass {
    return p.platform === 'ios' ? classifyIOS(p) : classifyAndroid(p);
}

/**
 * Map provenance to the `verification` enum used on activity_sessions. Returns the
 * provided `fallback` when there's no provenance to inspect (e.g. an OAuth provider
 * supplied the data, or the native sample carried no source metadata).
 */
export function verificationFromProvenance(
    p: HealthDataProvenance | undefined,
    fallback: 'wearable' | 'health',
): 'wearable' | 'health' {
    if (!p) return fallback;
    return classifyProvenance(p) === 'wearable' ? 'wearable' : 'health';
}

/**
 * Aggregate verdict across many samples (e.g. a day's worth of step records that
 * may mix iPhone + Apple Watch). If *any* sample came from a wearable we treat the
 * session as wearable-backed — owning a wearable is the signal we care about.
 */
export function verificationFromProvenances(
    ps: HealthDataProvenance[],
    fallback: 'wearable' | 'health',
): 'wearable' | 'health' {
    if (ps.length === 0) return fallback;
    return ps.some(p => classifyProvenance(p) === 'wearable') ? 'wearable' : 'health';
}

/** Health Connect device-type → readable form factor (worn types only). */
const HC_DEVICE_TYPE_LABEL: Record<number, string> = {
    1: 'Watch', 4: 'Ring', 5: 'Head-mounted', 6: 'Fitness band', 7: 'Chest strap',
};

function vendorToken(...haystacks: (string | undefined)[]): string | undefined {
    const hay = haystacks.filter(Boolean).join(' ').toLowerCase();
    return hay ? WEARABLE_VENDOR_TOKENS.find(t => hay.includes(t)) : undefined;
}

function titleCase(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Normalized, non-PII source label for the admin device overview — e.g.
 * "Apple Watch", "Garmin", "Fitness band", "iPhone", "Phone". Deliberately avoids
 * user-set device names (a source like "Jamie's iPhone" collapses to "iPhone").
 */
export function sourceLabel(p: HealthDataProvenance): string {
    if (p.platform === 'ios') {
        if (classifyIOS(p) === 'wearable') {
            // device.name is the generic model ("Apple Watch"), not user-named.
            if (p.deviceName) return p.deviceName;
            const v = vendorToken(p.sourceBundleId, p.sourceName);
            return v ? titleCase(v) : 'Wearable';
        }
        return 'iPhone';
    }
    if (classifyAndroid(p) === 'wearable') {
        const v = vendorToken(p.dataOrigin);
        if (v) return titleCase(v);
        if (p.deviceType !== undefined && HC_DEVICE_TYPE_LABEL[p.deviceType]) {
            return HC_DEVICE_TYPE_LABEL[p.deviceType];
        }
        return 'Wearable';
    }
    return 'Phone';
}

/**
 * Distinct, comma-joined source labels for a set of samples (e.g. a day's steps
 * from iPhone + Apple Watch → "iPhone, Apple Watch"). Returns undefined when there
 * are no samples to label.
 */
export function summarizeSources(ps: HealthDataProvenance[]): string | undefined {
    if (ps.length === 0) return undefined;
    const labels = [...new Set(ps.map(sourceLabel))];
    return labels.length > 0 ? labels.join(', ') : undefined;
}
