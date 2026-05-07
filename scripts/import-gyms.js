#!/usr/bin/env node
/**
 * Usage: node scripts/import-gyms.js path/to/gyms.xlsx [--dry-run]
 *
 * Reads an XLSX/XLS file of gym locations and upserts them into the
 * Supabase `partners` table with active=false.
 *
 * Expected columns (case-insensitive, common variations accepted):
 *   name, address, latitude/lat, longitude/lng, phone, website, opening_hours
 */

const XLSX = require('xlsx');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wjvvujnicwkruaeibttt.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY environment variable is required.');
  console.error('  export SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>');
  process.exit(1);
}

const GEOFENCE_RADIUS = 75;
const BATCH_SIZE = 50;

// ─── Column detection ────────────────────────────────────────────────────────

const COL_ALIASES = {
  name:    ['name', 'business name', 'gym name', 'title', 'place name'],
  address: ['address', 'full_address', 'full address', 'formatted_address', 'street address', 'location'],
  lat:     ['latitude', 'lat'],
  lng:     ['longitude', 'lng', 'long', 'lon'],
  phone:   ['phone', 'contact_phone', 'telephone', 'phone_number', 'phone number', 'contact phone'],
  website: ['website', 'site', 'url', 'web', 'website url'],
  hours:   ['opening_hours', 'opening hours', 'hours', 'working_hours', 'business hours', 'schedule', 'times'],
};

