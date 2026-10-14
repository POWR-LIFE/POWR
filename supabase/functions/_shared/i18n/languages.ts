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
