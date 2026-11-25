// Runs supabase/migrations/20261125120000_gym_visit_zone_bands_and_resume.sql in PGlite — real Postgres, in
// Node — with auth / net / vault stubbed, then exercises what it changes.
// It never connects to anything: production is the only database, so this is
// how a migration gets tried before it is applied.
//
// This machine has no psql, Postgres or Docker, and PGlite is deliberately not a
// project dependency. In a scratch folder (run it FROM there):
//
//   npm i @electric-sql/pglite@0.3.16
//   node <repo>/scripts/sql-tests/zone_bands_and_resume.mjs \
//        <repo>/supabase/migrations/20261125120000_gym_visit_zone_bands_and_resume.sql \
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
let failed = 0;
let passed = 0;

const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${extra}`); }
};
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const P1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

async function exec(sql) {
  try { await db.exec(sql); } catch (e) { console.log('SQL ERROR:', e.message, e.where ?? ''); throw e; }
}

await exec(`
  create role authenticated; create role anon; create role service_role;
  create schema auth; create schema net; create schema vault;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table net.calls (id bigserial primary key, url text, body jsonb);
  create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language plpgsql as
    $$ declare v bigint; begin insert into net.calls (url, body) values (url, body) returning id into v; return v; end $$;
  create view vault.decrypted_secrets as select 'shared_resolve_token'::text as name, 'tok'::text as decrypted_secret;

  create table partners (id uuid primary key, name text, locations jsonb, active boolean default true);
  create table system_config (key text primary key, value text);
  insert into system_config values ('min_gym_dwell_minutes', '30'), ('gym_upgrade_minutes', '40');
  create table activity_sessions (
    id uuid primary key default gen_random_uuid(), user_id uuid, type text, started_at timestamptz,
    ended_at timestamptz, duration_sec int, verification text, trust_score float8, partner_id uuid, raw_gps jsonb);
  create table point_transactions (id bigserial primary key, session_id uuid, type text, description text);
  create table geofence_region_events (
    id bigserial primary key, user_id uuid, region_id text, event text, platform text,
    detail jsonb default '{}'::jsonb, created_at timestamptz default now());

  -- Columns, checks and the one-live index copied from production (2026-11-25).
  create table gym_visits (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null, partner_id uuid, region_id text, platform text,
    started_at timestamptz not null, last_confirmed_at timestamptz,
    claimed_session_id uuid, claimed_at timestamptz, upgraded_at timestamptz, ended_at timestamptz,
    status text not null default 'open', nudge_count int not null default 0, last_nudge_at timestamptz,
    created_at timestamptz not null default now(), close_reason text,
    nudge_count_upgrade int not null default 0, announced_at timestamptz,
    wake_nonce_hash text, wake_nonce_expires_at timestamptz, completed_push_at timestamptz,
    last_proven_at timestamptz,
    constraint gym_visits_ended_implies_terminal check (ended_at is null or status in ('closed','abandoned')),
    constraint gym_visits_status_check check (status in ('open','claimed','upgraded','closed','abandoned')),
    constraint gym_visits_upgrade_implies_claim check (upgraded_at is null or claimed_at is not null));
  create unique index gym_visits_one_live_per_user_idx on gym_visits (user_id) where ended_at is null;
  create table gym_visit_events (
    id bigserial primary key, visit_id uuid, user_id uuid, event text,
    detail jsonb default '{}'::jsonb, created_at timestamptz default now());

  insert into partners values
    ('${P1}', 'ONE LDN', '[{"lat":51.5,"lng":-0.12,"radius":30}]'),
    ('${P2}', 'Next Door', '[{"lat":51.5003,"lng":-0.12,"radius":25}]');
