import { eventBookingUrl } from '@/lib/eventBookingLink';

describe('eventBookingUrl', () => {
    it('passes a placeholder-free URL through untouched', () => {
        expect(
            eventBookingUrl('https://www.oneldn.com/events2026/fnl-x-powr', {
                email: 'jamie@powr.life',
                name: 'Jamie',
            }),
        ).toBe('https://www.oneldn.com/events2026/fnl-x-powr');
    });

    it('substitutes and encodes {email} and {name}', () => {
        expect(
            eventBookingUrl('https://book.example.com/?e={email}&n={name}', {
                email: 'jamie+events@powr.life',
                name: 'Jamie Wright',
            }),
        ).toBe('https://book.example.com/?e=jamie%2Bevents%40powr.life&n=Jamie%20Wright');
    });

    it('substitutes every occurrence, not just the first', () => {
        expect(
            eventBookingUrl('https://x.test/?a={email}&b={email}', { email: 'a@b.c' }),
        ).toBe('https://x.test/?a=a%40b.c&b=a%40b.c');
    });

    it('never leaks the literal brace token when a value is missing', () => {
        expect(eventBookingUrl('https://x.test/?e={email}&n={name}', {})).toBe(
            'https://x.test/?e=&n=',
        );
    });
});
