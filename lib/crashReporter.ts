import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { readBackgroundAuth } from '@/lib/backgroundRest';
// One source of truth for the project URL and the publishable key. An autofix
// on #346 inlined a second copy of both here; it was reverted deliberately.
// Duplicating a credential is how one gets left behind at rotation — and the
// service_role rotation is already outstanding — quite apart from putting a
// second literal in front of the secret scanner it was meant to satisfy.
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/supabase';

/**
 * The crash reporter's engine: normalise, scrub, dedupe, spool, send.
 *
 * lib/crashHandler.ts is the half that must never throw and never import; this
 * is the half that does the work, and it is reached ONLY through that file's
 * lazy require(), by which time the handlers are already armed. That ordering
 * is the whole reason the two files are separate — see crashHandler's header.
 *
 * IT INHERITS ANALYTICS' RULES (lib/analytics.ts:7-35), for the same reason:
 * instrumentation must never be felt by a member. Nothing here throws to a call
 * site, nothing is awaited by the UI or by a background task, nothing retries in
 * place, nothing grows without bound. A crash reporter that delays a gym claim
 * is a worse bug than the crash it was recording.
 *
 * PRIVACY — the paragraph that makes this table different. app_events promises
 * no free text by construction; this table holds messages and stack traces,
 * which are free text on both counts. A Supabase error message can carry an
 * access token, an email address, a row id or a gym's coordinates. So the scrub
 * (redact(), below) lives in the same module as the sender, deliberately: there
 * is no path from a captured value to the network that does not pass through it,
 * and no future field can be added that quietly bypasses it. Server-side, the
 * table is admin-read-only and purged at 90 days.
 */

// ── Caps. These MUST equal the length CHECKs in the migration ──────────────
// PostgREST rejects an over-length row with 23514, and postRow() does not read
// the response body — so a mismatch here loses reports silently, which is the
// one failure mode a crash reporter cannot have.
const CAP = {
  name: 128,
  message: 1024,
  stack: 8192,
  componentStack: 4096,
  fingerprint: 64,
  route: 128,
  task: 64,
  phase: 16,
  source: 32,
  platform: 16,
  osVersion: 32,
  appVersion: 48,
  runtimeVersion: 64,
  updateId: 64,
  sessionId: 64,
  launchId: 64,
  props: 2048,
} as const;

/** Distinct fingerprints recorded per launch. A repeat of one already seen is
 *  free (it only increments a counter), so this bounds unique bugs, not volume. */
const MAX_DISTINCT_PER_LAUNCH = 12;
/** Spooled reports awaiting a send. Small on purpose: this is a diagnostic
 *  queue, not a message bus, and the newest reports are the useful ones. */
const MAX_SPOOL = 20;
const SPOOL_KEY = '@powr/crash_spool_v1';
/** The most text redact() will look at. Anything past it is discarded before
 *  scrubbing rather than after, so nothing unscrubbed can ever ship. */
const REDACT_INPUT_MAX = 64_000;

export type CrashSource = 'global_handler' | 'decorator' | 'error_boundary' | 'manual';

/** What the handler hands over. Every field is `unknown` because every field
 *  arrives from a value that was, by definition, in the middle of going wrong. */
export type CrashInput = {
  source: CrashSource;
  fatal: boolean;
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  componentStack?: unknown;
  route?: string | null;
  task?: string | null;
  phase?: string | null;
  props?: Record<string, unknown> | null;
};

type CrashRow = {
  session_id: string | null;
  launch_id: string;
  seq: number;
  repeat: number;
  source: string;
  fatal: boolean;
  name: string | null;
  message: string;
  stack: string | null;
  component_stack: string | null;
  fingerprint: string;
  route: string | null;
  task: string | null;
  phase: string | null;
  platform: string;
  os_version: string | null;
  app_version: string | null;
  runtime_version: string | null;
  update_id: string | null;
  props: Record<string, unknown> | null;
  occurred_at: string;
};

/**
 * One id per bundle execution, including headless wakes where no analytics
 * session and no auth session exist. It is what groups a cascade: the reports
 * that share a launch_id came from one process, and `seq = 0` is the one that
 * threw first — see the migration's note on why the later ones are usually
 * victims rather than causes.
 */
const LAUNCH_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

let seq = 0;
/** fingerprint → index within `pending`, so a storm is one row with repeat=400. */
const seen = new Map<string, number>();
const pending: CrashRow[] = [];
let distinct = 0;
let dropped = 0;

