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
 * The text lives in the health catalog (health:viaPhoneSteps) and is resolved
 * when the sheet asks for it, so it follows the language on screen. A path's
 * French or Spanish should mirror what the brand's app shows in that language.
 *
 * Pure — tested in __tests__/viaPhone.test.ts.
 */

import i18n from '@/lib/i18n';

export type ViaPhonePlatform = 'ios' | 'android' | 'web';

export type ViaPhoneCopy = {
    title: string;
    body: string;
    /** Null when the brand can't share into this platform's store at all. */
    step2: { title: string; desc: string } | null;
    /** One extra line under the steps, when the brand needs it. */
    note: string | null;
};

/** Catalog keys, not text. */
type BrandPaths = {
    /** How the brand's app is named in a sentence ("Garmin Connect", "the WHOOP app"). */
    app?: string;
    ios?: string | null;
    android?: string | null;
    note?: string;
};

const BRANDS: Record<string, BrandPaths> = {
    garmin: {
        app: 'health:viaPhoneSteps.brands.garmin.app',
        ios: 'health:viaPhoneSteps.brands.garmin.ios',
        android: 'health:viaPhoneSteps.brands.garmin.android',
        note: 'health:viaPhoneSteps.brands.garmin.note',
    },
    whoop: {
        app: 'health:viaPhoneSteps.brands.whoop.app',
        ios: 'health:viaPhoneSteps.brands.whoop.ios',
        android: 'health:viaPhoneSteps.brands.whoop.android',
    },
    oura: {
        app: 'health:viaPhoneSteps.brands.oura.app',
        ios: 'health:viaPhoneSteps.brands.oura.ios',
        android: 'health:viaPhoneSteps.brands.oura.android',
    },
    polar: {
        app: 'health:viaPhoneSteps.brands.polar.app',
        ios: 'health:viaPhoneSteps.brands.polar.ios',
        android: 'health:viaPhoneSteps.brands.polar.android',
    },
    strava: {
        app: 'health:viaPhoneSteps.brands.strava.app',
        ios: 'health:viaPhoneSteps.brands.strava.ios',
        android: 'health:viaPhoneSteps.brands.strava.android',
    },
    zepp: {
        app: 'health:viaPhoneSteps.brands.zepp.app',
        ios: 'health:viaPhoneSteps.brands.zepp.ios',
        android: 'health:viaPhoneSteps.brands.zepp.android',
    },
    fitbit: {
        app: 'health:viaPhoneSteps.brands.fitbit.app',
        // Fitbit has never written to Apple Health.
        ios: null,
        android: 'health:viaPhoneSteps.brands.fitbit.android',
    },
};

export function viaPhoneCopy(providerId: string, brand: string, platform: ViaPhonePlatform): ViaPhoneCopy {
    const paths = BRANDS[providerId] ?? {};
    const app = paths.app ? i18n.t(paths.app) : i18n.t('health:viaPhoneSteps.genericApp', { brand });
    const store = platform === 'android'
        ? i18n.t('health:viaPhoneSteps.store.healthConnect')
        : i18n.t('health:viaPhoneSteps.store.appleHealth');

    if (platform === 'web') {
        return {
            title: i18n.t('health:viaPhoneSteps.web.title', { brand }),
            body: i18n.t('health:viaPhoneSteps.web.body', { brand }),
            step2: null,
            note: null,
        };
    }

    const path = platform === 'android' ? paths.android : paths.ios;
    if (path === null) {
        // The brand can't share into this store — say so, and still offer the
        // phone's own steps rather than a dead end.
        return {
            title: platform === 'ios'
                ? i18n.t('health:viaPhoneSteps.unsupported.titleIos', { brand })
                : i18n.t('health:viaPhoneSteps.unsupported.titleAndroid', { brand }),
            body: i18n.t('health:viaPhoneSteps.unsupported.body', { brand, store }),
            step2: null,
            note: null,
        };
    }

    return {
        title: i18n.t('health:viaPhoneSteps.title', { brand, store }),
        body: i18n.t('health:viaPhoneSteps.body', { brand, app, store }),
        step2: {
            title: i18n.t('health:viaPhoneSteps.step2Title', { app }),
            desc: path ? i18n.t(path) : i18n.t('health:viaPhoneSteps.step2Generic', { app, store }),
        },
        note: paths.note ? i18n.t(paths.note) : null,
    };
}
