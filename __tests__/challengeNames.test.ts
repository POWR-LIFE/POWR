/**
 * Challenge names and goal lines in the reader's language
 * (shared/i18n/<lang>/app/challenges.json, lib/challengeText.ts,
 * shared/sharedChallengeGoal.ts, and the push side in _shared/pushCopy.ts).
 *
 * The English is data — the weekly catalog (three copies) and the
 * shared_challenge_templates rows (fixture: production on 2026-10-14) — so
 * these tests prove two things: every name has a translation, and English
 * output is byte-identical to the data it used to print straight.
 */
import fs from 'fs';
import path from 'path';

import { challengeTemplateGoal, challengeTemplateTitle, weeklyChallengeDescription, weeklyChallengeTitle, withLocalizedTemplateText, withLocalizedWeeklyText } from '@/lib/challengeText';
import i18n, { setLanguagePreference } from '@/lib/i18n';
import { edgeErrorText } from '@/hooks/useSharedChallenges';
import { APP_RESOURCES } from '@/shared/i18n/app';
import { sharedChallengeGoalText } from '@/shared/sharedChallengeGoal';
import { CATALOG } from '@/shared/weeklyChallenges';
import { CATALOG as EDGE_CATALOG } from '@/supabase/functions/_shared/challenges';
import { TEMPLATE_TITLE_KEYS, templateTitleKey } from '@/supabase/functions/_shared/i18n/challengeNames';
import { PUSH_CATALOGS } from '@/supabase/functions/_shared/i18n/index';
import { buildMessage, quotedTitleMarkers } from '@/supabase/functions/_shared/pushCopy';

// challengeRules.js is CommonJS — require for reliable interop.
/* eslint-disable @typescript-eslint/no-var-requires */
const { CATALOG: RULES_CATALOG } = require('@/shared/challengeRules');

type Row = { title: string; category: string; mode: string; measure: any; goal: string; active: boolean };
const TEMPLATES: Row[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/sharedChallengeTemplates.json'), 'utf8'),
).rows;

const LANGS = ['en', 'fr', 'es'] as const;
const app = (lang: string) => (APP_RESOURCES as any)[lang].challenges;
const NB = ' ';

/** A translator over one language of the app catalog (no i18next state involved). */
function translator(lang: string) {
  const t = i18n.getFixedT(lang);
  return (key: string, vars?: Record<string, string | number>) => t(key, vars as any) as string;
}

describe('the weekly catalog', () => {
  const pick = (c: any) => ({ id: c.id, title: c.title, description: c.description });

  it('is the same 57 challenges in all three copies', () => {
    expect(CATALOG).toHaveLength(57);
    expect(RULES_CATALOG.map(pick)).toEqual(CATALOG.map(pick));
    expect(EDGE_CATALOG.map(pick)).toEqual(CATALOG.map(pick));
  });

  it.each(LANGS)('has a title and description for every id in %s, and nothing else', (lang) => {
    const weekly = app(lang).weekly;
    expect(Object.keys(weekly).sort()).toEqual(CATALOG.map((c: any) => c.id).sort());
    for (const c of CATALOG as any[]) {
      expect({ id: c.id, title: !!weekly[c.id].title?.trim(), description: !!weekly[c.id].description?.trim() })
        .toEqual({ id: c.id, title: true, description: true });
    }
  });

  it('prints every name and description exactly as the catalog does, in English', () => {
    for (const c of CATALOG as any[]) {
      expect(weeklyChallengeTitle(c.id, c.title)).toBe(c.title);
      expect(weeklyChallengeDescription(c.id, c.description)).toBe(c.description);
    }
  });

  it('gives pushes the same names as the app', () => {
    for (const lang of LANGS) {
      const push = (PUSH_CATALOGS as any)[lang].challengeNames.weekly;
      const names = Object.fromEntries(Object.entries(app(lang).weekly).map(([id, v]: [string, any]) => [id, v.title]));
      expect(push).toEqual(names);
    }
  });
});

describe('Together template titles', () => {
  it('map every stored title to a key with a name in all three languages', () => {
    for (const row of TEMPLATES) {
      const key = templateTitleKey(row.title);
      expect({ title: row.title, key: !!key }).toEqual({ title: row.title, key: true });
      for (const lang of LANGS) expect({ lang, title: row.title, name: !!app(lang).templates[key!]?.trim() }).toEqual({ lang, title: row.title, name: true });
      expect(app('en').templates[key!]).toBe(row.title);
    }
    // Nothing in the catalog the map can't reach.
    expect(Object.keys(app('en').templates).sort()).toEqual(Object.values(TEMPLATE_TITLE_KEYS).sort());
  });

  it('leave a title we have no name for as written', () => {
    expect(templateTitleKey('Brand New Template')).toBeNull();
    expect(templateTitleKey('constructor')).toBeNull();
    expect(challengeTemplateTitle('Brand New Template')).toBe('Brand New Template');
  });

  it('give pushes the same names as the app', () => {
    for (const lang of LANGS) expect((PUSH_CATALOGS as any)[lang].challengeNames.templates).toEqual(app(lang).templates);
  });
});