// ── Scrubbing ──────────────────────────────────────────────────────────────

/**
 * Order matters and is not alphabetical: specific patterns run before catch-all
 * ones, or the generic long-token rule would eat a JWT's first segment and
 * leave the rest looking like prose.
 *
 * Two choices worth defending. UUIDs become STABLE per-report placeholders, so
 * the same id in the message and again in the stack both read `<id1>` and a
 * different one reads `<id2>` — that keeps the structural fact you actually
 * reason from (these two references are the same object) and none of the
 * identifier. And coordinates are scrubbed while generic digit runs are not:
 * four or more decimal places is a lat/long, and where a member trains is this
 * app's most sensitive datum, whereas a blanket digit rule would eat the line
 * numbers and timestamps that are the parts of a stack that locate the defect.
 */
export function redact(input: string): string {
  // Bounded before a single pattern runs. Two of the patterns below scan
  // forward from every start position, so cost grows with the SQUARE of the
  // input — and this runs synchronously inside the error handler, on the JS
  // thread, where a stall is indistinguishable from a freeze. A 200 KB string
  // is not a real stack trace anyway; it is a serialised object someone threw.
  let s = input.length > REDACT_INPUT_MAX ? input.slice(0, REDACT_INPUT_MAX) : input;
  try {
    // Every quantifier is bounded, for the same reason.
    s = s.replace(/eyJ[\w-]{8,512}\.[\w-]{8,512}\.[\w-]{0,512}/g, '<jwt>');
    s = s.replace(/\bsb_(publishable|secret)_[\w-]{1,128}/g, '<key>');
    s = s.replace(/\bsbp_[a-f0-9]{20,128}/g, '<key>');
    s = s.replace(/bearer\s+[\w.~+/-]{20,1024}=*/gi, 'bearer <redacted>');
    s = s.replace(
      /([?&](access_token|refresh_token|apikey|api_key|token|code|key|secret|password)=)[^&\s"']+/gi,
      '$1<redacted>',
    );
    s = s.replace(/[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,4}/g, '<email>');
    s = s.replace(/-?\d{1,3}\.\d{4,32}/g, '<coord>');

    const ids = new Map<string, string>();
    s = s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m) => {
      const key = m.toLowerCase();
      let placeholder = ids.get(key);
      if (!placeholder) {
        placeholder = `<id${ids.size + 1}>`;
        ids.set(key, placeholder);
      }
      return placeholder;
    });

    s = s.replace(/\b[A-Za-z0-9_-]{40,}\b/g, '<token>');
  } catch {
    // A pathological input that defeats the regex engine must not cost the
    // report — but it must not ship unscrubbed either.
    return '<unscrubbable>';
  }
  return s;
}

/** Read anything off anything without trusting it: the input may be null, a
 *  bare string, a circular object, or an Error whose .stack getter throws. */
function safeStr(value: unknown): string {
  try {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    const s = String(value);
    return s === '[object Object]' ? JSON.stringify(value)?.slice(0, 4096) ?? '' : s;
  } catch {
    return '';
  }
}

function trunc(value: string | null, cap: number): string | null {
  if (value == null) return null;
  return value.length > cap ? value.slice(0, cap) : value;
}

/**
 * A stable key for "the same bug", computed from the REDACTED message so a
 * per-user id cannot split one bug into fifty rows. djb2 rather than a hash
 * library: this runs while the app is already in trouble and must not pull a
 * dependency in to do it.
 */
