/**
 * Personalises the Together starter templates (shared_challenge_templates)
 * the way the weekly board already is: only categories relevant to the user
 * (declared picks ∪ recent sessions, see _shared/activityRelevance.ts) plus
 * the category-agnostic 'multi' ones. A walk/run-only user no longer sees
 * "Check in 4×" gym templates on Home.
 *
 * Fail open: if filtering would leave nothing (unknown categories, legacy
 * prefs), return the full list — an empty Together strip is worse than a
 * generic one.
 */
export function filterTemplatesByRelevance<T extends { category: string }>(
    templates: T[],
    relevant: readonly string[],
): T[] {
    const keep = new Set<string>(['multi', ...relevant]);
    const filtered = templates.filter(t => keep.has(t.category));
    return filtered.length > 0 ? filtered : templates;
}
