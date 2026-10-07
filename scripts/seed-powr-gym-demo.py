#!/usr/bin/env python3
"""
A full house at the POWR gym (the office, Meon Vale), so the gym portal's
Overview, Members and Retention pages can be seen working with a realistic
crowd. Prints SQL; run it with:

    python3 scripts/seed-powr-gym-demo.py > /tmp/seed.sql
    supabase db query --linked -f /tmp/seed.sql

Remove everything it made with scripts/seed-powr-gym-demo-cleanup.sql.

Contained on purpose (prod is the only database):
  * Every account is tagged raw_app_meta_data.seed = 'powr-gym-demo'.
  * No email address, so no weekly summary, re-engagement or any other mail.
  * show_on_leaderboard = false, and no points, so nobody appears on the app's
    weekly / all-time leaderboards, gym boards, TV screens or the Gym League.
  * No push tokens, so no pushes.
  * Inserted with session_replication_role = replica, so the profile triggers
    (the "New POWR signup" Slack ping, notification prefs) don't fire.
  * Visits are only at the POWR office gym, which Live Ops already excludes.

Deterministic: the same people and visits every run (relative to today).
"""

import random
import uuid
from datetime import datetime, timedelta, timezone, date

GYM = '7d865c3b-ff17-43d8-b31f-f8ce6b470986'          # POWR (the office)
STAFF = '434160eb-1b79-4a7f-bfd0-762986a80aac'        # its owner, for reach-outs
TAG = 'powr-gym-demo'
NS = uuid.UUID('5eed0000-0000-4000-8000-00000000d3a0')
rng = random.Random(7)

NOW = datetime.now(timezone.utc)
# London is on BST until 25 Oct 2026 and has been since 29 Mar: UTC+1 for the
# whole window this seeds.
LOCAL = timezone(timedelta(hours=1))
TODAY = NOW.astimezone(LOCAL).date()


def at(d: date, hour: float) -> datetime:
    """A local wall-clock time on day d, as UTC."""
    h = int(hour)
    m = int(round((hour - h) * 60)) + rng.randint(-20, 20)
    t = datetime(d.year, d.month, d.day, h, 0, tzinfo=LOCAL) + timedelta(minutes=m)
    return t.astimezone(timezone.utc)


def ago(n: int) -> date:
    return TODAY - timedelta(days=n)


# name, member, gym pattern, extras
#   dows: ISO weekdays they train at the gym; p: chance they turn up on one
#   hour: usual arrival (local); joined: days ago they started
#   last: days ago of their last visit (forced, and nothing after it)
#   gap: (from, to) days ago they stayed away, then came back
#   slow: from this many days ago, they turn up at this chance instead
#   visits: exact visit days (days ago), for new faces and drop-ins
#   elsewhere: [(type, per week)] training away from the gym
#   signal: 'ok' | 'stale' (phone silent) | 'denied' (location off)
P = []
def person(name, member=True, **kw):
    P.append(dict(name=name, member=member, **kw))

