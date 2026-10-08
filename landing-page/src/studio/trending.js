/**
 * The week's Trending templates (blueprints the weekly trend routine
 * publishes), for the gym and partner portals' Studio. The admin Studio reads
 * the studio_templates table itself (it also lists hidden ones on its Trends
 * tab). Gyms and brands can't read the table; they get the live ones through
 * studio_live_templates(), which leaves out the trend write-up. So a template
 * an admin hides is gone from every portal on its next load.
 *
 * Await it before the editor mounts: the editor picks its templates when it
 * opens. If the read fails, Trending is left out and nothing else changes.
 */
import { supabase } from '../lib/supabase';
import { registerTemplates } from './templates';
import { compileBlueprint } from './blueprint/compile';

let loaded = null;

export function loadTrending() {
    loaded ??= supabase.rpc('studio_live_templates').then(({ data, error }) => {
        if (error) { loaded = null; return 0; }
        return registerTemplates((data ?? []).map((r) => compileBlueprint(r.blueprint, { week: r.week_start })));
    }, () => { loaded = null; return 0; });
    return loaded;
}
