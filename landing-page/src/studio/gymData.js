/**
 * The gym portal's data source for the Studio editor (the admin's is
 * `adminStudioData` in data.js). Everything comes through the gym_* SQL
 * functions — staff have no table access — and only what the portal already
 * shows that gym:
 *   - its events (its own, and POWR-run ones at the venue), as the same
 *     display-ready facts the admin gets;
 *   - an event's standings, names shortened to first name + initial, and
 *     never while the board is sealed: a post must not beat the reveal;
 *   - this week's gym board, as the wall shows it (members who hide from
 *     leaderboards stay hidden).
 * No rewards: those belong to brands, not gyms.
 */
import { supabase } from '../lib/supabase';
import { eventFacts, shortName } from './data';

const TZ = 'Europe/London';

async function rpc(name, args, what) {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(`Couldn’t load ${what} — ${error.message}`);
    return data;
}

/** gym: { partner_id, name, address, weekStart } */
export function gymStudioData(gym) {
    return {
        sealedStandings: false,
        fillOnlyWithStandings: true,

        async listEvents() {
            const rows = await rpc('gym_list_events', { p_partner_id: gym.partner_id }, 'your events');
            return (rows ?? [])
                // Cancelled and pulled events never happened; a revealed one
                // that has since been archived still has its results.
                .filter((r) => r.status !== 'archived' || r.revealed_at)
                .map((r) => eventFacts({ ...r, partners: { name: gym.name, address: gym.address } }));
        },

        async eventStandings(eventId, n = 5) {
            const board = await rpc('gym_event_board', { p_event_id: eventId }, 'the standings');
            return (board?.rows ?? []).slice(0, n)
                .map((r) => ({ name: shortName(r.display_name || r.username), points: r.points ?? 0 }));
        },

        async listBoards() {
            const insights = await rpc('gym_insights', { p_partner_id: gym.partner_id, p_weeks: 1 }, 'this week’s board');
            const standings = (insights?.top ?? []).slice(0, 5)
                .map((r) => ({ name: shortName(r.display_name || r.username), points: r.points ?? 0 }));
            const start = gym.weekStart ? new Date(gym.weekStart) : null;
            const week = start
                ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }).format(start).replace('Sept', 'Sep')
                : '';
            return [{
                id: 'week',
                label: `This week at ${gym.name}${standings.length ? '' : ' · nobody yet'}`,
                name: `this week’s board at ${gym.name}`,
                gym: gym.name,
                week,
                standings,
            }];
        },
    };
}
