// Runs supabase/migrations/20261125122000_admin_pin_drift.sql in PGlite — real Postgres, in
// Node — with auth / net / vault stubbed, then exercises what it changes.
// It never connects to anything: production is the only database, so this is
// how a migration gets tried before it is applied.
//
// This machine has no psql, Postgres or Docker, and PGlite is deliberately not a
// project dependency. In a scratch folder (run it FROM there):
//
//   npm i @electric-sql/pglite@0.3.16
//   node <repo>/scripts/sql-tests/pin_drift.mjs \
//        <repo>/supabase/migrations/20261125122000_admin_pin_drift.sql \
//        <repo>/scripts/sql-tests/fixtures
//
// fixtures/ holds the two helper functions the migration calls but does not
// define, copied from production (pg_get_functiondef, 2026-11-25).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Loaded from the folder this is RUN in, not the folder it lives in: PGlite is
// installed in a scratch folder, never in the project (see above).
const { PGlite } = await import(
  pathToFileURL(join(process.cwd(), 'node_modules/@electric-sql/pglite/dist/index.js')).href
);

const [migrationPath, liveDir] = process.argv.slice(2);
const db = new PGlite();
let failed = 0, passed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); }
};
const q = async (sql, params) => (await db.query(sql, params)).rows;
async function exec(sql) {
  try { await db.exec(sql); } catch (e) { console.log('SQL ERROR:', e.message, e.where ?? ''); throw e; }
}

const P1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const users = ['1', '2', '3', '4', '5'].map(d => `${d.repeat(8)}-${d.repeat(4)}-${d.repeat(4)}-${d.repeat(4)}-${d.repeat(12)}`);

await exec(`
  create role authenticated; create role anon;
  create function public.is_admin() returns boolean language sql stable as
    $$ select coalesce(current_setting('test.admin', true), '') = 'yes' $$;
  create table partners (id uuid primary key, name text, locations jsonb, active boolean default true);
  create table gym_visits (id uuid primary key default gen_random_uuid(), user_id uuid, partner_id uuid, region_id text);
  create table gym_visit_events (id bigserial primary key, visit_id uuid, user_id uuid, event text,
    detail jsonb default '{}'::jsonb, created_at timestamptz default now());
  create table geofence_region_events (id bigserial primary key, user_id uuid, region_id text, event text,
    detail jsonb default '{}'::jsonb, created_at timestamptz default now());
  insert into partners values
    ('${P1}', 'Off-Centre Gym', '[{"lat":51.5,"lng":-0.12,"radius":30}]'),
    ('${P2}', 'Spot-On Gym',    '[{"lat":52.0,"lng":-1.5,"radius":25},{"lat":52.01,"lng":-1.5,"radius":25}]');
`);
await exec(readFileSync(`${liveDir}/_gym_detail_num.sql`, 'utf8') + ';');
await exec(readFileSync(migrationPath, 'utf8'));
console.log('applied.\n');

// Off-Centre Gym: five members over four days, all standing ~40 m east, ~10 m north.
// One of them answers every wake (many readings) — must still be ONE vote a day.
let seed = '';
for (const [ui, u] of users.entries()) {
  seed += `insert into gym_visits (id, user_id, partner_id, region_id) values ('${u.slice(0, 35)}a', '${u}', '${P1}', '${P1}-0');\n`;
  for (let day = 0; day < 4; day++) {
    const n = ui === 0 ? 30 : 2;
    for (let k = 0; k < n; k++) {
      const dx = 40 + ((ui + k) % 5) - 2, dy = 10 + ((day + k) % 3) - 1;
      seed += `insert into gym_visit_events (visit_id, user_id, event, detail, created_at) values
        ('${u.slice(0, 35)}a', '${u}', 'confirmed_inside',
         '{"dx_m":${dx},"dy_m":${dy},"accuracy_m":8,"fix_age_s":3,"fix_trusted":true}', now() - interval '${day} days' - interval '${k} minutes');\n`;
    }
  }
}
// Readings that must NOT count: coarse, stale, untrusted, offset-less, too old.
seed += `
  insert into gym_visit_events (visit_id, user_id, event, detail) values
    ('${users[1].slice(0, 35)}a', '${users[1]}', 'confirmed_inside', '{"dx_m":-140,"dy_m":0,"accuracy_m":80,"fix_age_s":3,"fix_trusted":true}'),
    ('${users[1].slice(0, 35)}a', '${users[1]}', 'confirmed_inside', '{"dx_m":-140,"dy_m":0,"accuracy_m":8,"fix_age_s":900,"fix_trusted":true}'),
    ('${users[1].slice(0, 35)}a', '${users[1]}', 'confirmed_inside', '{"dx_m":-140,"dy_m":0,"accuracy_m":8,"fix_age_s":3,"fix_trusted":false}'),
    ('${users[1].slice(0, 35)}a', '${users[1]}', 'confirmed_inside', '{"distance_m":12,"accuracy_m":8,"fix_age_s":3,"fix_trusted":true}');
  insert into gym_visit_events (visit_id, user_id, event, detail, created_at) values
    ('${users[1].slice(0, 35)}a', '${users[1]}', 'confirmed_inside', '{"dx_m":-140,"dy_m":0,"accuracy_m":8,"fix_age_s":3,"fix_trusted":true}', now() - interval '200 days');
`;
// Spot-On Gym, second location: a couple of members right on the pin.
for (const u of users.slice(0, 3)) {
  seed += `insert into gym_visits (id, user_id, partner_id, region_id) values ('${u.slice(0, 35)}b', '${u}', '${P2}', '${P2}-1');\n`;
  for (let day = 0; day < 3; day++) {
    seed += `insert into gym_visit_events (visit_id, user_id, event, detail, created_at) values
      ('${u.slice(0, 35)}b', '${u}', 'confirmed_inside', '{"dx_m":${day - 1},"dy_m":2,"accuracy_m":6,"fix_age_s":1,"fix_trusted":true}', now() - interval '${day} days');\n`;
  }
}
// Near misses at Off-Centre Gym: three members in the ring, never checked in.
for (const [i, u] of users.slice(2).entries()) {
  seed += `insert into geofence_region_events (user_id, region_id, event, detail, created_at) values
    ('${u}', '${P1}-0', 'enter_scan', '{"reason":"no_match_in_ring","dx_m":${60 + i * 5},"dy_m":0,"acc_m":9,"nearest_m":${60 + i * 5}}', now() - interval '${i} days'),
    ('${u}', '${P1}-0', 'enter_scan', '{"reason":"no_match_in_ring","dx_m":90,"dy_m":0,"acc_m":9,"nearest_m":90}', now() - interval '${i} days'),
    ('${u}', 'fix',     'enter_scan', '{"reason":"map_unavailable","acc_m":9}', now());\n`;
}
// A third venue whose pin is so wrong that nobody checks in: near misses only.
const P3 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
seed += `insert into partners values ('${P3}', 'Nobody Gets In', '[{"lat":53.0,"lng":-2.0,"radius":25}]');\n`;
for (const [i, u] of users.entries()) {
  for (let day = 0; day < 2; day++) {
    seed += `insert into geofence_region_events (user_id, region_id, event, detail, created_at) values
      ('${u}', '${P3}-0', 'enter_scan', '{"reason":"no_match_in_ring","dx_m":${-85 - i},"dy_m":20,"acc_m":7,"nearest_m":88}', now() - interval '${day} days');\n`;
  }
}
await exec(seed);