# ── On track ──
person('Aisha Khan',     dows=[1, 3, 5], p=.9,  hour=6.5,  joined=140, elsewhere=[('running', 1)], consent=True)
person('Tom Reid',       dows=[1, 2, 3, 4, 5], p=.75, hour=18, joined=150, elsewhere=[('cycling', 1)])
person('Maya Chen',      dows=[2, 4, 6], p=.9,  hour=7,    joined=120, elsewhere=[('yoga', 1)])
person('Ben Adeyemi',    dows=[1, 2, 4, 5], p=.85, hour=17.5, joined=160)
person('Leo Martin',     dows=[1, 3, 6], p=.8,  hour=12.5, joined=110, elsewhere=[('running', 2)], consent=True)
person('Ruth Patel',     dows=[2, 4], p=.95,    hour=9.5,  joined=130, elsewhere=[('walking', 2)])
person('Sami Darwish',   dows=[1, 2, 3, 4, 5, 6], p=.7, hour=19, joined=90)
person('Ollie Turner',   dows=[1, 3, 5], p=.85, hour=18.5, joined=75, elsewhere=[('hiit', 1)])
person('Hannah Brooks',  dows=[2, 3, 4, 6], p=.8, hour=6,  joined=145, elsewhere=[('running', 1)], consent=True)
person('Josh Allen',     dows=[1, 4], p=.9,     hour=20,   joined=60)
person('Grace Okafor',   dows=[1, 3, 5, 7], p=.75, hour=10, joined=100, gap=(60, 47), elsewhere=[('cycling', 1)])
person('Ryan Hughes',    dows=[2, 4, 6], p=.85, hour=17,   joined=135)
person('Chloe Evans',    dows=[1, 2, 3, 4, 5], p=.6, hour=13, joined=115, elsewhere=[('yoga', 1)])
person('Arjun Mehta',    dows=[1, 3, 5], p=.9,  hour=5.5,  joined=150, elsewhere=[('running', 2)], consent=True)
person('Freya Lewis',    dows=[6, 7], p=.9,     hour=10.5, joined=95)
person('Daniel Price',   dows=[2, 4, 7], p=.8,  hour=18,   joined=50)
person('Ella Ward',      dows=[1, 3], p=.9,     hour=7.5,  joined=80, elsewhere=[('walking', 2)])
person('Jack Foster',    dows=[1, 2, 3, 4, 5], p=.65, hour=17.5, joined=140, elsewhere=[('hiit', 1)])
person('Zara Hussain',   dows=[2, 5], p=.85,    hour=19.5, joined=70)
person('Nathan Cole',    dows=[3, 6], p=.9,     hour=9,    joined=125, elsewhere=[('cycling', 2)])
person('Isla Murray',    dows=[1, 4, 6], p=.8,  hour=6.5,  joined=85, elsewhere=[('running', 1)])
person('Kieran Shaw',    dows=[2, 3, 4], p=.75, hour=12,   joined=65)
person('Priyanka Rao',   dows=[1, 3, 5], p=.85, hour=18,   joined=105, elsewhere=[('yoga', 1)])
person('Lewis Grant',    dows=[1, 3, 5], p=.85, hour=7,    joined=130, gap=(45, 26))
person('Sophie Hall',    dows=[2, 4, 6], p=.85, hour=18,   joined=140, gap=(38, 22))
person('Mo Rahman',      member=False, dows=[2, 4], p=.85, hour=20, joined=100)   # trains here, picked no gym

# ── Slipping ──
person('Priya Singh',    dows=[1, 4], p=.9,     hour=12.5, joined=120, last=6)
person('Owen Davies',    dows=[1, 2, 3, 4, 5], p=.8, hour=7, joined=130, slow=(28, .2), elsewhere=[('running', 1)])
person('Amelia Scott',   dows=[2, 4, 6], p=.85, hour=18.5, joined=110, last=5)
person('Tyler Knight',   dows=[1, 3, 5], p=.9,  hour=19,   joined=100, last=5)

# ── Drifting (the trailer's four, and two more) ──
person('Callum Ross',    dows=[1, 3, 5], p=.95, hour=6.5,  joined=140, last=12, elsewhere=[('running', 1)], consent=True)
person('Nadia Farah',    dows=[1, 2, 4, 5], p=.9, hour=18.5, joined=125, last=9, consent=True)
person('Theo Barnes',    dows=[1, 3, 5], p=.9,  hour=7,    joined=150, last=15)
person('Esme Walker',    dows=[2, 6], p=.9,     hour=10,   joined=115, last=11)
person('Rohan Gupta',    dows=[1, 3, 4, 6], p=.85, hour=17.5, joined=90, last=10)
person('Megan Lowe',     dows=[2, 4], p=.9,     hour=12,   joined=105, last=16)

# ── Lapsed ──
person('Marcus Bell',    dows=[1, 3, 5], p=.85, hour=18,   joined=170, last=72)
person('Laura Pike',     dows=[2, 4], p=.8,     hour=9,    joined=165, last=95)

# ── New faces ──
person('Jade Kim',       visits=[10, 3], hour=18,  joined=12)
person('Alfie Moss',     visits=[5], hour=7,       joined=6)
person('Noor Ali',       visits=[20, 13, 6], hour=12.5, joined=22)

# ── Drop-ins ──
person('Kofi Asante',    member=False, visits=[60, 33, 19], hour=11, joined=70)
person('Will Sutton',    member=False, visits=[45], hour=16, joined=50)

# ── POWR can't hear their phone ──
person('Georgia Lane',   dows=[1, 3, 5], p=.85, hour=7,    joined=120, last=20, signal='stale')
person('Dan Hart',       dows=[2, 4, 6], p=.8,  hour=18,   joined=100, last=9,  signal='denied')

