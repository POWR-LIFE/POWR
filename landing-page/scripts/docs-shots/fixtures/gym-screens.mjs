// Screens (/venue/screens): switching the boards on and changing them.
// The board row itself (gym_portal_summary.board) and both boards' feeds
// (the gym-board and gym-league edge functions) are gym-core's. Shapes follow
// gym_board_setup / gym_board_update in
// supabase/migrations/20260924180100_gym_portal_screens_insights.sql: both
// return gym_portal_summary(...) -> 'board'.
import { reply } from '../mock.mjs';
import { BOARD_ROW } from './gym-core.mjs';

const fail = (message, code = 'P0001') => reply(400, { code, message, details: null, hint: null });
const KEYS = ['enabled', 'league_enabled', 'viewing', 'board_size', 'league_radius_km', 'rotate_token'];

export default {
    rpc: {
        gym_board_setup: ({ p_slug }) => {
            const slug = String(p_slug ?? '').trim().toLowerCase();
            if (slug.length < 2 || slug.length > 40 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
                return fail('Use 2–40 lower-case letters, numbers and single dashes');
            }
            return { ...BOARD_ROW, slug, created_at: new Date().toISOString() };
        },
        gym_board_update: ({ p_patch }) => {
            if (!p_patch || typeof p_patch !== 'object' || !Object.keys(p_patch).length) return fail('Nothing to change');
            const bad = Object.keys(p_patch).find((k) => !KEYS.includes(k));
            if (bad) return fail(`Can't change ${bad}`);
            const { rotate_token: rotate, ...patch } = p_patch;
            // A new key is never shown on screen; it only has to differ.
            return { ...BOARD_ROW, ...patch, ...(rotate ? { display_token: 'docs-board-key-2' } : {}) };
        },
    },
};
