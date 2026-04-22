#!/usr/bin/env node
/**
 * Upload Tribe partner images to Supabase storage and update DB records.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=<service-role-key> node scripts/upload-tribe-images.js
 *
 * Requires: the service-role key (not the anon key) for storage writes + DB updates.
 */

const fs   = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://wjvvujnicwkruaeibttt.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error('Set SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY (service-role key, not anon key).');
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

async function uploadFile(bucket, filePath, storagePath, contentType) {
  const body = fs.readFileSync(filePath);
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${bucket}/${storagePath}`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'true' },
      body,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload ${storagePath} failed (${res.status}): ${text}`);
  }
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${storagePath}`;
  console.log(`Uploaded → ${publicUrl}`);
  return publicUrl;
}

async function runSQL(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ query: sql }),
  });
  // Fallback: use the postgrest PATCH approach instead
}

async function patchPartnerLogo(partnerCode, logoUrl) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/partners?partner_code=eq.${partnerCode}`,
    {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ logo_url: logoUrl }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Patch partner logo failed (${res.status}): ${text}`);
  }
  console.log(`Partner ${partnerCode} logo_url updated.`);
}

async function patchRewardHero(partnerCode, heroUrl) {
  // Get partner id first
  const res1 = await fetch(
    `${SUPABASE_URL}/rest/v1/partners?partner_code=eq.${partnerCode}&select=id`,
    { headers: { ...headers, Accept: 'application/json' } },
  );
  const partners = await res1.json();
  if (!partners.length) throw new Error(`Partner ${partnerCode} not found`);
  const partnerId = partners[0].id;

  const res2 = await fetch(
    `${SUPABASE_URL}/rest/v1/rewards?partner_id=eq.${partnerId}&title=eq.Trial%20pack%20%C2%B7%206%20best%20sellers`,
    {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ hero_image_url: heroUrl }),
    },
  );
  if (!res2.ok) {
    const text = await res2.text();
    throw new Error(`Patch reward hero failed (${res2.status}): ${text}`);
  }
  console.log(`Tribe reward hero_image_url updated.`);
}

async function main() {
  const root = path.resolve(__dirname, '..');

  // Upload logo
  const logoPath = path.join(root, 'assets/images/partners/tribe.png');
  const logoUrl = await uploadFile('partner-logos', logoPath, 'tribe-logo.png', 'image/png');

  // Upload hero
  const heroPath = path.join(root, 'assets/images/6 pack.webp');
  const heroUrl = await uploadFile('reward-images', heroPath, 'tribe-6pack-hero.webp', 'image/webp');

  // Update DB records
  await patchPartnerLogo('TRIB', logoUrl);
  await patchRewardHero('TRIB', heroUrl);

  console.log('\nDone! Tribe images uploaded and DB records updated.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
