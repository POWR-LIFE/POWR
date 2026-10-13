// A tiny i18next-compatible translator for Deno edge functions (and Jest).
// Same conventions as the app's catalogs, so a translator learns one format:
//   - nested keys addressed with dots: "friendRequest.title"
//   - {{name}} placeholders
//   - plurals by suffix when `count` is passed: key_one / key_other (key_many
//     and the rest per Intl.PluralRules; missing forms fall back to _other)
//   - a missing or empty string in a language falls back to English, never to
//     a blank or a raw key
// Pure: no Deno or Node APIs, so it runs in edge functions, Jest and the portal.

export type Catalog = { readonly [key: string]: string | Catalog };
export type Vars = Record<string, string | number | null | undefined>;

function lookup(catalog: Catalog | undefined, key: string): string | undefined {
  let node: string | Catalog | undefined = catalog;
  for (const part of key.split(".")) {
    if (!node || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" && node.trim() !== "" ? node : undefined;
}

function pluralKey(lang: string, key: string, count: number): string[] {
  let category = "other";
  try {
    category = new Intl.PluralRules(lang).select(count);
  } catch {
    // Unknown language tag: "other" is always present.
  }
  return [`${key}_${category}`, `${key}_other`, key];
}

function interpolate(text: string, vars: Vars | undefined): string {
  if (!vars) return text;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = vars[name];
    return value === null || value === undefined ? match : String(value);
  });
}

/**
 * Translator over one set of catalogs ({ en: {...}, fr: {...} }). English is
 * the fallback for any key a language lacks; if English lacks it too the key
 * itself comes back, which the parity test makes impossible for literal keys.
 */
export function makeT(catalogs: Record<string, Catalog>) {
  return function t(lang: string, key: string, vars?: Vars): string {
    const count = typeof vars?.count === "number" ? vars.count : undefined;
    const candidates = count === undefined ? [key] : pluralKey(lang, key, count);
    for (const language of lang === "en" ? ["en"] : [lang, "en"]) {
      const keys = language === lang ? candidates : count === undefined ? [key] : pluralKey("en", key, count);
      for (const k of keys) {
        const text = lookup(catalogs[language], k);
        if (text !== undefined) return interpolate(text, vars);
      }
    }
    return key;
  };
}
