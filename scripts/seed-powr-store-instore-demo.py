#!/usr/bin/env python3
"""
POWR Store in-store demo data: what a live shop looks like in the partner
portal (In Store, Redemptions, Sites, Staff) and on the till tablet.

POWR Store is the QA store (system_config qa_brand_name). Everything here is
fake and stays out of members' sight:
  * the four sample rewards are INACTIVE (QA testers can still see them);
  * every shopper is one of the 47 demo people tagged
    raw_app_meta_data.seed = 'powr-gym-demo' (already excluded from member counts);
  * claims are inserted with receipt_emailed_at set, so no receipt email goes;
  * POWR Store has no webhooks, so codes marked used notify nobody;
  * no point_transactions: nobody's balance moves.
Sample rewards carry '[sample]' in their description; sample staff and shops
have created_by NULL. scripts/seed-powr-store-instore-demo-cleanup.sql removes
the lot.

Usage:
  supabase db query --linked "<ids query in the PR notes>" > ids.json  (see main())
  python3 scripts/seed-powr-store-instore-demo.py ids.json > seed.sql
  supabase db query --linked -f seed.sql

ids.json: {"demo": [{"id","name"}...], "manager": uuid, "site_powr": uuid, "staff_jamie": uuid}
"""
import datetime as dt
import json
import math
import random
import secrets
import sys
import uuid

random.seed(20261013)
NOW = dt.datetime.now(dt.timezone.utc)
BRAND = 'POWR Store'
IMG = 'https://powr.life/powr-avatar.png'
ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
LONDON_OFFSET = dt.timedelta(hours=1)  # BST until 25 Oct 2026; every seeded day is BST


def q(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, dt.datetime):
        return "'" + v.astimezone(dt.timezone.utc).isoformat() + "'"
    return "'" + str(v).replace("'", "''") + "'"


def ean13(n):
    base = '29' + str(n).zfill(10)
    s = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(base))
    return base + str((10 - s % 10) % 10)


def token(n=8):
    return ''.join(secrets.choice(ALPHA) for _ in range(n))


def jitter(lat, lng, metres):
    r = metres * math.sqrt(random.random())
    a = random.random() * 2 * math.pi
    return lat + (r * math.cos(a)) / 111320, lng + (r * math.sin(a)) / (111320 * math.cos(math.radians(lat)))


def local_time(day_offset, hour, minute):
    """A London wall-clock time `day_offset` days ago, as UTC."""
    d = (NOW + LONDON_OFFSET).date() - dt.timedelta(days=day_offset)
    return dt.datetime(d.year, d.month, d.day, hour, minute, random.randint(0, 59), tzinfo=dt.timezone.utc) - LONDON_OFFSET


def busy_hour():
    hours = list(range(8, 20))
    weights = [2, 4, 5, 6, 9, 10, 7, 5, 5, 8, 9, 4]  # lunch and after-work peaks
    return random.choices(hours, weights)[0]


