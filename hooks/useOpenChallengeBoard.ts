/**
 * The open challenge board — challenges strangers have posted, and the take
 * action.
 *
 * Why a board and not a matchmaker: measured 2026-08-21, POWR had 29 users
 * active in 30 days and only 10 with a single accepted friendship. Matching
 * needs two people wanting the same challenge at the same moment, which at that
 * scale resolves to nobody — and a search that finds nobody is a promise that
 * visibly fails, aimed squarely at the new user it was meant to hook. A board
 * is asynchronous (post Tuesday, taken Thursday) and when it is empty it simply
 * renders nothing.
 *
 * Every row here is already filtered server-side by get_open_challenges: both
 * sides opted in, a slot free, no block edge, no shared device. The client
 * re-checks nothing — it cannot be trusted to, and the take path re-authorises
 * from scratch anyway.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { edgeErrorMessage } from '@/hooks/useSharedChallenges';
import { CATEGORY_ICON, CATEGORY_LABEL } from '@/lib/social/categories';
import type { OpenChallenge } from '@/lib/social/types';

export interface TakeResult {
  ok: boolean;
  /** Server-supplied reason when `ok` is false — safe to show verbatim. */
  error?: string;
  challengeId?: string;
}

export interface UseOpenChallengeBoard {
  /** Takeable challenges, newest first. Empty when the user hasn't opted in. */
  board: OpenChallenge[];
  loading: boolean;
  /** Whether this user has turned the open board on. */
  optedIn: boolean;
  /** How many challenges this user COULD take if they opted in. A count only —
   *  no names, no faces (get_open_board_teaser). Proof that people are waiting
   *  is a far better pitch than a description of the feature, and without it a
   *  non-opted-in user has no way to discover the board exists at all. */
  teaserCount: number;
  /** Persisted immediately; flips the local flag optimistically. */
  setOptedIn: (on: boolean) => Promise<void>;
  /** Ids with a take in flight — a second tap is ignored while one is pending. */
  taking: Set<string>;
  takeChallenge: (id: string) => Promise<TakeResult>;
  refresh: () => Promise<void>;
}

function mapOpenRow(row: any): OpenChallenge {
  const tmpl = row.template ?? {};
  const category = row.category ?? tmpl.category ?? 'multi';
  return {
    id: row.id,
    template: {
      id: tmpl.id ?? row.id,
      category,
      categoryLabel: CATEGORY_LABEL[category] ?? 'Activity',
      icon: CATEGORY_ICON[category] ?? CATEGORY_ICON.multi,
      tier: tmpl.tier ?? 'medium',
      title: tmpl.title ?? 'Challenge',
      goal: tmpl.goal ?? '',
      basePoints: Number(tmpl.base_points ?? row.base_points) || 0,
      mode: tmpl.mode === 'pooled' ? 'pooled' : 'solo',
      durationHours: Number(row.duration_hours) || undefined,
    },
    kind: row.kind === 'pooled' ? 'pooled' : 'parallel',
    status: row.status,
    creatorId: row.creator_id,
    // The RPC already reduces display_name to a first name; the fallback is
    // never a username — a stranger gets a person or nothing.
    creatorName: row.creator_name || 'A POWR member',
    creatorAvatar: row.creator_avatar ?? null,
    category,
    basePoints: Number(row.base_points) || 0,
    durationHours: Number(row.duration_hours) || undefined,
    startsAt: row.starts_at ?? null,
    endsAt: row.ends_at ?? null,
    bonusPerHead: Number(row.bonus_per_head) || 0,
    bonusMax: Number(row.bonus_max) || 0,
    slotsLeft: Number(row.slots_left) || 0,
    createdAt: row.created_at,
  };
}

export function useOpenChallengeBoard(): UseOpenChallengeBoard {
  const { user } = useAuth();
  const [board, setBoard] = useState<OpenChallenge[]>([]);
  const [optedIn, setOptedInState] = useState(false);
  const [teaserCount, setTeaserCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const takingRef = useRef<Set<string>>(new Set());
  const [taking, setTaking] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!user) { setBoard([]); setOptedInState(false); setTeaserCount(0); setLoading(false); return; }
    // The opt-in read is what decides whether the shelf renders at all, so it
    // can't be inferred from an empty board — an opted-in user with nothing to
    // take and an opted-out user look identical from the rows alone.
    const [{ data: prof }, { data: rows, error }, { data: teaser }] = await Promise.all([
      supabase.from('profiles').select('open_to_strangers').eq('id', user.id).maybeSingle(),
      supabase.rpc('get_open_challenges'),
      supabase.rpc('get_open_board_teaser'),
    ]);
    setOptedInState(!!prof?.open_to_strangers);
    setTeaserCount(Number(teaser) || 0);
    if (error) {
      console.warn('[useOpenChallengeBoard] load failed:', error.message);
      setBoard([]);
    } else {
      setBoard((rows ?? []).map(mapOpenRow));
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const setOptedIn = useCallback(async (on: boolean) => {
    if (!user) return;
    setOptedInState(on); // optimistic — the switch must answer the tap
    const { error } = await supabase
      .from('profiles').update({ open_to_strangers: on }).eq('id', user.id);
    if (error) {
      console.warn('[useOpenChallengeBoard] opt-in failed:', error.message);
      setOptedInState(!on);
      return;
    }
    await load();
  }, [user, load]);

  const takeChallenge = useCallback(async (id: string): Promise<TakeResult> => {
    if (takingRef.current.has(id)) return { ok: false };
    takingRef.current.add(id);
    setTaking(new Set(takingRef.current));
    // Drop it from the shelf on the tap. Whatever the server says next, this
    // row is no longer takeable by this user — either they're in, or it's gone.
    setBoard((prev) => prev.filter((c) => c.id !== id));
    try {
      const { data, error } = await supabase.functions.invoke('respond-shared-challenge', {
        body: { action: 'take', challenge_id: id },
      });
      // A refusal arrives as a non-2xx, so the reason lives in the error's
      // response body, not in `data` — same read the challenge hook uses.
      if (error || (data as any)?.error) {
        const message = await edgeErrorMessage(error, data, 'Couldn’t take that challenge');
        await load(); // put the shelf back in sync — the row may still be live
        return { ok: false, error: message };
      }
      await load();
      return { ok: true, challengeId: id };
    } finally {
      takingRef.current.delete(id);
      setTaking(new Set(takingRef.current));
    }
  }, [load]);

  return { board, loading, optedIn, teaserCount, setOptedIn, taking, takeChallenge, refresh: load };
}
