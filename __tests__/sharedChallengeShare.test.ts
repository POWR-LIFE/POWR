/**
 * buildSharedChallengeShareInput — the completed-shared-challenge → share-card
 * mapping. The points must match what the celebration counts up to
 * (base + group bonus), never base alone.
 */

import { buildSharedChallengeShareInput } from '@/lib/social/share';
import type { SharedChallenge, Participant } from '@/lib/social/types';

function participant(id: string, opts: Partial<Participant> = {}): Participant {
    return {
        friend: { id, username: id, displayName: id, status: 'accepted' },
        state: 'completed',
        progress: 1,
        completed: true,
        ...opts,
    };
}

function challenge(overrides: Partial<SharedChallenge> = {}): SharedChallenge {
    return {
        id: 'ch1',
        template: {
            id: 't1',
            category: 'gym',
            categoryLabel: 'Gym',
            icon: { lib: 'ion', name: 'barbell' },
            tier: 'medium',
            title: 'Back Again',
            goal: 'Check in on 7 different days',
            basePoints: 30,
            mode: 'solo',
        },
        kind: 'parallel',
        status: 'completed',
        creatorId: 'me',
        participants: [
            participant('me', { isSelf: true }),
            participant('f1'),
            participant('f2', { completed: false, state: 'accepted', progress: 0.4 }),
        ],
        expiresIn: 'done',
        goalTarget: 7,
        goalRule: { kind: 'distinct_days', category: 'gym', threshold: 7 },
        ...overrides,
    };
}

test('points = base + group bonus for co-completers (perHead 5)', () => {
    // One co-completer (f1; f2 did not finish, self excluded) → 30 + 5.
    const input = buildSharedChallengeShareInput(challenge());
    expect(input.points).toBe(35);
    expect(input.challengeTitle).toBe('Back Again');
    expect(input.categoryLabel).toBe('Together');
    expect(input.tier).toBe('medium');
});

test('parallel goals read target + unit from goalTarget/goalRule', () => {
    const input = buildSharedChallengeShareInput(challenge());
    expect(input.displayGoal).toBe(7);
    expect(input.displayValue).toBe(7);
    expect(input.unit).toBe('qualifying days');
});

test('honours the server bonus config over BONUS_DEFAULTS', () => {
    // The server settles from the challenge's own snapshotted per-head/max. If
    // the card falls back to defaults (perHead 5) it brags a number that was
    // never banked — 35 instead of 42.
    const input = buildSharedChallengeShareInput(challenge(), { perHead: 12, maxBonus: 30 });
    expect(input.points).toBe(42);
});

test('respects the bonus cap from the server config', () => {
    const withFour = challenge({
        participants: [
            participant('me', { isSelf: true }),
            participant('f1'),
            participant('f2'),
            participant('f3'),
        ],
    });
    // 3 co-completers × 12 = 36, capped at 20 → 30 + 20.
    expect(buildSharedChallengeShareInput(withFour, { perHead: 12, maxBonus: 20 }).points).toBe(50);
});

test('the challenge’s own snapshot beats the live global config', () => {
    // The server settles from the challenge row's bonus_per_head/bonus_max,
    // taken at creation. If an admin retunes the global config mid-flight, the
    // card must still brag the number that was actually banked.
    const input = buildSharedChallengeShareInput(
        challenge({ bonusPerHead: 5, bonusMax: 30 }),
        { perHead: 50, maxBonus: 500 }, // global config, retuned since creation
    );
    expect(input.points).toBe(35);
});

test('pooled goals read the shared pool instead', () => {
    const input = buildSharedChallengeShareInput(
        challenge({ pool: { target: 100000, total: 104220, unit: 'steps' }, goalTarget: undefined }),
    );
    expect(input.displayGoal).toBe(100000);
    expect(input.unit).toBe('steps');
});
