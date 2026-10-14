// The Monday recap and the drift digest in French and Spanish (gymRecap.*).
// English is held byte for byte by gym-recap-email.test and
// gym-account-email.test; this file checks the other languages.
import fs from 'fs';
import path from 'path';
import { gymWeeklyRecapEmail, weekLabel, type GymWeeklyRecapData } from '../supabase/functions/_shared/emails/gym-weekly-recap';
import { gymDriftDigestEmail, type GymDriftDigestData } from '../supabase/functions/_shared/emails/gym-drift-digest';
import { BUSINESS_CATALOGS } from '../supabase/functions/_shared/i18n';

const TZ = 'Europe/London';

const recap: GymWeeklyRecapData = {
  gymName: 'Stars Gym',
  // What send-gym-email passes today: the label in English.
  weekLabel: weekLabel('2026-09-13T23:00:00Z', '2026-09-20T23:00:00Z', TZ),
  tz: TZ,
  sessions: 84, prevSessions: 71, athletes: 31, prevAthletes: 31, minutes: 4620, newFaces: 3, members: 41,
  top: [{ name: 'Aisha K', points: 240, sessions: 7 }, { name: 'Tom Reid', points: 223, sessions: 1 }],
  busiest: { day: 'Tuesday', sessions: 21 },
  quiet: 4, quietNamed: true,
  events: [{ id: 'e1', name: 'October Challenge', status: 'live', participants: 23, window_start_at: '2026-09-20T23:00:00Z', window_end_at: '2026-10-18T23:00:00Z' }],
  notice: { sentAt: '2026-09-19T10:00:00Z', told: 38, away: 9, unseen: 5, back: 4, unseenBack: 2, backIn: 1, unseenBackIn: 1 },
};

const drift: GymDriftDigestData = {
  gymName: 'Stars Gym', named: true, newCount: 2, drifting: 4, slipping: 1,
  people: [
    { name: 'Callum R.', gap_days: 12, per_week: 3.1, part: 'morning', dows: [1, 3, 5] },
    { name: 'Esme W.', gap_days: 30, per_week: null },
  ],
};

const portalRetention = (lang: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'shared/i18n', lang, 'portal/venueMembers.json'), 'utf8')).retention;

describe('gym recap emails in French and Spanish', () => {
  it.each(['en', 'fr', 'es'])('word Retention exactly as the portal does (%s)', lang => {
    const email = (BUSINESS_CATALOGS as any)[lang].gymRecap.retention;
    const portal = portalRetention(lang);
    for (const group of ['quiet', 'frequency', 'pattern', 'dayParts']) expect({ group, words: email[group] }).toEqual({ group, words: portal[group] });
  });

  it('leave English as it was when no language is given', () => {
    expect(gymWeeklyRecapEmail(recap)).toEqual(gymWeeklyRecapEmail(recap, 'en'));
    expect(gymDriftDigestEmail(drift)).toEqual(gymDriftDigestEmail(drift, 'en'));
  });

  it.each(['fr', 'es'])('render whole in %s: no raw keys, no English left, the right lang', lang => {
    for (const email of [gymWeeklyRecapEmail(recap, lang), gymDriftDigestEmail(drift, lang), gymDriftDigestEmail({ ...drift, named: false }, lang)]) {
      for (const part of [email.subject, email.html, email.text]) expect(part).not.toMatch(/\{\{|gymRecap\.|undefined|NaN/);
      expect(email.html).toContain(`<html lang="${lang}">`);
      expect(email.text).not.toMatch(/\b(Sept?|Tuesday|sessions?|drifting|slipping|Retention|Usually|quiet)\b/);
    }
  });

  it('say the week, the day and the pattern in French', () => {
    const r = gymWeeklyRecapEmail(recap, 'fr');
    expect(r.subject).toBe('Stars Gym sur POWR : 84 séances la semaine dernière');
    expect(r.text).toContain('14–20 sept.');
    expect(r.text).toContain('Jour le plus chargé : mardi, 21 séances.');
    expect(r.text).toContain('4 membres fidèles décrochent');
    const d = gymDriftDigestEmail(drift, 'fr');
    expect(d.subject).toBe('Stars Gym : 2 personnes décrochent');
    expect(d.text).toContain('- Callum R. : 12 jours sans venir (En général 3 fois par semaine, le matin · lun., mer. et ven.)');
    expect(d.text).toContain('- Esme W. : 4 semaines sans venir\n');
  });

  it('say the week, the day and the pattern in Spanish', () => {
    const r = gymWeeklyRecapEmail(recap, 'es');
    expect(r.subject).toBe('Stars Gym en POWR: 84 sesiones la semana pasada');
    expect(r.text).toContain('14–20 sept');
    expect(r.text).toContain('Día con más actividad: martes, 21 sesiones.');
    const d = gymDriftDigestEmail({ ...drift, newCount: 1, people: [drift.people[0]] }, 'es');
    expect(d.subject).toBe('Stars Gym: Callum R. se está alejando');
    expect(d.text).toContain('Suele venir 3 veces por semana, por la mañana · lun, mié y vie');
  });
});
