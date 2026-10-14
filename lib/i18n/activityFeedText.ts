import { PUSH_CATALOGS } from '@/supabase/functions/_shared/i18n/index';
import { buildMessage, type NotificationType } from '@/supabase/functions/_shared/pushCopy';

/**
 * The words of a bell-feed ("Recent") row in the language on screen now.
 *
 * send-push-notification writes each user_activity row with the push's
 * title/body in the language the member read AT SEND TIME (rows from before
 * French and Spanish went live are English), plus the push's `data`. That data
 * is the routing payload, which for many types is everything the copy was
 * built from (level_up's level, points_milestone's points and reward, a session
 * receipt's points and streak) and for others is not (a reward's or a
 * challenge's name never rides along).
 *
 * So the row is rebuilt with the server's own pure copy (_shared/pushCopy.ts)
 * only when that is provably faithful: rebuilding it from `data` in some push
 * language must reproduce the stored title and body exactly. That proves `data`
 * holds everything the words depend on, and says which language the row was
 * written in. Then the same data is rendered in the reader's language.
 * Anything else shows as stored: data that isn't enough, copy the admin
 * overrode in /admin/notifications, copy that has since changed wording.
 *
 * A row already in the reader's language is never rebuilt, so English readers
 * see English rows byte for byte as before.
 *
 * Admin broadcasts ('announcement', data.broadcast) are free text POWR typed in
 * /admin and stay exactly as typed in every language.
 */

export type FeedText = { title: string; body: string };

type FeedRow = FeedText & { type: string; data: Record<string, unknown> | null };

const PUSH_LANGUAGES = Object.keys(PUSH_CATALOGS);

function rebuild(type: string, data: Record<string, unknown>, lang: string): FeedText | null {
  const message = buildMessage(type as NotificationType, data, lang);
  return typeof message.title === 'string' && typeof message.body === 'string' && message.title && message.body
    ? { title: message.title, body: message.body }
    : null;
}

export function activityFeedText(row: FeedRow, lang: string): FeedText {
  const stored = { title: row.title, body: row.body };
  const data = row.data ?? {};
  if (row.type === 'announcement' || data.broadcast === true) return stored;
  if (!PUSH_LANGUAGES.includes(lang)) return stored;
  try {
    // Already in the reader's language: nothing to do (and nothing to risk).
    const same = rebuild(row.type, data, lang);
    if (same && same.title === row.title && same.body === row.body) return stored;
    const writtenIn = PUSH_LANGUAGES.find(other => {
      if (other === lang) return false;
      const built = rebuild(row.type, data, other);
      return !!built && built.title === row.title && built.body === row.body;
    });
    if (!writtenIn) return stored;
    return same ?? stored;
  } catch {
    return stored;
  }
}
