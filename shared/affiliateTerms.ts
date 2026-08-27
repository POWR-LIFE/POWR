/**
 * The POWR Affiliate Programme terms — ONE copy, rendered in the app
 * (app/affiliate-terms.tsx) and on the web (/affiliate/terms + the portal
 * gate). Bump TERMS_VERSION when the substance changes; creators.terms_version
 * records what each affiliate accepted.
 *
 * Plain English on purpose: an affiliate reads this on a phone, once.
 */
export const AFFILIATE_TERMS_VERSION = '2026-08-v1';

export interface TermsSection {
    title: string;
    body: string[];
}

export const AFFILIATE_TERMS: TermsSection[] = [
    {
        title: 'Who can be an affiliate',
        body: [
            'The programme is invite-only. You need a POWR account, you must be 18 or over, and one person means one affiliate account.',
            'Your POWR ID is your affiliate code. If we give you a vanity code on top, it works the same way.',
        ],
    },
    {
        title: 'How you earn',
        body: [
            'You earn when someone signs up with your code or link and then logs their first workout that POWR can verify — checked in at a gym, or synced from a wearable. Workouts typed in by hand never count, for anyone.',
            'Rewards are POWR points and, at certain steps, products or experiences. There is no cash, and rewards can’t be sold, swapped or transferred.',
            'The points per conversion, the steps and the rewards on your ladder are set by the programme you’re on. We can change them for future conversions; anything you’ve already earned stays earned.',
        ],
    },
    {
        title: 'Playing fair',
        body: [
            'No referring yourself, your own other accounts, or accounts on devices you control.',
            'No paying, bribing or pressuring people to sign up, and no promising them anything POWR doesn’t offer.',
            'No misleading claims about POWR, its rewards or its partners.',
            'If we see signs of gaming — shared devices, clusters of sign-ups from one place, conversions minutes after a code is entered — we can hold, void or reverse rewards and pause or end your affiliate status.',
        ],
    },
    {
        title: 'Tell people it’s an affiliate link',
        body: [
            'UK advertising rules (ASA/CMA) require it: when you share your link or code, make it clear you earn rewards for sign-ups — for example “#ad” or “affiliate link” in the post, caption or bio, somewhere people will actually see it.',
            'Say it in your own words, but say it every time.',
        ],
    },
    {
        title: 'Your link page',
        body: [
            'powr.life/join/<your handle> shows your display name, photo and bio to anyone who taps your link. Keep them accurate and yours — no impersonating other people or brands.',
        ],
    },
    {
        title: 'Products and delivery',
        body: [
            'When you reach a step with a product attached, we’ll ask for a delivery name and address then — not before. We’ll only use it to send that reward.',
            'We may substitute an item of equal or higher value if something is out of stock. Delivery times vary; we’ll show tracking when we have it.',
        ],
    },
    {
        title: 'Pausing and ending',
        body: [
            'You can stop being an affiliate any time by telling us. We can pause or end your affiliate status if these terms are broken or the programme changes; your link stops earning from that point.',
        ],
    },
    {
        title: 'Your data',
        body: [
            'Your affiliate profile, link taps, sign-ups and rewards are handled as described in the POWR privacy policy. You never see who signed up — only that they did and whether they converted.',
        ],
    },
];
