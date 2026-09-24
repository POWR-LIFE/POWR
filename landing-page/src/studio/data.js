/**
 * The Studio's data: live events and rewards, read with the admin's own
 * session, turned into plain, display-ready values the templates fill their
 * words from (templates never see a database row).
 *
 * Rewards are selected column by column — never `*` — so a promo code can't
 * reach a design by accident.
 */
import { supabase } from '../lib/supabase';
import { eventRegisterUrl } from '../lib/eventRegisterUrl';
import { titleCase } from './words';

const TZ = 'Europe/London';

export async function listEvents() {
    const { data, error } = await supabase
        .from('live_events')
        .select('id, slug, name, status, hidden, window_start_at, window_end_at, doors_open_at, doors_close_at, partners:venue_partner_id (name, address)')
        .order('window_start_at', { ascending: false });
    if (error) throw new Error(`Couldn’t load events — ${error.message}`);
    return (data ?? []).map(eventFacts);
}

/** Top of an event's board, names shortened to first name + initial. */
export async function eventStandings(eventId, n = 5) {
    const { data, error } = await supabase.rpc('admin_get_event_leaderboard', { p_event_id: eventId });
    if (error) throw new Error(`Couldn’t load the standings — ${error.message}`);
    return (data?.standings ?? []).slice(0, n).map((r) => ({ name: shortName(r.display_name), points: r.points ?? 0 }));
}

export async function listRewards() {
    const { data, error } = await supabase
        .from('rewards')
        .select('id, title, description, brand_name, brand_color, offer, value_label, discount_type, discount_value, powr_cost, category, terms, active, image_url, hero_image_url, partners:partner_id (name, logo_url)')
        .order('active', { ascending: false })
        .order('brand_name', { ascending: true });
    if (error) throw new Error(`Couldn’t load rewards — ${error.message}`);
    return (data ?? []).map(rewardFacts);
}

// ── Events ──────────────────────────────────────────────────────────────

function parts(date) {
    const get = (o) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...o }).formatToParts(date).map((p) => [p.type, p.value]));
    const a = get({ weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const long = get({ weekday: 'long' });
    const h = Number(a.hour);
    const m = a.minute;
    return {
        // en-GB spells September "Sept"; posters want three letters throughout.
        weekday: a.weekday, weekdayLong: long.weekday, day: a.day, month: a.month.slice(0, 3), year: a.year,
        time24: `${a.hour}:${m}`,
        time12: `${h % 12 || 12}${m === '00' ? '' : `:${m}`}${h < 12 ? 'am' : 'pm'}`,
        dots: `${a.day}.${String(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: '2-digit' }).format(date))}.${a.year}`,
    };
}

// "Imperial Wharf, 3 The Blvd, London SW6 2UB" → "London".
export function cityOf(address) {
    if (!address) return '';
    const bits = address.split(',').map((s) => s.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, '').trim()).filter(Boolean);
    return bits[bits.length - 1] ?? '';
}

// A name for a public post: "Morgan Kelly" → "Morgan K.".
export function shortName(name) {
    const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return 'POWR member';
    const first = titleCase(words[0]);
    return words.length === 1 ? first : `${first} ${words[words.length - 1][0].toUpperCase()}.`;
}

function eventFacts(row) {
    const start = new Date(row.window_start_at);
    const end = new Date(new Date(row.window_end_at).getTime() - 1); // the window's last moment, not the next day
    // The night itself: doors if set, else a window that fits in an evening.
    const short = new Date(row.window_end_at) - start <= 12 * 3600e3;
    const night = row.doors_open_at ? new Date(row.doors_open_at) : short ? start : null;
    const close = row.doors_close_at ? new Date(row.doors_close_at) : short ? new Date(row.window_end_at) : null;
    const venue = row.partners?.name ?? '';
    const city = cityOf(row.partners?.address);
    const s = parts(night ?? start);
    const e = parts(end);
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        status: row.status,
        hidden: row.hidden,
        label: `${row.name} · ${s.day} ${s.month} ${s.year} · ${row.status}${row.hidden ? ', hidden' : ''}`,
        venue, city,
        night: Boolean(night),
        days: Math.max(1, Math.round((new Date(row.window_end_at) - start) / 86400e3)),
        ...s,
        close24: close ? parts(close).time24 : '',
        // Multi-day windows with no night: "03 Oct – 06 Oct".
        range: `${parts(start).day} ${parts(start).month} – ${e.day} ${e.month}`,
        rangeFrom: `${parts(start).day} ${parts(start).month}`,
        rangeTo: `${e.day} ${e.month}`,
        joinUrl: eventRegisterUrl(row.slug),
        // What the board may say in public: nothing before it starts, live
        // standings while it runs, nothing while it's sealed for the reveal.
        board: { live: 'live', locked: 'sealed', revealed: 'final', settled: 'final', archived: 'final' }[row.status] ?? 'none',
    };
}

