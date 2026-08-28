/**
 * Data layer for shared ("together") challenges — Supabase-backed.
 *
 * Reads go through the get_my_shared_challenges RPC (challenges + participants in
 * one call). Mutations go through the edge functions (create/respond/complete),
 * then we refetch. This is the seam the mock used to fill — components keep the
 * same API. Completion is checked opportunistically on load (like
 * useWeeklyChallenge): when you open the app after doing the activity, your part
 * is awarded; the cron backstop covers app-closed users + the end-of-challenge
 * group-bonus settlement.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { useActivityRelevance } from '@/hooks/useGymRelevance';
import { filterTemplatesByRelevance } from '@/lib/social/templateRelevance';
import { supabase } from '@/lib/supabase';
import { useFriends } from '@/hooks/useFriends';
import { isTerminal } from '@/lib/social/status';
import { CATEGORY_ICON, CATEGORY_LABEL } from '@/lib/social/categories';
import type {
  ChallengeTemplate,
  Friend,
  IconSpec,
  Participant,
  ParticipantState,
  SharedChallenge,
} from '@/lib/social/types';

export interface NewChallengeInput {
  templateId: string;
  friendIds: string[];
  /** Post to the open board instead of (or as well as) inviting friends —
   *  anyone opted in can take it. Server-gated on the creator's own opt-in. */
  isOpen?: boolean;
  /** How many strangers may take it. Open posts only; server clamps to 1–5. */
  openSlots?: number;
}

/** Outcome of an invite response, so a rejection can be shown rather than logged. */
export interface RespondResult {
  ok: boolean;
  /** Server-supplied reason when `ok` is false — safe to show verbatim. */
  error?: string;
}

type RespondAction = 'accept' | 'decline' | 'leave' | 'dismiss' | 'cancel';

/** How our own participant row reads the moment we act, before the server agrees. */
const OPTIMISTIC_SELF_STATE: Partial<Record<RespondAction, ParticipantState>> = {
  accept: 'accepted',
  decline: 'declined',
  leave: 'left',
};

const RESPOND_FALLBACK_ERROR: Record<RespondAction, string> = {
  accept: 'Couldn’t join this challenge. Check your connection and try again.',
  decline: 'Couldn’t decline this invite. Check your connection and try again.',
  leave: 'Couldn’t leave this challenge. Check your connection and try again.',
  dismiss: 'Couldn’t clear this challenge. Check your connection and try again.',
  cancel: 'Couldn’t cancel this challenge. Check your connection and try again.',
};

/**
 * supabase-js surfaces a non-2xx edge-function reply as an error carrying the
 * Response on `context`, so the server's own message (slots full, already
 * finished) only exists if we read the body back out. Same shape join-challenge
 * and lib/api/rewards use.
 */
export async function edgeErrorMessage(fnErr: unknown, data: any, fallback: string): Promise<string> {
  try {
    const body = fnErr && typeof fnErr === 'object' && 'context' in (fnErr as any)
      ? await (fnErr as any).context.json()
      : data;
    if (body?.error) return String(body.error);
  } catch { /* body already consumed or not JSON — use the fallback */ }
  return fallback;
}

export function durationLabel(h: number): string {
  if (h % 168 === 0) return `${h / 168} week${h / 168 === 1 ? '' : 's'}`;
  if (h % 24 === 0) return `${h / 24} day${h / 24 === 1 ? '' : 's'}`;
  return `${h}h`;
}

