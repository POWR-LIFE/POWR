import fs from 'fs';
import path from 'path';

/**
 * The Series owns the League tab, and its board is the tab's home whether a
 * round is running or not. A live event runs on its own clock, so the way
 * into it (the event card) has to be on that home in every phase — before a
 * round, during one and between rounds. It used to render only while a round
 * was running, so the week before Round 01 a sealed event had no door on
 * League at all (ONE LDN, 2026-11-06).
 *
 * Source assertions, because SeriesHome is a large screen with no render
 * harness and this is the kind of branch a refactor drops quietly.
 */
const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'series', 'SeriesHome.tsx'), 'utf8');

const count = (needle: string) => src.split(needle).length - 1;

describe('SeriesHome event card', () => {
    it('renders the event card in both the running and the off-round layout', () => {
        // Top slot (event night / sealed) and lower slot, once per branch.
        expect(count('{evTop && eventCard}')).toBe(2);
        expect(count('{!evTop && eventCard && ')).toBe(2);
    });
});