# ── Picked the gym, never checked in ──
person('Ellie Rose',     visits=[], joined=30)
person('Sam Carter',     visits=[], joined=8)

# Reach-outs: (who, days ago, channel, note). 'push' rows also go in gym_quiet_nudges.
OUTREACH = [
    ('Callum Ross', 2,  'text',  'Said work has been mad, back next week'),
    ('Theo Barnes', 3,  'push',  None),
    ('Lewis Grant', 30, 'call',  'Knee niggle. Booked a PT session to ease back in'),
    ('Sophie Hall', 25, 'push',  None),
    ('Grace Okafor', 50, 'email', 'Sent the new class timetable'),
    ('Marcus Bell', 70, 'call',  'Moving to Birmingham, may join a gym there'),
]

ELSEWHERE = {   # minutes, km (None = no distance)
    'running': ((25, 55), (4, 10)),
    'cycling': ((45, 100), (15, 40)),
    'hiit':    ((30, 45), None),
    'yoga':    ((45, 60), None),
    'walking': ((30, 60), (2.5, 5)),
}


def q(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, datetime):
        return f"'{v.isoformat()}'"
    return "'" + str(v).replace("'", "''") + "'"


users, profiles, sessions = [], [], []
ids = {}
for i, x in enumerate(P):
    uid = str(uuid.uuid5(NS, x['name']))
    ids[x['name']] = uid
    first, last_name = x['name'].split(' ', 1)
    username = f"{first.lower()}{last_name[0].lower()}{rng.randint(10, 99)}"
    created = datetime.combine(ago(x['joined'] + rng.randint(1, 10)), datetime.min.time(), tzinfo=LOCAL).astimezone(timezone.utc) + timedelta(hours=rng.randint(8, 21))
    signal = x.get('signal', 'ok')
    perm = 'denied' if signal == 'denied' else rng.choice(['always', 'always', 'always', 'while_using'])
    checked = NOW - (timedelta(days=18 + rng.randint(0, 4)) if signal == 'stale' else timedelta(hours=rng.randint(1, 40)))
    users.append((uid, created, x['name']))
    profiles.append((uid, x['name'], username, GYM if x['member'] else None, created, perm, checked))

    # Gym visit days
    days = []
    if 'visits' in x:
        days = [ago(n) for n in x['visits']]
    else:
        last = x.get('last', 0)
        for n in range(x['joined'], -1, -1):
            d = ago(n)
            if d.isoweekday() not in x['dows']:
                continue
            if n < last:
                continue
            g = x.get('gap')
            if g and g[1] < n <= g[0]:
                continue
            chance = x['p']
            if x.get('slow') and n < x['slow'][0]:
                chance = x['slow'][1]
            if rng.random() < chance:
                days.append(d)
        if 'last' in x and ago(x['last']) not in days:
            days.append(ago(x['last']))       # make the last visit land exactly
        if x.get('gap'):
            back = ago(x['gap'][1])
            if back not in days:
                days.append(back)             # and the day they came back
    for d in sorted(set(days)):
        start = at(d, x.get('hour', 18))
        if start > NOW - timedelta(minutes=90):
            continue                          # nothing still in progress
        mins = rng.randint(45, 85)
        sessions.append((uid, 'gym', start, mins, None, 'geofence', 0.94, GYM))

    # Training elsewhere, on days they weren't at the gym
    gym_days = set(days)
    stop = x.get('last', 0) if signal == 'stale' else 0
    for typ, per_week in x.get('elsewhere', []):
        for n in range(x['joined'], stop - 1, -1):
            d = ago(n)
            if d in gym_days or rng.random() > per_week / 7:
                continue
            (lo, hi), dist = ELSEWHERE[typ]
            mins = rng.randint(lo, hi)
            start = at(d, rng.choice([7, 12.5, 18.5]))
            if start > NOW - timedelta(minutes=90):
                continue
            km = round(rng.uniform(*dist), 1) if dist else None
            sessions.append((uid, typ, start, mins, km, 'wearable', 0.85, None))