`);
await exec(readFileSync(`${liveDir}/_gym_detail_num.sql`, 'utf8') + ';');
await exec(readFileSync(`${liveDir}/_gym_visit_radius_m.sql`, 'utf8') + ';');

console.log('applying migration…');
await exec(readFileSync(migrationPath, 'utf8'));
console.log('applied.\n');

const as = (uid) => db.exec(`select set_config('test.uid', '${uid}', false)`);
const visit = (id) => one('select * from gym_visits where id = $1::uuid', [id]);
const lastEvent = async (id, event) => (await one(
  'select detail from gym_visit_events where visit_id = $1::uuid and event = $2 order by id desc limit 1', [id, event]))?.detail;
const open = async (partner, startedAgoMin, fix = null) => (await one(
  `select open_gym_visit($1::uuid, $2, now() - ($3::int * interval '1 minute'), 'ios', $4::jsonb) as id`,
  [partner, `${partner}-0`, startedAgoMin, fix ? JSON.stringify(fix) : null])).id;
const confirm = (id, detail, inside = true) => one(
  'select confirm_gym_visit_v2($1::uuid, $2::boolean, $3::jsonb, false, null) as r', [id, inside, JSON.stringify(detail)]);
const rewind = (id, cols) => db.exec(`update gym_visits set ${cols} where id = '${id}'`);

// ── 1. the band function matches lib/geofence/zone.ts ────────────────────────
console.log('_gym_visit_band');
{
  const cases = [
    [18, 25, 8, 'inside'], [35, 25, 10, 'inside'], [36, 25, 10, 'near'],
    [37, 30, 5, 'near'],   // ONE LDN 09-07
    [80, 25, 99, 'near'],  // blur no longer buys proof range (old rule: present)
    [55, 25, 99, 'inside'], [105, 25, 99, 'near'], [106, 25, 99, 'gone'],
    [75, 25, null, 'near'], [76, 25, null, 'gone'], [85, 25, 10, 'near'], [86, 25, 10, 'gone'],
  ];
  for (const [d, r, a, want] of cases) {
    const got = (await one('select _gym_visit_band($1::numeric, $2::numeric, $3::numeric) as b', [d, r, a])).b;
    ok(`d=${d} r=${r} acc=${a} → ${want}`, got === want, `(got ${got})`);
  }
  ok('null distance → null', (await one('select _gym_visit_band(null, 25, 5) as b')).b === null);
}

// ── 2. proof, near, and the two clocks ───────────────────────────────────────
console.log('\nconfirm_gym_visit_v2');
await as(U1);
{
  const id = await open(P1, 20, { distance_m: 12, accuracy_m: 8, fix_trusted: true, fix_age_s: 2 });
  let v = await visit(id);
  ok('check-in fix proves presence', v.last_proven_at != null);
  ok('…and stamps last_present_at too', v.last_present_at != null);
  const proofAfterOpen = v.last_proven_at.getTime();

  // Sharp fix, 37 m from a 30 m pin: the refused-but-present case.
  await db.exec(`select pg_sleep(0.05)`);
  await confirm(id, { distance_m: 37, accuracy_m: 5, fix_trusted: true, fix_age_s: 1, stage: 'presence' });
  v = await visit(id);
  let ev = await lastEvent(id, 'confirmed_inside');
  ok('37 m / acc 5 is not proof', ev.proven === false && ev.present === false);
  ok('…but is near', ev.near === true && ev.band === 'near');
  ok('…leaves last_proven_at alone', v.last_proven_at.getTime() === proofAfterOpen);
  ok('…and advances last_present_at', v.last_present_at.getTime() > proofAfterOpen);

  // Blurry fix that the OLD rule (radius + accuracy) accepted from 90 m.
  await confirm(id, { distance_m: 90, accuracy_m: 99, fix_trusted: true, fix_age_s: 1 });
  ev = await lastEvent(id, 'confirmed_inside');
  ok('90 m / acc 99 no longer proves', ev.proven === false && ev.band === 'near');

  // Stale near fix vouches for nothing.
  const presentBefore = (await visit(id)).last_present_at.getTime();
  await confirm(id, { distance_m: 40, accuracy_m: 5, fix_trusted: true, fix_age_s: 600 });
  ev = await lastEvent(id, 'confirmed_inside');
  ok('a 10-minute-old near fix does not stamp', ev.near === false
    && (await visit(id)).last_present_at.getTime() === presentBefore);

  // Untrusted fix.
  await confirm(id, { distance_m: 10, accuracy_m: 300, fix_trusted: false, fix_age_s: 1 });
  ev = await lastEvent(id, 'confirmed_inside');
  ok('an untrusted fix is neither proof nor near', ev.proven === false && ev.near === false);

  // Gone.
  await confirm(id, { distance_m: 400, accuracy_m: 8, fix_trusted: true, fix_age_s: 1 });
  ev = await lastEvent(id, 'confirmed_inside');
  ok('400 m is gone', ev.band === 'gone' && ev.near === false);

  // An "outside" answer never stamps presence, whatever the numbers say.
  const before = (await visit(id)).last_present_at.getTime();
  await confirm(id, { distance_m: 10, accuracy_m: 5, fix_trusted: true, fix_age_s: 1 }, false);
  ok('p_inside=false never stamps last_present_at', (await visit(id)).last_present_at.getTime() === before);

  // Credit path still fires exactly as before: past the dwell, request credit.
  await rewind(id, `started_at = now() - interval '31 minutes'`);
  const r = (await one('select confirm_gym_visit_v2($1::uuid, true, $2::jsonb, true, null) as r',
    [id, JSON.stringify({ distance_m: 10, accuracy_m: 5, fix_trusted: true, fix_age_s: 1 })])).r;
  ok('credit branch unchanged: claim is triggered past the dwell', r.triggered === 'claim');
  ok('…and posts to claim-points once', (await q('select * from net.calls')).length === 1);
}

// ── 3. resuming a visit ──────────────────────────────────────────────────────
console.log('\nopen_gym_visit — resume');
await as(U2);
{
  // 24 minutes, then an exit 12 minutes ago.
  const id = await open(P1, 36, { distance_m: 10, accuracy_m: 8, fix_trusted: true, fix_age_s: 2 });
  await one(`select close_gym_visit($1::uuid, now() - interval '12 minutes')`, [id]);
  let v = await visit(id);
  ok('first leg closed by exit', v.status === 'closed' && v.close_reason === 'exit' && v.ended_at != null);
  const origStart = v.started_at.getTime();
  await rewind(id, `completed_push_at = now()`);

  // A bare re-open (no resume request) is a NEW visit — old behaviour intact.
  const fresh = await open(P1, 0, { distance_m: 9, accuracy_m: 8, fix_trusted: true, fix_age_s: 1 });
  ok('no resume_visit → a new visit, as before', fresh !== id);
  await db.exec(`delete from gym_visit_events where visit_id = '${fresh}'; delete from gym_visits where id = '${fresh}'`);

  // The app's request: resume, start shifted by the ~12 minutes away.
  const resumed = (await one(
    `select open_gym_visit($1::uuid, $2, $3::timestamptz, 'ios', $4::jsonb) as id`,
    [P1, `${P1}-0`, new Date(origStart + 12 * 60_000).toISOString(),
      JSON.stringify({ distance_m: 9, accuracy_m: 8, fix_trusted: true, fix_age_s: 1, resume_visit: id })])).id;
  v = await visit(id);
  ok('resume returns the SAME visit', resumed === id);
  ok('…live again, status open', v.ended_at === null && v.status === 'open' && v.close_reason === null);
  const shiftMin = (v.started_at.getTime() - origStart) / 60_000;
  ok('…start moved forward by the time away (~12 min), never billed', shiftMin >= 11.9 && shiftMin <= 12.1, `(shift ${shiftMin})`);
  ok('…proof clock not below the new start', v.last_proven_at.getTime() >= v.started_at.getTime());
  ok('…completion push re-armed', v.completed_push_at === null);
  const ev = await lastEvent(id, 'resumed');
  ok('…logged as resumed with the gap', ev && ev.gap_s >= 700 && ev.gap_s <= 740 && ev.prior_status === 'open', JSON.stringify(ev));
  const stampEv = await lastEvent(id, 'confirmed_inside');
  ok('…the confirming fix is stamped, without the routing key', stampEv.stage === 'check_in' && !('resume_visit' in stampEv));

  // A client cannot shorten its own absence: asks for the ORIGINAL start.
  await one(`select close_gym_visit($1::uuid, now() - interval '14 minutes')`, [id]);
  const cheat = (await one(
    `select open_gym_visit($1::uuid, $2, $3::timestamptz, 'ios', $4::jsonb) as id`,
    [P1, `${P1}-0`, new Date(origStart).toISOString(), JSON.stringify({ resume_visit: id })])).id;
  const v2 = await visit(id);
  const forced = (v2.started_at.getTime() - v.started_at.getTime()) / 60_000;
  ok('server enforces its own measure of the gap (less 5 min slack)', cheat === id && forced >= 8.9, `(forced ${forced})`);
  ok('a fix-less resume writes no empty confirm row',
    (await q(`select 1 from gym_visit_events where visit_id = $1::uuid and event = 'confirmed_inside'`, [id])).length === 2);

  // Too late: closed 25 minutes ago.
  await one(`select close_gym_visit($1::uuid, now())`, [id]);
  await rewind(id, `ended_at = now() - interval '25 minutes'`);
  const late = await open(P1, 0, { distance_m: 9, accuracy_m: 8, fix_trusted: true, fix_age_s: 1, resume_visit: id });
  ok('past the window → a new visit', late !== id);
  await one(`select close_gym_visit($1::uuid, now())`, [late]);

  // Not an exit: a reaper close is never resumed.
  await rewind(late, `ended_at = now() - interval '2 minutes', close_reason = 'stale_after_upgrade'`);
  const afterReap = await open(P1, 0, { resume_visit: late });
  ok('a visit the reaper closed is not resumed', afterReap !== late);
  await one(`select close_gym_visit($1::uuid, now())`, [afterReap]);

  // Wrong venue.
  await rewind(afterReap, `ended_at = now() - interval '2 minutes'`);
  const other = await open(P2, 0, { resume_visit: afterReap });
  ok('a visit at another venue is not resumed', other !== afterReap);
  await one(`select close_gym_visit($1::uuid, now())`, [other]);

  // Someone else's visit.
  await as(U1);
  await db.exec(`update gym_visits set ended_at = now(), status = 'closed', close_reason = 'exit' where user_id = '${U1}' and ended_at is null`);
  await rewind(other, `ended_at = now() - interval '2 minutes'`);
  const stolen = await open(P2, 0, { resume_visit: other });
  ok("another member's visit is not resumed", stolen !== other && (await visit(other)).ended_at !== null);

  // Garbage in the routing key must not break a normal open.
  await one(`select close_gym_visit($1::uuid, now())`, [stolen]);
  const garbage = await open(P2, 0, { resume_visit: 'not-a-uuid', distance_m: 5, accuracy_m: 5, fix_trusted: true, fix_age_s: 1 });
  ok('a malformed resume_visit still opens a visit', typeof garbage === 'string' && garbage.length === 36);
}

// ── 4. a claimed first leg resumes as claimed ────────────────────────────────
console.log('\nresume keeps what was earned');
await as(U2);
{
  await db.exec(`update gym_visits set ended_at = coalesce(ended_at, now()), status = 'closed', close_reason = coalesce(close_reason, 'exit') where user_id = '${U2}' and ended_at is null`);
  const id = await open(P1, 40, { distance_m: 10, accuracy_m: 8, fix_trusted: true, fix_age_s: 2 });
  await rewind(id, `status = 'claimed', claimed_at = now() - interval '9 minutes'`);
  await one(`select close_gym_visit($1::uuid, now() - interval '3 minutes')`, [id]);
  const back = await open(P1, 37, { resume_visit: id, distance_m: 8, accuracy_m: 6, fix_trusted: true, fix_age_s: 1 });
  let v = await visit(id);
  ok('claimed visit resumes as claimed', back === id && v.status === 'claimed' && v.ended_at === null);
  ok('…claimed_at is still after the shifted start', v.claimed_at.getTime() > v.started_at.getTime());

  // A client that asks for a start AFTER the claim cannot push the row into a
  // state where it was claimed before it began.
  await one(`select close_gym_visit($1::uuid, now() - interval '1 minute')`, [id]);
  await open(P1, 0, { resume_visit: id });
  v = await visit(id);
  ok('…and a start past the claim is clamped to it', v.ended_at === null && v.started_at.getTime() <= v.claimed_at.getTime());
}

// ── 5. a coarse sweep can no longer cut an end time ──────────────────────────
console.log('\nclose_gym_visit — sweep_elsewhere');
{
  await db.exec(`update gym_visits set ended_at = coalesce(ended_at, now()), status = 'closed', close_reason = coalesce(close_reason, 'exit') where ended_at is null`);
  await as(U1);
  const mk = async (acc, nearest, startedAgoMin) => {
    const id = await open(P1, startedAgoMin, { distance_m: 10, accuracy_m: 8, fix_trusted: true, fix_age_s: 2 });
    await rewind(id, `last_proven_at = now() - interval '40 minutes'`);
    await db.exec(`insert into geofence_region_events (user_id, region_id, event, detail, created_at) values
      ('${U1}', 'sweep', 'sweep', '${JSON.stringify({ outcome: 'handoff', acc_m: acc, nearest_m: nearest })}', now() - interval '20 minutes')`);
    await one(`select close_gym_visit($1::uuid, now())`, [id]);
    const ev = await lastEvent(id, 'exit');
    await db.exec(`delete from geofence_region_events`);
    return ev;
  };
  const coarse = await mk(600, 300, 50);
  ok('a 600 m-accuracy sweep 300 m "away" does not clamp the end', coarse.end_basis === 'exit_witness', JSON.stringify(coarse));
  const withinBar = await mk(90, 150, 60);
  ok('a sweep whose error bar still reaches the venue does not clamp', withinBar.end_basis === 'exit_witness', JSON.stringify(withinBar));
  const sharp = await mk(10, 300, 70);
  ok('a sharp sweep 300 m away still clamps', sharp.end_basis === 'sweep_elsewhere', JSON.stringify(sharp));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
