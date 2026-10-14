/**
 * Bell-feed rows in the reader's language (lib/i18n/activityFeedText.ts).
 * A row is written by send-push-notification with the push's title/body in the
 * member's language at send time, plus the push's `data`. It's rebuilt in the
 * reader's language only when that data provably reproduces the stored words.
 */
import { activityFeedText } from '@/lib/i18n/activityFeedText';
import { applyNotifOverrides, buildMessage, type NotificationType } from '@/supabase/functions/_shared/pushCopy';

/** What send-push-notification inserts into user_activity (data through JSON, as Postgres keeps it). */
function storedRow(type: NotificationType, payload: Record<string, unknown>, lang = 'en') {
  const msg = buildMessage(type, payload, lang);
  return { type, title: msg.title, body: msg.body, data: JSON.parse(JSON.stringify(msg.data ?? {})) };
}

describe('activityFeedText', () => {
  const levelUp = storedRow('level_up', { level: 5 });
  const milestone = storedRow('points_milestone', { points: 1200, points_to_unlock: 150, reward_name: 'Free coffee' });

  it('shows an English row to an English reader exactly as stored', () => {
    for (const row of [levelUp, milestone]) {
      expect(activityFeedText(row, 'en')).toEqual({ title: row.title, body: row.body });
    }
  });

  it('rebuilds an English row in French and Spanish when its data reproduces it', () => {
    for (const lang of ['fr', 'es']) {
      for (const [type, payload] of [
        ['level_up', { level: 5 }],
        ['points_milestone', { points: 1200, points_to_unlock: 150, reward_name: 'Free coffee' }],
        ['streak_rescued', { current_streak: 9 }],
        ['vault_unlocked', { points: 300 }],
      ] as [NotificationType, Record<string, unknown>][]) {
        const row = storedRow(type, payload);
        const expected = buildMessage(type, payload, lang);
        expect(activityFeedText(row, lang)).toEqual({ title: expected.title, body: expected.body });
        expect(activityFeedText(row, lang).title).not.toBe(row.title);
      }
    }
  });

  it('moves a row stored in French to Spanish, and back to English', () => {
    const french = storedRow('level_up', { level: 5 }, 'fr');
    const es = buildMessage('level_up', { level: 5 }, 'es');
    expect(activityFeedText(french, 'es')).toEqual({ title: es.title, body: es.body });
    expect(activityFeedText(french, 'en')).toEqual({ title: levelUp.title, body: levelUp.body });
    expect(activityFeedText(french, 'fr')).toEqual({ title: french.title, body: french.body });
  });

  it("keeps the stored words when the data doesn't hold what they were built from", () => {
    // The reward's name never rides in data.
    const reward = storedRow('reward_unlocked', { reward_name: 'Free coffee', reward_id: 'r1' });
    expect(activityFeedText(reward, 'fr')).toEqual({ title: reward.title, body: reward.body });
    // Nor does the streak a lost-streak offer names.
    const lost = storedRow('streak_lost', { lost_streak: 12, requirement_text: '2 sessions', window_hours: 48 });
    expect(activityFeedText(lost, 'es')).toEqual({ title: lost.title, body: lost.body });
  });

  it('keeps copy an admin overrode, and copy that has since changed', () => {
    const msg = buildMessage('level_up', { level: 5 }, 'en');
    const overridden = applyNotifOverrides(msg, { title_override: 'Big news', body_override: null }, 'en');
    const row = { type: 'level_up', title: overridden.title, body: overridden.body, data: { level: 5 } };
    expect(activityFeedText(row, 'fr')).toEqual({ title: 'Big news', body: msg.body });
    const old = { ...levelUp, body: 'Wording from last year' };
    expect(activityFeedText(old, 'fr')).toEqual({ title: old.title, body: old.body });
  });

  it('leaves admin broadcasts exactly as typed', () => {
    const row = { type: 'announcement', title: 'New in POWR', body: 'Typed by a human', data: { broadcast: true } };
    for (const lang of ['en', 'fr', 'es']) expect(activityFeedText(row, lang)).toEqual({ title: row.title, body: row.body });
  });

  it('passes through anything it cannot rebuild', () => {
    const odd = { type: 'something_new', title: 'Hi', body: 'There', data: null };
    expect(activityFeedText(odd, 'fr')).toEqual({ title: 'Hi', body: 'There' });
    expect(activityFeedText(levelUp, 'de')).toEqual({ title: levelUp.title, body: levelUp.body });
  });
});
