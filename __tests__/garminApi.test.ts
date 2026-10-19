/**
 * Garmin OAuth 2.0 PKCE helpers (supabase/functions/_shared/garminApi.ts),
 * against Garmin's OAuth2 PKCE spec: a 43–128 character verifier from the
 * unreserved set, an S256 challenge, and the consent URL's parameters.
 */
import {
    authorizeUrl,
    codeChallengeFor,
    expiriesFrom,
    needsRefresh,
    newCodeVerifier,
    safeReturnTo,
    withParams,
} from '@/supabase/functions/_shared/garminApi';

describe('PKCE', () => {
    it('makes a verifier Garmin accepts', () => {
        const v = newCodeVerifier();
        expect(v.length).toBeGreaterThanOrEqual(43);
        expect(v.length).toBeLessThanOrEqual(128);
        expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
        expect(newCodeVerifier()).not.toBe(v);
    });

    it('derives the S256 challenge: base64url(sha256(verifier)), unpadded', async () => {
        // Expected value computed independently with Node's crypto:
        //   createHash('sha256').update(verifier).digest('base64url')
        expect(await codeChallengeFor('dBjftJeZ4CVP-mJ92K9qkd2eTrE-I-Mqq_D3GMwOX6Mnvk'))
            .toBe('ekWMQFSd_jnQ0FY89SD4fwYq3CxxSB0sGmrfbGtb6XI');
        const c = await codeChallengeFor(newCodeVerifier());
        expect(c).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes, no padding
    });
});

describe('authorizeUrl', () => {
    it('asks for a code with an S256 challenge, our redirect and the state', () => {
        const url = new URL(authorizeUrl({
            clientId: 'client-1', codeChallenge: 'chal', redirectUri: 'https://x.supabase.co/functions/v1/garmin-auth/callback', state: 'st',
        }));
        expect(url.origin + url.pathname).toBe('https://connect.garmin.com/oauth2Confirm');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            response_type: 'code',
            client_id: 'client-1',
            code_challenge: 'chal',
            code_challenge_method: 'S256',
            redirect_uri: 'https://x.supabase.co/functions/v1/garmin-auth/callback',
            state: 'st',
        });
    });
});

describe('token expiry', () => {
    it('stamps both expiries from a token response', () => {
        expect(expiriesFrom({ access_token: 'a', refresh_token: 'r', expires_in: 86400, refresh_token_expires_in: 7775998 }, 0))
            .toEqual({ access_expires_at: '1970-01-02T00:00:00.000Z', refresh_expires_at: new Date(7775998000).toISOString() });
        expect(expiriesFrom({ access_token: 'a', refresh_token: 'r', expires_in: 60 }, 0).refresh_expires_at).toBeNull();
    });

    it('refreshes inside Garmin\'s 600 s margin, not before', () => {
        const now = Date.parse('2026-10-19T12:00:00Z');
        expect(needsRefresh('2026-10-19T12:09:59Z', now)).toBe(true);
        expect(needsRefresh('2026-10-19T12:10:01Z', now)).toBe(false);
        expect(needsRefresh(null, now)).toBe(true);
        expect(needsRefresh('garbage', now)).toBe(true);
    });
});

describe('safeReturnTo — never an open redirect', () => {
    it.each([
        'powr://garmin-callback',
        'exp://192.168.1.20:8081/--/garmin-callback',
        'exps://u.expo.dev/abc/--/garmin-callback',
    ])('accepts %s', (v) => {
        expect(safeReturnTo(v)).toBe(v);
    });

    it.each([
        'https://evil.example/garmin-callback',
        'powr://terra-callback',
        'powr://garmin-callback.evil',
        'javascript:alert(1)',
        undefined,
        42,
    ])('falls back to the app for %p', (v) => {
        expect(safeReturnTo(v)).toBe('powr://garmin-callback');
    });

    it('appends the outcome whether or not the address already has a query', () => {
        expect(withParams('powr://garmin-callback', { status: 'connected' })).toBe('powr://garmin-callback?status=connected');
        expect(withParams('exp://h/--/garmin-callback?a=1', { status: 'denied' })).toBe('exp://h/--/garmin-callback?a=1&status=denied');
    });
});
