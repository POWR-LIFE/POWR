# Shared Challenges — Scoping

> Status: **Draft / scoping** · Owner: Jamie · Branch: `claude/shared-challenges-scope`
>
> Goal: extend the weekly challenges concept so two (or more) members can take on
> a challenge **together** — e.g. "gym session at 6pm together", "get a walk in
> before 9am together" — whether or not they're in the same place.

---

## 0. Decisions locked in (v1 direction)

From the first scoping pass, the product direction is:

- **Invite model:** a **friend / buddy graph** (not just one-off links). You build
  a list of friends and pull them into challenges in a tap.
- **Group size:** **small groups for v1 (3–6)**, but the architecture should scale
  to a larger list (~20) so we can grow into bigger groups later.
- **Points:** **bonus over solo** — and specifically, **the bonus scales with how
  many friends actually complete the challenge with you.** Adding more people and
  finishing together earns everyone more. This is the centrepiece mechanic, not a
  side perk.

> Net effect: shared challenges become a **social-growth loop**. More friends added
> + more friends completing → more points for everyone → incentive to invite. That
> raises the stakes on the friend graph (Section 4) and the points design
> (Section 6a), and on anti-abuse (more points per head = more farming incentive).

---

## 1. Where we are today (the starting point)

Today's weekly challenges are **entirely individual**:

| Concern | Where it lives | Behaviour |
| --- | --- | --- |
| Catalog + rotation | `shared/weeklyChallenges.js`, `shared/challengeRules.js` | 57 challenges, 5 categories. Each ISO week surfaces **one per category** (5 active). Pure, dependency-free. Mirrored into `supabase/functions/_shared/challenges.ts`. |
| Evaluation (client) | `hooks/useWeeklyChallenge.ts` | Pulls *your own* `activity_sessions` for the week, runs the rule engine, optimistically awards. |
| Evaluation (server, authoritative) | `supabase/functions/complete-weekly-challenge/index.ts` | Re-evaluates server-side, never trusts client, idempotent on `(user, challenge, week)`. |
| Completion record | `user_challenge_completions` table | One row per `(user_id, challenge_id, challenge_week)`. Points via `point_transactions`. |
| UI | `components/home/ChallengeCard.tsx`, `app/(tabs)/index.tsx` | The home cards. Share-to-social via `app/share-stats.tsx` + `lib/api/share.ts`. |

**Key implication:** the rule engine (`evaluateChallenge`) operates on a *single
user's* session context. Nothing in the data model expresses "these users are
doing this challenge together."

### What we do NOT have yet
- **No social graph.** `profiles` are publicly readable (for the leaderboard),
  and there's a one-time **referral code** system (`referrals`, `referral_code`
  on `profiles`), but no friends / followers / buddies / "connections" concept.
- **No multi-user challenge instance.** Challenges are catalog entries selected
  by rotation, not objects a user creates and invites others into.
- **No scheduled / appointment challenges.** Everything is "...this week"; there's
  no "at 6pm" concept.

### Primitives we CAN reuse
- **Referral-style short codes** (`generate_referral_code`) — a proven pattern for
  "share this, someone else claims it."
- **Universal / App Links** — `https://powr.life/app` already opens the native app
  and is routed in `app/+native-intent.tsx`. Deep-link invites are basically free.
- **Partner-geofenced gym check-ins** — sessions carry `partner_id` /
  `partner_location_idx`, so "same place" is detectable *for gym venues*.
- **Intraday step buckets** — `daily_step_windows` already buckets steps into
  `before_9am` / `midday_12_14` / `after_6pm`, so "a morning walk together" is
  feasible without raw GPS.
- **Server-side authoritative evaluation + idempotency + point caps** — the whole
  anti-abuse spine already exists and should be reused wholesale.

---

## 2. The two things we have to invent

A "shared challenge" needs exactly two new concepts on top of what exists:

