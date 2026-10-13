/**
 * Pure helpers for the onboarding activities step. Free of React/Supabase so
 * the pre-selection rule can be unit-tested directly.
 *
 * Since 2026-08-28 the step runs AFTER the wearables step, so a user who just
 * connected a watch already has their Terra 7-day backfill landing as
 * activity_sessions rows. Those rows are the best guess at what this person
 * actually does — better than any default — so they pre-tick the picker.
 */

import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import {
    CATALOG_BY_SLUG,
    genericEntryForBucket,
    selectionLabel,
    toSelection,
    type ActivitySelection,
} from '@/constants/activityCatalog';
import i18n from '@/lib/i18n';

/** Gym starts ticked for everyone (opt-out, not opt-in — Jamie's call). */
export const DEFAULT_SELECTIONS: ActivitySelection[] = [toSelection(CATALOG_BY_SLUG.gym)];

/** Distinct session types → count, from raw session rows. Sleep/unknown dropped. */
export function countObservedTypes(rows: ReadonlyArray<{ type?: string | null }> | null | undefined): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const r of rows ?? []) {
        const t = r?.type;
        if (!t || !(t in ACTIVITIES) || ACTIVITIES[t as ActivityType].hideFromPicker) continue;
        counts[t] = (counts[t] ?? 0) + 1;
    }
    return counts;
}

/**
 * Pre-selection: the observed buckets first (most sessions first, stable on
 * ties by ACTIVITY order), then the defaults fill any free slot, capped at
 * `max`. With nothing observed this is exactly the defaults.
 */
export function preselectFromObserved(
    observed: Record<string, number>,
    opts: { defaults?: ActivitySelection[]; max: number },
): ActivitySelection[] {
    const defaults = opts.defaults ?? DEFAULT_SELECTIONS;
    const out: ActivitySelection[] = [];
    const seen = new Set<string>();
    const push = (s: ActivitySelection | null) => {
        if (!s || seen.has(s.bucket) || out.length >= opts.max) return;
        seen.add(s.bucket);
        out.push(s);
    };
    const order = Object.keys(ACTIVITIES);
    const observedBuckets = Object.entries(observed)
        .filter(([, n]) => n > 0)
        .sort((a, b) => (b[1] - a[1]) || (order.indexOf(a[0]) - order.indexOf(b[0])))
        .map(([t]) => t as ActivityType);
    for (const b of observedBuckets) {
        const entry = genericEntryForBucket(b);
        push(entry ? toSelection(entry) : null);
    }
    for (const d of defaults) push(d);
    return out;
}

/**
 * "running and cycling" / "running, cycling and swimming" for the subhead, in
 * the language on screen. Hermes has no Intl.ListFormat, so the joiners come
 * from the catalog (activities:list.*).
 */
export function observedLabelList(selections: ActivitySelection[], observed: Record<string, number>): string {
    const labels = selections.filter(s => (observed[s.bucket] ?? 0) > 0).map(s => selectionLabel(s).toLowerCase());
    if (labels.length === 0) return '';
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return i18n.t('activities:list.pair', { first: labels[0], second: labels[1] });
    return i18n.t('activities:list.last', {
        rest: labels.slice(0, -1).join(i18n.t('activities:list.separator')),
        last: labels[labels.length - 1],
    });
}

/**
 * How many activities observedLabelList names — the count its subhead plural
 * should use (it/them, lo/los). Testing that list for " and " only works in
 * English.
 */
export function observedPickCount(selections: ActivitySelection[], observed: Record<string, number>): number {
    return selections.filter(s => (observed[s.bucket] ?? 0) > 0).length;
}
