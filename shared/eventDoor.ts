// Live-event door board — the interpretation layer.
//
// admin_get_event_door (20260819150000_live_event_door.sql) returns FACTS per
// person: roster/booking/gate state, and what the venue geofence saw (first
// entry, freshest presence proof, last close, open visit?) plus any manual
// mark by the door. Everything here is the JUDGEMENT on top — "inside now",
// "left", "arrived (by hand)" — kept as pure functions with jest coverage
// for the same reason as shared/liveops.ts: a rule that is wrong inside SQL
// is invisible, and these rules have been wrong before.
//
// Field semantics this leans on (learned the hard way on Live Ops):
//   • A geofence visit proves ARRIVAL. Its absence proves nothing — the fence
//     needs the app, Always+Precise, and a live device. So "not seen" is a
//     label, never a verdict, and the manual mark exists for exactly that.
//   • An OPEN visit with a fresh proof is "inside". An open visit whose proof
//     has gone stale is "inside?" — the app may be dead, or they may have
//     left and the exit hasn't been detected. We say which stamp we have.
//   • last_proof_at is the NEWER of last_proven_at / last_confirmed_at /
//     started_at, folded in SQL.

// ── Thresholds ───────────────────────────────────────────────────────────────

/** An open visit whose freshest proof is older than this is "inside?" not "inside". Mirrors liveops STUCK_PRESENCE_AFTER_MIN. */
export const PRESENCE_FRESH_MIN = 45;

/** Board auto-refresh cadence, ms. */
export const DOOR_POLL_MS = 15_000;

/** The board auto-polls from this long before doors until this long after. */
export const DOOR_LIVE_MARGIN_MIN = 120;

// ── Shapes returned by the RPC ───────────────────────────────────────────────

export interface DoorEvent {
  id: string;
  scope: 'opt_in' | 'global' | string;
  status: string;
  venue_partner_id: string | null;
  venue_name: string | null;
  gate_n: number;
  gate_counting: 'signups' | 'conversions' | string;
  band_from: string;
  band_to: string | null;
  band_source: 'doors' | 'lock' | 'window' | string;
  doors_open_at: string | null;
  doors_close_at: string | null;
}

export interface DoorRow {
  user_id: string;
  name: string;
  username: string | null;
  email: string | null;
  member_id: string | null;
  on_roster: boolean;
  joined_at: string | null;
  disqualified_at: string | null;
  booked: boolean;
  /** null when the event has no gate. */
  gate_count: number | null;
  first_entered_at: string | null;
  last_proof_at: string | null;
  last_ended_at: string | null;
  has_open_visit: boolean;
  visit_count: number;
  platform: string | null;
  last_status: string | null;
  manual_checked_in_at: string | null;
  manual_by: string | null;
  manual_note: string | null;
}

export interface DoorPayload {
  event: DoorEvent;
  rows: DoorRow[];
  generated_at: string;
}

// ── Presence ─────────────────────────────────────────────────────────────────

export type PresenceKey = 'inside' | 'inside_stale' | 'left' | 'manual' | 'not_seen';

export interface Presence {
  key: PresenceKey;
  label: string;
  /** One line of evidence: which stamp, how old. */
  detail: string;
  /** The timestamp the label rests on, for sorting. */
  at: string | null;
  /** True for anything that counts as "arrived" on the tiles. */
  arrived: boolean;
}

const minutesBetween = (iso: string, now: number): number => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));

