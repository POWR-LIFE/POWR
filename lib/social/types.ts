/**
 * Shared ("together") challenges — client types.
 *
 * These describe the shapes the UI consumes. They intentionally mirror the
 * planned tables (docs/shared-challenges-scope.md §4–§5) so the mock layer and
 * the eventual Supabase-backed layer expose the same surface — only the data
 * source changes, not the components.
 */

/** Icon descriptor — matches the shape used by ChallengeCardData. */
export type IconSpec = { lib: 'ion' | 'mc'; name: string };

/** A person you can invite — from the friend graph (scope §4). */
export interface Friend {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  /** Friendship state; only `accepted` friends are invitable. */
  status: 'pending' | 'accepted' | 'blocked';
  /**
   * Whether this person has the "Together" feature switched on. `false` means
   * they opted out in settings — they can't be invited (they'd never see it).
   * Defaults to true when unknown.
   */
  togetherEnabled?: boolean;
}

/** A challenge template you can launch as a group challenge. */
export interface ChallengeTemplate {
  id: string;
  category: string;
  categoryLabel: string;
  icon: IconSpec;
  tier: 'easy' | 'medium' | 'hard';
  title: string;
  /** Short "what you each have to do" line — never names a timeframe (the chosen duration is the single source of timing). */
  goal: string;
  basePoints: number;
  /** 'solo' = each does their own part; 'pooled' = effort sums toward one shared total. */
  mode: 'solo' | 'pooled';
  /**
   * Authored run length (hours) — part of the template's design, next to
   * target/tier/points. Every challenge from this template runs exactly this
   * long once everyone's in; members make no timing choice. Optional only
   * because in-flight challenge snapshots predating the column lack it.
   */
  durationHours?: number;
}

export type ParticipantState = 'invited' | 'accepted' | 'declined' | 'completed' | 'left';

/** One participant's row within a shared challenge instance. */
export interface Participant {
  friend: Friend;
  state: ParticipantState;
  /** 0–1 progress. For 'parallel' this is toward their own goal; for 'pooled' it mirrors the shared pool fraction. */
  progress: number;
  /** Did they individually finish? (drives the co-completer bonus). */
  completed: boolean;
  /** Pooled (type B) only: this person's raw contribution toward the shared total. */
  contribution?: number;
  /** True for the signed-in user's own row. */
  isSelf?: boolean;
}

export type SharedChallengeStatus = 'open' | 'active' | 'completed' | 'expired' | 'cancelled';

/** A live shared-challenge instance shown on Home. */
export interface SharedChallenge {
  id: string;
  template: ChallengeTemplate;
  /** 'parallel' for Phase 1 (each does their own part). */
  kind: 'parallel' | 'pooled' | 'synchronized' | 'versus';
  status: SharedChallengeStatus;
  creatorId: string;
  participants: Participant[];
  /** Human-readable time left, e.g. "4d left". Fallback for when `endsAt` is unset. */
  expiresIn: string;
  /**
   * ISO deadline. The clock only starts once EVERY participant has accepted, so
   * this is null/undefined while the challenge is still "forming" (someone's
   * invite is outstanding). Once set, the UI shows a live countdown to it.
   */
  endsAt?: string | null;
  /**
   * ISO accept deadline — how long invitees have to respond. Stops a forming
   * challenge hanging forever: at this point it starts with whoever's accepted
   * (≥2) or auto-cancels. Only meaningful while forming.
   */
  acceptBy?: string | null;
  /** Chosen run length, applied to `endsAt` the moment the clock starts. */
  durationHours?: number;
  /** Set when this is a pending invite the user hasn't answered yet. */
  pendingInviteFromName?: string;
  /**
   * Pooled (type B) challenges only: the shared combined goal. `total` is the sum
   * of every participant's `contribution`; the group wins when `total >= target`.
   * `unit` is the display unit ('steps' | 'km' | 'check-ins' | 'sessions' | …).
   */
  pool?: { target: number; total: number; unit: string };
  /**
   * Parallel (solo-goal) challenges: the goal's numeric target (from the eval
   * `rule`, e.g. 3 for "3 gym check-ins"). Lets the card/detail show a concrete
   * "1 / 3" readout instead of an abstract "33%". Undefined for goals with no
   * clean integer target — those fall back to the percentage.
   */
  goalTarget?: number;
}
