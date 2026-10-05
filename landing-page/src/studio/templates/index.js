import editorial from './editorial';
import bleed from './bleed';
import manifesto from './manifesto';
import dots from './dots';
import barcode from './barcode';
import frame from './frame';
import partner from './partner';
import reward from './reward';
import club from './club';
import spec from './spec';
import ticket from './ticket';
import results from './results';
import countdown from './countdown';
import grid from './grid';
import tally from './tally';
import spread from './spread';
import move from './pillars/move';
import eat from './pillars/eat';
import mind from './pillars/mind';
import sleep from './pillars/sleep';

// Picker order, grouped by what the post is for. 'Trending' holds the weekly
// trend routine's blueprints (registerTemplates). The four pillars are the
// categories a partner's reward sits in (Move · Eat · Mind · Sleep) — each a
// library of its own that a brand in that space can post from.
export const CATEGORIES = ['Trending', 'Brand', 'Partners', 'Events', 'Challenges', 'Move', 'Eat', 'Mind', 'Sleep'];

// The picker's tabs: POWR's own templates, then one per pillar.
export const LIBRARIES = [
    { id: 'core', label: 'Core', categories: ['Trending', 'Brand', 'Partners', 'Events', 'Challenges'] },
    { id: 'move', label: 'Move', categories: ['Move'] },
    { id: 'eat', label: 'Eat', categories: ['Eat'] },
    { id: 'mind', label: 'Mind', categories: ['Mind'] },
    { id: 'sleep', label: 'Sleep', categories: ['Sleep'] },
];

export const TEMPLATES = [editorial, bleed, manifesto, dots, barcode, frame, tally, spread, partner, reward, club, spec, ticket, results, countdown, grid, ...move, ...eat, ...mind, ...sleep];
export const templateById = (id) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];

/**
 * Add blueprint templates (the weekly trend routine's, from
 * studio_templates) to the picker's "Trending" group. Replaces any with the
 * same id; returns how many were added.
 */
export function registerTemplates(list) {
    let n = 0;
    for (const t of list) {
        if (!t) continue;
        const i = TEMPLATES.findIndex((x) => x.id === t.id);
        if (i >= 0) TEMPLATES[i] = t; else { TEMPLATES.unshift(t); n++; }
    }
    return n;
}
