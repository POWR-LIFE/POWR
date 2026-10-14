import fs from 'fs';
import path from 'path';

import { PORTAL_DRAFT_LANGUAGES, PORTAL_LANGUAGES } from '../shared/i18n';

// The gym and partner portals' catalogs: shared/i18n/<lang>/portal/<ns>.json.
// landing-page/src/lib/i18n.js loads every file there by glob, so there is no
// registry to forget — this test reads the same files from disk.
const ROOT = path.join(__dirname, '..');
const CATALOG_ROOT = path.join(ROOT, 'shared/i18n');
const SRC = path.join(ROOT, 'landing-page/src');

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const REQUIRED_PLURALS = ['one', 'other'];

function readCatalogs(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const dir of fs.readdirSync(CATALOG_ROOT, { withFileTypes: true })) {
    const portalDir = path.join(CATALOG_ROOT, dir.name, 'portal');
    if (!dir.isDirectory() || !fs.existsSync(portalDir)) continue;
    for (const file of fs.readdirSync(portalDir).filter(f => f.endsWith('.json'))) {
      (out[dir.name] ??= {})[file.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(portalDir, file), 'utf8'));
    }
  }
  return out;
}

const CATALOGS = readCatalogs();
const NAMESPACES = Object.keys(CATALOGS.en ?? {});

/** { "common:language.label": "Language", … } for every leaf of one language. */
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
const tags = (text: string) => [...new Set((text.match(/<\/?([a-zA-Z][\w]*)>/g) ?? []).map(t => t.replace(/[<>/]/g, '')))].sort();

function englishPlaceholders(key: string): string[] {
  if (english[key] !== undefined && !PLURAL_SUFFIX.test(key)) return placeholders(english[key]);
  const base = baseOf(key);
  return [...new Set(Object.keys(english).filter(k => baseOf(k) === base).flatMap(k => placeholders(english[k])))].sort();
}

const translations = Object.keys(CATALOGS).filter(lang => lang !== 'en');

describe('portal catalogs', () => {
  it('has English, and a catalog for every language a portal can show or preview', () => {
    expect(NAMESPACES).toContain('common');
    for (const lang of [...PORTAL_LANGUAGES, ...PORTAL_DRAFT_LANGUAGES]) expect(CATALOGS[lang]).toBeDefined();
  });

  it('keeps drafts out of what gyms and brands see, and always offers English', () => {
    expect(PORTAL_LANGUAGES).toContain('en');
    for (const lang of PORTAL_DRAFT_LANGUAGES) expect(PORTAL_LANGUAGES).not.toContain(lang);
  });

  it.each(translations)('%s has no namespace English lacks', lang => {
    expect(Object.keys(CATALOGS[lang]).filter(ns => !NAMESPACES.includes(ns))).toEqual([]);
  });

  it('has no empty English strings', () => {
    expect(Object.entries(english).filter(([, text]) => !text.trim()).map(([key]) => key)).toEqual([]);
  });

  it.each(translations)('%s has no keys English lacks, and keeps its {{placeholders}} and <tags>', lang => {
    const problems: string[] = [];
    for (const [key, text] of Object.entries(flattenLanguage(lang))) {
      const plural = PLURAL_SUFFIX.test(key);
      const known = plural ? isPluralBase(baseOf(key)) : english[key] !== undefined;
      if (!known) { problems.push(`${key}: not in English`); continue; }
      if (!text.trim()) continue; // untranslated — falls back to English
      const offered = englishPlaceholders(key);
      const used = placeholders(text);
      const ok = plural ? used.every(p => offered.includes(p)) : used.join() === offered.join();
      if (!ok) problems.push(`${key}: placeholders ${used.join() || '(none)'} ≠ English ${offered.join() || '(none)'}`);
      const englishText = english[key] ?? english[`${baseOf(key)}_other`] ?? '';
      if (tags(text).join() !== tags(englishText).join()) problems.push(`${key}: <tags> ${tags(text).join() || '(none)'} ≠ English ${tags(englishText).join() || '(none)'}`);
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

  it('writes Spanish without spaced English dashes', () => {
    const problems = Object.entries(flattenLanguage('es')).filter(([, text]) => / [—–] /.test(text)).map(([key]) => key);
    expect(problems).toEqual([]);
  });

  it('only switches on languages that cover every English string', () => {
    // A loop, not it.each: today the list is just English, and it.each refuses an empty table.
    for (const lang of PORTAL_LANGUAGES.filter(l => l !== 'en')) {
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

describe('portal source', () => {
  const files: string[] = [];
  const collect = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  collect(SRC);
  const rel = (file: string) => path.relative(ROOT, file);

  const namespaces = NAMESPACES.join('|');
  // Any string literal shaped like a portal key: 'common:language.label'.
  const KEY = new RegExp(`['"\`]((?:${namespaces}):[A-Za-z0-9_.]+)['"\`]`, 'g');
  const T_CALL = /\bt\(\s*['"`]([^'"`]+)['"`]/g;
  // Files that translate: they import react-i18next or the portal's i18n.
  const translating = (source: string) => /from ['"](react-i18next|[./]*lib\/i18n(\.js)?)['"]/.test(source);

  it('only references keys that exist in English', () => {
    const missing: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const [, key] of source.matchAll(KEY)) {
        if (english[key] === undefined && !isPluralBase(key)) missing.push(`${rel(file)}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('writes every t() key in full, with a known namespace', () => {
    const known = new RegExp(`^(?:${namespaces}):`);
    const loose: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      if (!translating(source)) continue;
      for (const [, key] of source.matchAll(T_CALL)) if (!known.test(key)) loose.push(`${rel(file)}: ${key}`);
    }
    expect(loose).toEqual([]);
  });

  it('never calls t() at module level (it would freeze in the language on screen when the file loaded)', () => {
    // Heuristic: a top-level const/let whose initialiser calls t( or i18n.t(.
    const bad: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      if (!translating(source)) continue;
      for (const line of source.split('\n')) {
        if (/^(export )?(const|let) [^=]+=.*\b(i18n\.)?t\(\s*['"`]/.test(line)) bad.push(`${rel(file)}: ${line.trim().slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
