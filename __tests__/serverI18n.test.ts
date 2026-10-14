import fs from 'fs';
import path from 'path';

import {
  EMAIL_CATALOGS,
  LEVEL_KEYS,
  LEVEL_NAMES,
  PUSH_CATALOGS,
  SERVER_DRAFT_LANGUAGES,
  SERVER_LANGUAGES,
  languagesFor,
  levelName,
  previewLanguage,
  serverLanguage,
} from '@/supabase/functions/_shared/i18n/index';
import { makeT } from '@/supabase/functions/_shared/i18n/t';
import { LEVELS } from '@/supabase/functions/_shared/levels';

const PLURAL = /_(zero|one|two|few|many|other)$/;

function flatten(node: unknown, prefix = ''): Record<string, string> {
  if (typeof node === 'string') return { [prefix]: node };
  return Object.entries((node ?? {}) as Record<string, unknown>).reduce<Record<string, string>>(
    (acc, [k, v]) => ({ ...acc, ...flatten(v, prefix ? `${prefix}.${k}` : k) }),
    {},
  );
}
const placeholders = (s: string) => [...new Set((s.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map(p => p.replace(/\s/g, '')))].sort();

describe('makeT', () => {
  const t = makeT({
    en: { hi: 'Hi {{name}}', pts_one: '{{count}} point', pts_other: '{{count}} points', nested: { a: 'A' }, onlyEn: 'English only' },
    fr: { hi: 'Salut {{name}}', pts_one: '{{count}} point', pts_other: '{{count}} points', nested: { a: '' } },
  });

  it('interpolates and nests', () => {
    expect(t('en', 'hi', { name: 'Sam' })).toBe('Hi Sam');
    expect(t('fr', 'hi', { name: 'Sam' })).toBe('Salut Sam');
    expect(t('en', 'nested.a')).toBe('A');
  });

  it('pluralises per language (French says 0 point)', () => {
    expect(t('en', 'pts', { count: 0 })).toBe('0 points');
    expect(t('en', 'pts', { count: 1 })).toBe('1 point');
    expect(t('fr', 'pts', { count: 0 })).toBe('0 point');
    expect(t('fr', 'pts', { count: 2 })).toBe('2 points');
  });

  it('falls back to English for missing or empty strings, and unknown languages', () => {
    expect(t('fr', 'onlyEn')).toBe('English only');
    expect(t('fr', 'nested.a')).toBe('A');
    expect(t('de', 'hi', { name: 'Sam' })).toBe('Hi Sam');
  });

  it('leaves an unknown placeholder visible rather than printing "undefined"', () => {
    expect(t('en', 'hi')).toBe('Hi {{name}}');
  });
});

describe('server languages', () => {
  it('sends only live languages, English otherwise', () => {
    expect(serverLanguage('en')).toBe('en');
    expect(serverLanguage(null)).toBe('en');
    expect(serverLanguage('de')).toBe('en');
    for (const draft of SERVER_DRAFT_LANGUAGES) expect(serverLanguage(draft)).toBe(SERVER_LANGUAGES.includes(draft) ? draft : 'en');
  });

  it('lets previews show drafts', () => {
    for (const draft of SERVER_DRAFT_LANGUAGES) expect(previewLanguage(draft)).toBe(draft);
    expect(previewLanguage('de')).toBe('en');
  });

  it('keeps drafts out of what is sent', () => {
    expect(SERVER_LANGUAGES).toContain('en');
    for (const draft of SERVER_DRAFT_LANGUAGES) expect(SERVER_LANGUAGES).not.toContain(draft);
  });

  it('reads languages in chunks and never loses a recipient', async () => {
    const calls: string[][] = [];
    const client = {
      from: () => ({
        select: () => ({
          in: async (_c: string, ids: string[]) => {
            calls.push(ids);
            return { data: ids.filter(id => id !== 'u2').map(id => ({ id, language: id === 'u1' ? 'fr' : 'en' })), error: null };
          },
        }),
      }),
    };
    const ids = Array.from({ length: 450 }, (_, i) => `u${i}`);
    const map = await languagesFor(client as any, ids, ['en', 'fr']);
    expect(calls.map(c => c.length)).toEqual([200, 200, 50]);
    expect(map.size).toBe(450);
    expect(map.get('u1')).toBe('fr');
    expect(map.get('u2')).toBe('en');
  });

  it('does not touch the database while English is the only live language', async () => {
    const client = { from: jest.fn() };
    const map = await languagesFor(client as any, ['a', 'b', 'a'], ['en']);
    expect(client.from).not.toHaveBeenCalled();
    expect([...map.entries()]).toEqual([['a', 'en'], ['b', 'en']]);
  });
});

describe.each([['push', PUSH_CATALOGS], ['email', EMAIL_CATALOGS]] as const)('%s catalogs', (_name, catalogs) => {
  const english = flatten((catalogs as any).en);
  const translations = Object.keys(catalogs).filter(l => l !== 'en');
  const offered = (key: string) => {
    if (!PLURAL.test(key)) return placeholders(english[key] ?? '');
    const base = key.replace(PLURAL, '');
    return [...new Set(Object.keys(english).filter(k => k.replace(PLURAL, '') === base).flatMap(k => placeholders(english[k])))].sort();
  };

  it('has a catalog for every live and draft language', () => {
    for (const lang of [...SERVER_LANGUAGES, ...SERVER_DRAFT_LANGUAGES]) expect((catalogs as any)[lang]).toBeDefined();
  });

  it.each(translations)('%s has no keys English lacks, and keeps its {{placeholders}} and plural forms', lang => {
    const strings = flatten((catalogs as any)[lang]);
    const problems: string[] = [];
    for (const [key, text] of Object.entries(strings)) {
      const plural = PLURAL.test(key);
      const known = plural ? english[`${key.replace(PLURAL, '')}_other`] !== undefined : english[key] !== undefined;
      if (!known) { problems.push(`${key}: not in English`); continue; }
      if (!text.trim()) continue;
      const used = placeholders(text);
      const ok = plural ? used.every(p => offered(key).includes(p)) : used.join() === offered(key).join();
      if (!ok) problems.push(`${key}: placeholders ${used.join() || '(none)'} ≠ English ${offered(key).join() || '(none)'}`);
    }
    for (const base of new Set(Object.keys(strings).filter(k => PLURAL.test(k)).map(k => k.replace(PLURAL, '')))) {
      for (const form of ['one', 'other']) if (!strings[`${base}_${form}`]?.trim()) problems.push(`${base}_${form}: missing`);
    }
    expect(problems).toEqual([]);
  });

  it('only sends live languages that cover every English string', () => {
    for (const lang of SERVER_LANGUAGES.filter(l => l !== 'en')) {
      const strings = flatten((catalogs as any)[lang]);
      const missing = Object.keys(english).filter(k => !PLURAL.test(k) || k.endsWith('_other')).filter(k => !strings[k]?.trim());
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
  });

  it('writes French with typographic apostrophes and no-break spaces before ? ! : ; and inside « »', () => {
    const fr = flatten((catalogs as any).fr);
    const problems = Object.entries(fr).flatMap(([key, text]) => [
      ...(text.includes("'") ? [`${key}: straight apostrophe`] : []),
      ...(/ [?!:;»]|« /.test(text) ? [`${key}: plain space where French needs U+00A0`] : []),
    ]);
    expect(problems).toEqual([]);
  });
});

describe('level names', () => {
  it('cover the server ladder, in order, with the same English names', () => {
    expect(LEVEL_KEYS.length).toBe(LEVELS.length);
    LEVELS.forEach((l, i) => expect(LEVEL_NAMES.en[LEVEL_KEYS[i]]).toBe(l.name));
  });

  it.each(['en', 'fr', 'es'])('match the app catalog in %s', lang => {
    const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'shared/i18n', lang, 'app/points.json'), 'utf8')).levels;
    for (const key of LEVEL_KEYS) expect({ key, name: LEVEL_NAMES[lang][key] }).toEqual({ key, name: app[key].name });
  });

  it('falls back to English, then to "Level N"', () => {
    expect(levelName('en', 1)).toBe('Touching Grass');
    expect(levelName('fr', 1)).toBe(LEVEL_NAMES.fr.touchingGrass);
    expect(levelName('de', 2)).toBe('Cardio Goblin');
    expect(levelName('en', 99)).toBe('Level 99');
  });
});

