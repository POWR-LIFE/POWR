import type { EventBoardEntry, EventLeaderboard, LiveEvent, LiveEventViewer } from '@/lib/api/liveEvents';

/**
 * DESIGN SCAFFOLD — multi-event surfaces (Home carousel + League switcher).
 *
 * Prod has no list RPC yet and no two events running, so in dev builds the
 * events list is padded out with sample events to make the multi-event UI
 * reviewable in Expo Go. Nothing here ships: every entry point is behind
 * `MULTI_EVENT_DESIGN`, which is false outside __DEV__. Delete this file when
 * `get_active_live_events()` lands.
 *
 * Registering on a sample is kept in memory only (`designJoin`), so the
 * "in several events at once" state can be walked through; a reload resets it.
 */
export const MULTI_EVENT_DESIGN = __DEV__;

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

const SAMPLE_ID_PREFIX = '00000000-0000-4000-9000-';

/** Sample events registered this session — never persisted, never sent. */
const joinedSamples = new Set<string>();

const BASE = {
    logo_url: null,
    scope: 'opt_in',
    lock_at: null,
    is_locked: false,
    revealed_at: null,
    board_size: 20,
    invite_bonus_points: 20,
    invite_milestone_n: 3,
    invite_milestone_bonus: 100,
    conversion_deadline_at: null,
    rules: [] as string[],
    booking_url: null,
} as const;

function sampleOneLdn(): LiveEvent {
    return {
        ...BASE,
        id: `${SAMPLE_ID_PREFIX}000000000001`,
        slug: 'design-one-ldn',
        name: 'FNL x POWR',
        logo_only: true,
        status: 'live',
        window_start_at: iso(-3),
        window_end_at: iso(4),
        doors_open_at: iso(5),
        prizes: [
            { rank: 1, label: '3 months membership' },
            { rank: 2, label: 'PT block' },
            { rank: 3, label: 'ONE LDN kit' },
        ],
        promo_headline: null,
        promo_media_url:
            'https://video.squarespace-cdn.com/content/v1/5daedc99ae72575df5d8d8f9/01903936-aa4b-4d12-a87d-7fd27fe2bda9/playlist.m3u8',
        venue: {
            id: '4c7d3f47-c91f-491b-ab60-329458a63e37',
            name: 'ONE LDN',
            logo_url:
                'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/partner-logos/partners/1780309700450-phgw9x.webp',
            logo_bg: 'dark',
        },
        viewer: { eligible: true, joined: true, disqualified: false, gate: null },
    };
}

function sampleStars(): LiveEvent {
    const id = `${SAMPLE_ID_PREFIX}000000000002`;
    return {
        ...BASE,
        id,
        slug: 'design-stars-gym',
        name: 'Stars x POWR',
        logo_only: false,
        status: 'scheduled',
        window_start_at: iso(5),
        window_end_at: iso(12),
        doors_open_at: iso(13),
        prizes: [
            { rank: 1, label: '6 months membership' },
            { rank: 2, label: 'Fight camp week' },
        ],
        promo_headline: 'One week. One board. One night at Stars.',
        promo_media_url:
            'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/partner-logos/stars-gym-one.avif',
        venue: {
            id: '6e386546-b618-4ea8-ad12-28fb185f44be',
            name: 'Stars Gym',
            logo_url:
                'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/partner-logos/6e386546-b618-4ea8-ad12-28fb185f44be.avif',
            logo_bg: 'dark',
        },
        viewer: { eligible: true, joined: joinedSamples.has(id), disqualified: false, gate: null },
    };
}

/** The list the multi-event surfaces render in design mode: whatever real
 *  event exists keeps its place, samples fill the list out to two. */
export function designEvents(real: LiveEvent | null): LiveEvent[] {
    if (!MULTI_EVENT_DESIGN) return real ? [real] : [];
    return real ? [real, sampleStars()] : [sampleOneLdn(), sampleStars()];
}

export function designEventBySlug(slug: string): LiveEvent | null {
    if (!MULTI_EVENT_DESIGN) return null;
    return [sampleOneLdn(), sampleStars()].find(e => e.slug === slug) ?? null;
}

export function isDesignEventId(id: string | null | undefined): boolean {
    return !!id && id.startsWith(SAMPLE_ID_PREFIX);
}

/** Stand-in for join_live_event on a sample: null for any real event, so the
 *  caller falls through to the RPC. */
export function designJoin(eventId: string): LiveEventViewer | null {
    if (!MULTI_EVENT_DESIGN || !isDesignEventId(eventId)) return null;
    joinedSamples.add(eventId);
    return { eligible: true, joined: true, disqualified: false, gate: null };
}

const NAMES = ['Megan W', 'Will H', 'Connor M', 'You', 'Tegan R', 'Suzi K', 'Luke P', 'Chloe D', 'Kate B', 'Izzy F'];
const POINTS = [481, 433, 321, 288, 240, 199, 174, 173, 122, 80];

/** Sample standings for a sample event. Rows use the board-preview sentinel
 *  id range, so the existing tap-guard already keeps them off profiles. */
export function designBoard(eventId: string): EventLeaderboard | null {
    if (!isDesignEventId(eventId)) return null;
    const event = [sampleOneLdn(), sampleStars()].find(e => e.id === eventId);
    if (!event || event.status !== 'live') return null;
    const standings: EventBoardEntry[] = NAMES.map((name, i) => ({
        rank: i + 1,
        user_id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        display_name: name,
        username: null,
        avatar_url: null,
        is_pro: false,
        points: POINTS[i],
        today_points: i % 3 === 0 ? 24 : 0,
        rank_delta: i === 3 ? 2 : 0,
    }));
    return {
        event_id: eventId,
        status: 'live',
        is_locked: false,
        is_preview: true,
        standings,
        viewer: { ...event.viewer, rank: 4, rank_delta: 2, points: POINTS[3] },
    };
}