describe('Together goal lines', () => {
  it.each(TEMPLATES.map((r) => [r.title, r]))('regenerate "%s" byte for byte in English', (_title, row) => {
    const r = row as Row;
    expect(sharedChallengeGoalText(r, translator('en'), 'en-GB')).toBe(r.goal);
  });

  it.each(['fr', 'es'])('say every template in %s, with nothing left untranslated', (lang) => {
    const locale = lang === 'fr' ? 'fr-FR' : 'es-ES';
    for (const row of TEMPLATES) {
      const line = sharedChallengeGoalText(row, translator(lang), locale);
      expect({ title: row.title, line: typeof line === 'string' && line.length > 0 && !line.includes('{{') && line !== row.goal })
        .toEqual({ title: row.title, line: true });
    }
  });

  it('formats numbers for the language', () => {
    const steps = { category: 'walking', mode: 'pooled', measure: { measure: 'steps_week', target: 250000 } };
    expect(sharedChallengeGoalText(steps, translator('fr'), 'fr-FR')).toBe(`Ensemble${NB}: ${(250000).toLocaleString('fr-FR')} pas`);
    expect(sharedChallengeGoalText(steps, translator('es'), 'es-ES')).toBe('En equipo: 250.000 pasos');
    const km = { category: 'running', mode: 'solo', measure: { measure: 'distance', target: 10, unit: 'km' } };
    expect(sharedChallengeGoalText(km, translator('fr'), 'fr-FR')).toBe(`Cours 10${NB}km au total`);
    const days = { category: 'walking', mode: 'solo', measure: { measure: 'steps_day', target: 8000, days: 1, window: 'before_9am' } };
    expect(sharedChallengeGoalText(days, translator('en'), 'en-GB')).toBe('8,000 steps before 9am, 1 day');
    expect(sharedChallengeGoalText(days, translator('es'), 'es-ES')).toBe('8000 pasos antes de las 9:00, 1 día');
  });

  it('gives up (null) rather than guess', () => {
    const t = translator('fr');
    expect(sharedChallengeGoalText({ category: 'gym', mode: 'solo', measure: null }, t, 'fr-FR')).toBeNull();
    expect(sharedChallengeGoalText({ category: 'gym', mode: 'solo', measure: { measure: 'yoga_flow', target: 3 } }, t, 'fr-FR')).toBeNull();
    expect(sharedChallengeGoalText({ category: 'gym', mode: 'solo', measure: { measure: 'checkins', target: 3, window: 'at_dawn' } }, t, 'fr-FR')).toBeNull();
    expect(sharedChallengeGoalText({ category: 'walking', mode: 'solo', measure: { measure: 'steps_day', target: 8000 } }, t, 'fr-FR')).toBeNull();
    expect(sharedChallengeGoalText({ category: 'running', mode: 'solo', measure: { measure: 'distance', target: 10 } }, t, 'fr-FR')).toBeNull();
    expect(sharedChallengeGoalText({ category: 'gym', mode: 'pooled', measure: { measure: 'distance', target: 10, unit: 'km' } }, t, 'fr-FR')).toBeNull();
  });
});

describe('in the app', () => {
  afterEach(async () => { await setLanguagePreference(null); });

  const fourOfAKind = TEMPLATES.find((r) => r.title === 'Four of a Kind')!;
  const mapped = () => withLocalizedTemplateText({
    title: fourOfAKind.title, goal: fourOfAKind.goal, category: fourOfAKind.category, mode: fourOfAKind.mode, measure: fourOfAKind.measure,
  });

  it('keeps English exactly as stored, including a goal edited by hand', async () => {
    const tmpl = mapped();
    expect(tmpl.title).toBe('Four of a Kind');
    expect(tmpl.goal).toBe('Check in 4×');
    expect(challengeTemplateGoal({ goal: 'Check in 4× at any gym', category: 'gym', measure: { measure: 'checkins', target: 4 } })).toBe('Check in 4× at any gym');
  });

  it('reads the language on screen when rendered, not when loaded', async () => {
    const tmpl = mapped();
    const card = withLocalizedWeeklyText({ id: 'walk-first-steps', title: 'First Steps', description: 'Hit 5,000 steps in a single day this week.', completeSubtitle: 'Hit 5,000 steps in a single day this week.' });
    await setLanguagePreference('fr');
    expect(tmpl.title).toBe('Carré d’as');
    expect(tmpl.goal).toBe('Fais 4 check-ins');
    expect(tmpl.sourceTitle).toBe('Four of a Kind');
    expect(card.title).toBe('Premiers pas');
    expect(card.description).toBe(`Atteins ${(5000).toLocaleString('fr-FR')} pas en une seule journée cette semaine.`);
    expect(card.completeSubtitle).toBe(card.description);
    await setLanguagePreference('es');
    expect(tmpl.title).toBe('Póker de ases');
    expect(card.title).toBe('Primeros pasos');
  });

  it('shows the stored English for anything it cannot translate', async () => {
    await setLanguagePreference('fr');
    // An admin catalog override that renamed a weekly challenge keeps its own words.
    expect(weeklyChallengeTitle('run-just-run', 'Run, Forrest')).toBe('Run, Forrest');
    expect(weeklyChallengeTitle('not-a-challenge', 'Mystery')).toBe('Mystery');
    // A snapshot from before measures were stored.
    expect(challengeTemplateGoal({ goal: 'Check in 3× this week', category: 'gym', measure: null })).toBe('Check in 3× this week');
    // A snapshot with no title at all.
    expect(withLocalizedTemplateText({ title: '', goal: '', category: 'gym' }, false).title).toBe('Défi');
  });

  it('says a refused request in the language on screen, by its code', async () => {
    const full = { error: 'Groups are capped at 6', code: 'GROUP_FULL' };
    const atCap = { error: 'Challenge slots full — finish or drop one first', code: 'AT_CAP' };
    const uncoded = { error: 'Some invitees are not your friends' };
    expect(edgeErrorText(full, 'fallback')).toBe('Groups are capped at 6');
    expect(edgeErrorText(atCap, 'fallback')).toBe(atCap.error);
    expect(edgeErrorText(uncoded, 'fallback')).toBe(uncoded.error);
    expect(edgeErrorText(null, 'fallback')).toBe('fallback');
    await setLanguagePreference('fr');
    expect(edgeErrorText(full, 'repli')).toBe('Les groupes sont limités à 6 personnes');
    expect(edgeErrorText(atCap, 'repli')).toBe('Plus de place pour un défi — termine ta part ou quittes-en un d’abord');
    expect(edgeErrorText({ error: 'x', code: 'SOMETHING_NEW' }, 'repli')).toBe('repli');
    expect(edgeErrorText(uncoded, 'repli')).toBe('repli');
  });
});

