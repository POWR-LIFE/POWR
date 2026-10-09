// Who is signed in to the gym portal, and on what package. Every gym shot
// starts from this; area fixtures (gym-*.mjs) add the data their pages read.
import { GYM } from '../world.mjs';

export const PRO = {
    package: 'pro', billing: 'monthly', on_trial: false, trial_ends_at: '2026-07-01T00:00:00Z', level: 2,
    features: { boards: true, events: true, insights: true, studio: true, people: true },
    requested: null, requested_at: null, founding_taken: 4, founding_limit: 10,
};
/** The package a shot of a locked page wants: package('clash'). */
export const pkg = (name) => ({
    clash: { ...PRO, package: 'clash', level: 0, features: { boards: true, events: false, insights: false, studio: false, people: false } },
    clash_plus: { ...PRO, package: 'clash_plus', level: 1, features: { boards: true, events: true, insights: true, studio: false, people: false } },
    pro: PRO,
    founding: { ...PRO, package: 'founding', billing: 'annual' },
    trial: { ...PRO, package: 'clash', on_trial: true, trial_ends_at: new Date(Date.now() + 41 * 864e5).toISOString() },
}[name]);

export default {
    rpc: {
        gym_my_memberships: [{ partner_id: GYM.id, name: GYM.name, logo_url: GYM.logo_url, logo_bg: GYM.logo_bg, role: 'owner', active: true }],
        gym_package: PRO,
    },
    rest: {
        // Not an admin: the portal shows exactly what a gym owner sees.
        admin_roles: [],
        partners: [{ id: GYM.id, name: GYM.name, logo_url: GYM.logo_url, logo_bg: GYM.logo_bg, category: 'gym', active: true,
            // Open sea, like gym-core's Gym Clash cluster: a map drawn here shows no real place names.
            locations: [{ lat: 54.62, lng: 1.48, name: GYM.name, address: GYM.address }] }],
    },
};
