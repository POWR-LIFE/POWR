/**
 * The Series bounty (20261118160000): what the Overall tab's bounty row says
 * to the chaser, the member it's on, someone who was already ahead, in Blind
 * Mode, and once it's claimed. The server decides who can claim; the app only
 * words it (components/series/SeriesBounty).
 */
import fs from 'fs';
import path from 'path';

import { bountyCopy } from '@/components/series/SeriesBounty';
import type { SeriesBounty } from '@/lib/api/series';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const bounty = (over: Partial<SeriesBounty> = {}): SeriesBounty => ({
    id: 'b1', status: 'live', prize: '£50 Gymshark voucher', detail: null, sponsor: 'Gymshark', image_url: null,
    placed_at: '2026-11-18T10:00:00Z', ends_at: null, claimed_at: null,
    target: { user_id: 't', name: 'Alex Reid', avatar_url: null, you: false, points: 240 },
    claimer: null,
    you: { can_claim: true, gap: 34 },
    ...over,
});

describe('a live bounty', () => {
    it('tells a chaser how far they are from it', () => {
        const c = bountyCopy(bounty(), NOW);
        expect(c.eyebrow).toBe('BOUNTY · ON ALEX REID');
        expect(c.line).toBe('Overtake Alex Reid to win it · 34 pts to go');
        expect(c.ends).toBeNull();
        expect(c.mine).toBe(false);
    });

    it('says it is theirs once they are past (the claim lands on the minute)', () => {
        expect(bountyCopy(bounty({ you: { can_claim: true, gap: 0 } }), NOW).line).toBe("You're past Alex Reid: it's yours in a minute");
        expect(bountyCopy(bounty({ you: { can_claim: true, gap: -12 } }), NOW).line).toBe("You're past Alex Reid: it's yours in a minute");
    });

    it('tells someone who was ahead when it went on that it is for the chasers', () => {
        expect(bountyCopy(bounty({ you: { can_claim: false, gap: null } }), NOW).line).toBe('For the chasers: you were ahead of Alex Reid when it went on');
    });

    it('gives no gap in Blind Mode', () => {
        const c = bountyCopy(bounty({ you: { can_claim: true, gap: null }, target: { ...bounty().target, points: null } }), NOW);
        expect(c.line).toBe('Overtake Alex Reid to win it · claims wait for Blind Mode to lift');
        expect(c.line).not.toMatch(/\d/);
    });

    it('speaks to the member it is on', () => {
        const c = bountyCopy(bounty({ target: { ...bounty().target, you: true }, you: null }), NOW);
        expect(c.eyebrow).toBe("THERE'S A BOUNTY ON YOU");
        expect(c.line).toBe('Whoever overtakes you wins it. Stay ahead.');
    });

    it('just names the target for someone not in the round', () => {
        expect(bountyCopy(bounty({ you: null }), NOW).line).toBe('Overtake Alex Reid to win it');
    });

    it('counts down an end time', () => {
        const c = bountyCopy(bounty({ ends_at: '2026-11-19T15:00:00Z' }), NOW);
        expect(c.ends).toMatch(/^ENDS IN /);
        expect(c.ends).toMatch(/1/);
    });
});

describe('a claimed bounty', () => {
    const claimed = (claimerYou: boolean, targetYou = false) => bounty({
        status: 'claimed', claimed_at: '2026-11-18T11:40:00Z', you: null, ends_at: '2026-11-19T15:00:00Z',
        target: { ...bounty().target, you: targetYou },
        claimer: { user_id: 'c', name: 'Marta Ruiz', avatar_url: null, you: claimerYou },
    });

    it('says who took it', () => {
        const c = bountyCopy(claimed(false), NOW);
        expect(c.eyebrow).toBe('BOUNTY CLAIMED');
        expect(c.line).toBe('Marta Ruiz overtook Alex Reid and took it');
        expect(c.ends).toBeNull();
        expect(c.mine).toBe(false);
    });

    it('in gold for the winner', () => {
        const c = bountyCopy(claimed(true), NOW);
        expect(c.line).toBe('You overtook Alex Reid and won it');
        expect(c.mine).toBe(true);
    });

    it('to the member it was on', () => {
        expect(bountyCopy(claimed(false, true), NOW).line).toBe('Marta Ruiz overtook you and took it');
    });
});

describe('copy', () => {
    it('has every bounty line in English, French and Spanish', () => {
        const read = (lang: string) => JSON.parse(fs.readFileSync(path.join(__dirname, `../shared/i18n/${lang}/app/series.json`), 'utf8')).bounty;
        const en = read('en');
        for (const lang of ['fr', 'es']) {
            const other = read(lang);
            expect(Object.keys(other).sort()).toEqual(Object.keys(en).sort());
            for (const k of Object.keys(en)) {
                const vars = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();
                expect(vars(other[k])).toEqual(vars(en[k]));
            }
        }
    });
});
