import fs from 'fs';
import path from 'path';

import { EXACT, PATTERNS, localDate } from '../landing-page/src/lib/serverErrorTable';

// The portals' server-error table (landing-page/src/lib/serverErrorTable.js):
// server message → key in the serverErrors namespace. serverErrors.js itself
// imports the Vite-only i18n setup, so this tests the data it reads.
const ROOT = path.join(__dirname, '..');
const read = (lang: string) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/i18n', lang, 'portal/serverErrors.json'), 'utf8'));

function flatten(tree: unknown, prefix = 'serverErrors:'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree as Record<string, unknown>)) {
    const key = prefix.endsWith(':') ? prefix + k : `${prefix}.${k}`;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const english = flatten(read('en'));
const exact = EXACT as Record<string, string>;
const patterns = PATTERNS as [RegExp, string, (groups: string[], locale: string) => Record<string, unknown>][];

/** The English for a key: the key itself, or its plural "other" form. */
const englishOf = (key: string) => english[key] ?? english[`${key}_other`];
const placeholders = (text: string) => [...new Set((text.match(/\{\{(\w+)\}\}/g) ?? []).map(p => p.slice(2, -2)))].sort();

// A plausible value for each placeholder, so the English template can be
// rendered into the message the server would send.
const SAMPLE: Record<string, string> = {
  count: '3', days: '28', date: '9 November 2026', brand: 'Acme Coffee', n: '2', limit: '3',
  max: '5', detail: 'HTTP 500', status: '502', code: 'POWR-AB12',
};
const render = (template: string) => template.replace(/\{\{(\w+)\}\}/g, (_, name) => SAMPLE[name] ?? `<${name}>`);

describe('portal server errors', () => {
  it('gives every exact message a key whose English is that message, word for word', () => {
    const problems = Object.entries(exact).flatMap(([message, key]) => {
      if (!key.startsWith('serverErrors:')) return [`${key}: not in the serverErrors namespace`];
      if (english[key] === undefined) return [`${key}: missing from en/portal/serverErrors.json`];
      if (english[key] !== message) return [`${key}: English "${english[key]}" ≠ server "${message}"`];
      if (message !== message.trim()) return [`${key}: message has outer spaces (matching is on the trimmed text)`];
      return [];
    });
    expect(problems).toEqual([]);
  });

  it('gives every pattern a key whose English renders into a message the pattern matches, with every value filled', () => {
    const problems = patterns.flatMap(([pattern, key, values]) => {
      const template = englishOf(key);
      if (template === undefined) return [`${key}: missing from en/portal/serverErrors.json`];
      if (!pattern.source.startsWith('^') || !pattern.source.endsWith('$')) return [`${key}: pattern must match the whole message`];
      const message = render(template);
      const m = message.match(pattern);
      if (!m) return [`${key}: "${message}" doesn't match ${pattern}`];
      const given = Object.keys(values(m.slice(1), 'fr-FR')).sort();
      const wanted = placeholders(template);
      return given.join() === wanted.join() ? [] : [`${key}: values give ${given.join()} but the English uses ${wanted.join()}`];
    });
    expect(problems).toEqual([]);
  });

  it('never lets a pattern swallow an exact message (exact wins, but it would hide a mistake)', () => {
    const overlaps = Object.keys(exact).flatMap(message =>
      patterns.filter(([pattern]) => pattern.test(message)).map(([, key]) => `${message} → ${key}`),
    );
    expect(overlaps).toEqual([]);
  });

  it('has no catalog key the table never uses', () => {
    const used = new Set([...Object.values(exact), ...patterns.map(([, key]) => key)]);
    const unused = Object.keys(english).filter(key => !used.has(key.replace(/_(zero|one|two|few|many|other)$/, '')));
    expect(unused).toEqual([]);
  });

  it('only maps messages the server code actually sends (Supabase Auth and functions-js aside)', () => {
    // Postgres doubles a quote inside a string literal; edge functions don't.
    const sources: string[] = [];
    const migrations = path.join(ROOT, 'supabase/migrations');
    for (const f of fs.readdirSync(migrations)) if (f.endsWith('.sql')) sources.push(fs.readFileSync(path.join(migrations, f), 'utf8'));
    for (const fn of ['manage-gym-staff', 'manage-partner-user', 'manage-partner-api', 'shopify-connect']) {
      sources.push(fs.readFileSync(path.join(ROOT, 'supabase/functions', fn, 'index.ts'), 'utf8'));
    }
    for (const shared of ['mintTest.ts', 'webhookSign.ts']) sources.push(fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared', shared), 'utf8'));
    const all = sources.join('\n');
    // _gym_team_link builds these from 'The % needs to be…' / 'That % is too long' with p_what.
    const built = /^(The (booking|profile) link needs to be a web address, like calendly\.com\/yourname|That (booking|profile) link is too long)$/;
    const missing = Object.entries(exact)
      .filter(([, key]) => !/^serverErrors:(auth|network)\./.test(key))
      .filter(([message]) => !built.test(message))
      .filter(([message]) => !all.includes(message) && !all.includes(message.replace(/'/g, "''")))
      .map(([message, key]) => `${key}: "${message}"`);
    expect(missing).toEqual([]);
  });

  it('shows the Clash Night date in the reader’s language, and leaves anything else as it came', () => {
    expect(localDate('9 November 2026', 'fr-FR')).toBe('9 novembre 2026');
    expect(localDate('9 November 2026', 'es-ES')).toBe('9 de noviembre de 2026');
    expect(localDate('9 November 2026', 'en-GB')).toBe('9 November 2026');
    expect(localDate('next Tuesday', 'fr-FR')).toBe('next Tuesday');
  });
});
