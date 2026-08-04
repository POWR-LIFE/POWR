import { storageImage } from '../../lib/storage';
import { supabase } from '../../lib/supabase';

/**
 * The live partner wall.
 *
 * Read straight from the `rewards` table at runtime, exactly like the
 * homepage vault (stages/RedeemTrack.jsx) — a hand-maintained logo list on a
 * partners page goes stale the moment a brand is deactivated, and this page
 * is where that would be most embarrassing. One row per brand: a brand with
 * two live rewards is one partner, not two.
 *
 * ⚠ Coupling worth knowing: flipping `rewards.active` in admin changes BOTH
 * the app catalogue and this page. There is no partners-page-only pin.
 */

/* Card-scale copies of brand art. Logos are uploaded at press resolution —
   one is 7554x2123 — and cost ~60MB of decoded bitmap to paint a 44px chip
   unless the CDN resizes them first. See lib/storage.js. */
const LOGO_MAX = 160;
const HERO_MAX = 1024;

/* "15% OFF" / "£10 OFF" from the reward's structured discount columns.
   `value_label` is display copy and mostly empty — the real discount lives in
   discount_type + discount_value. */
function discountLabel(type, value) {
  const v = parseFloat(value);
  if (!v) return '';
  const n = Number.isInteger(v) ? v : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  if (type === 'percentage') return `${n}% OFF`;
  if (type === 'fixed_amount') return `£${n} OFF`;
  return '';
}

function offerFlash(item) {
  const m = /(£\s?\d+(?:\.\d+)?|\d+\s?%)\s*off/i.exec(item || '');
  return m ? `${m[1].replace(/\s/g, '')} OFF` : '';
}

/* Shown if the fetch fails. Deliberately the same eight brands that are live
   today, so a network blip degrades to "slightly out of date" rather than to
   an empty wall on the page whose whole job is showing the wall. */
export const FALLBACK_BRANDS = [
  { id: 'f1', brand: 'HUEL', flash: '£10 OFF', pts: 185, logo: null, hero: null, tint: '#A6C34C' },
  { id: 'f2', brand: 'MAJIC', flash: '15% OFF', pts: 180, logo: null, hero: null, tint: '#9000fe' },
  { id: 'f3', brand: 'Tribe', flash: '35% OFF', pts: 220, logo: null, hero: null, tint: '#1877C7' },
  { id: 'f4', brand: 'FRANk', flash: '20% OFF', pts: 200, logo: null, hero: null, tint: '#E8734A' },
  { id: 'f5', brand: 'REP', flash: '20% OFF', pts: 200, logo: null, hero: null, tint: '#006AFB' },
  { id: 'f6', brand: 'OMNITY', flash: '20% OFF', pts: 210, logo: null, hero: null, tint: '#E8D200' },
  { id: 'f7', brand: 'SWT', flash: '15% OFF', pts: 150, logo: null, hero: null, tint: '#E8D200' },
  { id: 'f8', brand: 'MATHAN', flash: '£15 OFF', pts: 300, logo: null, hero: null, tint: '#0e2bff' },
];

export async function fetchLiveBrands() {
  if (!supabase) return FALLBACK_BRANDS;
  const { data, error } = await supabase
    .from('rewards')
    .select('id, title, brand_name, powr_cost, value_label, offer, discount_type, discount_value, image_url, hero_image_url, brand_color')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('powr_cost', { ascending: true })
    .limit(48);
  if (error) throw error;

  const byBrand = new Map();
  for (const r of data ?? []) {
    const brand = (r.brand_name || r.title || '').trim();
    if (!brand) continue;
    const key = brand.toLowerCase();
    const flash = discountLabel(r.discount_type, r.discount_value)
      || offerFlash(r.value_label?.trim() || r.offer?.trim() || '');
    const existing = byBrand.get(key);
    if (existing) {
      // Merge rather than drop: the richer of a brand's rows wins each field
      if (!existing.flash && flash) existing.flash = flash;
      if (!existing.hero && r.hero_image_url) existing.hero = storageImage(r.hero_image_url, HERO_MAX);
      if (!existing.offer) existing.offer = r.value_label?.trim() || r.offer?.trim() || '';
      continue;
    }
    byBrand.set(key, {
      id: r.id,
      brand,
      flash,
      offer: r.value_label?.trim() || r.offer?.trim() || '',
      pts: r.powr_cost,
      logo: storageImage(r.image_url || null, LOGO_MAX),
      hero: storageImage(r.hero_image_url || null, HERO_MAX),
      tint: r.brand_color?.trim() || '#E8D200',
    });
  }
  const brands = [...byBrand.values()];
  return brands.length ? brands : FALLBACK_BRANDS;
}
