import fs from 'fs';
import path from 'path';

import { APP_DRAFT_LANGUAGES, APP_LANGUAGES, formatLocaleFor, resolveLanguage } from '../shared/i18n';
import { APP_NAMESPACES, APP_RESOURCES } from '../shared/i18n/app';

const ROOT = path.join(__dirname, '..');
const CATALOG_ROOT = path.join(ROOT, 'shared/i18n');
const CATALOGS = APP_RESOURCES as Record<string, Record<string, unknown>>;

// i18next picks one of these suffixes by count. A missing "_many" falls back to
// "_other", so only "_one" and "_other" are required of a translation.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const REQUIRED_PLURALS = ['one', 'other'];

/** { "settings:language.title": "Language", … } for every leaf of one language. */
function flattenLanguage(lang: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (node: unknown, key: string) => {
    if (typeof node === 'string') out[key] = node;
    else for (const [k, child] of Object.entries(node as Record<string, unknown>)) walk(child, key.endsWith(':') ? key + k : `${key}.${k}`);
  };
  for (const [ns, tree] of Object.entries(CATALOGS[lang] ?? {})) walk(tree, `${ns}:`);
  return out;
}

const english = flattenLanguage('en');
const baseOf = (key: string) => key.replace(PLURAL_SUFFIX, '');
const isPluralBase = (key: string) => english[`${key}_other`] !== undefined;
const placeholders = (text: string) => [...new Set((text.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).map(p => p.replace(/\s/g, '')))].sort();

/** Placeholders English offers for a key — for plurals, any of its forms. */
function englishPlaceholders(key: string): string[] {
  if (english[key] !== undefined && !PLURAL_SUFFIX.test(key)) return placeholders(english[key]);
  const base = baseOf(key);
  return [...new Set(Object.keys(english).filter(k => baseOf(k) === base).flatMap(k => placeholders(english[k])))].sort();
}

const translations = Object.keys(CATALOGS).filter(lang => lang !== 'en');