export function fingerprint(name: string, message: string, stack: string | null): string {
  const frame = topOwnFrame(stack);
  const basis = `${name}|${message.replace(/\d+/g, '#')}|${frame}`;
  let h = 5381;
  for (let i = 0; i < basis.length; i++) h = ((h << 5) + h + basis.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * The first frame that is ours — node_modules and [native code] frames are the
 * same for every bug and would collapse unrelated errors onto one fingerprint.
 *
 * `.jsbundle` and `.bundle` are matched too, and the COLUMN is kept: a release
 * Hermes stack has no source paths at all, only `main.jsbundle:1:207431`, so
 * without those two details every production fingerprint would fall back to the
 * same '-' and be told apart by message text alone. The column is what
 * identifies a call site in a minified bundle.
 */
function topOwnFrame(stack: string | null): string {
  if (!stack) return '-';
  try {
    for (const raw of stack.split('\n')) {
      const line = raw.trim();
      if (!line || line.includes('node_modules') || line.includes('[native code]')) continue;
      const m = line.match(/([\w.\-/]+\.(?:[jt]sx?|bundle|jsbundle)):(\d+)(?::(\d+))?/);
      if (m) return m[3] ? `${m[1]}:${m[2]}:${m[3]}` : `${m[1]}:${m[2]}`;
    }
  } catch {
    /* fall through to the constant */
  }
  return '-';
}

/** Shape-limited so a caller cannot smuggle an unbounded object into the row. */
function capProps(props: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!props) return null;
  try {
    const walk = (value: unknown, depth: number): unknown => {
      if (value == null) return value;
      if (typeof value === 'string') return redact(value).slice(0, 200);
      if (typeof value === 'number' || typeof value === 'boolean') return value;
      if (depth >= 3) return '<deep>';
      if (Array.isArray(value)) return value.slice(0, 40).map((v) => walk(v, depth + 1));
      if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value as object).slice(0, 40)) {
          out[key.slice(0, 64)] = walk((value as Record<string, unknown>)[key], depth + 1);
        }
        return out;
      }
      return '<unserialisable>';
    };
    const capped = walk(props, 0) as Record<string, unknown>;
    if (JSON.stringify(capped).length > CAP.props) return { note: 'props omitted: over cap' };
    return capped;
  } catch {
    return null;
  }
}

// ── Version context ────────────────────────────────────────────────────────
// Memoised and each half separately guarded: expo-updates may never otherwise
// load on a headless boot, and a throw while reading a version must not cost the
// report the version was meant to describe.

type VersionContext = {
  app_version: string | null;
  update_id: string | null;
  runtime_version: string | null;
};
let versionContext: VersionContext | null = null;

function readVersionContext(): VersionContext {
  if (versionContext) return versionContext;
  const ctx: VersionContext = { app_version: null, update_id: null, runtime_version: null };
  try {
    const { getAppVersion } = require('@/lib/device');
    const v = getAppVersion();
    ctx.app_version = v?.appVersion ?? null;
    ctx.update_id = v?.otaUpdateId ?? null;
  } catch {
    /* leave null */
  }
  try {
    ctx.runtime_version = require('expo-updates').runtimeVersion ?? null;
  } catch {
    /* leave null */
  }
  versionContext = ctx;
  return ctx;
}

// ── Capture ────────────────────────────────────────────────────────────────

export function buildRow(input: CrashInput): CrashRow {
  // Scrub a bounded window, then truncate — never the other way round. Cutting
  // to the column cap first would slice a token into a fragment the pattern no
  // longer recognises and ship its head anyway; scrubbing an unbounded string
  // stalls the JS thread. Taking twice the cap gives redaction the whole of
  // what can possibly be sent, and throws the rest away before it is read.
  const window = (value: unknown, cap: number) => redact(safeStr(value).slice(0, cap * 2));

  const name = window(input.name, CAP.name) || 'Error';
  const message = window(input.message, CAP.message);
  const stack = window(input.stack, CAP.stack);
  const componentStack = window(input.componentStack, CAP.componentStack);
  const version = readVersionContext();

  return {
    // The ANALYTICS launch id, read off a global rather than imported: importing
    // lib/analytics from here would drag its AppState listener and 30s flush
    // timer into every headless wake that currently never loads it. Absent
    // headlessly, which is correct — there is no screen trail to join to.
    session_id: trunc(safeStr((globalThis as Record<string, any>).__POWR_SESSION__) || null, CAP.sessionId),
    launch_id: LAUNCH_ID.slice(0, CAP.launchId),
    seq: seq++,
    repeat: 1,
    source: input.source.slice(0, CAP.source),
    fatal: input.fatal,
    name: trunc(name, CAP.name),
    // NOT NULL in the table, and an Error with no message is common enough to
    // matter (a thrown string, a rejected undefined).
    message: trunc(message, CAP.message) || 'unknown',
    stack: trunc(stack, CAP.stack) || null,
    component_stack: trunc(componentStack, CAP.componentStack) || null,
    fingerprint: fingerprint(name, message, stack || null).slice(0, CAP.fingerprint),
    route: trunc(input.route ?? null, CAP.route),
    task: trunc(input.task ?? null, CAP.task),
    phase: trunc(input.phase ?? null, CAP.phase),
    platform: Platform.OS.slice(0, CAP.platform),
    os_version: trunc(safeStr(Platform.Version) || null, CAP.osVersion),
    app_version: trunc(version.app_version, CAP.appVersion),
    runtime_version: trunc(version.runtime_version, CAP.runtimeVersion),
    update_id: trunc(version.update_id, CAP.updateId),
    props: capProps(input.props),
    occurred_at: new Date().toISOString(),
  };
}