describe('activity names', () => {
  // Pushes name an activity (a synced workout, a vault bonus) with the app's own
  // words for it, so the lock screen and the app never call it two things.
  it.each(['en', 'fr', 'es'])('match the app catalog in %s', lang => {
    const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'shared/i18n', lang, 'app/activities.json'), 'utf8')).names;
    const server = (PUSH_CATALOGS as any)[lang].activityNames;
    expect(Object.keys(server).sort()).toEqual(Object.keys(app).sort());
    for (const key of Object.keys(app)) expect({ key, name: server[key] }).toEqual({ key, name: app[key] });
  });
});

describe('server source', () => {
  // Every literal key passed to tPush / tEmail anywhere in supabase/functions
  // must exist in English, or a phone would show the raw key.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.ts$/.test(e.name)) files.push(full);
    }
  };
  walk(path.join(__dirname, '..', 'supabase/functions'));
  const CALL = /\bt(Push|Email)\(\s*[^,()]+,\s*['"`]([\w.]+)['"`]/g;

  it('only uses keys that exist in English', () => {
    const missing: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const [, kind, key] of source.matchAll(CALL)) {
        const english = flatten(kind === 'Push' ? (PUSH_CATALOGS as any).en : (EMAIL_CATALOGS as any).en);
        if (english[key] === undefined && english[`${key}_other`] === undefined) missing.push(`${path.relative(path.join(__dirname, '..'), file)}: t${kind} ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
