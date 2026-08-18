import { eventInviteLink, eventInviteMessage } from '@/lib/eventInviteLink';

describe('eventInviteLink', () => {
    it('encodes the slug and carries the referral code as ref=', () => {
        expect(eventInviteLink('fnl-x-powr', 'ABCD1234')).toBe(
            'https://powr.life/app?to=league&event=fnl-x-powr&ref=ABCD1234',
        );
    });

    it('omits ref= when there is no code', () => {
        expect(eventInviteLink('fnl-x-powr')).toBe('https://powr.life/app?to=league&event=fnl-x-powr');
        expect(eventInviteLink('fnl-x-powr', null)).toBe('https://powr.life/app?to=league&event=fnl-x-powr');
    });
});

describe('eventInviteMessage', () => {
    const link = eventInviteLink('fnl-x-powr', 'ABCD1234');

    it('spells the code out beside the link, with the bonus when the event pays one', () => {
        expect(eventInviteMessage({ eventName: 'FNL x POWR', link, code: 'ABCD1234', bonusPoints: 20 })).toBe(
            'Join me for FNL x POWR on POWR 💪\n' +
                'Sign up with my code ABCD1234 — we both earn +20 POWR after your first workout.\n' +
                link,
        );
    });

    it('still spells the code out when no bonus is configured', () => {
        expect(eventInviteMessage({ eventName: 'FNL x POWR', link, code: 'ABCD1234' })).toBe(
            'Join me for FNL x POWR on POWR 💪\nSign up with my code ABCD1234.\n' + link,
        );
        expect(eventInviteMessage({ eventName: 'FNL x POWR', link, code: 'ABCD1234', bonusPoints: 0 })).toContain(
            'Sign up with my code ABCD1234.',
        );
    });

    it('is just the pitch and the link with no code', () => {
        const bare = eventInviteLink('fnl-x-powr');
        expect(eventInviteMessage({ eventName: 'FNL x POWR', link: bare, code: null })).toBe(
            'Join me for FNL x POWR on POWR 💪\n' + bare,
        );
    });

    // The code is the only thing that survives a store install, so what the
    // clipboard gets must always contain it — this is the contract the copy
    // buttons rely on.
    it('always contains the code when one is given', () => {
        for (const bonusPoints of [undefined, null, 0, 20]) {
            expect(eventInviteMessage({ eventName: 'X', link, code: 'ZZ99ZZ99', bonusPoints })).toContain('ZZ99ZZ99');
        }
    });
});