describe('pushes', () => {
  const nudge = { challenge_id: 'run-just-run', challenge_name: 'Just Run', progress_text: '0/1 runs', points: 15 };

  it('quote a weekly challenge exactly as sent in English', () => {
    expect(buildMessage('challenge_within_reach', nudge, 'en').body).toBe('"Just Run" is at 0/1 runs — finish it for +15 pts.');
    expect(buildMessage('weekly_challenge_expiry', { challenge_id: 'run-just-run' }, 'en').body).toContain('"Weekly Challenge"');
  });

  it('quote a weekly challenge in the reader’s language by its id', () => {
    expect(buildMessage('challenge_within_reach', nudge, 'fr').body).toContain(`«${NB}Cours, c’est tout${NB}»`);
    expect(buildMessage('weekly_challenge_expiry', { ...nudge, challenge_name: undefined }, 'es').body).toContain('«Solo corre»');
    // A renamed challenge (admin override) or an unknown id goes out as sent.
    expect(buildMessage('challenge_within_reach', { ...nudge, challenge_name: 'Run, Forrest' }, 'fr').body).toContain('Run, Forrest');
    expect(buildMessage('challenge_within_reach', { ...nudge, challenge_id: 'nope' }, 'fr').body).toContain('Just Run');
  });

  it('dedupe the within-reach nudge on the name in every language it can go out in', () => {
    const markers = quotedTitleMarkers('Just Run');
    for (const lang of LANGS) {
      const body = buildMessage('challenge_within_reach', nudge, lang).body;
      expect({ lang, seen: markers.some((m) => body.includes(m)) }).toEqual({ lang, seen: true });
    }
    expect(markers).toEqual(expect.arrayContaining(['"Just Run"', `«${NB}Just Run${NB}»`, `«${NB}Cours, c’est tout${NB}»`, '«Solo corre»']));
  });

  it('quote a Together template in the reader’s language, and anything unknown as sent', () => {
    const invite = { challenge_id: 'c1', from_name: 'Sam', title: 'Four of a Kind' };
    expect(buildMessage('challenge_invite', invite, 'en').body).toContain('"Four of a Kind"');
    expect(buildMessage('challenge_invite', invite, 'fr').body).toContain(`«${NB}Carré d’as${NB}»`);
    expect(buildMessage('challenge_completed', { ...invite, total: 40 }, 'es').body).toContain('«Póker de ases»');
    expect(buildMessage('challenge_invite', { ...invite, title: 'Brand New' }, 'fr').body).toContain('Brand New');
  });
});

describe('the weekly summary email', () => {
  it('names completed weekly challenges in the reader’s language, English as the catalog has it', () => {
    const { weeklyChallengeTitle } = require('@/supabase/functions/_shared/i18n/index');
    expect(weeklyChallengeTitle('en', 'gym-no-days-off', 'No Days Off')).toBe('No Days Off');
    expect(weeklyChallengeTitle('fr', 'gym-no-days-off', 'No Days Off')).toBe('Zéro jour off');
    expect(weeklyChallengeTitle('es', 'multi-5-days', '5 Days Active')).toBe('5 días activos');
    expect(weeklyChallengeTitle('fr', 'gym-no-days-off', 'Renamed By Admin')).toBe('Renamed By Admin');
    expect(weeklyChallengeTitle('fr', 'unknown-id', 'Mystery')).toBe('Mystery');
  });
});