function detectColumns(headers) {
  const normalised = headers.map(h => (h || '').toString().toLowerCase().trim());
  const map = {};
  for (const [field, aliases] of Object.entries(COL_ALIASES)) {
    const idx = normalised.findIndex(h => aliases.includes(h));
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

// ─── Opening hours parser ────────────────────────────────────────────────────

const DAY_NAMES = {
  monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu',
  friday: 'fri', saturday: 'sat', sunday: 'sun',
  mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu',
  fri: 'fri', sat: 'sat', sun: 'sun',
};

function normaliseStr(s) {
  return (s || '')
    .replace(/ | | /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function to24h(timeStr) {
  timeStr = normaliseStr(timeStr).trim();
  const m = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? m[2] : '00';
  const ampm = (m[3] || '').toLowerCase();
  if (ampm === 'pm' && h !== 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

function parseTimeRange(rangeStr) {
  rangeStr = normaliseStr(rangeStr);
  if (/open 24 hours/i.test(rangeStr)) return { open: '00:00', close: '23:59' };
  // Take first period if there are multiple (e.g. "6am-1pm, 4pm-9pm")
  if (rangeStr.includes(',')) rangeStr = rangeStr.split(',')[0].trim();
  const sep = ['–', '—', '-', 'to'].find(s => rangeStr.includes(s));
  if (!sep) return null;
  const [openStr, closeStr] = rangeStr.split(sep).map(s => s.trim());
  // Inherit AM/PM from close time if open time lacks it
  let openParsed = to24h(openStr);
  const closeParsed = to24h(closeStr);
  if (!openParsed && /am|pm/i.test(closeStr) && !/am|pm/i.test(openStr)) {
    const suffix = closeStr.match(/am|pm/i)[0];
    openParsed = to24h(openStr + suffix);
  }
  if (!openParsed || !closeParsed) return null;
  return { open: openParsed, close: closeParsed };
}

function expandDayRange(from, to) {
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const s = order.indexOf(from);
  const e = order.indexOf(to);
  if (s === -1 || e === -1) return [];
  return s <= e ? order.slice(s, e + 1) : [...order.slice(s), ...order.slice(0, e + 1)];
}

function parseOpeningHours(raw) {
  if (!raw) return null;
  const s = normaliseStr(String(raw));
  if (!s || s.toLowerCase() === 'n/a') return null;

  const result = {};

  // Format: "Monday: 6am-10pm; Tuesday: 6am-10pm" or "Mon-Fri: 6am-10pm"
  // Also handles newline-separated entries
  const entries = s.split(/[;\n]+/).map(e => e.trim()).filter(Boolean);

  for (const entry of entries) {
    const colonIdx = entry.indexOf(':');
    if (colonIdx === -1) continue;
    const dayPart = entry.slice(0, colonIdx).trim().toLowerCase();
    const timePart = entry.slice(colonIdx + 1).trim();

    const range = parseTimeRange(timePart);
    if (!range) continue;

    // Expand day ranges like "Mon-Fri" or "Monday-Friday"
    const dashMatch = dayPart.match(/^(\w+)\s*[-–—]\s*(\w+)$/);
    if (dashMatch) {
      const fromKey = DAY_NAMES[dashMatch[1].toLowerCase()];
      const toKey   = DAY_NAMES[dashMatch[2].toLowerCase()];
      if (fromKey && toKey) {
        for (const d of expandDayRange(fromKey, toKey)) {
          result[d] = range;
        }
        continue;
      }
    }

    // Single day or comma-separated days
    const dayTokens = dayPart.split(/[,/]+/).map(d => d.trim());
    for (const token of dayTokens) {
      const key = DAY_NAMES[token.toLowerCase()];
      if (key) result[key] = range;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

// ─── partner_code generator ──────────────────────────────────────────────────

const SKIP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'in', 'at', 'on', 'for', 'to', 'london',
  'with', 'by', 'de', '&',
]);

function makeCode(name, used) {
  const words = name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w && !SKIP_WORDS.has(w.toLowerCase()));
  let base = words.map(w => w[0].toUpperCase()).join('').slice(0, 8);
  if (!base) base = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = base.slice(0, 7) + n;
    n++;
  }
  used.add(candidate);
  return candidate;
}

// ─── Supabase helpers ────────────────────────────────────────────────────────

const HEADERS = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=ignore-duplicates,return=representation',
};

async function fetchExistingCodes() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/partners?select=partner_code&category=eq.gym`,
    { headers: HEADERS }
  );
  const rows = await res.json();
  return new Set(rows.map(r => r.partner_code));
}

async function insertBatch(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/partners`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(rows),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text || '[]');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const filePath = args.find(a => !a.startsWith('--'));

  if (!filePath) {
    console.error('Usage: node scripts/import-gyms.js <file.xlsx> [--dry-run]');
    process.exit(1);
  }

  const wb = XLSX.readFile(path.resolve(filePath));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (rows.length < 2) {
    console.error('No data rows found in spreadsheet');
    process.exit(1);
  }

  const headers = rows[0];
  const colMap = detectColumns(headers);

  console.log('\nDetected columns:');
  for (const [field, idx] of Object.entries(colMap)) {
    console.log(`  ${field.padEnd(8)} → col ${idx} ("${headers[idx]}")`);
  }

  const required = ['name', 'lat', 'lng'];
  const missing = required.filter(f => colMap[f] === undefined);
  if (missing.length) {
    console.error(`\nMissing required columns: ${missing.join(', ')}`);
    console.error('Available headers:', headers.join(', '));
    process.exit(1);
  }

  console.log(`\nFetching existing partner codes...`);
  const usedCodes = dryRun ? new Set() : await fetchExistingCodes();
  console.log(`  ${usedCodes.size} existing codes loaded\n`);

  const partners = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = normaliseStr(String(row[colMap.name] || ''));
    if (!name) { skipped++; continue; }

    const lat = parseFloat(row[colMap.lat]);
    const lng = parseFloat(row[colMap.lng]);
    if (isNaN(lat) || isNaN(lng)) { skipped++; continue; }

    const address = colMap.address !== undefined ? normaliseStr(String(row[colMap.address] || '')) : '';
    const phone   = colMap.phone   !== undefined ? normaliseStr(String(row[colMap.phone]   || '')) || null : null;
    const website = colMap.website !== undefined ? normaliseStr(String(row[colMap.website] || '')) || null : null;
    const hours   = colMap.hours   !== undefined ? parseOpeningHours(row[colMap.hours]) : null;

    partners.push({
      name,
      partner_code:   makeCode(name, usedCodes),
      category:       'gym',
      active:         false,
      contact_phone:  phone,
      website,
      address,
      locations:      [{ lat, lng, radius: GEOFENCE_RADIUS, name: address || name }],
      opening_hours:  hours ?? null,
    });
  }

  console.log(`Parsed ${partners.length} partners, skipped ${skipped} empty/invalid rows`);

  if (dryRun) {
    console.log('\n--- DRY RUN (first 3 rows) ---');
    partners.slice(0, 3).forEach(p => console.log(JSON.stringify(p, null, 2)));
    return;
  }

  // Insert in batches
  let inserted = 0;
  let ignored  = 0;
  for (let i = 0; i < partners.length; i += BATCH_SIZE) {
    const batch = partners.slice(i, i + BATCH_SIZE);
    const result = await insertBatch(batch);
    inserted += result.length;
    ignored  += batch.length - result.length;
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${result.length} inserted, ${batch.length - result.length} skipped (duplicates)`);
  }

  console.log(`\nDone. ${inserted} inserted, ${ignored} skipped.`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