/**
 * The entry point. Synchronous, returns void, never throws, never awaited.
 *
 * A repeat of a fingerprint already recorded this launch only bumps a counter:
 * an error firing every frame reads as one row with repeat=400 rather than 400
 * rows, and costs one map lookup per occurrence.
 */
export function ingest(input: CrashInput): void {
  try {
    const row = buildRow(input);

    const already = seen.get(row.fingerprint);
    if (already != null) {
      const prior = pending[already];
      if (prior) {
        prior.repeat += 1;
        void spool(prior);
      }
      return;
    }

    if (distinct >= MAX_DISTINCT_PER_LAUNCH && !input.fatal) {
      // Non-fatals give way. The decorator sees every console.error in the app,
      // and this codebase has ~40 call sites sitting on exactly the failure
      // paths that are hot during an incident — without this, routine logging
      // could spend the whole budget and the fatal that follows would be the
      // one report we drop. A fatal is never dropped for a budget reason.
      dropped += 1;
      markDropped();
      return;
    }
    distinct += 1;
    if (dropped > 0) row.props = { ...(row.props ?? {}), dropped_this_launch: dropped };

    seen.set(row.fingerprint, pending.length);
    pending.push(row);

    // Both, not either. The spool survives a process death but is only drained
    // on a later foreground launch; the single POST is the only thing that gets
    // a headless wake's report out of a process that may not be revisited for
    // days. Neither is awaited.
    void spool(row);
    void send(row);
  } catch {
    /* a crash reporter that throws is the bug it was hired to prevent */
  }
}

/**
 * Record a drop on a row that ALREADY EXISTS. Stamping it onto the next
 * accepted report is no good: once the cap is reached there may never be a next
 * one, and a starved launch would look identical to a quiet one.
 */
function markDropped(): void {
  const last = pending[pending.length - 1];
  if (!last) return;
  last.props = { ...(last.props ?? {}), dropped_this_launch: dropped };
  void spool(last);
}

// ── Spool ──────────────────────────────────────────────────────────────────
// AsyncStorage, not SecureStore: lib/device.ts records a background Keystore
// read hanging indefinitely, and this runs on exactly those wakes.
//
// Serialised through one promise chain so a storm cannot interleave a
// read-modify-write and lose entries.

let chain: Promise<void> = Promise.resolve();
let flushing = false;

/**
 * Read the spool without trusting what is in it.
 *
 * A truncated or corrupt value — a kill mid-write, a storage downgrade — would
 * otherwise throw on every future read AND write, wedging the queue for the life
 * of the install and silently losing every crash from then on. Dropping the
 * poisoned key costs the reports already spooled, once. Every reader goes
 * through here so no single call site can be the one that forgets.
 */
async function readSpool(): Promise<CrashRow[]> {
  const raw = await AsyncStorage.getItem(SPOOL_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CrashRow[]) : [];
  } catch {
    await AsyncStorage.removeItem(SPOOL_KEY);
    return [];
  }
}

function spool(row: CrashRow): Promise<void> {
  chain = chain
    .then(async () => {
      const list = await readSpool();
      const at = list.findIndex(
        (r) => r.launch_id === row.launch_id && r.fingerprint === row.fingerprint,
      );
      if (at >= 0) list[at] = row;
      else list.push(row);
      await AsyncStorage.setItem(SPOOL_KEY, JSON.stringify(evict(list, row.launch_id)));
    })
    .catch(() => {
      /* a spool that cannot be written is a lost report, never a crash */
    });
  return chain;
}

/**
 * Oldest-first, EXCEPT that the CURRENT launch's seq-0 report outlives that
 * launch's later ones. seq 0 is the error that threw first; everything after it
 * in the same launch is usually the downstream victim, and dropping the cause
 * to keep the symptom is the wrong half to lose.
 *
 * The protection is scoped to this launch on purpose. Protecting every seq-0
 * row ever spooled would let twenty old ones fill the queue and evict each new
 * report on arrival — turning a preference for causes into a spool that only
 * ever keeps history.
 */
function evict(list: CrashRow[], launchId: string): CrashRow[] {
  if (list.length <= MAX_SPOOL) return list;
  const keep = [...list];
  while (keep.length > MAX_SPOOL) {
    const victim = keep.findIndex((r) => !(r.seq === 0 && r.launch_id === launchId));
    keep.splice(victim >= 0 ? victim : 0, 1);
  }
  return keep;
}