1. **A way to connect / invite** — how user A pulls user B into a challenge.
2. **A shared challenge instance** — a stateful object with participants, a
   lifecycle, and a *group* completion definition.

Everything else (rules, points, verification, anti-abuse) is an extension of the
existing engine.

---

## 3. Types of shared challenge (the product menu)

The useful way to categorise them is by **what "together" means**. This is the
core product decision, because it drives verification difficulty.

### A. Parallel co-op — *"we each do our part, this week"*
Everyone must individually hit the same goal within the window.
- *Example:* "We both check in to the gym 3× this week."
- **Completion:** AND of each participant's individual completion.
- **Effort:** Lowest. Reuses the existing per-user evaluation almost verbatim;
  the shared layer just ANDs results. **Strong MVP candidate.**

### B. Pooled / additive — *"combine our efforts toward one total"*
Contributions sum across participants toward a shared target.
- *Example:* "Together walk 100,000 steps this week" / "Our team runs 50km combined."
- **Completion:** `sum(contributions) ≥ target`.
- **Effort:** Medium. New evaluation, but conceptually simple; great for groups.

### C. Synchronized / appointment — *"same time, optionally same place"* ⭐
A scheduled commitment where both must show up in a time window.
- *Examples (the ones you raised):* "Gym session together at 6pm", "Walk before
  9am together."
- **Params:** `scheduled_at`, `± window tolerance`, `require_same_venue?`,
  activity category.
- **Completion:** each participant has a qualifying session inside the window
  (and, if required, the *same* `partner_id`).
