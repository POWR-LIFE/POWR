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
import move from './pillars/move';
import eat from './pillars/eat';
import mind from './pillars/mind';
import sleep from './pillars/sleep';

// Picker order, grouped by what the post is for. The four pillars are the
// categories a partner's reward sits in (Move · Eat · Mind · Sleep) — each a
// library of its own that a brand in that space can post from.
export const CATEGORIES = ['Brand', 'Partners', 'Events', 'Challenges', 'Move', 'Eat', 'Mind', 'Sleep'];

// The picker's tabs: POWR's own templates, then one per pillar.
export const LIBRARIES = [
    { id: 'core', label: 'Core', categories: ['Brand', 'Partners', 'Events', 'Challenges'] },
    { id: 'move', label: 'Move', categories: ['Move'] },
    { id: 'eat', label: 'Eat', categories: ['Eat'] },
    { id: 'mind', label: 'Mind', categories: ['Mind'] },
    { id: 'sleep', label: 'Sleep', categories: ['Sleep'] },
];

export const TEMPLATES = [editorial, bleed, manifesto, dots, barcode, frame, partner, reward, club, spec, ticket, results, countdown, grid, ...move, ...eat, ...mind, ...sleep];
export const templateById = (id) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