names = {u: n for u, _, n in users}
out = []
w = out.append
w('-- Generated by scripts/seed-powr-gym-demo.py. Remove with seed-powr-gym-demo-cleanup.sql.')
w('begin;')
w('-- Skip the profile triggers: no "New POWR signup" Slack ping, no notification prefs.')
w('set local session_replication_role = replica;')
for uid, created, name in users:
    meta_app = '{"provider":"seed","providers":["seed"],"seed":"%s"}' % TAG
    meta_user = '{"full_name":%s,"seed":"%s"}' % ('"' + name + '"', TAG)
    w("insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, "
      "confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token, is_sso_user, is_anonymous) values ("
      f"'00000000-0000-0000-0000-000000000000', {q(uid)}, 'authenticated', 'authenticated', null, {q(meta_app)}::jsonb, {q(meta_user)}::jsonb, {q(created)}, {q(created)}, "
      "'', '', '', '', '', '', '', '', false, false);")
for uid, name, username, gym, created, perm, checked in profiles:
    w("insert into public.profiles (id, display_name, username, preferred_gym_id, show_on_leaderboard, referral_code, created_at, timezone, location_permission, location_permission_checked_at) values ("
      f"{q(uid)}, {q(name)}, {q(username)}, {q(gym)}, false, public.generate_referral_code(), {q(created)}, 'Europe/London', {q(perm)}, {q(checked)});")
w('insert into public.activity_sessions (user_id, type, started_at, ended_at, duration_sec, distance_m, verification, trust_score, partner_id, flagged, created_at) values')
rows = []
for uid, typ, start, mins, km, ver, trust, partner in sessions:
    end = start + timedelta(minutes=mins)
    rows.append(f"  ({q(uid)}, '{typ}', {q(start)}, {q(end)}, {mins * 60}, {q(round(km * 1000) if km else None)}, '{ver}', {trust}, {q(partner)}, false, {q(end + timedelta(minutes=rng.randint(1, 30)))})")
w(',\n'.join(rows) + ';')
w('-- Share-with-POWR opt-ins (their training elsewhere shows on Members).')
for x in P:
    if x.get('consent'):
        w(f"insert into public.gym_activity_consents (user_id, partner_id, granted_at) values ({q(ids[x['name']])}, '{GYM}', now() - interval '{rng.randint(20, 60)} days');")
w('-- Reach-outs, and the POWR nudges among them.')
for who, n, ch, note in OUTREACH:
    t = NOW - timedelta(days=n, hours=rng.randint(0, 6))
    w(f"insert into public.gym_member_outreach (partner_id, user_id, staff_id, channel, note, created_at) values ('{GYM}', {q(ids[who])}, '{STAFF}', '{ch}', {q(note)}, {q(t)});")
    if ch == 'push':
        w(f"insert into public.gym_quiet_nudges (partner_id, user_id, sent_at, sent_by, single) values ('{GYM}', {q(ids[who])}, {q(t)}, '{STAFF}', true);")
w('set local session_replication_role = origin;')
w("""-- Each reach-out's status and gap as they stood, and the drift episodes:
-- open for whoever is drifting now, closed for the three who came back.
update public.gym_member_outreach o set status = 'drifting', gap_days = 10
 where o.partner_id = '%s' and o.status is null and o.user_id in (select id from auth.users where raw_app_meta_data->>'seed' = '%s');
insert into public.gym_drift_alerts (partner_id, user_id, flagged_on, gap_days, drift_after)
select '%s', r.user_id, r.last_visit + r.drift_after, r.gap_days, r.drift_after
  from public._gym_retention_people('%s') r
  join auth.users u on u.id = r.user_id and u.raw_app_meta_data->>'seed' = '%s'
 where r.status = 'drifting' and r.signal = 'ok'
on conflict do nothing;""" % (GYM, TAG, GYM, GYM, TAG))
for who, (start, back) in [('Lewis Grant', (45, 26)), ('Sophie Hall', (38, 22)), ('Grace Okafor', (60, 47))]:
    w(f"insert into public.gym_drift_alerts (partner_id, user_id, flagged_on, gap_days, drift_after, cleared_on, cleared_reason) values "
      f"('{GYM}', {q(ids[who])}, '{ago(start - 8)}', 8, 8, '{ago(back)}', 'returned') on conflict do nothing;")
w('commit;')
print('\n'.join(out))
import sys
print(f'-- {len(users)} people, {len(sessions)} sessions '
      f"({sum(1 for s in sessions if s[1] == 'gym')} gym visits)", file=sys.stderr)
