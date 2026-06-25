/**
 * Mock data for shared challenges so the UI is fully interactive in Expo Go
 * before the friend-graph + shared_challenges backend lands. The
 * `useSharedChallenges` hook is the only thing that imports this — swapping to
 * Supabase later is a change to the hook, not the components.
 */

import type { ChallengeTemplate, Friend, SharedChallenge } from './types';

export const MOCK_SELF_ID = 'self';

const self: Friend = {
  id: MOCK_SELF_ID,
  username: 'you',
  displayName: 'You',
  status: 'accepted',
};

export const MOCK_FRIENDS: Friend[] = [
  { id: 'f-sam', username: 'samr', displayName: 'Sam Reyes', status: 'accepted' },
  { id: 'f-alex', username: 'alexk', displayName: 'Alex Kim', status: 'accepted' },
  { id: 'f-jo', username: 'jowild', displayName: 'Jo Wilde', status: 'accepted' },
  { id: 'f-priya', username: 'priya', displayName: 'Priya Shah', status: 'accepted' },
  { id: 'f-max', username: 'maxb', displayName: 'Max Bauer', status: 'accepted' },
  { id: 'f-nina', username: 'ninag', displayName: 'Nina Gomez', status: 'accepted' },
];

/**
 * Templates a creator can launch as a group challenge. For v1 these mirror the
 * easy/medium tier of the catalog — whether the picker draws from the live
 * weekly rotation or the full catalog is scope §8 #3 (still open).
 */
export const MOCK_TEMPLATES: ChallengeTemplate[] = [
  { id: 'gym-back-again', category: 'gym', categoryLabel: 'Gym', icon: { lib: 'ion', name: 'barbell' }, tier: 'easy', title: 'Back Again', goal: 'Check in 3× this week', basePoints: 25, mode: 'solo' },
  { id: 'walk-10k-days', category: 'walking', categoryLabel: 'Walking', icon: { lib: 'ion', name: 'walk' }, tier: 'medium', title: '10K Days', goal: '10,000 steps, 4 days', basePoints: 40, mode: 'solo' },
  { id: 'run-just-run', category: 'running', categoryLabel: 'Running', icon: { lib: 'mc', name: 'run' }, tier: 'easy', title: 'Just Run', goal: 'Log 1 run this week', basePoints: 15, mode: 'solo' },
  { id: 'gym-4-from-7', category: 'gym', categoryLabel: 'Gym', icon: { lib: 'ion', name: 'barbell' }, tier: 'medium', title: '4 From 7', goal: 'Check in 4× this week', basePoints: 40, mode: 'solo' },
  { id: 'walk-35k-week', category: 'walking', categoryLabel: 'Walking', icon: { lib: 'ion', name: 'walk' }, tier: 'medium', title: '35K Week', goal: '35,000 steps this week', basePoints: 45, mode: 'solo' },
];

const friend = (id: string): Friend =>
  MOCK_FRIENDS.find((f) => f.id === id) ?? self;

const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const days = (n: number) => iso(n * 86_400_000);
const hours = (n: number) => iso(n * 3_600_000);
const mins = (n: number) => iso(n * 60_000);

/**
 * Seeded at the concurrency cap so every state is visible on load:
 *   • sc-1, sc-3, sc-4 — open-for-you (your part not done) → fill all 3 slots
 *   • sc-2            — a pending invite → shows "Free a slot to join" while full
 *   • sc-5            — you've finished your part → does NOT consume a slot
 * Timer rule: `endsAt` is only set once everyone's accepted. sc-4 is still
 * forming (Max hasn't accepted) so it has no clock and no finishers yet. sc-3
 * ends in ~50 min so you can watch the countdown tick.
 */
export const MOCK_SHARED_CHALLENGES: SharedChallenge[] = [
  {
    id: 'sc-1',
    template: MOCK_TEMPLATES[0],
    kind: 'parallel',
    status: 'active',
    creatorId: MOCK_SELF_ID,
    expiresIn: '4d left',
    endsAt: days(4),
    participants: [
      { friend: self, state: 'accepted', progress: 0.66, completed: false, isSelf: true },
      { friend: friend('f-sam'), state: 'completed', progress: 1, completed: true },
      { friend: friend('f-alex'), state: 'accepted', progress: 0.33, completed: false },
    ],
  },
  {
    id: 'sc-2',
    template: MOCK_TEMPLATES[1],
    kind: 'parallel',
    status: 'open',
    creatorId: 'f-priya',
    expiresIn: '6d left',
    pendingInviteFromName: 'Priya',
    participants: [
      { friend: friend('f-priya'), state: 'accepted', progress: 0.5, completed: false },
      { friend: self, state: 'invited', progress: 0, completed: false, isSelf: true },
      { friend: friend('f-max'), state: 'accepted', progress: 0.25, completed: false },
    ],
  },
  {
    id: 'sc-3',
    template: MOCK_TEMPLATES[2],
    kind: 'parallel',
    status: 'active',
    creatorId: MOCK_SELF_ID,
    expiresIn: '50m left',
    endsAt: mins(50),
    participants: [
      { friend: self, state: 'accepted', progress: 0.4, completed: false, isSelf: true },
      { friend: friend('f-nina'), state: 'accepted', progress: 0.8, completed: false },
    ],
  },
  {
    id: 'sc-4',
    template: MOCK_TEMPLATES[3],
    kind: 'parallel',
    status: 'active',
    creatorId: 'f-max',
    expiresIn: 'Not started',
    endsAt: null,
    acceptBy: hours(28),
    durationHours: 72,
    participants: [
      { friend: friend('f-max'), state: 'accepted', progress: 0, completed: false },
      { friend: self, state: 'accepted', progress: 0, completed: false, isSelf: true },
      { friend: friend('f-priya'), state: 'accepted', progress: 0, completed: false },
      { friend: friend('f-alex'), state: 'invited', progress: 0, completed: false },
    ],
  },
  {
    id: 'sc-5',
    template: MOCK_TEMPLATES[4],
    kind: 'parallel',
    status: 'active',
    creatorId: MOCK_SELF_ID,
    expiresIn: '3d left',
    endsAt: days(3),
    participants: [
      { friend: self, state: 'completed', progress: 1, completed: true, isSelf: true },
      { friend: friend('f-jo'), state: 'accepted', progress: 0.6, completed: false },
      { friend: friend('f-sam'), state: 'completed', progress: 1, completed: true },
    ],
  },
];