console.log('admin_pin_drift');
let threw = false;
try { await q('select * from admin_pin_drift()'); } catch (e) { threw = /admins only/.test(e.message); }
ok('refuses a non-admin', threw);

await db.exec(`select set_config('test.admin', 'yes', false)`);
const rows = await q('select * from admin_pin_drift(60, 5)');
ok('three venues qualify', rows.length === 3, `(got ${rows.length})`);
const none = rows.find(r => r.partner_id === P3);
ok('a venue nobody can check into is listed on its near misses alone', !!none && none.votes === 0 && none.near_miss_votes === 10 && none.near_miss_members === 5, JSON.stringify(none));
ok('…ranked first: its phones sit ~90 m from the pin', rows[0].partner_id === P3 && Math.abs(none.near_miss_median_m - 89.5) <= 2);
ok('…with the direction they sat in (west, a little north)', Number(none.near_miss_dx_m) < -80 && Number(none.near_miss_dy_m) === 20);
ok('…and NO suggested pin — a pin is not moved on passers-by', none.suggested_lat === null && none.suggested_lng === null && none.confidence === 'near misses only');
const off = rows.find(r => r.partner_id === P1);
const spot = rows.find(r => r.partner_id === P2);
ok('the off-centre venue comes next', rows[1].partner_id === P1);
ok('one vote per member per day: 5 members × 4 days = 20', off.votes === 20 && off.members === 5, JSON.stringify(off));
ok('…while every sharp reading is still counted as a reading', off.readings === 30 * 4 + 2 * 4 * 4);
ok('centre is ~40 m east, ~10 m north of the pin', Math.abs(off.centre_dx_m - 40) <= 2 && Math.abs(off.centre_dy_m - 10) <= 1.5, `${off.centre_dx_m}, ${off.centre_dy_m}`);
ok('offset is ~41 m', Math.abs(off.offset_m - 41.2) <= 2.5, off.offset_m);
ok('every vote is outside the 30 m circle', Number(off.share_outside_circle) === 1);
ok('coarse / stale / untrusted / old readings did not drag it west', Number(off.centre_dx_m) > 35);
ok('suggested pin moves east and north', off.suggested_lng > off.pin_lng && off.suggested_lat > off.pin_lat);
// 40 m east at 51.5°N ≈ 0.000578° of longitude; 10 m north ≈ 0.00009° of latitude.
ok('…by the right amount', Math.abs((off.suggested_lng - off.pin_lng) - 40 / (111195 * Math.cos(51.5 * Math.PI / 180))) < 0.00005
  && Math.abs((off.suggested_lat - off.pin_lat) - 10 / 111195) < 0.00003);
ok('confidence strong on 20 votes from 5 members', off.confidence === 'strong');
ok('near misses are reported, one per member per day, by their closest reading',
  off.near_miss_votes === 3 && off.near_miss_members === 3 && Math.abs(off.near_miss_median_m - 65) <= 0.5, JSON.stringify(off));
ok('second location of a multi-site partner is its own row', spot.location_idx === 1 && Math.abs(spot.pin_lat - 52.01) < 1e-9);
ok('a well-placed pin shows a small offset and nobody outside', Number(spot.offset_m) <= 3 && Number(spot.share_outside_circle) === 0);
ok('…and is not called strong on 9 votes from 3 members', spot.confidence === 'fair');
ok('a higher bar hides the thin venues', (await q('select * from admin_pin_drift(60, 15)')).length === 1);
ok('a short window drops old days', (await q('select * from admin_pin_drift(1, 1)')).every(r => r.votes <= r.members));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