function humanizeRemaining(endsAt?: string | null): string {
  if (!endsAt) return 'Not started';
  const ms = Date.parse(endsAt) - Date.now();
  if (ms <= 0) return 'Ended';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h left`;
  return `${Math.round(hrs / 24)}d left`;
}

function mapTemplateRow(row: any): ChallengeTemplate {
  return {
    id: row.id,
    category: row.category,
    categoryLabel: CATEGORY_LABEL[row.category] ?? 'Activity',
    icon: CATEGORY_ICON[row.category] ?? CATEGORY_ICON.multi,
    tier: row.tier,
    title: row.title,
    goal: row.goal,
    basePoints: row.base_points,
    mode: row.mode === 'pooled' ? 'pooled' : 'solo',
    durationHours: Number(row.duration_hours) || undefined,
  };
}

function mapChallengeRow(row: any): SharedChallenge {
  const participants: Participant[] = (row.participants ?? []).map((p: any) => ({
    friend: {
      id: p.user_id,
      username: p.username ?? '',
      displayName: p.display_name ?? p.username ?? '',
      avatarUrl: p.avatar_url ?? null,
      status: 'accepted',
    },
    state: p.state,
    progress: Number(p.progress) || 0,
    momentum: p.momentum && Number(p.momentum.target) > 0
      ? {
          current: Number(p.momentum.current) || 0,
          target: Number(p.momentum.target) || 0,
          unit: p.momentum.unit ?? '',
        }
      : null,
    completed: !!p.completed,
    contribution: Number(p.contribution) || 0,
    isSelf: !!p.is_self,
  }));
  const self = participants.find((p) => p.isSelf);
  const creator = participants.find((p) => p.friend.id === row.creator_id);
  const tmpl = row.template ?? {};

  // Pooled (type B): contributions sum toward one shared target.
  const isPooled = row.kind === 'pooled';
  const pool = isPooled && tmpl.pool
    ? {
        target: Number(tmpl.pool.target) || 0,
        total: participants.reduce((a, p) => a + (p.contribution ?? 0), 0),
        unit: tmpl.pool.unit ?? '',
      }
    : undefined;

  // Parallel (solo-goal): the eval rule's numeric target, so the card/detail can
  // show "1 / 3" rather than "33%". Pooled uses its own pool total instead.
  const rule = row.rule ?? {};
  const goalTarget = !isPooled && Number(rule.target) > 0 ? Number(rule.target) : undefined;
  const goalRule = !isPooled && rule.kind
    ? {
        kind: String(rule.kind),
        category: typeof rule.category === 'string' ? rule.category : undefined,
        metric: rule.metric === 'steps' || rule.metric === 'distance_m' ? rule.metric : undefined,
        threshold: Number(rule.threshold) > 0 ? Number(rule.threshold) : undefined,
        window: rule.window === 'morning' || rule.window === 'midday' || rule.window === 'evening' ? rule.window : undefined,
      }
    : undefined;

  return {
    id: row.id,
    template: {
      id: tmpl.id ?? row.id,
      category: row.category,
      categoryLabel: CATEGORY_LABEL[row.category] ?? 'Activity',
      icon: CATEGORY_ICON[row.category] ?? CATEGORY_ICON.multi,
      tier: tmpl.tier ?? 'easy',
      title: tmpl.title ?? 'Challenge',
      goal: tmpl.goal ?? '',
      basePoints: tmpl.base_points ?? row.base_points ?? 0,
      mode: row.kind === 'pooled' ? 'pooled' : 'solo',
      durationHours: Number(row.duration_hours) || undefined,
    },
    kind: row.kind ?? 'parallel',
    // The UI derives "forming" from a participant still being `invited`; DB
    // 'forming' maps to the client's 'active' so the card renders either way.
    // Terminal statuses map through truthfully. The list RPC now returns all
    // three for 3 days after they settle, so a loss gets the same closure a win
    // does instead of vanishing; the by-id fallback still resolves older ones
    // from notification links.
    status: row.status === 'completed' || row.status === 'expired' || row.status === 'cancelled'
      ? row.status
      : 'active',
    creatorId: row.creator_id,
    participants,
    expiresIn: humanizeRemaining(row.ends_at),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    acceptBy: row.accept_by,
    durationHours: row.duration_hours,
    pendingInviteFromName:
      self?.state === 'invited' ? creator?.friend.displayName ?? 'A friend' : undefined,
    pool,
    goalTarget,
    goalRule,
    dismissedAt: row.dismissed_at ?? null,
    settledAt: row.settled_at ?? null,
    bonusPerHead: row.bonus_per_head ?? null,
    bonusMax: row.bonus_max ?? null,
  };
}

/** A challenge occupies a slot when you've committed (accepted), it's live, and you're not done. */
function isOpenForSelf(c: SharedChallenge): boolean {
  const self = c.participants.find((p) => p.isSelf);
  if (!self) return false;
  return self.state === 'accepted' && !self.completed && c.status === 'active';
}

export interface UseSharedChallenges {
  loading: boolean;
  /** True when the last load() failed (RPC/network) — lets screens show a retry
   *  instead of conflating a fetch error with a genuinely-missing challenge. */
  error: boolean;
  all: SharedChallenge[];
  active: SharedChallenge[];
  pendingInvites: SharedChallenge[];
  openChallenges: SharedChallenge[];
  openCount: number;
  cap: number;
  atCap: boolean;
  friends: Friend[];
  /** Username search + friend-request, surfaced so the invite sheet can add new
   *  friends inline without spinning up a second useFriends instance. */
  search: (query: string) => Promise<Friend[]>;
  sendRequest: (friend: Friend) => void;
  templates: ChallengeTemplate[];
  bonusConfig: { perHead: number; maxBonus: number };
  selfId: string | null;
  getById: (id: string) => SharedChallenge | undefined;
  createChallenge: (input: NewChallengeInput) => Promise<RespondResult>;
  /** Answers optimistically — the card flips on the tap, then reconciles with
   *  the server. Resolves `{ ok: false, error }` if the server refused. */
  acceptInvite: (challengeId: string) => Promise<RespondResult>;
  declineInvite: (challengeId: string) => Promise<RespondResult>;
  leaveChallenge: (challengeId: string) => Promise<RespondResult>;
  /** Challenge ids with a response in flight — a second tap is ignored while
   *  one is pending, and callers can show the button as busy. */
  responding: Set<string>;
  /** Creator-only: end a live challenge for EVERYONE. `leaveChallenge` only
   *  ever moves your own row, so it is not the same thing — the detail screen's
   *  "Cancel challenge" button used to call it and quietly leave the rest of
   *  the group running. */
  cancelChallenge: (challengeId: string) => Promise<RespondResult>;
  /** Creator-only: pull more friends into a forming/active challenge. Returns
   *  the count actually (re)invited, or throws on a rejected request. */
  inviteToChallenge: (challengeId: string, userIds: string[]) => Promise<number>;
  /** Hide a settled challenge card from YOUR Home (per-user display flag). */
  dismissChallenge: (challengeId: string) => Promise<RespondResult>;
  /** Durable single-challenge fetch (no 3-day cutoff) — old notification links. */
  fetchById: (id: string) => Promise<SharedChallenge | null>;
  completeChallenge: (challengeId: string) => Promise<void>;
  newlyCompletedId: string | null;
  clearCelebration: () => void;
  refresh: () => Promise<void>;
}

export function useSharedChallenges(): UseSharedChallenges {
  const { user } = useAuth();
  const { friends, search, sendRequest } = useFriends();
  const [all, setAll] = useState<SharedChallenge[]>([]);
  const [allTemplates, setTemplates] = useState<ChallengeTemplate[]>([]);
  const { relevant } = useActivityRelevance();
  // Personalised like the weekly board — see lib/social/templateRelevance.ts.
  const templates = useMemo(() => filterTemplatesByRelevance(allTemplates, relevant), [allTemplates, relevant]);
  const [cap, setCap] = useState(3);
  const [bonusConfig, setBonusConfig] = useState({ perHead: 5, maxBonus: 30 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [newlyCompletedId, setNewlyCompletedId] = useState<string | null>(null);
  const checkedRef = useRef<Set<string>>(new Set());
  // In-flight invite responses. The ref is the guard (two taps in one frame see
  // it synchronously); the state mirror is what re-renders the button and
  // re-runs the opportunistic-completion effect once the answer lands.
  const respondingRef = useRef<Set<string>>(new Set());
  const [responding, setResponding] = useState<Set<string>>(new Set());

  const utcOffsetMinutes = -new Date().getTimezoneOffset();

  const loadConfig = useCallback(async () => {
    const [{ data: cfg }, { data: tmpls }] = await Promise.all([
      supabase.from('shared_challenge_config')
        .select('per_head, max_bonus, challenge_cap')
        .eq('id', 1).maybeSingle(),
      supabase.from('shared_challenge_templates')
        .select('id, category, title, tier, base_points, goal, measure, mode, duration_hours')
        .eq('active', true).order('sort_order', { ascending: true }),
    ]);
    if (cfg) {
      setCap(cfg.challenge_cap ?? 3);
      setBonusConfig({ perHead: cfg.per_head ?? 5, maxBonus: cfg.max_bonus ?? 30 });
    }
    if (tmpls) setTemplates(tmpls.map(mapTemplateRow));
  }, []);

  const load = useCallback(async () => {
    if (!user) { setAll([]); setError(false); setLoading(false); return; }
    const { data, error: rpcError } = await supabase.rpc('get_my_shared_challenges');
    if (rpcError) {
      // Don't wipe `all` — keep whatever we had so a transient blip doesn't blank
      // the UI — but flag the failure so detail screens can offer a retry rather
      // than wrongly claiming the challenge no longer exists.
      console.warn('[useSharedChallenges] load failed:', rpcError.message);
      setError(true);
      setLoading(false);
      return;
    }
    setAll((data ?? []).map(mapChallengeRow));
    setError(false);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadConfig(); }, [loadConfig]);
  useEffect(() => { load(); }, [load]);

  // An unanswered invite is only pending while the challenge can still be
  // joined. Terminal challenges now linger in the list for 3 days, so without
  // the status check a challenge that expired while you ignored the invite
  // would keep offering you an Accept button (which the server rejects).
  const pendingInvites = useMemo(
    () => all.filter(
      (c) => !isTerminal(c.status) && c.participants.some((p) => p.isSelf && p.state === 'invited'),
    ),
    [all],
  );
  // Home surface: everything you're committed to, minus settled cards you've
  // dismissed. `all` (and so getById / the detail screen) keeps them — dismissal
  // is a display preference, not data removal.
  //
  // Every terminal status is dismissible, not just the winning one: the list RPC
  // now lingers expired/cancelled challenges for the same 3 days, so a loss you
  // don't want to look at needs the same (X) a win has.
  const active = useMemo(
    () => all.filter(
      (c) => !c.participants.some((p) => p.isSelf && p.state === 'invited')
        && !(isTerminal(c.status) && c.dismissedAt),
    ),
    [all],
  );
  const openChallenges = useMemo(() => all.filter(isOpenForSelf), [all]);
  const openCount = openChallenges.length;
  const atCap = openCount >= cap;

  const getById = useCallback((id: string) => all.find((c) => c.id === id), [all]);

  // Opportunistic completion: for live challenges you're in but haven't finished,
  // ask the server to (re)evaluate your part. Checked once per id per mount so we
  // don't spam; evaluation also updates pooled contributions, so reload afterward.
  const completeRaw = useCallback(async (id: string) => {
    const { data } = await supabase.functions.invoke('complete-shared-challenge', {
      body: { challenge_id: id, utc_offset_minutes: utcOffsetMinutes },
    });
    return data as { newly_completed?: boolean } | null;
  }, [utcOffsetMinutes]);

  useEffect(() => {
    const candidates = all.filter((c) => {
      const self = c.participants.find((p) => p.isSelf);
      // Skip anything mid-answer: joining a running challenge marks us accepted
      // optimistically, and evaluating that before the server has our row would
      // burn the once-per-mount check on a no-op. It re-runs when the flag clears.
      return c.status === 'active' && c.endsAt && self?.state === 'accepted'
        && !self.completed && !checkedRef.current.has(c.id) && !responding.has(c.id);
    });
    if (candidates.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const c of candidates) {
        checkedRef.current.add(c.id);
        const res = await completeRaw(c.id);
        if (res?.newly_completed) {
          if (!cancelled) setNewlyCompletedId(c.id);
        }
      }
      if (!cancelled) load();
    })();
    return () => { cancelled = true; };
  }, [all, completeRaw, load, responding]);

  const createChallenge = useCallback(async (
    { templateId, friendIds, isOpen, openSlots }: NewChallengeInput,
  ): Promise<RespondResult> => {
    // No duration: the run length is the template's (server reads it there).
    const { data, error } = await supabase.functions.invoke('create-shared-challenge', {
      body: {
        template_id: templateId,
        friend_ids: friendIds,
        utc_offset_minutes: utcOffsetMinutes,
        ...(isOpen ? { is_open: true, open_slots: openSlots ?? 1 } : {}),
      },
    });
    // An open post can be refused for reasons the user can act on — they haven't
    // turned the board on, or they already have one up — so the outcome is
    // returned rather than swallowed into a console.warn the way it used to be.
    if (error || (data as any)?.error) {
      const message = await edgeErrorMessage(error, data, 'Couldn’t create that challenge');
      console.warn('[useSharedChallenges] create failed:', message);
      await load();
      return { ok: false, error: message };
    }
    await load();
    return { ok: true };
  }, [utcOffsetMinutes, load]);

  /**
   * Answer an invite. Optimistic and single-flight, because both halves of that
   * were the "I had to press Accept twice" reports:
   *   - nothing on screen moved until the edge function AND the refetch had both
   *     landed (a second or more on mobile data), so the first press read as a
   *     missed tap and people pressed again;
   *   - a rejection (slots full, challenge already finished) only ever reached a
   *     console.warn, leaving the Accept button sitting there as if untouched.
   * Patching our own participant row up front makes the card answer the tap
   * immediately; load() then reconciles against server truth, and a refusal
   * reverts the patch and comes back as a message the caller can show.
   */
  const respond = useCallback(async (
    challengeId: string,
    action: RespondAction,
  ): Promise<RespondResult> => {
    // Already answering this one — the second tap is the same intent, not a
    // second one. Report success so a caller that navigates on `ok` still does.
    if (respondingRef.current.has(challengeId)) return { ok: true };
    respondingRef.current.add(challengeId);
    setResponding(new Set(respondingRef.current));

    // What to put back if the server refuses. load() normally overwrites the
    // patch with truth, but it deliberately keeps the last good list when the
    // refetch itself fails — without this the optimistic row would survive that.
    const before = all.find((c) => c.id === challengeId);
    const priorSelfState = before?.participants.find((p) => p.isSelf)?.state;
    const priorDismissedAt = before?.dismissedAt ?? null;

    const patchSelf = (state: ParticipantState | undefined, dismissedAt: string | null) => {
      setAll((prev) => prev.map((c) => {
        if (c.id !== challengeId) return c;
        return {
          ...c,
          dismissedAt,
          participants: state
            ? c.participants.map((p) => (p.isSelf ? { ...p, state } : p))
            : c.participants,
        };
      }));
    };

    const optimisticState = OPTIMISTIC_SELF_STATE[action];
    if (optimisticState || action === 'dismiss') {
      patchSelf(
        optimisticState,
        action === 'dismiss' ? new Date().toISOString() : priorDismissedAt,
      );
    }

    try {
      const { data, error } = await supabase.functions.invoke('respond-shared-challenge', {
        body: { challenge_id: challengeId, action },
      });
      if (error || data?.ok === false) {
        const message = await edgeErrorMessage(error, data, RESPOND_FALLBACK_ERROR[action]);
        console.warn(`[useSharedChallenges] ${action} failed:`, message);
        patchSelf(priorSelfState, priorDismissedAt);
        await load(); // server truth, where it's reachable
        return { ok: false, error: message };
      }
      await load();
      return { ok: true };
    } finally {
      respondingRef.current.delete(challengeId);
      setResponding(new Set(respondingRef.current));
    }
  }, [all, load]);

  const acceptInvite = useCallback((id: string) => respond(id, 'accept'), [respond]);
  const declineInvite = useCallback((id: string) => respond(id, 'decline'), [respond]);
  const leaveChallenge = useCallback((id: string) => respond(id, 'leave'), [respond]);
  const cancelChallenge = useCallback((id: string) => respond(id, 'cancel'), [respond]);
  const dismissChallenge = useCallback((id: string) => respond(id, 'dismiss'), [respond]);

  // Durable by-id lookup for challenges the list RPC no longer returns
  // (completed >3 days ago, expired, cancelled) — old notification deep links
  // resolve through this. Not merged into `all` so history never re-enters the
  // Home surface.
  const fetchById = useCallback(async (id: string): Promise<SharedChallenge | null> => {
    const { data, error } = await supabase.rpc('get_shared_challenge', { p_id: id });
    if (error) {
      console.warn('[useSharedChallenges] fetchById failed:', error.message);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    return row ? mapChallengeRow(row) : null;
  }, []);

  const inviteToChallenge = useCallback(async (challengeId: string, userIds: string[]): Promise<number> => {
    const { data, error } = await supabase.functions.invoke('respond-shared-challenge', {
      body: { challenge_id: challengeId, action: 'invite', target_user_ids: userIds },
    });
    if (error) {
      console.warn('[useSharedChallenges] invite failed:', error.message);
      throw error;
    }
    await load();
    return Number((data as { invited?: number } | null)?.invited ?? 0);
  }, [load]);

  const completeChallenge = useCallback(async (id: string) => {
    const res = await completeRaw(id);
    if (res?.newly_completed) setNewlyCompletedId(id);
    await load();
  }, [completeRaw, load]);

  const clearCelebration = useCallback(() => setNewlyCompletedId(null), []);

  return {
    loading, error, all, active, pendingInvites, openChallenges, openCount, cap, atCap,
    friends, search, sendRequest, templates, bonusConfig,
    selfId: user?.id ?? null,
    getById, createChallenge, acceptInvite, declineInvite, leaveChallenge, cancelChallenge, inviteToChallenge,
    dismissChallenge, fetchById, completeChallenge, responding,
    newlyCompletedId, clearCelebration, refresh: load,
  };
}
