import { supabase } from '../../lib/supabase';

/**
 * Live data for the Move stage's deconstructed Discover page.
 *
 * Same source of truth as app/(tabs)/discover.tsx: the `partners` table
 * (anon-readable), real logos + logo_bg, open-now from opening_hours,
 * distance via the app's own miles formula. The stage showcases a curated
 * trio of partners (see SHOWCASE) rather than a raw nearest query; their
 * real lat/lng are projected linearly onto the stylised map canvas.
 */

// app/(tabs)/discover.tsx DEFAULT_REGION
const CENTER = { lat: 51.5074, lng: -0.1278 };

/**
 * The partners the stage features (Jamie's picks, 2026-07-14). Rows are
 * matched by name against the live table; a brand with several sites keeps
 * the one nearest the canvas centre (Stars Gym: Battersea over Deptford).
 * POWR is the check-in target — the session card, push toast and active
 * pin are its story. Its real gym is in Stratford-upon-Avon, ~80 mi off
 * this central-London canvas, so it borrows a stand-in position that seats
 * its pin where the composition wants the target; the list row keeps the
 * honest address.
 */
// Composition note: a 3-point projection pins each extreme to a canvas
// edge, and the map's lower-left is covered by the partner-list float —
// ONE LDN's real Imperial Wharf longitude lands its pin exactly under
// that card, so it borrows an eastward nudge (real latitude kept) to sit
// clear at the bottom-right instead.
const SHOWCASE = [
  { pattern: /^powr$/i, area: 'Meon Vale, Stratford-upon-Avon', target: true, standIn: { lat: 51.478, lng: -0.1788 } },
  { pattern: /^one\s*ldn$/i, area: 'Imperial Wharf, London', standIn: { lat: 51.4738, lng: -0.162 } },
  { pattern: /^stars\s*gym$/i, area: 'Battersea, London' },
];

// The same trio, from a 2026-07-14 snapshot — used when the live fetch
// fails. logo:null renders the app's letter-fallback pin.
const FALLBACK_PARTNERS = [
  { name: 'POWR', lat: 51.478, lng: -0.1788, logo: null, logoBg: 'dark', area: 'Meon Vale, Stratford-upon-Avon', openNow: true, isTarget: true },
  { name: 'ONE LDN', lat: 51.4738, lng: -0.162, logo: null, logoBg: 'dark', area: 'Imperial Wharf, London', openNow: true },
  { name: 'Stars Gym', lat: 51.4804, lng: -0.1689, logo: null, logoBg: 'dark', area: 'Battersea, London', openNow: true },
];
const FALLBACK_COUNT = 7993; // active partners at snapshot time

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// app/(tabs)/discover.tsx getDistanceMiles
function getDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const formatMiles = (mi) => (mi < 0.1 ? '< 0.1 mi' : `${mi.toFixed(1)} mi`);

function isOpenNow(oh) {
  if (!oh) return true;
  const today = oh[DAY_KEYS[new Date().getDay()]];
  if (!today?.open || !today?.close) return false;
  const mins = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
  const now = new Date().getHours() * 60 + new Date().getMinutes();
  const open = mins(today.open);
  let close = mins(today.close);
  if (close <= open) close += 24 * 60; // spans midnight (e.g. 06:00–00:00)
  return now >= open && now < close;
}

/* Project the partner set's real lat/lng box onto map-canvas percentages.
   The window keeps every pin clear of the docked floats on both layouts —
   the compact header spans the panel's top third full-width, the desktop
   partner list owns the bottom-left — and leaves the 170px target ring
   room to bloom inside the narrowest (335px) compact panel. */
function project(partners) {
  const lats = partners.map((p) => p.lat);
  const lngs = partners.map((p) => p.lng);
  const latMin = Math.min(...lats), latMax = Math.max(...lats);
  const lngMin = Math.min(...lngs), lngMax = Math.max(...lngs);
  const span = (v, lo, hi, a, b) => (hi === lo ? (a + b) / 2 : a + ((v - lo) / (hi - lo)) * (b - a));
  return partners.map((p) => ({
    ...p,
    x: span(p.lng, lngMin, lngMax, 26, 80),
    y: span(p.lat, latMin, latMax, 76, 36), // north up
  }));
}

function finalise(partners, count) {
  const withDist = partners
    .map((p) => {
      const mi = getDistanceMiles(CENTER.lat, CENTER.lng, p.lat, p.lng);
      return { ...p, distMi: mi, distance: formatMiles(mi) };
    })
    .sort((a, b) => a.distMi - b.distMi);
  const projected = project(withDist);
  return {
    partners: projected,
    // The flagged showcase partner; nearest otherwise (the app's default sort)
    target: projected.find((p) => p.isTarget) ?? projected[0],
    count,
  };
}

export function fallbackDiscover() {
  return finalise(FALLBACK_PARTNERS, FALLBACK_COUNT);
}

export async function fetchDiscover() {
  if (!supabase) throw new Error('no supabase client');
  const [{ data, error }, countRes] = await Promise.all([
    supabase
      .from('partners')
      .select('id, name, logo_url, logo_bg, locations, opening_hours')
      .eq('active', true)
      .not('logo_url', 'is', null)
      .or('name.ilike.powr,name.ilike.one*ldn,name.ilike.stars*gym'),
    supabase.from('partners').select('id', { count: 'exact', head: true }).eq('active', true),
  ]);
  if (error) throw error;

  const partners = [];
  for (const spec of SHOWCASE) {
    // A brand can hold several rows and locations — keep its nearest site
    let best = null;
    for (const row of data ?? []) {
      if (!spec.pattern.test(row.name?.trim() ?? '')) continue;
      for (const loc of row.locations ?? []) {
        if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') continue;
        const mi = getDistanceMiles(CENTER.lat, CENTER.lng, loc.lat, loc.lng);
        if (!best || mi < best.mi) best = { row, loc, mi };
      }
    }
    if (!best) continue;
    partners.push({
      name: best.row.name,
      lat: spec.standIn?.lat ?? best.loc.lat,
      lng: spec.standIn?.lng ?? best.loc.lng,
      logo: best.row.logo_url,
      logoBg: best.row.logo_bg,
      area: spec.area,
      openNow: isOpenNow(best.row.opening_hours),
      isTarget: !!spec.target,
    });
  }
  if (partners.length < SHOWCASE.length) throw new Error('showcase partners missing');
  return finalise(partners, countRes.count ?? FALLBACK_COUNT);
}