// ── Send ───────────────────────────────────────────────────────────────────

/**
 * Raw fetch, never supabase-js and never bgInsert().
 *
 * bgInsert sends `Prefer: return=representation`, and app_errors deliberately
 * has no member SELECT policy — INSERT … RETURNING would be refused by RLS and
 * every report would be lost. And supabase-js's auth machinery is the thing
 * lib/backgroundRest.ts exists to keep off a wake path entirely.
 *
 * user_id is resolved HERE, at send time, rather than being captured with the
 * row: a report spooled across a device transfer or an account deletion would
 * otherwise come back 42501 or 23503 and occupy the spool forever. The cost is
 * that a spooled report is attributed to whoever is signed in when it lands,
 * which under one-account-per-device is nearly always the same person.
 */
async function postRow(row: CrashRow): Promise<boolean> {
  try {
    const auth = await readBackgroundAuth();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Prefer: 'return=minimal',
    };
    if (auth) headers.Authorization = `Bearer ${auth.accessToken}`;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/app_errors`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...row, user_id: auth ? auth.userId : null }),
    });
    // Anything below 500 is final: a 4xx will never be accepted on a retry, so
    // treating it as delivered stops one malformed row wedging the spool.
    return res.status < 500;
  } catch {
    return false;
  }
}

/** Deliberately not wrapped in withNetworkTimeout: that helper's own header
 *  records its race freezing screen-off, because RN drives setTimeout off the UI
 *  frame clock. Since nothing awaits this, a frozen fetch is a leaked promise
 *  rather than a frozen wake — strictly better than a timer that freezes too. */
function send(row: CrashRow): Promise<void> {
  return postRow(row).then(
    (ok) => {
      if (ok) void unspool(row);
    },
    () => {},
  );
}

function unspool(row: CrashRow): Promise<void> {
  chain = chain
    .then(async () => {
      const list = await readSpool();
      if (list.length === 0) return;
      const next = list.filter(
        (r) => !(r.launch_id === row.launch_id && r.fingerprint === row.fingerprint),
      );
      await AsyncStorage.setItem(SPOOL_KEY, JSON.stringify(next));
    })
    .catch(() => {});
  return chain;
}

/**
 * Drain what earlier launches left behind. Called once, from the root layout,
 * a few seconds after mount — never from a headless boot, which must not spend
 * its Doze budget uploading a backlog.
 *
 * Never rejects, so `void flush()` is always safe.
 */
export async function flush(): Promise<void> {
  // The same in-flight guard analytics uses, and for a sharper reason: the
  // recovery screen's Try again remounts the root layout, which re-arms the
  // 4-second flush timer. Two concurrent drains would read the same spool and
  // post every row twice.
  if (flushing) return;
  flushing = true;
  try {
    const list = await readSpool();
    if (list.length === 0) return;

    const keep: CrashRow[] = [];
    for (const row of list.slice(0, MAX_SPOOL)) {
      const ok = await postRow(row);
      if (!ok) keep.push(row);
    }
    chain = chain
      .then(async () => {
        // Re-read rather than overwrite: a crash captured while this drain was
        // in flight has already appended, and must not be clobbered by it.
        const now = await readSpool();
        const sent = new Set(
          list.filter((r) => !keep.includes(r)).map((r) => `${r.launch_id}|${r.fingerprint}`),
        );
        const next = now.filter((r) => !sent.has(`${r.launch_id}|${r.fingerprint}`));
        await AsyncStorage.setItem(SPOOL_KEY, JSON.stringify(next));
      })
      .catch(() => {});
    await chain;
  } catch {
    /* a failed drain is a delayed report, never a crash */
  } finally {
    flushing = false;
  }
}

/** Exposed for tests. */
export const __reporterInternals = {
  redact,
  fingerprint,
  topOwnFrame,
  buildRow,
  capProps,
  evict,
  getLaunchId: () => LAUNCH_ID,
  peek: () => [...pending],
  peekSpool: readSpool,
  settle: () => chain,
  reset: () => {
    seq = 0;
    seen.clear();
    pending.length = 0;
    distinct = 0;
    dropped = 0;
    versionContext = null;
    chain = Promise.resolve();
    flushing = false;
  },
  MAX_DISTINCT_PER_LAUNCH,
  MAX_SPOOL,
  SPOOL_KEY,
  CAP,
};