- **Effort:** Highest, but **the most differentiated** — this is the headline
  feature. Needs scheduled evaluation (can't depend on someone opening the app).

### D. Versus / head-to-head — *"who does more"*
Not "completed together" but a shared, social challenge variant.
- *Example:* "Most steps this week wins."
- **Effort:** Medium. Tempting but arguably a separate feature; note and defer.

### E. Relay / streak chain — *"pass the baton"*
Each person covers a day; the group keeps a shared streak alive.
- **Effort:** Medium-high, niche. Phase 3+.

> The examples you gave ("gym at 6pm", "walk before X") are **type C**, with type
> A as the looser fallback ("let's both do it sometime this week").

### The "same place" axis
- **Same place:** match `partner_id` across participants within the window. Works
  today **for gyms** (geofenced). Outdoor walks/runs have no shared venue and we
  don't store/compare GPS tracks — so "same place" outdoors is **out of scope**;
  "same time" is the practical proxy.
- **Same time, any place:** qualifying sessions overlap the scheduled window.
- **Together-ish:** both complete the goal anytime in the week (type A).

---

## 4. How sharing/invites could work

Three options, cheapest first:

### Option 1 — Share link / join code (no friend graph) ✅ recommended for MVP
1. A creates a challenge (type + params) → we mint a `join_code` + a deep link
   (`https://powr.life/app?challenge=<code>`).
2. A shares it via the native share sheet / WhatsApp / Slack / etc.
3. B opens the link → app resolves the code → "Jamie invited you: *Gym at 6pm
   together*" → **Accept** creates a participant row.
- **Pros:** reuses referral-code + deep-link infra; zero new social surface;
  works with people not yet on POWR (link → App Store → join post-install).
- **Cons:** no easy "re-invite my usual gym partner."

### Option 2 — Lightweight friend / buddy graph
A `connections` table (mutual or follow-style) so you can invite saved partners
in one tap, see their challenge activity, etc.
- **Pros:** much better repeat-use & retention loop. **Cons:** a whole new feature
  (requests, accept/block, privacy, notifications). Heavier.

### Option 3 — Username / contact search
Invite by `@username` (usernames already exist & are unique).
- Sits between 1 and 2; can layer onto either.

**Decision:** build **Option 2 (friend/buddy graph)** as the v1 backbone, because
the points mechanic rewards completing with *more distinct friends*, which only
pays off if friendships persist between challenges. Layer **Option 1 (share link)**
on top as the **recruitment edge** — an invite link is how a non-user (or a
not-yet-friend) gets pulled in: link → install/open → friend request auto-sent →
once accepted they're addable to challenges. And **Option 3 (@username)** is the
in-app "add friend" search. So all three coexist; the graph is the core.

### Friend graph — minimum shape
```sql
create table friendships (
  user_id     uuid not null references profiles(id) on delete cascade,
  friend_id   uuid not null references profiles(id) on delete cascade,
  status      text not null default 'pending', -- pending | accepted | blocked
  requested_by uuid not null references profiles(id),
  created_at  timestamptz not null default now(),
  primary key (user_id, friend_id)
);
```
Store one row per ordered pair (or a canonical low/high pair + a mutual flag) —
decide during design. Needs: request / accept / decline / remove / block, a
friends list, and a "find friends" surface (username search + share-link + maybe
referral/contacts later). RLS: you can read a friendship row you're part of.

---

## 5. Data model sketch (illustrative, not final)

```sql
-- A shared challenge instance someone created and invited others into.
create table shared_challenges (
  id            uuid primary key default gen_random_uuid(),
  creator_id    uuid not null references profiles(id) on delete cascade,
  kind          text not null,         -- 'parallel' | 'pooled' | 'synchronized' | 'versus'
  category      text not null,         -- gym | walking | running | cycling | multi
  rule          jsonb not null,        -- reuse the existing declarative rule shape
  scheduled_at  timestamptz,           -- type C only
  window_min    int,                   -- ± tolerance around scheduled_at (type C)
  partner_id    uuid references partners(id), -- 'same place' (gym) — optional
  require_venue boolean not null default false,
  join_code     text unique,           -- for share-link invites
  status        text not null default 'open', -- open | active | completed | expired | cancelled
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);

-- Who's in it + their per-participant state.
create table shared_challenge_participants (
  challenge_id  uuid not null references shared_challenges(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  status        text not null default 'invited', -- invited | accepted | declined | left
  contribution  numeric default 0,     -- pooled (type B): steps/metres tally
  met           boolean not null default false, -- did this user hit their part?
  completed_at  timestamptz,
  joined_at     timestamptz,
  primary key (challenge_id, user_id)
);
```

- **Completion:** a new edge function `complete-shared-challenge` (or an extension
  of the existing one) evaluates the *group* rule. Because RLS forbids reading
  other users' raw `activity_sessions`, this **must run with the service role**,
  reading every participant's sessions, then awarding each.
- **Scheduled evaluation (type C):** synchronized challenges can't wait for a user
  to open the app — evaluate them just after the window closes via a cron
  edge function (reuse the `send-weekly-summary` cron pattern).
- **RLS:** participants may read challenges/participants they belong to; raw
  cross-user session reads stay server-side only.
- **Idempotency & points:** mirror `complete-weekly-challenge` exactly (unique
  guard, record-then-award, rollback on point-insert failure, existing caps).

---

## 6a. Points — the group-size bonus (centrepiece mechanic)

The agreed model: each participant who **individually completes their part** earns
the challenge's base points **plus a "together bonus" that scales with the number
of co-completers** (the other participants who also finished).

**Recommended shape — flat-per-head, capped (legible: "+5 per friend, up to +X"):**

```
earned = base_points + min(maxBonus, perHead × coCompleters)
```

- `coCompleters` = participants (excluding you) who individually met their part.
- Example: base 30, perHead 5, cap 30 → finish with 1 friend = 35; with 6 = 60.
- A percentage variant (`base × (1 + min(maxPct, step × coCompleters))`) also works;
  flat-per-head reads more clearly in the UI ("Invite 3 friends, earn +15").

**Why "co-completers", not "people added":** points must follow *actual completion*,
not list size — otherwise you add dormant accounts for free points. You only get
the bonus for friends who genuinely showed up.

**Optional "new faces" bonus (growth lever):** a one-time extra the first time you
complete a shared challenge with a *particular* friend, to reward breadth and feed
the friend-graph growth loop. Keep it small and one-shot per pair. Defer if it
complicates v1.

**Anti-abuse — this mechanic raises the farming incentive, so guardrails matter:**
- Only **sensor-verified** sessions count toward completion (already enforced
  today — do not loosen for shared).
- Bonus is awarded **only to participants who individually met their part** — no
  free-riding on the group.
- **Hard cap** the bonus (the `min(maxBonus, …)` above) so a 20-person group can't
  mint unbounded points.
- **One bonus per group per challenge-week** — the same circle can't re-farm the
  same challenge repeatedly in a window.
- Keep the existing **point caps** (`enforce_point_award_caps`) as a backstop.
- Friend-graph gating (must be accepted friends) raises the bar but isn't
  sufficient alone — caps + sensor verification are the real defence.

All bonus maths must live **server-side** in the completion edge function, computed
from the authoritative per-participant evaluation — never trust a client total.

---

## 6. The hard parts (call them out now)

1. **Synchronized verification.** Gym is easy (timestamp + geofenced `partner_id`).
   Steps are daily aggregates → lean on `daily_step_windows` buckets ("both logged
   a morning walk") rather than minute-precise timing.
2. **Same place outdoors.** Not solvable today (no shared venue, no GPS proximity
   compare). Scope "same place" to gym venues; use "same time" elsewhere.
3. **No-show / one-sided completion.** Decide the rule: parallel → each is awarded
   on their own; synchronized → both must show or neither scores (maybe a
   consolation). **Product decision.**
4. **Points design.** Decided: bonus scaling with co-completers — see **§6a**. The
   open part is tuning (`perHead`, `maxBonus`, the new-faces bonus).
5. **Anti-abuse (two accounts farming).** Existing sensor-backed verification +
   point caps already mitigate this; reuse them and don't loosen for shared.
6. **Invites to non-users.** Link → App Store → must reattach the pending invite
   after install (deferred deep link). Solvable but adds work; could be Phase 2.

---

## 7. Recommended phasing

- **Phase 1 — Friend graph + parallel co-op group challenge with group-size bonus.**
  Build the `friendships` table (request/accept/remove, username search, share-link
  recruitment) + a **parallel co-op** challenge (type A) you invite 3–6 friends
  into. Completion = each friend ANDs their own per-user evaluation; the **group
  bonus (§6a)** scales points by how many actually finished. This ships the whole
  social-growth loop with the simplest verification.
- **Phase 2 — Synchronized appointment ("gym at 6pm together").** Type C: adds
  `scheduled_at`, window verification, same-venue option (gym), and the cron
  evaluator. The headline, differentiated feature — on top of the same friend graph
  and bonus engine.
- **Phase 3 — Pooled totals (type B), versus (type D), larger groups (~20),
  "new faces" bonus, deferred deep-link invites for non-users.**

---

## 8. Open questions (remaining)

Resolved in §0: friend graph, small groups (3–6) scaling to ~20, bonus-over-solo
scaling with co-completers, parallel co-op first.

Still open:
1. **Bonus tuning** — `perHead` and `maxBonus` values (§6a). Where does the cap sit
   so big groups feel rewarding but not exploitable?
2. **"New faces" bonus** — include the per-new-friend one-time bonus in v1, or defer?
3. **Challenge authoring** — does a group challenge draw from the existing weekly
   catalog/rotation, or can a creator pick *any* catalog challenge (or a custom
   target) to set the group?
4. **Window** — does a group challenge run on the same Mon–Sun ISO week as solo
   challenges, or its own start→expiry from creation time?
5. **Friendship privacy** — what can friends see of each other (challenge activity,
   completion, streaks)? Needs a privacy pass before launch.
6. **No-show handling** for synchronized (Phase 2) — strict (everyone in-window or
   no bonus) or lenient (each scores their own)?