describe('app catalogs', () => {
  it('registers every catalog file on disk, and nothing that is not one', () => {
    const onDisk = fs
      .readdirSync(CATALOG_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory() && fs.existsSync(path.join(CATALOG_ROOT, d.name, 'app')));
    for (const dir of onDisk) {
      const files = fs.readdirSync(path.join(CATALOG_ROOT, dir.name, 'app')).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const ns = file.replace(/\.json$/, '');
        expect({ file: `${dir.name}/app/${file}`, known: (APP_NAMESPACES as readonly string[]).includes(ns) })
          .toEqual({ file: `${dir.name}/app/${file}`, known: true });
        expect({ file: `${dir.name}/app/${file}`, registered: CATALOGS[dir.name]?.[ns] !== undefined })
          .toEqual({ file: `${dir.name}/app/${file}`, registered: true });
      }
    }
    for (const ns of APP_NAMESPACES) expect(CATALOGS.en[ns]).toBeDefined();
  });

  it('has a catalog for every language the app can show or preview', () => {
    for (const lang of [...APP_LANGUAGES, ...APP_DRAFT_LANGUAGES]) expect(CATALOGS[lang]).toBeDefined();
  });

  it('keeps drafts out of what members see, and always offers English', () => {
    expect(APP_LANGUAGES).toContain('en');
    for (const lang of APP_DRAFT_LANGUAGES) expect(APP_LANGUAGES).not.toContain(lang);
  });

  it('has no empty English strings', () => {
    expect(Object.entries(english).filter(([, text]) => !text.trim()).map(([key]) => key)).toEqual([]);
  });

  it.each(translations)('%s has no keys English lacks, and keeps its {{placeholders}}', lang => {
    const problems: string[] = [];
    for (const [key, text] of Object.entries(flattenLanguage(lang))) {
      const plural = PLURAL_SUFFIX.test(key);
      const known = plural ? isPluralBase(baseOf(key)) : english[key] !== undefined;
      if (!known) { problems.push(`${key}: not in English`); continue; }
      if (!text.trim()) continue; // untranslated — falls back to English
      const offered = englishPlaceholders(key);
      const used = placeholders(text);
      // A plural form may drop {{count}} ("un point"); nothing may invent one.
      const ok = plural ? used.every(p => offered.includes(p)) : used.join() === offered.join();
      if (!ok) problems.push(`${key}: placeholders ${used.join() || '(none)'} ≠ English ${offered.join() || '(none)'}`);
    }
    expect(problems).toEqual([]);
  });

  it.each(translations)('%s gives every plural it translates a "one" and an "other" form', lang => {
    const strings = flattenLanguage(lang);
    const bases = new Set(Object.keys(strings).filter(k => PLURAL_SUFFIX.test(k)).map(baseOf));
    const missing = [...bases].flatMap(base => REQUIRED_PLURALS.filter(s => !strings[`${base}_${s}`]?.trim()).map(s => `${base}_${s}`));
    expect(missing).toEqual([]);
  });

  it('never names a <Trans> tag after a void HTML element (it renders empty and drops the styling)', () => {
    const VOID = /<\/?(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i;
    const bad = Object.keys(CATALOGS).flatMap(lang =>
      Object.entries(flattenLanguage(lang)).filter(([, text]) => VOID.test(text)).map(([key]) => `${lang} ${key}`),
    );
    expect(bad).toEqual([]);
  });

  it('writes French with typographic apostrophes and no-break spaces before ? ! : ; and inside « »', () => {
    const problems = Object.entries(flattenLanguage('fr')).flatMap(([key, text]) => [
      ...(text.includes("'") ? [`${key}: straight apostrophe, use ’`] : []),
      ...(/ [?!:;»]|« /.test(text) ? [`${key}: plain space where French needs a no-break space (U+00A0)`] : []),
    ]);
    expect(problems).toEqual([]);
  });

  it('only switches on languages that cover every English string', () => {
    // A loop, not it.each: today the list is just English, and it.each refuses an empty table.
    for (const lang of APP_LANGUAGES.filter(l => l !== 'en')) {
      const strings = flattenLanguage(lang);
      const missing = Object.keys(english).flatMap(key => {
        if (!PLURAL_SUFFIX.test(key)) return strings[key]?.trim() ? [] : [key];
        if (!key.endsWith('_other')) return [];
        const base = baseOf(key);
        return REQUIRED_PLURALS.filter(s => !strings[`${base}_${s}`]?.trim()).map(s => `${base}_${s}`);
      });
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
  });
});

describe('app source', () => {
  const SOURCE_DIRS = ['app', 'components', 'context', 'hooks', 'lib', 'constants'];
  const files: string[] = [];
  const collect = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) files.push(full);
    }
  };
  for (const dir of SOURCE_DIRS) if (fs.existsSync(path.join(ROOT, dir))) collect(path.join(ROOT, dir));

  const namespaces = (APP_NAMESPACES as readonly string[]).join('|');
  // Any string literal shaped like a key: 'settings:language.title'.
  const KEY = new RegExp(`['"\`]((?:${namespaces}):[A-Za-z0-9_.]+)['"\`]`, 'g');
  // The first argument of every t('…') call, to catch keys written without a
  // namespace (or with a misspelt one), which the scan above would miss.
  const T_CALL = /\bt\(\s*['"`]([^'"`]+)['"`]/g;

  it('only references keys that exist in English', () => {
    const missing: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const [, key] of source.matchAll(KEY)) {
        if (english[key] === undefined && !isPluralBase(key)) missing.push(`${path.relative(ROOT, file)}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('writes every t() key in full, with a known namespace', () => {
    const known = new RegExp(`^(?:${namespaces}):`);
    const loose: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const [, key] of source.matchAll(T_CALL)) if (!known.test(key)) loose.push(`${path.relative(ROOT, file)}: ${key}`);
    }
    expect(loose).toEqual([]);
  });
});

describe('resolveLanguage', () => {
  it('shows a supported preference', () => {
    expect(resolveLanguage('fr', ['en', 'fr'])).toBe('fr');
  });

  it('falls back to English for anything the surface does not speak yet', () => {
    expect(resolveLanguage('fr', ['en'])).toBe('en');
    expect(resolveLanguage('de', ['en', 'fr', 'es'])).toBe('en');
    expect(resolveLanguage(null, ['en'])).toBe('en');
  });
});

describe('formatLocaleFor', () => {
  it('keeps English on en-GB whatever the phone says, so moving a hard-coded en-GB changes nothing', () => {
    expect(formatLocaleFor('en', 'en-US')).toBe('en-GB');
    expect(formatLocaleFor('en', 'fr-FR')).toBe('en-GB');
  });

  it("uses the phone's own region when it speaks the language on screen", () => {
    expect(formatLocaleFor('fr', 'fr-CA')).toBe('fr-CA');
    expect(formatLocaleFor('es', 'es_MX')).toBe('es-MX');
  });

  it('defaults the region when the phone is in another language', () => {
    expect(formatLocaleFor('fr', 'en-GB')).toBe('fr-FR');
    expect(formatLocaleFor('es', null)).toBe('es-ES');
  });
});