def main():
    ids = json.load(open(sys.argv[1]))
    demo = ids['demo']
    out = ['begin;']

    # ── Shops ──
    sites = [
        {'id': ids['site_powr'], 'name': 'POWR', 'lat': 52.124527, 'lng': -1.76384, 'w': 40, 'new': False},
        {'id': str(uuid.uuid4()), 'name': 'Stratford', 'address': 'Bridge Street, Stratford-upon-Avon CV37 6AB',
         'lat': 52.19190, 'lng': -1.70640, 'code': 'STR-01', 'w': 35, 'new': True},
        {'id': str(uuid.uuid4()), 'name': 'Shoreditch', 'address': 'Redchurch Street, London E2 7DJ',
         'lat': 51.52390, 'lng': -0.07450, 'code': 'SHO-02', 'w': 25, 'new': True},
    ]
    for s in sites:
        if s['new']:
            out.append(
                "insert into public.reward_brand_sites (id, brand_name, name, address, lat, lng, radius_m, stand_code) values "
                f"({q(s['id'])}, {q(BRAND)}, {q(s['name'])}, {q(s['address'])}, {s['lat']}, {s['lng']}, 50, "
                f"coalesce((select case when exists (select 1 from public.reward_brand_sites where stand_code = {q(s['code'])}) "
                f"then null else {q(s['code'])} end), public._in_store_new_stand_code({q(s['name'])})));")

    # ── Staff (sample links have no usable token: make a real one with "New link") ──
    staff = {
        'POWR': [{'id': ids['staff_jamie'], 'name': 'Jamie Mason-Wright', 'new': False},
                 {'id': str(uuid.uuid4()), 'name': 'Ellie', 'new': True}],
        'Stratford': [{'id': str(uuid.uuid4()), 'name': 'Priya', 'new': True}],
        'Shoreditch': [{'id': str(uuid.uuid4()), 'name': 'Dan', 'new': True}],
    }
    site_by_name = {s['name']: s for s in sites}
    for site_name, people in staff.items():
        for p in people:
            if p['new']:
                out.append(
                    "insert into public.reward_brand_staff (id, brand_name, name, site_id, token_hash) values "
                    f"({q(p['id'])}, {q(BRAND)}, {q(p['name'])}, {q(site_by_name[site_name]['id'])}, "
                    "encode(extensions.digest(encode(extensions.gen_random_bytes(16), 'hex'), 'sha256'), 'hex'));")

    # ── Rewards (inactive) ──
    R = {
        'kit': {'id': str(uuid.uuid4()), 'title': '20% off POWR kit', 'cost': 800, 'type': 'IN_STORE', 'value': '20% off',
                'offer': '20% off any POWR kit in store', 'where': 'in_store', 'check': 'staff_scan'},
        'shaker': {'id': str(uuid.uuid4()), 'title': 'Free shaker with any purchase', 'cost': 500, 'type': 'IN_STORE',
                   'value': 'Free shaker', 'offer': 'A free POWR shaker with any purchase', 'where': 'in_store', 'check': 'look'},
        'tenner': {'id': str(uuid.uuid4()), 'title': '£10 off orders over £50', 'cost': 1200, 'type': 'POOL', 'value': '£10 off',
                   'offer': '£10 off when you spend £50, online or in store', 'where': 'both', 'check': 'staff_scan',
                   'url': 'https://powr.life'},
        'fiver': {'id': str(uuid.uuid4()), 'title': '£5 off at the till', 'cost': 400, 'type': 'POOL', 'value': '£5 off',
                  'offer': '£5 off, scanned at the till', 'where': 'in_store', 'check': 'till_barcode'},
    }
    for r in R.values():
        out.append(
            "insert into public.rewards (id, title, description, powr_cost, category, brand_name, active, integration_type, "
            "reward_kind, offer, value_label, partner_blurb, terms, image_url, url, code_expiry_days) values "
            f"({q(r['id'])}, {q(r['title'])}, {q('[sample] POWR Store demo data.')}, {r['cost']}, 'gear', {q(BRAND)}, false, "
            f"{q(r['type'])}, 'digital', {q(r['offer'])}, {q(r['value'])}, {q('POWR kit, made for training.')}, "
            f"{q('Sample reward for the POWR Store demo.')}, {q(IMG)}, {q(r.get('url'))}, 30);")
        # IN_STORE rows get their reward_in_store row from the trigger; set the rest.
        out.append(
            "insert into public.reward_in_store (reward_id, redeem_where, check_method, barcode_format) values "
            f"({q(r['id'])}, {q(r['where'])}, {q(r['check'])}, {q('ean13' if r['check'] == 'till_barcode' else 'code128')}) "
            "on conflict (reward_id) do update set redeem_where = excluded.redeem_where, check_method = excluded.check_method, "
            "barcode_format = excluded.barcode_format;")

    # Code pools for the two code-backed rewards.
    pools = {'tenner': [], 'fiver': []}
    for _ in range(300):
        pools['tenner'].append({'id': str(uuid.uuid4()), 'code': 'POWR-SAMPLE-' + token(6), 'status': 'available'})
    for n in range(1, 201):
        pools['fiver'].append({'id': str(uuid.uuid4()), 'code': ean13(n), 'status': 'available'})
    pool_next = {'tenner': 0, 'fiver': 0}

    def take_code(key, user_id, at):
        c = pools[key][pool_next[key]]
        pool_next[key] += 1
        c.update({'status': 'reserved', 'user': user_id, 'assigned_at': at})
        return c

    redemptions, vouchers = [], []
    last_scan = {}

    def add_redemption(reward_key, user, claimed_at, status, used_at=None, code=None, code_id=None):
        r = R[reward_key]
        rid = str(uuid.uuid4())
        redemptions.append({
            'id': rid, 'user': user['id'], 'reward': r['id'], 'code': code or ('POWR-IS-' + token(8)),
            'redeemed_at': claimed_at, 'used_at': used_at, 'status': status, 'code_id': code_id,
            'type': r['type'], 'spent': r['cost'], 'expires': claimed_at + dt.timedelta(days=30),
            'title': r['title'], 'checkout': r.get('url'),
        })
        return rid

    # ── In-store visits, 30 days, building up towards today ──
    now_local_hour = (NOW + LONDON_OFFSET).hour
    for day in range(29, -1, -1):
        rate = 1.4 + 3.6 * (1 - day / 30)
        weekday = ((NOW + LONDON_OFFSET).date() - dt.timedelta(days=day)).weekday()
        if weekday >= 5:
            rate *= 1.35
        n = max(0, int(random.gauss(rate, 1.1) + 0.5))
        if day == 0:
            n = max(n, 6)
        for _ in range(n):
            hour = busy_hour()
            if day == 0:
                hour = random.randint(8, max(8, now_local_hour - 1))
            opened = local_time(day, hour, random.randint(0, 59))
            if opened > NOW - dt.timedelta(minutes=8):
                continue
            key = random.choices(['kit', 'shaker', 'tenner'], [45, 25, 30])[0]
            site = random.choices(sites, [s['w'] for s in sites])[0]
            member = random.choice(demo)
            claimed = opened - dt.timedelta(days=random.randint(0, 6), hours=random.randint(0, 20), minutes=random.randint(5, 59))
            if R[key]['check'] == 'look':
                outcome = random.choices(['swiped', 'closed'], [82, 18])[0]
            else:
                outcome = random.choices(['confirmed', 'swiped', 'closed'], [84, 7, 9])[0]
            acted = opened + dt.timedelta(seconds=random.randint(25, 150))
            code = code_id = None
            if key == 'tenner':
                c = take_code('tenner', member['id'], claimed)
                if outcome == 'confirmed':
                    c.update({'status': 'used', 'used_at': acted})
                code, code_id = c['code'], c['id']
            rid = add_redemption(key, member, claimed, 'active' if outcome == 'closed' else 'used',
                                 None if outcome == 'closed' else acted, code, code_id)
            people = staff[site['name']]
            by_manager = outcome == 'confirmed' and random.random() < 0.05
            person = None if by_manager else random.choice(people)
            lat, lng = jitter(site['lat'], site['lng'], 25)
            spend = None
            if outcome == 'confirmed' and random.random() < 0.75:
                lo, hi = (50, 140) if key == 'tenner' else (18, 95)
                spend = int(round(random.uniform(lo, hi) * 100))
            vouchers.append({
                'id': str(uuid.uuid4()), 'red': rid, 'user': member['id'], 'reward': R[key]['id'], 'site': site['id'],
                'status': 'open' if outcome == 'closed' else outcome, 'opened': opened,
                'expires': opened + dt.timedelta(minutes=5), 'lat': lat, 'lng': lng,
                'acc': random.randint(8, 40), 'dist': random.randint(3, 30), 'at_shop': random.random() < 0.96,
                'swiped': acted if outcome == 'swiped' else None,
                'confirmed': acted if outcome == 'confirmed' else None,
                'staff': person['id'] if (outcome == 'confirmed' and person) else None,
                'manager': ids['manager'] if by_manager else None,
                'confirm_site': site['id'] if outcome == 'confirmed' else None, 'spend': spend,
            })
            if outcome == 'confirmed' and person:
                last_scan[person['id']] = max(last_scan.get(person['id'], acted), acted)

    # Claimed in the last week, not used yet.
    for _ in range(14):
        claimed = NOW - dt.timedelta(days=random.uniform(0.2, 7))
        add_redemption(random.choice(['kit', 'shaker']), random.choice(demo), claimed, 'active')
    # Online use of the online-or-in-store reward.
    for _ in range(18):
        claimed = NOW - dt.timedelta(days=random.uniform(0.5, 28))
        member = random.choice(demo)
        c = take_code('tenner', member['id'], claimed)
        used = claimed + dt.timedelta(days=random.uniform(0.1, 3))
        if used < NOW and random.random() < 0.6:
            c.update({'status': 'used', 'used_at': used})
        add_redemption('tenner', member, claimed, 'active', None, c['code'], c['id'])
    # Till barcodes handed out; most later reconciled from the till report.
    for _ in range(28):
        claimed = NOW - dt.timedelta(days=random.uniform(0.3, 29))
        member = random.choice(demo)
        c = take_code('fiver', member['id'], claimed)
        used = claimed + dt.timedelta(days=random.uniform(0.2, 4))
        if used < NOW - dt.timedelta(days=1) and random.random() < 0.75:
            c.update({'status': 'used', 'used_at': used})
        add_redemption('fiver', member, claimed, 'active', None, c['code'], c['id'])

    # ── Write it out ──
    for key, codes in pools.items():
        rows = []
        for c in codes:
            rows.append(f"({q(c['id'])}, {q(R[key]['id'])}, {q(c['code'])}, 'PARTNER_UPLOAD', {q(c['status'])}, "
                        f"{q(c.get('user'))}, {q(c.get('assigned_at'))}, {q(c.get('used_at'))}, '2027-10-13 23:59:59+00')")
        for i in range(0, len(rows), 100):
            out.append("insert into public.redemption_codes (id, reward_id, code, source, status, assigned_user_id, assigned_at, "
                       "used_at, expires_at) values\n  " + ",\n  ".join(rows[i:i + 100]) + ";")
    rows = [f"({q(r['id'])}, {q(r['user'])}, {q(r['reward'])}, {q(r['code'])}, {q(r['redeemed_at'])}, {q(r['used_at'])}, "
            f"{q(r['status'])}, {q(r['code_id'])}, {q(r['type'])}, {r['spent']}, {q(r['expires'])}, {q(r['title'])}, "
            f"{q(BRAND)}, {q(IMG)}, {q(r['checkout'])}, {q(r['redeemed_at'])})" for r in redemptions]
    for i in range(0, len(rows), 100):
        out.append("insert into public.redemptions (id, user_id, reward_id, code, redeemed_at, used_at, status, code_id, "
                   "integration_type, powr_spent, expires_at, reward_title, partner_name, reward_image_url, checkout_url, "
                   "receipt_emailed_at) values\n  " + ",\n  ".join(rows[i:i + 100]) + ";")
    rows = [f"({q(v['id'])}, {q(v['red'])}, {q(v['user'])}, {q(v['reward'])}, {q(BRAND)}, {q(v['site'])}, "
            f"encode(extensions.gen_random_bytes(16), 'hex'), {q(v['status'])}, {q(v['opened'])}, {q(v['expires'])}, "
            f"{v['lat']:.6f}, {v['lng']:.6f}, {v['acc']}, {v['dist']}, false, {q(v['at_shop'])}, {q(v['swiped'])}, "
            f"{q(v['confirmed'])}, {q(v['staff'])}, {q(v['manager'])}, {q(v['confirm_site'])}, {q(v['spend'])})"
            for v in vouchers]
    for i in range(0, len(rows), 100):
        out.append("insert into public.in_store_vouchers (id, redemption_id, user_id, reward_id, brand_name, site_id, secret, "
                   "status, opened_at, expires_at, open_lat, open_lng, open_accuracy_m, open_distance_m, stand_scanned, at_shop, "
                   "swiped_at, confirmed_at, confirmed_by_staff_id, confirmed_by_user_id, confirm_site_id, spend_pence) values\n  "
                   + ",\n  ".join(rows[i:i + 100]) + ";")
    for sid, at in last_scan.items():
        out.append(f"update public.reward_brand_staff set last_seen_at = greatest(coalesce(last_seen_at, {q(at)}), {q(at)}) "
                   f"where id = {q(sid)};")
    out.append(f"-- {len(vouchers)} in-store visits, {len(redemptions)} claims, "
               f"{pool_next['tenner']} + {pool_next['fiver']} pool codes handed out")
    out.append('commit;')
    print('\n'.join(out))


if __name__ == '__main__':
    main()
