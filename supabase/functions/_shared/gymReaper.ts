// Pure, dependency-free rule for when the orphaned-visit reaper may close an
// upgraded gym visit, and what it may record as the end. NO Deno or React
// Native APIs here, so both runtimes can import it:
//   - edge function (Deno): import { ... } from '../_shared/gymReaper.ts'
//   - jest (Node):          import { ... } from '@/supabase/functions/_shared/gymReaper'
//
// WHY THIS EXISTS. The reaper is the ONLY mechanism that can close a visit the
// client has forgotten, and its gate was 45 minutes of silence measured over
// four columns — one of which, last_confirmed_at, four different writers could
// advance without anybody proving anything (a coarse "inside" the geometry
// could not contradict; a claim/upgrade marker; a server-side relay from
// claim-points or upgrade-gym-tier while the phone was miles away). Every one
// of those pushed the deadline out another 45 minutes.
//
// Measured 2026-08-10: iOS visit 2efeea36 upgraded 09:08:05Z, a server-side
// `claimed` relay at 09:42:30Z moved its deadline from 09:53 to 10:27 with the
// owner miles away. Android answered every wake within ~1 s on 900 m fixes and
// could have deferred it indefinitely in principle. The mechanism meant to keep
// the reaper honest was disarming it.
//
// See project_presence_pass_defers_reaper.

/** Silence — measured over PROOF, not over contact — before an upgraded visit
 *  is presumed over. */
export const STALE_SILENCE_MS = 45 * 60 * 1000;

/**
 * The ceiling that silence-resetting cannot postpone.
 *
 * A proof-only clock is still a clock somebody can keep resetting: a device
 * sitting in a café 20 m from the gym's centroid proves presence honestly and
 * forever. Past the upgrade there is nothing left to earn, so an upper bound
 * costs a genuinely-long session nothing but the tail of its recorded duration
 * — and `ended_at` is the last PROVEN moment either way, so the ceiling decides
 * only WHEN we close, never what we write.
 *
 * Four hours from check-in: comfortably past any real gym visit (the upgrade
 * itself lands at 40 minutes), and well inside both the presence pass's 8 h
 * give-up and the 12 h abandon cron that is the outer net for everything else.
 */
export const MAX_OPEN_AFTER_UPGRADE_MS = 4 * 60 * 60 * 1000;

export interface ReaperVisitRow {
  started_at: string;
  claimed_at?: string | null;
  upgraded_at?: string | null;
  /** ⚠ NOT last_confirmed_at. See the header — that column has four writers and
   *  three of them are bookkeeping. */
  last_proven_at?: string | null;
}

export interface ReaperVerdict {
  close: boolean;
  /** The last moment presence was actually proven. Also the end we record. */
  provenMs: number;
  closeReason: 'stale_after_upgrade' | 'max_open_after_upgrade' | null;
}

const ms = (iso: string | null | undefined): number => {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

/**
 * Should this upgraded, still-open visit be closed now, and at what end?
 *
 * `provenMs` takes the max of the moments presence was genuinely established:
 * the check-in itself, the two credit gates (each of which required a
 * location-confirmed wake, and each of which can only ever fire once), and
 * last_proven_at — the only one that repeats, and the only one now written on
 * evidence strong enough to bill.
 *
 * It is never `now()`: under-report a session rather than inflate one. That
 * costs a few minutes of tail on a real walk-out and cannot manufacture dwell
 * that never happened.
 */
export function staleVisitVerdict(visit: ReaperVisitRow, nowMs: number): ReaperVerdict {
  const startedMs = ms(visit.started_at);
  const provenMs = Math.max(
    ms(visit.last_proven_at),
    ms(visit.upgraded_at),
    ms(visit.claimed_at),
    startedMs,
  );

  if (startedMs > 0 && nowMs - startedMs > MAX_OPEN_AFTER_UPGRADE_MS) {
    return { close: true, provenMs, closeReason: 'max_open_after_upgrade' };
  }
  if (provenMs <= nowMs - STALE_SILENCE_MS) {
    return { close: true, provenMs, closeReason: 'stale_after_upgrade' };
  }
  return { close: false, provenMs, closeReason: null };
}
