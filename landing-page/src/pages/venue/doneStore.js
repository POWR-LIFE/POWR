import { useEffect, useState } from 'react';

// What a gym has put off or done on the Overview, on this device: move key →
// until (ISO). "Not now" on a suggestion, or downloading today's post, puts
// it away for a while and the next suggestion takes its place. Only
// suggestions that can wait use it; alerts (winners to reveal) leave when
// they're dealt with, never on a tap.

const EVENT = 'powr:moves-done';
const keyOf = (partnerId) => `powr_moves_done_${partnerId}`;

function read(partnerId) {
    try {
        const all = JSON.parse(localStorage.getItem(keyOf(partnerId)) || '{}');
        const now = Date.now();
        // Drop what has run out, so the store never grows.
        return Object.fromEntries(Object.entries(all).filter(([, until]) => Date.parse(until) > now));
    } catch {
        return {};
    }
}

/** Put `moveKey` away until `until` (a Date), for this gym on this device. */
export function markDone(partnerId, moveKey, until) {
    try {
        const next = { ...read(partnerId), [moveKey]: until.toISOString() };
        localStorage.setItem(keyOf(partnerId), JSON.stringify(next));
    } catch { /* private window: the suggestion just stays */ }
    window.dispatchEvent(new CustomEvent(EVENT));
}

/** Local midnight after `now`, in the gym's time zone. */
export function endOfDay(tz, now = new Date()) {
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const [h, m] = hm.split(':').map(Number);
    return new Date(now.getTime() + ((24 - h) * 60 - m) * 60_000);
}

/** The gym's put-off moves, kept current across the page and other tabs. */
export function useDone(partnerId) {
    const [done, setDone] = useState(() => read(partnerId));
    useEffect(() => {
        setDone(read(partnerId));
        const on = () => setDone(read(partnerId));
        window.addEventListener(EVENT, on);
        window.addEventListener('storage', on);
        return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on); };
    }, [partnerId]);
    return done;
}
