// Which languages the SERVER may send in — pushes and emails. Separate from the
// app's list (shared/i18n/index.ts APP_LANGUAGES) because server copy can lag
// the app: a language joins this list only once every push and email in it is
// translated and reviewed by a native speaker. __tests__/serverI18n.test.ts
// fails if a live language misses a string, or a draft is listed as live.
//
// profiles.language stores what the person READS (it can be a draft, or a
// language POWR has never heard of); serverLanguage() turns that into what we
// can actually send.

/** Languages pushes and emails go out in. */
export const SERVER_LANGUAGES: readonly string[] = ["en", "fr", "es"];

/** Translated but not yet sent to anyone — previewable in email-previews. */
export const SERVER_DRAFT_LANGUAGES: readonly string[] = [];

/** The language to send to someone whose profiles.language is `preferred`. */
export function serverLanguage(preferred: string | null | undefined): string {
  return preferred && SERVER_LANGUAGES.includes(preferred) ? preferred : "en";
}

/** For previews only: drafts allowed, anything else falls back to English. */
export function previewLanguage(asked: string | null | undefined): string {
  return asked && (SERVER_LANGUAGES.includes(asked) || SERVER_DRAFT_LANGUAGES.includes(asked)) ? asked : "en";
}

// ── Gym and brand emails ────────────────────────────────────────────────────
// What POWR sends to the people who run a gym or a brand (the Monday recap,
// drift digest, event mails, invites, the brand weekly report …). These switch
// on together with the portals (shared/i18n/index.ts PORTAL_LANGUAGES), never
// before: a gym reading French in its inbox should find French in its portal.
// __tests__/serverI18n.test.ts holds the two lists equal.

/** Languages the gym and brand emails go out in. */
export const BUSINESS_LANGUAGES: readonly string[] = ["en"];

/** Translated but not yet sent — previewable in email-previews (?lang=). */
export const BUSINESS_DRAFT_LANGUAGES: readonly string[] = ["fr", "es"];

/** The language to send a gym or brand email in, for a reader of `preferred`. */
export function businessLanguage(preferred: string | null | undefined): string {
  return preferred && BUSINESS_LANGUAGES.includes(preferred) ? preferred : "en";
}

/** For previews only: drafts allowed, anything else falls back to English. */
export function businessPreviewLanguage(asked: string | null | undefined): string {
  return asked && (BUSINESS_LANGUAGES.includes(asked) || BUSINESS_DRAFT_LANGUAGES.includes(asked)) ? asked : "en";
}
