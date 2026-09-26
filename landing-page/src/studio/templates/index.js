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

// Picker order, grouped by what the post is for.
export const CATEGORIES = ['Brand', 'Partners', 'Events', 'Challenges'];

export const TEMPLATES = [editorial, bleed, manifesto, dots, barcode, frame, partner, reward, club, spec, ticket, results, countdown, grid];
export const templateById = (id) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
