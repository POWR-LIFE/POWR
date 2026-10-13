// Server-side translation: everything a push or an email needs to speak the
// recipient's language. Import from here, never from the catalogs directly.
//
//   const lang = serverLanguage(profile.language);      // 'en' unless live
//   tPush(lang, <key>, { name })   // key as in push/en.ts
//
// Every function that bundles this (send-push-notification, the member email
// senders, gym-visit-beacon …) must be REDEPLOYED after a catalog change: each
// edge function freezes its own copy of _shared at deploy time.

import emailEn from "./email/en.ts";
import emailEs from "./email/es.ts";
import emailFr from "./email/fr.ts";
import pushEn from "./push/en.ts";
import pushEs from "./push/es.ts";
import pushFr from "./push/fr.ts";
import { serverLanguage } from "./languages.ts";
import { makeT } from "./t.ts";

export { previewLanguage, SERVER_DRAFT_LANGUAGES, SERVER_LANGUAGES, serverLanguage } from "./languages.ts";
export { LEVEL_KEYS, LEVEL_NAMES, levelName } from "./levels.ts";
export type { Catalog, Vars } from "./t.ts";

export const PUSH_CATALOGS = { en: pushEn, fr: pushFr, es: pushEs };
export const EMAIL_CATALOGS = { en: emailEn, fr: emailFr, es: emailEs };

export const tPush = makeT(PUSH_CATALOGS);
export const tEmail = makeT(EMAIL_CATALOGS);

/** The date/number locale to format with for a language ('en' stays en-GB, as every server format already is). */
export function formatLocale(lang: string): string {
  return lang === "fr" ? "fr-FR" : lang === "es" ? "es-ES" : "en-GB";
}

type ProfilesClient = {
  from(table: "profiles"): {
    select(columns: string): {
      in(column: string, values: string[]): PromiseLike<{ data: { id: string; language: string | null }[] | null; error: unknown }>;
    };
  };
};

/**
 * The language to send in, per user id — one profiles read per 200 ids.
 * Never throws: a failed read means English for those users, never a lost
 * push or email.
 */
export async function languagesFor(supabase: ProfilesClient, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(userIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    try {
      const { data } = await supabase.from("profiles").select("id, language").in("id", chunk);
      for (const row of data ?? []) out.set(row.id, serverLanguage(row.language));
    } catch {
      // English for this chunk.
    }
  }
  for (const id of ids) if (!out.has(id)) out.set(id, "en");
  return out;
}

