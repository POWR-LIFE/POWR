/**
 * The partner portal's data source for the Studio editor (the admin's is
 * `adminStudioData` in data.js, a gym's is gymData.js). A reward brand fills
 * its posts from its own rewards, as the same display-ready facts the admin
 * gets. They're read with the brand's own session, and RLS already limits that
 * to the brand's rows. An admin previewing the portal reads them by name.
 * No events or boards: those belong to gyms.
 */
import { supabase } from '../lib/supabase';
import { REWARD_COLUMNS, rewardFacts, fetchImage } from './data';

export function brandStudioData(brandName) {
    let rewards = null;
    return {
        // The page reads the list to choose a reward to open on, then the
        // editor reads it again: one fetch serves both. A failed one is retried.
        listRewards() {
            rewards ??= loadRewards(brandName).catch((e) => { rewards = null; throw e; });
            return rewards;
        },
        fetchImage,
    };
}

async function loadRewards(brandName) {
    const { data, error } = await supabase
        .from('rewards')
        .select(REWARD_COLUMNS)
        .ilike('brand_name', brandName)
        .order('active', { ascending: false })
        .order('created_at', { ascending: false });
    if (error) throw new Error(`Couldn’t load your rewards — ${error.message}`);
    return (data ?? []).map((row) => {
        const r = rewardFacts(row);
        // Every row is this brand's, so the picker names the reward, not the brand.
        const offer = r.value ? `${r.value} ${r.unit}`.trim() : '';
        const name = [(row.title || '').trim() || r.brand, offer].filter(Boolean).join(' — ');
        return { ...r, label: `${name}${r.cost ? ` · ${r.cost} pts` : ''}${r.active ? '' : ' · switched off'}` };
    });
}
