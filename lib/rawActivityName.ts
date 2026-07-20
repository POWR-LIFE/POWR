import { ACTIVITIES, type ActivityType } from '@/constants/activities';

// Raw names that add nothing over the bucket label. Whoop sends its
// unspecified workout as "Activity"; Health Connect unknowns arrive as
// "exercise_<int>"; native HK unknowns fall back to "other".
const UNINFORMATIVE = new Set(['other', 'unknown', 'activity', 'workout', 'exercise', 'not available']);

// Tokens that must keep their casing after title-casing snake_case input.
const ACRONYMS: Record<string, string> = { hiit: 'HIIT', mma: 'MMA', p90x: 'P90X' };

/**
 * Formats a provider-reported raw activity name for display next to its POWR
 * bucket label ("Gym · Strength Training"). Returns null when the raw name
 * would not tell the user anything the bucket label doesn't already say.
 */
export function formatRawActivityName(
    raw: string | null | undefined,
    bucketType: string,
): string | null {
    if (!raw) return null;
    const cleaned = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned) return null;

    const lower = cleaned.toLowerCase();
    if (UNINFORMATIVE.has(lower)) return null;
    if (/^exercise \d+$/.test(lower)) return null;

    const bucketLabel = (ACTIVITIES[bucketType as ActivityType]?.label ?? bucketType).toLowerCase();
    if (lower === bucketType.toLowerCase() || lower === bucketLabel) return null;

    // Terra names arrive pre-formatted ("Padel Tennis") — title-casing is a
    // no-op there; it exists for snake_case Health Connect values ("boot camp").
    return lower
        .split(' ')
        .map(w => ACRONYMS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}
