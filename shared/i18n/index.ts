/**
 * Which languages each surface may actually show, and how a detected language
 * resolves to one of them. Catalogs live beside this file
 * (shared/i18n/<language>/<namespace>.json) so the app and the portals are
 * translated from one place.
 *
 * ⚠ A language joins a surface's list only when BOTH hold — a half-translated
 * portal is worse than English throughout:
 *   1. every page of that surface renders through keys (today only the portal
 *      shells and the gym sign-in do; the pages inside are still hard-coded
 *      English, so Spanish must stay a draft whatever its catalog covers), and
 *   2. its catalog covers every English key — __tests__/portalI18n.test.ts
 *      fails if a switched-on language misses one, or a draft is switched on.
 */

import { FALLBACK_LANGUAGE } from '../locale';

/** Languages the reward and gym portals show. Spanish is drafted, not yet complete. */
export const PORTAL_LANGUAGES: readonly string[] = ['en'];

/** Languages with a catalog, shown only to translators via ?lang= until they're listed above. */
export const DRAFT_LANGUAGES: readonly string[] = ['es'];

/** The language to render for someone who prefers `preferred`. */
export function resolveLanguage(preferred: string | null | undefined, supported: readonly string[]): string {
  return preferred && supported.includes(preferred) ? preferred : FALLBACK_LANGUAGE;
}
