/**
 * Words for the "sync through your phone" sheet (components/ViaPhoneSheet),
 * shown when someone taps a wearable whose direct link is paused: Garmin
 * since 2026-09-21, and every Terra brand while the Terra pause switch is on.
 *
 * Step 1 is always "connect Apple Health / Health Connect"; step 2 is the one
 * setting in the brand's own app that shares into it. The paths below were
 * checked against each brand's help pages in October 2026 — menus move
 * between app versions, so re-check on a device when a brand redesigns. A
 * brand without a known path gets a generic one rather than a wrong one.
 *
 * Pure — tested in __tests__/viaPhone.test.ts.
 */

export type ViaPhonePlatform = 'ios' | 'android' | 'web';

export type ViaPhoneCopy = {
    title: string;
    body: string;
    /** Null when the brand can't share into this platform's store at all. */
    step2: { title: string; desc: string } | null;
    /** One extra line under the steps, when the brand needs it. */
    note: string | null;
};

type BrandPaths = {
    /** How the brand's app is named in a sentence ("Garmin Connect", "the WHOOP app"). */
    app?: string;
    ios?: string | null;
    android?: string | null;
    note?: string;
};

const BRANDS: Record<string, BrandPaths> = {
    garmin: {
        app: 'Garmin Connect',
        ios: 'Garmin Connect → More → Settings → Connected Apps → Apple Health, then allow everything',
        android: 'Garmin Connect → Settings → Health Connect, then allow everything',
        note: 'Open Garmin Connect once a day — it only shares while it’s open.',
    },
    whoop: {
        app: 'the WHOOP app',
        ios: 'WHOOP → More → App Settings → Integrations → Apple Health → Connect, then allow everything',
        android: 'WHOOP → More → App Settings → Integrations → Health Connect, then allow everything',
    },
    oura: {
        app: 'the Oura app',
        ios: 'Oura → menu → Settings → Apple Health, then turn on Connect to Health',
        android: 'Oura → menu → Settings → Health Connect, then allow everything',
    },
    polar: {
        app: 'Polar Flow',
        ios: 'Polar Flow → More → General settings → Apple Health, then Turn All Categories On',
        android: 'Polar Flow → More → General settings → Health Connect, then allow everything',
    },
    strava: {
        app: 'Strava',
        ios: 'Strava → Settings → Applications, Services, and Devices → Health → Connect, and turn on Workouts',
        android: 'Strava → Settings → Applications, Services, and Devices → Health Connect',
    },
    zepp: {
        app: 'the Zepp app',
        ios: 'Zepp → Profile → Add accounts → Apple Health, then allow everything',
        android: 'Zepp → Profile → Link third-party accounts → Health Connect, then turn on sync',
    },
    fitbit: {
        app: 'the Fitbit app',
        // Fitbit has never written to Apple Health.
        ios: null,
        android: 'Fitbit → your profile → Settings → Health Connect → Sync with Health Connect',
    },
};

export function viaPhoneCopy(providerId: string, brand: string, platform: ViaPhonePlatform): ViaPhoneCopy {
    const paths = BRANDS[providerId] ?? {};
    const app = paths.app ?? `the ${brand} app`;
    const store = platform === 'android' ? 'Health Connect' : 'Apple Health';

    if (platform === 'web') {
        return {
            title: `${brand} syncs through your phone`,
            body: `Our direct ${brand} link is paused for now. Open POWR on your phone to connect Apple Health or Health Connect. Your ${brand} data reaches POWR from there.`,
            step2: null,
            note: null,
        };
    }

    const path = platform === 'android' ? paths.android : paths.ios;
    if (path === null) {
        // The brand can't share into this store — say so, and still offer the
        // phone's own steps rather than a dead end.
        return {
            title: `${brand} can’t sync to ${platform === 'ios' ? 'iPhone' : 'this phone'} right now`,
            body: `Our direct ${brand} link is paused, and ${brand} doesn’t share with ${store}. Until it’s back, POWR counts the steps your phone records — connect ${store} for those.`,
            step2: null,
            note: null,
        };
    }

    return {
        title: `${brand} syncs through ${store}`,
        body: `Our direct ${brand} link is paused for now. Your ${brand} still earns POWR: ${app} shares your workouts, steps and sleep with ${store}, and POWR reads them from there.`,
        step2: {
            title: `2. Turn on sharing in ${app}`,
            desc: path ?? `In ${app}, find its ${store} setting (usually under Settings → Connected apps) and allow everything`,
        },
        note: paths.note ?? null,
    };
}