const ago = (iso: string, now: number): string => {
  const m = minutesBetween(iso, now);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m ago` : `${Math.floor(h / 24)}d ago`;
};

const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/**
 * Where is this person, as far as we can tell.
 *
 * Geofence outranks the manual mark (a device proof is stronger than a tap),
 * and among geofence states an open visit outranks a closed one.
 */
export function presence(row: DoorRow, now: number = Date.now()): Presence {
  if (row.has_open_visit && row.last_proof_at) {
    const m = minutesBetween(row.last_proof_at, now);
    if (m <= PRESENCE_FRESH_MIN) {
      return { key: 'inside', label: 'INSIDE', detail: `proof ${ago(row.last_proof_at, now)}`, at: row.last_proof_at, arrived: true };
    }
    return { key: 'inside_stale', label: 'INSIDE?', detail: `last proof ${ago(row.last_proof_at, now)} — app may be asleep or they left unseen`, at: row.last_proof_at, arrived: true };
  }
  if (row.first_entered_at && row.last_ended_at) {
    return { key: 'left', label: 'LEFT', detail: `in ${clock(row.first_entered_at)} · out ${clock(row.last_ended_at)}`, at: row.last_ended_at, arrived: true };
  }
  if (row.first_entered_at) {
    // Visit rows exist but none open and no close stamp — shouldn't happen,
    // but "arrived" is still the truthful summary.
    return { key: 'left', label: 'SEEN', detail: `in ${clock(row.first_entered_at)}`, at: row.first_entered_at, arrived: true };
  }
  if (row.manual_checked_in_at) {
    const by = row.manual_by ? ` by ${row.manual_by}` : '';
    return { key: 'manual', label: 'ARRIVED', detail: `marked${by} ${clock(row.manual_checked_in_at)}`, at: row.manual_checked_in_at, arrived: true };
  }
  return { key: 'not_seen', label: 'NOT SEEN', detail: 'no geofence visit, no manual mark', at: null, arrived: false };
}

// ── Qualification ────────────────────────────────────────────────────────────

/** Gate met — a gateless event qualifies everyone. */
export function gateMet(row: Pick<DoorRow, 'gate_count'>, gateN: number): boolean {
  if (!gateN || gateN <= 0) return true;
  return (row.gate_count ?? 0) >= gateN;
}

/** "3 / 5" or "—" when there's no gate. */
export function gateLabel(row: Pick<DoorRow, 'gate_count'>, gateN: number): string {
  if (!gateN || gateN <= 0) return '—';
  return `${row.gate_count ?? 0} / ${gateN}`;
}

// ── Totals ───────────────────────────────────────────────────────────────────

export interface DoorTotals {
  registered: number;
  qualified: number;
  booked: number;
  arrived: number;
  inside: number;
  walkIns: number;
}

/**
 * Tile numbers. Registered/qualified/booked count the roster; arrived/inside
 * count anyone on the board (walk-ins are in the building too); walkIns is
 * the fence-seen-but-not-registered list.
 */
export function doorTotals(rows: DoorRow[], gateN: number, now: number = Date.now()): DoorTotals {
  const t: DoorTotals = { registered: 0, qualified: 0, booked: 0, arrived: 0, inside: 0, walkIns: 0 };
  for (const r of rows) {
    const p = presence(r, now);
    if (r.on_roster && !r.disqualified_at) {
      t.registered += 1;
      if (gateMet(r, gateN)) t.qualified += 1;
      if (r.booked) t.booked += 1;
    }
    if (p.arrived) t.arrived += 1;
    if (p.key === 'inside' || p.key === 'inside_stale') t.inside += 1;
    if (!r.on_roster && p.arrived) t.walkIns += 1;
  }
  return t;
}

// ── Ordering / filtering ─────────────────────────────────────────────────────

const PRESENCE_RANK: Record<PresenceKey, number> = {
  inside: 0, inside_stale: 1, manual: 2, left: 3, not_seen: 4,
};

/** Inside first, then by hand, then left, then not seen; freshest on top within a band. */
export function sortDoorRows(rows: DoorRow[], now: number = Date.now()): DoorRow[] {
  return [...rows].sort((a, b) => {
    const pa = presence(a, now), pb = presence(b, now);
    const r = PRESENCE_RANK[pa.key] - PRESENCE_RANK[pb.key];
    if (r !== 0) return r;
    const ta = pa.at ? new Date(pa.at).getTime() : 0;
    const tb = pb.at ? new Date(pb.at).getTime() : 0;
    if (ta !== tb) return tb - ta;
    return a.name.localeCompare(b.name);
  });
}

export type DoorFilter = 'all' | 'qualified' | 'arrived' | 'not_arrived' | 'walk_ins';

export function filterDoorRows(rows: DoorRow[], filter: DoorFilter, gateN: number, now: number = Date.now()): DoorRow[] {
  switch (filter) {
    case 'qualified':   return rows.filter(r => r.on_roster && !r.disqualified_at && gateMet(r, gateN));
    case 'arrived':     return rows.filter(r => presence(r, now).arrived);
    case 'not_arrived': return rows.filter(r => r.on_roster && !presence(r, now).arrived);
    case 'walk_ins':    return rows.filter(r => !r.on_roster);
    default:            return rows;
  }
}

/** Free-text match on name / username / email / member id. */
export function searchDoorRows(rows: DoorRow[], query: string): DoorRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  const code = q.replace(/[\s-]+/g, '').toUpperCase();
  return rows.filter(r =>
    [r.name, r.username, r.email].some(v => (v ?? '').toLowerCase().includes(q))
    || (code.length >= 3 && !!r.member_id && r.member_id.startsWith(code)));
}

// ── Band ─────────────────────────────────────────────────────────────────────

export interface BandInfo {
  /** What the UI should call the band. */
  label: string;
  /** True when the board should be auto-polling. */
  live: boolean;
  /** True when the band came from a fallback — nudge to set doors. */
  fallback: boolean;
}

export function bandInfo(ev: Pick<DoorEvent, 'band_from' | 'band_to' | 'band_source'>, now: number = Date.now()): BandInfo {
  const from = new Date(ev.band_from).getTime();
  const to = ev.band_to ? new Date(ev.band_to).getTime() : null;
  const margin = DOOR_LIVE_MARGIN_MIN * 60_000;
  const live = now >= from - margin && (to === null || now <= to + margin);
  const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const span = to ? `${fmt(ev.band_from)} → ${fmt(ev.band_to as string)}` : `from ${fmt(ev.band_from)}`;
  switch (ev.band_source) {
    case 'doors':  return { label: `Doors ${span}`, live, fallback: false };
    case 'lock':   return { label: `No doors set — counting from board lock, ${span}`, live, fallback: true };
    default:       return { label: `No doors set — counting from window end, ${span}`, live, fallback: true };
  }
}

// ── Export ───────────────────────────────────────────────────────────────────

const csvQ = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;

export function doorCsv(rows: DoorRow[], gateN: number, now: number = Date.now()): string {
  const header = 'name,username,email,member_id,registered,qualified,gate,booked,presence,first_entered_at,last_proof_at,last_ended_at,manual_checked_in_at,manual_by,note';
  const lines = sortDoorRows(rows, now).map(r => {
    const p = presence(r, now);
    return [
      csvQ(r.name), csvQ(r.username), csvQ(r.email), csvQ(r.member_id),
      r.on_roster && !r.disqualified_at ? 'yes' : 'no',
      gateMet(r, gateN) ? 'yes' : 'no',
      csvQ(gateLabel(r, gateN)),
      r.booked ? 'yes' : 'no',
      p.label,
      csvQ(r.first_entered_at), csvQ(r.last_proof_at), csvQ(r.last_ended_at),
      csvQ(r.manual_checked_in_at), csvQ(r.manual_by), csvQ(r.manual_note),
    ].join(',');
  });
  return [header, ...lines].join('\n');
}
