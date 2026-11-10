import fs from 'fs';
import path from 'path';

import { getRouteFromNotification } from '@/lib/notifications';
import { audienceUserIds, resolveRecipients, sendToRecipients } from '@/supabase/functions/_shared/broadcastSend';

/**
 * Admin → Broadcast → Audience → Series: a push (or an email) to everyone who
 * joined one Series season, the way "Live event" reaches everyone registered
 * for one event. And the push's Opens → Series lands on the Series page.
 */

const SEASON = '11111111-1111-4111-8111-111111111111';
const OTHER_SEASON = '22222222-2222-4222-8222-222222222222';

// A tiny stand-in for the service-role client: .from(t).select().eq().order().range()
// reads rows of a table, filtered by .eq(), then sliced by .range() like PostgREST.
function fakeAdmin(tables: Record<string, any[]>) {
    const reads: { table: string; filters: [string, unknown][] }[] = [];
    const inserted: Record<string, any[]> = {};
    const from = (table: string) => {
        const filters: [string, unknown][] = [];
        let window: [number, number] | null = null;
        const q: any = {
            select: () => q,
            eq: (col: string, val: unknown) => { filters.push([col, val]); return q; },
            order: () => q,
            range: (a: number, b: number) => { window = [a, b]; return q; },
            insert: (rows: any[]) => { (inserted[table] ??= []).push(...rows); return Promise.resolve({ error: null }); },
            delete: () => ({ in: () => Promise.resolve({ error: null }) }),
            then: (resolve: any, reject: any) => {
                reads.push({ table, filters });
                const rows = (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
                const data = window ? rows.slice(window[0], window[1] + 1) : rows;
                return Promise.resolve({ data, error: null }).then(resolve, reject);
            },
        };
        return q;
    };
    return { from, reads, inserted };
}

const entry = (user_id: string, season_id = SEASON) => ({ season_id, user_id });

describe("audience mode 'series'", () => {
    it('is everyone who joined that season, and nobody from another', async () => {
        const admin = fakeAdmin({ series_entries: [entry('a'), entry('b'), entry('c', OTHER_SEASON)] });
        const ids = await audienceUserIds(admin, { mode: 'series', season_id: SEASON, season_name: 'Autumn Series' });
        expect([...ids!].sort()).toEqual(['a', 'b']);
        expect(admin.reads[0]).toEqual({ table: 'series_entries', filters: [['season_id', SEASON]] });
    });

    it('reads past the 1,000-row cap', async () => {
        const rows = Array.from({ length: 2300 }, (_, i) => entry(`u${i}`));
        const ids = await audienceUserIds(fakeAdmin({ series_entries: rows }), { mode: 'series', season_id: SEASON });
        expect(ids!.size).toBe(2300);
    });

    it('is nobody, never everyone, without a valid season', async () => {
        for (const season_id of [undefined, '', 'not-a-uuid', "x' or 1=1"]) {
            const admin = fakeAdmin({ series_entries: [entry('a')] });
            const ids = await audienceUserIds(admin, { mode: 'series', season_id } as any);
            expect(ids).not.toBeNull();
            expect(ids!.size).toBe(0);
            expect(admin.reads).toHaveLength(0); // never even queried
        }
    });

    it('still fails closed on a mode it does not know', async () => {
        const ids = await audienceUserIds(fakeAdmin({}), { mode: 'seriez' } as any);
        expect(ids!.size).toBe(0);
    });

    it('pushes only the joined members’ devices, and respects Product news opt-out', async () => {
        const admin = fakeAdmin({
            series_entries: [entry('a'), entry('b'), entry('c', OTHER_SEASON)],
            notification_preferences: [{ user_id: 'b', announcements: false }],
            user_push_tokens: [
                { user_id: 'a', expo_push_token: 'ExpoPushToken[a]', platform: 'ios', app_version: '1.6.0' },
                { user_id: 'b', expo_push_token: 'ExpoPushToken[b]', platform: 'ios', app_version: '1.6.0' },
                { user_id: 'c', expo_push_token: 'ExpoPushToken[c]', platform: 'ios', app_version: '1.6.0' },
                { user_id: 'd', expo_push_token: 'ExpoPushToken[d]', platform: 'ios', app_version: '1.6.0' },
            ],
        });
        const out = await resolveRecipients(admin, { mode: 'series', season_id: SEASON });
        expect(out.map((r) => r.user_id)).toEqual(['a']);
    });

    it('honours the platform filter on top, like every other mode', async () => {
        const admin = fakeAdmin({
            series_entries: [entry('a')],
            user_push_tokens: [
                { user_id: 'a', expo_push_token: 'ExpoPushToken[a-ios]', platform: 'ios', app_version: '1.6.0' },
                { user_id: 'a', expo_push_token: 'ExpoPushToken[a-and]', platform: 'android', app_version: '1.6.0' },
            ],
        });
        const out = await resolveRecipients(admin, { mode: 'series', season_id: SEASON, platforms: ['android'] });
        expect(out.map((r) => r.expo_push_token)).toEqual(['ExpoPushToken[a-and]']);
    });
});

describe('Opens → Series', () => {
    const SERIES_ROUTE = '/(tabs)/league?focus=series';

    it('travels in the push payload and the in-app feed row', async () => {
        const admin = fakeAdmin({});
        const sent: any[] = [];
        const realFetch = global.fetch;
        global.fetch = jest.fn(async (_url: any, init: any) => {
            const msgs = JSON.parse(init.body);
            sent.push(...msgs);
            // No ticket ids → nothing to poll for receipts (keeps the test instant).
            return { json: async () => ({ data: msgs.map(() => ({ status: 'ok' })) }) } as any;
        }) as any;
        try {
            await sendToRecipients(admin, [{ user_id: 'a', expo_push_token: 'ExpoPushToken[a]' }], {
                title: 'Round 02 is open', body: 'Move up the board.', route: SERIES_ROUTE, source: 'admin_broadcast',
            });
        } finally {
            global.fetch = realFetch;
        }
        expect(sent[0].data).toEqual({ type: 'admin_broadcast', route: SERIES_ROUTE });
        expect(admin.inserted.user_activity[0].route).toBe(SERIES_ROUTE);
    });

    it('is a route the app resolves as-is on tap', () => {
        const tap = { notification: { request: { content: { data: { route: SERIES_ROUTE } } } } } as any;
        expect(getRouteFromNotification(tap)).toBe(SERIES_ROUTE);
    });

    it('is offered on both the Broadcast and the Campaigns page (one shared list)', () => {
        const root = path.join(__dirname, '..', 'landing-page', 'src');
        const presets = fs.readFileSync(path.join(root, 'lib', 'pushRoutes.js'), 'utf8');
        expect(presets).toContain(`label: 'Series'`);
        expect(presets).toContain(`value: '${SERIES_ROUTE}'`);
        for (const page of ['Broadcast.jsx', 'Campaigns.jsx']) {
            const src = fs.readFileSync(path.join(root, 'pages', 'admin', page), 'utf8');
            expect(src).toContain(`from '../../lib/pushRoutes'`);
            expect(src).not.toContain('const ROUTE_PRESETS');
        }
    });

    it('closes an event page left open on the League tab, so the member lands on the Series', () => {
        const league = fs.readFileSync(path.join(__dirname, '..', 'app', '(tabs)', 'league.tsx'), 'utf8');
        expect(league).toContain(`focus === 'rival' || focus === 'series'`);
    });
});
