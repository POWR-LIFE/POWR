import { affiliateShareText, ladderPosition, stepName, type AffiliateStep } from '@/lib/api/affiliate';

const step = (id: string, n: number, name: string): AffiliateStep => ({
    id, n, label: name, points: 100, creator_rewards: { name, description: null, image_url: null, value_label: null },
});
const steps = [step('a', 5, 'Tee'), step('b', 15, 'Hoodie'), step('c', 40, 'Whoop')];

describe('ladderPosition', () => {
    it('counts converted signups by default and finds the next unreached rung', () => {
        const p = ladderPosition({ program: null, steps, reachedStepIds: ['a'], conversions: 8, signups: 20 });
        expect(p.basis).toBe(8);
        expect(p.basisWord).toBe('converted signups');
        expect(stepName(p.next)).toBe('Hoodie');
        expect(p.from).toBe(5);
        expect(p.remaining).toBe(7);
        expect(Math.round(p.pct)).toBe(30); // (8-5)/(15-5)
    });

    it('counts signups when the programme says so', () => {
        const program = { id: 'p', step_counting: 'signups' as const, creator_conversion_points: 50, invitee_bonus_points: 20, event_signup_points: 0 };
        const p = ladderPosition({ program, steps, reachedStepIds: [], conversions: 1, signups: 6 });
        expect(p.basis).toBe(6);
        expect(stepName(p.next)).toBe('Hoodie'); // the 5-rung is passed but unreached-by-milestone AND n <= basis → skipped
    });

    it('is complete when every rung is reached', () => {
        const p = ladderPosition({ program: null, steps, reachedStepIds: ['a', 'b', 'c'], conversions: 41, signups: 0 });
        expect(p.next).toBeNull();
        expect(p.pct).toBe(100);
        expect(p.remaining).toBe(0);
    });

    it('never reports negative progress when the count is behind the last reached rung', () => {
        const p = ladderPosition({ program: null, steps, reachedStepIds: ['a'], conversions: 2, signups: 0 });
        expect(p.pct).toBe(0);
    });
});

describe('affiliateShareText', () => {
    it('carries the code AND the link — iOS installs can only carry the code by hand', () => {
        const t = affiliateShareText('JAMIE10', 'jamie');
        expect(t).toContain('JAMIE10');
        expect(t).toContain('https://powr.life/join/jamie');
    });
});
