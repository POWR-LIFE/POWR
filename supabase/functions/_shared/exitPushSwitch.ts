/**
 * The admin switch for the walk-out banner — "Session complete 💪 · {gym} ·
 * N min · +X pts today" — kept in notification_config under
 * 'gym_session_complete' and flipped from /admin/notifications.
 *
 * The beacon delivers this banner itself (_shared/visiblePush.ts), so it never
 * passes send-push-notification, where every other type's kill-switch and copy
 * overrides are applied. These helpers give the beacon the same two controls.
 *
 * Pure so it can be unit-tested; the beacon supplies the row.
 */

import { formatLocale, tPush } from './i18n/index.ts';

export interface ExitPushSwitchRow {
  enabled?: boolean | null;
  enabled_changed_at?: string | null;
  title_override?: string | null;
  body_override?: string | null;
}

/** Does the complete pass run at all this tick?
 *
 *  A failed read SKIPS the tick rather than sending: nothing is stamped when the
 *  pass is skipped, so every owed banner is still owed on the next tick a minute
 *  later. Sending through a failed read would ignore a switch someone turned
 *  off to run a test. No row at all means the switch has not been created, and
 *  the banner behaves as it did before the switch existed. */
export function exitPushPassOpen(row: ExitPushSwitchRow | null, readFailed: boolean): boolean {
  if (readFailed) return false;
  return row?.enabled !== false;
}

/** Did this visit end while the switch was off?
 *
 *  The complete pass is a catch-up scan over every unstamped visit from the
 *  last two hours, and switching it off leaves those rows unstamped (stamping
 *  would tell Live Ops a banner was sent). Without this, switching back on
 *  would deliver the whole backlog in one tick. enabled_changed_at is stamped by
 *  a trigger whenever `enabled` flips, so on an enabled row it is the moment
 *  the switch came back on. */
export function exitPushEndedWhileOff(row: ExitPushSwitchRow | null, endedAt: string): boolean {
  const changedAt = row?.enabled_changed_at ? Date.parse(row.enabled_changed_at) : NaN;
  if (!Number.isFinite(changedAt)) return false;
  return Date.parse(endedAt) < changedAt;
}

/** The banner's own words: "Session complete 💪" / "{gym} · N min · +X pts
 *  today", in the member's language. `gymName` null/undefined = the visit's
 *  partner had no name. */
export function exitPushDefaultCopy(
  lang: string,
  gymName: string | null | undefined,
  mins: number,
  totalPts: number,
): { title: string; body: string } {
  const gym = gymName ?? tPush(lang, 'gymSessionComplete.yourGym');
  const points = lang === 'en' ? `${totalPts}` : totalPts.toLocaleString(formatLocale(lang));
  return {
    title: tPush(lang, 'gymSessionComplete.title'),
    body: totalPts > 0
      ? tPush(lang, 'gymSessionComplete.bodyPoints', { gym, minutes: `${mins}`, points })
      : tPush(lang, 'gymSessionComplete.body', { gym, minutes: `${mins}` }),
  };
}

/** Copy overrides, applied the way send-push applies them: a set override
 *  replaces the whole title or body with static text.
 *
 *  ENGLISH ONLY: an override is one line an admin typed in English, with no
 *  translation behind it, so a member reading another language keeps the
 *  translated default rather than a lone English sentence. */
export function exitPushCopy(
  row: ExitPushSwitchRow | null,
  copy: { title: string; body: string },
  lang = 'en',
): { title: string; body: string } {
  if (lang !== 'en') return copy;
  return {
    title: row?.title_override?.trim() || copy.title,
    body: row?.body_override?.trim() || copy.body,
  };
}
