import { supabase } from '../../lib/supabase';
import { storageImage } from '../../lib/storage';

export { fetchLiveRewards } from '../stages/RedeemTrack';

/*
 * Live proof numbers — public.landing_stats() (migration 20260905150000).
 * Read-only aggregates, anon-executable, showcase QA accounts excluded.
 * The fallback is the 2026-09-05 read, used only if the RPC fails.
 */
export const STATS_FALLBACK = {
  partners: 7871,
  brands: 8,
  sessions_7d: 785,
  points_7d: 13393,
  sessions_all: 4113,
  points_all: 52503,
  redemptions: 41,
};

export async function fetchStats() {
  try {
    const { data, error } = await supabase.rpc('landing_stats');
    if (error || !data) throw error;
    return { ...STATS_FALLBACK, ...data, live: true };
  } catch {
    return { ...STATS_FALLBACK, live: false };
  }
}

/* "Is my gym on POWR?" — partners are publicly readable where active */
export async function searchGyms(q) {
  const term = q.trim().replace(/[%_,]/g, ' ');
  if (term.length < 2) return [];
  const { data, error } = await supabase
    .from('partners')
    .select('id, name, address, logo_url, logo_bg, locations')
    .eq('active', true)
    .ilike('name', `%${term}%`)
    .order('name', { ascending: true })
    .limit(8);
  if (error) throw error;
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    area: areaOf(p),
    sites: Array.isArray(p.locations) ? p.locations.length : 1,
    logo: storageImage(p.logo_url || null, 96),
    logoBg: p.logo_bg,
  }));
}

/* A short, human place line — the town/postcode tail of the address, or the
   first location's own name */
function areaOf(p) {
  const loc = Array.isArray(p.locations) ? p.locations[0] : null;
  const addr = (p.address || loc?.address || '').trim();
  if (addr) {
    const parts = addr.split(',').map((s) => s.trim()).filter(Boolean);
    return parts.length > 1 ? parts.slice(-2).join(', ') : addr;
  }
  return loc?.name && loc.name !== p.name ? loc.name : 'United Kingdom';
}

/* Real partner chains on the platform (site counts from the partners table, 2026-09-05) */
export const CHAINS = ['Everlast Gyms', 'Sweaty Betty', 'Virgin Active', 'Anytime Fitness', 'Powerhouse Gym', 'OneGym', 'Revolution Studios', 'Spirit Health Club'];

/*
 * The award ladder — mirrors enforce_point_award_cap() / claim-points. A
 * curated read of it; the per-type daily caps are walking 5, sleep 5,
 * gym+HIIT 30, cardio uncapped.
 */
export const LADDER = [
  { label: 'Gym session', detail: '40 min or more, geofence-verified', pts: 20 },
  { label: 'Gym session', detail: '30–39 minutes', pts: 15 },
  { label: 'Run', detail: '10 km or 60 min', pts: 10 },
  { label: 'Run', detail: '5 km or 30 min', pts: 8 },
  { label: 'Ride', detail: '25 km or 60 min', pts: 8 },
  { label: 'Swim', detail: '1 km or 20 min', pts: 7 },
  { label: 'Yoga or Pilates', detail: '45 minutes', pts: 5 },
  { label: 'Steps', detail: '10,000 in a day', pts: 5 },
  { label: 'Sleep', detail: '8 hours', pts: 5 },
];
export const GYM_PTS = 20;

/* FNL x POWR — the first live event, read from live_events on 2026-09-05 */
export const EVENT = {
  name: 'FNL x POWR',
  venue: 'ONE LDN',
  venueArea: 'Imperial Wharf, London',
  venueLogo: 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/partner-logos/partners/1780309700450-phgw9x.webp',
  scoring: '27 Aug – 4 Sep 2026',
  night: 'Friday 4 September, 6–7pm',
  competitors: 25,
  prizes: [
    { rank: 1, label: 'Mandarin Oriental Wellness Day', img: 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-images/event-prizes/1787239532955-ql2qvy.png' },
    { rank: 2, label: 'Unbound Testing Package', img: 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-images/event-prizes/1787134225188-eu7abr.png' },
    { rank: 3, label: 'Form Smart Swim 2 Goggles', img: 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-images/event-prizes/1787133997902-c2yfwr.png' },
    { rank: 4, label: 'Huel Hamper', img: 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-images/event-prizes/1787141434856-a0sl2u.png' },
  ].map((p) => ({ ...p, img: storageImage(p.img, 720) })),
  rules: ['Only points earned during the event week count', 'Multipliers and streaks do not count', 'Winners revealed at the doors'],
};

/* Wearable marks — white-alpha PNGs in /public/wearables */
export const WEARABLES = [
  { id: 'apple-health', name: 'Apple Health' },
  { id: 'whoop', name: 'WHOOP' },
  { id: 'garmin', name: 'Garmin' },
  { id: 'oura', name: 'Oura' },
  { id: 'strava', name: 'Strava' },
  { id: 'fitbit', name: 'Fitbit' },
];

/* Level beats — constants/levels.ts, artwork in /public/levels. Legend tier
   stays classified on the site, as in the film. */
export const LEVELS = [
  { level: 1, name: 'Touching Grass', tier: 'Recruit', img: '/levels/touching-grass-1.png', color: '#FFFFFF', xp: 0 },
  { level: 5, name: 'Heavy Hitter', tier: 'Recruit', img: '/levels/heavy-hit.png', color: '#FF6A2C', xp: 4500 },
  { level: 9, name: 'Step Collector', tier: 'Athlete', img: '/levels/step-collector.png', color: '#E85CD8', xp: 19000 },
  { level: 15, name: 'Momentum Monster', tier: 'Elite', img: '/levels/momentum-monster.png', color: '#4A9EFF', xp: 77000 },
  { level: 17, name: null, tier: 'Legend', img: '/levels/diesel-mode.png', color: '#F5334F', xp: 111000 },
  { level: 20, name: null, tier: 'Legend', img: '/levels/goggins.png', color: '#E8D200', xp: 182000 },
];

export const APP_STORE = 'https://apps.apple.com/gb/app/powr/id6766784336';
export const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.powr.life&pcampaignid=web_share';
