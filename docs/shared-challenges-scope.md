# Shared Challenges — Scoping

> Status: **Draft / scoping** · Owner: Jamie · Branch: `claude/shared-challenges-scope`
>
> Goal: extend the weekly challenges concept so two (or more) members can take on
> a challenge **together** — e.g. "gym session at 6pm together", "get a walk in
> before 9am together" — whether or not they're in the same place.

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

**Recommendation:** ship **Option 1** first (fastest path to the social loop),
then add **Option 2** in a later phase to make recurring partnerships frictionless.

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

## 6. The hard parts (call them out now)

1. **Synchronized verification.** Gym is easy (timestamp + geofenced `partner_id`).
   Steps are daily aggregates → lean on `daily_step_windows` buckets ("both logged
   a morning walk") rather than minute-precise timing.
2. **Same place outdoors.** Not solvable today (no shared venue, no GPS proximity
   compare). Scope "same place" to gym venues; use "same time" elsewhere.
3. **No-show / one-sided completion.** Decide the rule: parallel → each is awarded
   on their own; synchronized → both must show or neither scores (maybe a
   consolation). **Product decision.**
4. **Points design.** Bonus over solo? Same? Pooled reward? Affects motivation and
   abuse surface.
5. **Anti-abuse (two accounts farming).** Existing sensor-backed verification +
   point caps already mitigate this; reuse them and don't loosen for shared.
6. **Invites to non-users.** Link → App Store → must reattach the pending invite
   after install (deferred deep link). Solvable but adds work; could be Phase 2.

---

## 7. Recommended phasing

- **Phase 1 — MVP: Parallel co-op via share link.** Type A + Option 1 invites.
  Reuses per-user evaluation; the shared layer is invite + AND of completions.
  Ships the social loop with the least risk.
- **Phase 2 — Synchronized appointment ("gym at 6pm together").** Type C: adds
  `scheduled_at`, window verification, same-venue option (gym), and the cron
  evaluator. The headline, differentiated feature.
- **Phase 3 — Pooled totals (type B), friend graph (Option 2), versus (type D).**

---

## 8. Open questions (need product decisions before building)

1. **Invite mechanism for v1** — share link/code only, or build a friend graph now?
2. **Group size** — 1:1 buddy only, or small groups (3–6)?
3. **Points** — do shared challenges grant *bonus* points vs solo, the *same*, or a
   *pooled* reward?
4. **First challenge type to build** — parallel co-op (easiest) or jump straight to
   the synchronized "6pm gym" appointment (most exciting, more work)?
5. **No-show handling** for synchronized — strict (both or neither) or lenient?