// ── Rewards ─────────────────────────────────────────────────────────────

const CATEGORY_WORD = { food: 'Eat', nutrition: 'Eat', gym: 'Move', gear: 'Move', fashion: 'Wear', health: 'Recover' };

const money = (v) => `£${Number(v) % 1 ? Number(v).toFixed(2) : Number(v)}`;

function rewardFacts(row) {
    const brand = (row.brand_name || row.partners?.name || row.title || '').trim();
    const pct = row.discount_type === 'percentage' && Number(row.discount_value) > 0;
    const fixed = row.discount_type === 'fixed_amount' && Number(row.discount_value) > 0;
    // The big number: a short value label if they wrote one, else the discount.
    const label = (row.value_label || '').trim();
    let value = '';
    let unit = 'off';
    const m = label.match(/^(£?\d+(?:\.\d+)?%?)\s+(off)$/i);
    if (m) value = m[1];
    else if (pct) value = `${Number(row.discount_value)}%`;
    else if (fixed) value = money(row.discount_value);
    else if (label && label.length <= 10) { value = label; unit = ''; }
    // The big number is already on the post: "Get 35% off site wide…" → "Site wide…".
    let offer = firstSentence(row.offer) || firstSentence(row.description) || '';
    if (value) {
        const esc = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rest = offer.replace(new RegExp(`^(get\\s+)?${esc}\\s+off\\b[\\s,:–—-]*`, 'i'), '');
        if (rest !== offer && rest) offer = rest[0].toUpperCase() + rest.slice(1);
    }
    return {
        id: row.id,
        active: row.active,
        brand,
        label: `${brand} — ${value ? `${value} ${unit}`.trim() : row.title}${row.powr_cost ? ` · ${row.powr_cost} pts` : ''}${row.active ? '' : ' · inactive'}`,
        value, unit,
        offer,
        description: (row.description || '').trim(),
        cost: row.powr_cost ?? null,
        category: CATEGORY_WORD[row.category] ?? '',
        terms: (row.terms || '').trim(),
        accent: legibleAccent(row.brand_color),
        logoUrl: row.image_url || row.partners?.logo_url || null,
        heroUrl: row.hero_image_url || null,
    };
}

// The offer's first sentence, tidied — the rest is small print for the app.
function firstSentence(text) {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    const cut = t.split(/(?<=[.!?])\s|\s\*/)[0].trim();
    return cut.length > 110 ? `${cut.slice(0, 107).replace(/\s+\S*$/, '')}…` : cut;
}

/**
 * A brand colour that reads on the templates' near-black: a dark one is
 * lifted toward white (same hue) until it clears 3:1. Empty or not a colour → ''.
 */
export function legibleAccent(hex) {
    const m = String(hex ?? '').trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
    if (!m) return '';
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    let rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    const lum = (c) => {
        const [r, g, b] = c.map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ground = 0.006; // ≈ #111
    for (let i = 0; i < 40 && (lum(rgb) + 0.05) / (ground + 0.05) < 3; i++) {
        rgb = rgb.map((v) => Math.round(v + (255 - v) * 0.05));
    }
    return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** A remote image (a reward's logo) as a File, for loadAsset(). */
export async function fetchImage(url, name) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Couldn’t fetch ${name} (${r.status}).`);
    const blob = await r.blob();
    return new File([blob], name, { type: blob.type });
}
