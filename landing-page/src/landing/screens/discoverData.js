import { supabase } from '../../lib/supabase';

/**
 * Live data for the Move stage's deconstructed Discover page.
 *
 * Same source of truth as app/(tabs)/discover.tsx: the `partners` table
 * (anon-readable), central-London bounds around the app's DEFAULT_REGION,
 * real logos + logo_bg, area = location address/name, open-now from
 * opening_hours, distance via the app's own miles formula. Real lat/lng are
 * projected linearly onto the stylised map canvas.
 */

// app/(tabs)/discover.tsx DEFAULT_REGION
const CENTER = { lat: 51.5074, lng: -0.1278 };
const BOUNDS = { latMin: 51.45, latMax: 51.56, lngMin: -0.25, lngMax: 0.05 };

// Real central-London partners (2026-07-03 snapshot) — used when the live
// fetch fails. logo:null renders the app's letter-fallback pin.
const FALLBACK_PARTNERS = [
  { name: 'PureGym London Tottenham Court Road', lat: 51.5242, lng: -0.1373, logo: null, logoBg: 'white', area: '145 Tottenham Ct Rd, London W1T 7NE, UK', openNow: true },
  { name: 'PureGym London Kentish Town', lat: 51.5475, lng: -0.1417, logo: null, logoBg: 'white', area: '217-223 Kentish Town Rd, London NW5 2JU, UK', openNow: true },
  { name: 'PureGym London Holloway Road', lat: 51.5597, lng: -0.1235, logo: null, logoBg: 'white', area: 'Mercers Rd, London N19 4PJ, UK', openNow: true },
  { name: 'PureGym London Swiss Cottage', lat: 51.5457, lng: -0.1786, logo: null, logoBg: 'white', area: '177 Finchley Rd, London NW3 6LB, UK', openNow: true },
  { name: 'Stars Gym', lat: 51.4804, lng: -0.1689, logo: null, logoBg: 'dark', area: 'Battersea, London', openNow: true },
  { name: 'ONE LDN', lat: 51.4738, lng: -0.1825, logo: null, logoBg: 'dark', area: 'Imperial Wharf, 3 The Blvd, London', openNow: true },
  { name: 'Stars Gym', lat: 51.4644, lng: -0.0125, logo: null, logoBg: 'dark', area: 'Deptford, London', openNow: true },
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

/* Project the partner set's real lat/lng box onto map-canvas percentages */
function project(partners) {
  const lats = partners.map((p) => p.lat);
  const lngs = partners.map((p) => p.lng);
  const latMin = Math.min(...lats), latMax = Math.max(...lats);
  const lngMin = Math.min(...lngs), lngMax = Math.max(...lngs);
  const span = (v, lo, hi, a, b) => (hi === lo ? (a + b) / 2 : a + ((v - lo) / (hi - lo)) * (b - a));
  return partners.map((p) => ({
    ...p,
    x: span(p.lng, lngMin, lngMax, 15, 85),
    y: span(p.lat, latMin, latMax, 78, 16), // north up
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
    target: projected[0], // nearest — same as the app's default sort
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
      .select('id, name, logo_url, logo_bg, address, locations, opening_hours')
      .eq('active', true)
      .not('logo_url', 'is', null)
      .filter('locations->0->lat', 'gte', BOUNDS.latMin)
      .filter('locations->0->lat', 'lte', BOUNDS.latMax)
      .filter('locations->0->lng', 'gte', BOUNDS.lngMin)
      .filter('locations->0->lng', 'lte', BOUNDS.lngMax)
      .limit(24),
    supabase.from('partners').select('id', { count: 'exact', head: true }).eq('active', true),
  ]);
  if (error) throw error;

  const seen = new Set();
  const partners = [];
  for (const row of data ?? []) {
    const loc = row.locations?.[0];
    if (!loc) continue;
    const key = `${row.name}|${loc.lat.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    partners.push({
      name: row.name,
      lat: loc.lat,
      lng: loc.lng,
      logo: row.logo_url,
      logoBg: row.logo_bg,
      // GeofenceContext: area = loc.address || loc.name || 'Local'
      area: loc.address?.trim() || loc.name?.trim() || row.address?.trim() || 'Local',
      openNow: isOpenNow(row.opening_hours),
    });
    if (partners.length >= 7) break;
  }
  if (!partners.length) throw new Error('no partners in bounds');
  return finalise(partners, countRes.count ?? FALLBACK_COUNT);
}
