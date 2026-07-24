import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import type { PointTransaction } from '@/lib/api/points';

/**
 * The ledger's filter axis. A member's history is one long undifferentiated
 * list, so the screen offers a bucket per question worth asking — "just my gym
 * points", "just what I've spent". Buckets are derived from the member's own
 * rows rather than from the full catalogue, so nobody is offered a Swimming
 * bucket they've never earned against.
 */
export type LedgerFilterKey = string;

export interface LedgerFilter {
  key: LedgerFilterKey;
  kind: 'all' | 'activity' | 'together' | 'type';
  /** Full name, for the sheet row, which has the width for it. */
  label: string;
  /** Tight name, for the header chip, which does not. */
  shortLabel: string;
  /** Which section of the sheet this belongs under. */
  group: 'all' | 'activity' | 'other';
  /** Set on activity buckets — the UI resolves icon + colour from ACTIVITIES. */
  activity: ActivityType | null;
  /** Set on type buckets — the UI resolves icon + colour from its TYPE_META. */
  type: PointTransaction['type'] | null;
  /** Rows in this bucket. */
  count: number;
  /** Net POWR across those rows — negative for spends. */
  net: number;
}

/** Together (shared-challenge) base + bonus rows — surfaced distinctly. */
export function isTogether(tx: PointTransaction): boolean {
  return tx.source === 'shared_challenge' || tx.source === 'shared_challenge_bonus';
}

/**
 * The single bucket a row belongs to. Every row lands in exactly one, so the
 * bucket list is a partition of the history: no row is unreachable, and no
 * bucket can come up empty.
 *
 * Together wins over activity so a bucket always matches the icon and badge
 * already rendered on the row — a shared-challenge run reads as TOGETHER in the
 * list, so it must filter as Together too.
 */
export function bucketOf(tx: PointTransaction): LedgerFilterKey {
  if (isTogether(tx)) return 'together';
  if (tx.activity_type && tx.activity_type in ACTIVITIES) return `activity:${tx.activity_type}`;
  return `type:${tx.type}`;
}

export function matchesLedgerFilter(tx: PointTransaction, key: LedgerFilterKey): boolean {
  return key === 'all' || bucketOf(tx) === key;
}

/**
 * Plural labels for the non-activity buckets. 'earn' is the leftovers drawer:
 * a credit with no session behind it to name an activity with.
 */
const TYPE_LABELS: Record<PointTransaction['type'], string> = {
  bonus: 'Bonuses',
  streak: 'Streaks',
  redeem: 'Rewards',
  penalty: 'Penalties',
  adjustment: 'Adjustments',
  earn: 'Other',
};

/** Credits first, then spends, then the corrections nobody goes looking for. */
const TYPE_ORDER: PointTransaction['type'][] = [
  'bonus',
  'streak',
  'redeem',
  'penalty',
  'adjustment',
  'earn',
];

const ACTIVITY_ORDER = Object.keys(ACTIVITIES) as ActivityType[];

/**
 * Builds the filter list for a member's history: an All entry carrying
 * whole-history totals, then a bucket for everything actually present.
 *
 * Ordered by row count within each group, so the member's real training sits at
 * the top of the sheet and the long tail sinks. Ties break on catalogue order so
 * the list is deterministic run to run.
 *
 * Returns just `[All]` for an empty or single-bucket history — the screen hides
 * the control in that case, since a filter that can't narrow anything is noise.
 */
export function buildLedgerFilters(transactions: PointTransaction[]): LedgerFilter[] {
  const stats = new Map<LedgerFilterKey, { count: number; net: number }>();
  for (const tx of transactions) {
    const key = bucketOf(tx);
    const stat = stats.get(key);
    if (stat) {
      stat.count += 1;
      stat.net += tx.amount;
    } else {
      stats.set(key, { count: 1, net: tx.amount });
    }
  }

  const all: LedgerFilter = {
    key: 'all',
    kind: 'all',
    label: 'All',
    shortLabel: 'All',
    group: 'all',
    activity: null,
    type: null,
    count: transactions.length,
    net: transactions.reduce((sum, tx) => sum + tx.amount, 0),
  };

  // Catalogue rank rides alongside rather than inside the filter, so the sort can
  // break ties on it without the shape leaking into what the UI consumes.
  type Ranked = { filter: LedgerFilter; rank: number };

  const activities: Ranked[] = [];
  ACTIVITY_ORDER.forEach((activity, rank) => {
    const stat = stats.get(`activity:${activity}`);
    if (!stat) return;
    activities.push({
      rank,
      filter: {
        key: `activity:${activity}`,
        kind: 'activity',
        label: ACTIVITIES[activity].label,
        shortLabel: ACTIVITIES[activity].labelShort,
        group: 'activity',
        activity,
        type: null,
        count: stat.count,
        net: stat.net,
      },
    });
  });

  const other: Ranked[] = [];
  const togetherStat = stats.get('together');
  if (togetherStat) {
    other.push({
      rank: -1, // ahead of every type bucket when counts tie
      filter: {
        key: 'together',
        kind: 'together',
        label: 'Together',
        shortLabel: 'Together',
        group: 'other',
        activity: null,
        type: null,
        count: togetherStat.count,
        net: togetherStat.net,
      },
    });
  }
  TYPE_ORDER.forEach((type, rank) => {
    const stat = stats.get(`type:${type}`);
    if (!stat) return;
    other.push({
      rank,
      filter: {
        key: `type:${type}`,
        kind: 'type',
        label: TYPE_LABELS[type],
        shortLabel: TYPE_LABELS[type],
        group: 'other',
        activity: null,
        type,
        count: stat.count,
        net: stat.net,
      },
    });
  });

  const byCountThenCatalogue = (a: Ranked, b: Ranked) =>
    b.filter.count - a.filter.count || a.rank - b.rank;

  activities.sort(byCountThenCatalogue);
  other.sort(byCountThenCatalogue);

  return [all, ...activities.map((r) => r.filter), ...other.map((r) => r.filter)];
}

/** The active filter, or the All entry. Never undefined for a key that came from the list. */
export function findLedgerFilter(filters: LedgerFilter[], key: LedgerFilterKey): LedgerFilter | null {
  return filters.find((f) => f.key === key) ?? null;
}
