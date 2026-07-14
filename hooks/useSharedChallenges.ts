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
import { supabase } from '@/lib/supabase';
import { useFriends } from '@/hooks/useFriends';
import type {
  ChallengeTemplate,
  Friend,
  IconSpec,
  Participant,
  SharedChallenge,
} from '@/lib/social/types';

export interface NewChallengeInput {
  templateId: string;
  friendIds: string[];
}

const CATEGORY_LABEL: Record<string, string> = {
  gym: 'Gym', walking: 'Walking', running: 'Running', cycling: 'Cycling', multi: 'All',
};
const CATEGORY_ICON: Record<string, IconSpec> = {
  gym: { lib: 'ion', name: 'barbell' },
  walking: { lib: 'ion', name: 'walk' },
  running: { lib: 'mc', name: 'run' },
  cycling: { lib: 'mc', name: 'bike' },
  multi: { lib: 'ion', name: 'flame' },
};

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
    // Terminal statuses map through truthfully — the list RPC never returns
    // expired/cancelled, but the by-id fallback (old notification links) can.
    status: row.status === 'completed' || row.status === 'expired' || row.status === 'cancelled'
      ? row.status
      : 'active',
    creatorId: row.creator_id,
    participants,
    expiresIn: humanizeRemaining(row.ends_at),
    endsAt: row.ends_at,
    acceptBy: row.accept_by,
    durationHours: row.duration_hours,
    pendingInviteFromName:
      self?.state === 'invited' ? creator?.friend.displayName ?? 'A friend' : undefined,
    pool,
    goalTarget,
    goalRule,
    dismissedAt: row.dismissed_at ?? null,
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
  createChallenge: (input: NewChallengeInput) => Promise<void>;
  acceptInvite: (challengeId: string) => Promise<void>;
  declineInvite: (challengeId: string) => Promise<void>;
  leaveChallenge: (challengeId: string) => Promise<void>;
  /** Creator-only: pull more friends into a forming/active challenge. Returns
   *  the count actually (re)invited, or throws on a rejected request. */
  inviteToChallenge: (challengeId: string, userIds: string[]) => Promise<number>;
  /** Hide a settled challenge card from YOUR Home (per-user display flag). */
  dismissChallenge: (challengeId: string) => Promise<void>;
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
  const [templates, setTemplates] = useState<ChallengeTemplate[]>([]);
  const [cap, setCap] = useState(3);
  const [bonusConfig, setBonusConfig] = useState({ perHead: 5, maxBonus: 30 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [newlyCompletedId, setNewlyCompletedId] = useState<string | null>(null);
  const checkedRef = useRef<Set<string>>(new Set());

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

  const pendingInvites = useMemo(
    () => all.filter((c) => c.participants.some((p) => p.isSelf && p.state === 'invited')),
    [all],
  );
  // Home surface: everything you're committed to, minus settled cards you've
  // dismissed. `all` (and so getById / the detail screen) keeps them — dismissal
  // is a display preference, not data removal.
  const active = useMemo(
    () => all.filter(
      (c) => !c.participants.some((p) => p.isSelf && p.state === 'invited')
        && !(c.status === 'completed' && c.dismissedAt),
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
      return c.status === 'active' && c.endsAt && self?.state === 'accepted'
        && !self.completed && !checkedRef.current.has(c.id);
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
  }, [all, completeRaw, load]);

  const createChallenge = useCallback(async ({ templateId, friendIds }: NewChallengeInput) => {
    // No duration: the run length is the template's (server reads it there).
    const { error } = await supabase.functions.invoke('create-shared-challenge', {
      body: { template_id: templateId, friend_ids: friendIds, utc_offset_minutes: utcOffsetMinutes },
    });
    if (error) console.warn('[useSharedChallenges] create failed:', error.message);
    await load();
  }, [utcOffsetMinutes, load]);

  const respond = useCallback(async (challengeId: string, action: 'accept' | 'decline' | 'leave' | 'dismiss') => {
    const { error } = await supabase.functions.invoke('respond-shared-challenge', {
      body: { challenge_id: challengeId, action },
    });
    if (error) console.warn(`[useSharedChallenges] ${action} failed:`, error.message);
    await load();
  }, [load]);

  const acceptInvite = useCallback((id: string) => respond(id, 'accept'), [respond]);
  const declineInvite = useCallback((id: string) => respond(id, 'decline'), [respond]);
  const leaveChallenge = useCallback((id: string) => respond(id, 'leave'), [respond]);
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
    getById, createChallenge, acceptInvite, declineInvite, leaveChallenge, inviteToChallenge,
    dismissChallenge, fetchById, completeChallenge,
    newlyCompletedId, clearCelebration, refresh: load,
  };
}
