# Live Events — Points Week Platform

First event: **One LDN, Friday 4 Sept 2026** (scoring week Mon 31 Aug → Thu 3 Sept).
Owner: Jamie. Status: spec agreed in Slack 29 Jul; mechanic locks with Suzi this week.

The platform is generic (`live_events` rows, admin-configured); One LDN is simply the
first configured event. Nothing event-specific is hardcoded.

---

## 1. The mechanic (agreed)

- **Points week**: leaderboard counts only points earned inside the event window.
  Balances, levels and the vault are untouched — this is a windowed sum, never a reset.
  Comms must say "only points earned that week count", never "reset".
- **Window**: Mon 00:00 → Thu 23:59:59 **Europe/London** (stored timestamptz).
- **Eligibility**: account created before the window opens (admin-tunable cutoff).
- **Thursday lock**: at `lock_at` the board freezes and **hides** — server stops
  returning scores, not a client-side blur. It stays hidden through Friday until after
  the in-person prize handout, then flips to a winners card.
- **Reveal is in-person, staged on the venue big screen.** A standalone web display
  (§5a) runs on a TV/projector at the venue from a URL. Vetting + Settle happen
  Friday morning; during the handout an admin hits **Reveal** and the big screen
  animates the podium (3rd → 2nd → 1st) while prizes are handed over — the app's
  winners card flips at the same moment. The app never announces before the room.
- **Invites (Revolut-style)**: a signup converts when the new user logs their first
  *qualifying verified* workout (geofence or wearable — manual does NOT convert).
  Each conversion pays both sides a bonus; N conversions (default 5) = milestone bonus.
  **Per-friend rewards, not an all-or-nothing entry gate** — everyone eligible competes.
- **Tie-break**: first to reach the final score wins (rank by score DESC, timestamp of
  last counted transaction ASC). Never "last logged wins" — that rewards logging late.
- **Winner vetting**: scores lock Thu night → admin reviews top N on Friday (session
  review + anti-cheat report) → the list read out in the room is already verified.
  T&Cs: verified activity only, winners are reviewed, prizes collected in person.

### Open decisions (need product call before build freezes)

| # | Decision | Recommendation |
|---|----------|----------------|
| D1 | Scope: global board vs opt-in "Join the week" | Opt-in join (explicit consent, respects `show_on_leaderboard`); prizes claimable in person only, next-ranked if absent |
| D2 | Streak bonus rows count toward event score? | No (current views already exclude `streak` rows — fair to new signups; copy must match) |
| D3 | Walking (step-tier) points count? | Yes (capped 5/day, inclusive) — knob exists either way |
| D4 | Sleep points count? | No ("you have to train" positioning) — knob exists |
| D5 | Manual logs count toward score? | Yes (already 1/day × 0.8 — bounded), knob to exclude per event |
| D6 | Conversion deadline for invites | End of scoring window (Thu lock) |

---

## 2. Scoring definition (precise)

Event score for user U = sum of `point_transactions.amount` where:

- `created_at` within `[window_start_at, window_end_at)`
- `type IN ('earn', 'adjustment', 'penalty')` — **penalty rows subtract**. The existing
  `leaderboard_weekly`/`leaderboard_alltime` views exclude `penalty`, so supersessions
  and admin rejections don't reduce scores today. That is a bug for a prize event and
  gets fixed in both the event RPC **and** the global views.
- `type = 'bonus'` NEVER counts (referral/signup bonuses must not buy rank).
- `type = 'streak'` counts only if `count_streak` (D2, default false).
- Earn rows filter by linked session's activity type + verification against event
  config (`included_activities`, `count_manual`; walking/sleep per D3/D4). Earn rows
  with no session (legacy) count unless excluded by source.

Rank = (score DESC, `last_counted_tx_at` ASC, user_id) — deterministic, fully
resolvable from the ledger, no manual tie decisions on the night.

**Known constraint (never publish):** earn paths pay differently (wearable flat 10,
gym tiered + streak under a 30/day cap, manual ×0.8). We rank points and never put
per-path values in comms. See `project_earn_path_divergence` memory / POWR_Points_Logic.md.

---

## 3. Data model

```sql
live_events (
  id uuid PK, slug text UNIQUE, name text, venue_partner_id uuid NULL,
  status text CHECK (draft|scheduled|live|locked|revealed|settled|archived),
  window_start_at timestamptz, window_end_at timestamptz,
  eligibility_cutoff_at timestamptz,          -- signup before this to compete
  scope text CHECK (global|opt_in),           -- D1
  -- scoring knobs
  included_activities text[],                 -- default all minus sleep
  count_manual bool DEFAULT true,
  count_streak bool DEFAULT false,
  count_walking bool DEFAULT true,
  -- lock / reveal
  lock_at timestamptz,                        -- auto-hide moment (Thu 23:59 London)
  hidden bool DEFAULT false,                  -- admin override, instant
  revealed_at timestamptz,                    -- set by admin Reveal action
  -- invites
  invite_bonus_points int DEFAULT 20,         -- each side, per conversion
  invite_milestone_n int DEFAULT 5,
  invite_milestone_bonus int DEFAULT 100,
  conversion_deadline_at timestamptz,         -- D6
  conversion_verifications text[] DEFAULT '{geofence,wearable}',
  -- display
  prizes jsonb,          -- [{rank:1, label:'Soho Farmhouse weekend'}, ...]
  board_size int DEFAULT 50,
  display_token text,    -- unguessable token gating the big-screen URL (§5a);
                         -- admin can regenerate at any time to kill old links
  created_by uuid, created_at, updated_at
)

live_event_participants (event_id, user_id, joined_at, disqualified_at, disqualified_by,
                         PK (event_id, user_id))   -- rows exist for opt_in scope;
                         -- for global scope only disqualifications are stored

live_event_results (event_id, rank, user_id, final_points, prize_label,
                    PK (event_id, rank))
-- written ONCE by the admin Settle/Reveal action: frozen snapshot the winners card
-- reads forever (later point changes can't drift a settled event)

-- referrals table (exists) gains:
--   converted_at timestamptz NULL, converting_session_id uuid NULL, event_id uuid NULL
```

RPCs (all SECURITY DEFINER, authenticated):

- `get_live_event(slug)` → config + status + viewer's participation/eligibility.
- `get_event_leaderboard(event_id)` → standings **only while status = live and not
  hidden**; when locked/hidden returns `{status, your_participation}` with NO scores
  (server-side blur — a proxy must see nothing). After reveal → reads `live_event_results`.
- `join_live_event(event_id)` (opt_in scope).
- Admin: `admin_get_event_leaderboard` (sees through blur; includes flags),
  `admin_settle_event(event_id)` (computes final rank, writes results + prize labels),
  plus CRUD. Conversion detection = AFTER INSERT trigger on `activity_sessions`
  (first qualifying verified session per referred user → stamp `converted_at`, pay
  bonuses via the service-role-context pattern already used by `process_referral`).

---

## 4. Admin control surface (everything is a knob)

New **Events** page in the admin portal (`landing-page/src/pages/admin/`), following
the SystemConfig / VaultManager patterns. Principle: **every mechanic parameter is a
column on the event row, edited in admin, effective immediately** — scores are
computed views, so a config change re-scores retroactively and consistently. Nothing
about an event ships hardcoded in app JS.

1. **Event list + editor** — create/duplicate/archive; every field in §3 editable:
   window, cutoff, scope, scoring toggles (manual/streak/walking/sleep/activity list),
   invite amounts + milestone + conversion rules + deadline, prizes (rank → label),
   board size, venue link.
2. **Status controls** — explicit buttons with confirm: Schedule → Go live → **Lock**
   (auto at `lock_at`, button as backup) → **Hide/Unhide** (instant kill-switch at any
   moment) → **Settle** (snapshot results) → **Reveal** (drives the big screen's podium
   animation AND the in-app winners card) → Archive. Reveal is deliberately separate
   from Settle so vetting always completes before anything is shown anywhere.
   Plus: **Display URL** block — copy the tokened big-screen link, regenerate token
   (kills any previously shared link), open preview.
3. **Ops dashboard (per event)** — live standings visible to admins even while hidden
   (this is the list whoever hands out prizes reads from — plus Print/CSV export);
   participant + eligible counts; invite funnel (codes shared → signups → converted,
   by referrer); freshness note (wearable data lags ~30–90 min).
4. **Verification workflow** — top-N table with per-user: sessions in window,
   verification mix (geofence/wearable/manual %), anti-cheat flags (same Terra/device
   identity on 2+ accounts — the Emily double-credit pattern; bursts of short
   flat-rate wearable sessions; manual-heavy scores), one-click into existing
   SessionReview (rejection already reverses points; with the §2 penalty fix that
   now correctly lowers event score), and **Disqualify from event** (event-scoped
   only — removes from board + results, does not touch their points).
5. **Comms** — reuse existing Broadcast + scheduled-push tooling for week-start /
   last-day / "results are in" sends; a "notify participants" shortcut on the event
   targets the cohort. No new push infrastructure.

---

## 5. App surfaces (all JS + backend ⇒ OTA-able; no native changes)

- **League tab** (`app/(tabs)/league.tsx` exists behind `LEAGUE_LIVE=false`,
  `lib/api/leaderboard.ts`): becomes server-driven. Active event → event board
  (name, prize list, countdown to lock, standings, your rank). States: upcoming →
  live → locked ("Scores are locked 🔒 — winners announced at One LDN Friday") →
  revealed (winners card from `live_event_results` + your final rank) → settled.
  Poll every ~60s on-screen; no realtime infra needed.
- **Invite surface**: "Invite friends" card on the event screen — your code
  (`profiles.referral_code` exists), share via existing share/QR flows, progress
  "2 of 5 converted · Ben and Priya still need their first verified workout".
  **Code-first**: signup code entry already exists in `onboarding-achievement.tsx`
  (+ `pending_referral_code` deep-link capture in AuthContext) — make it prominent;
  attribution has 0 conversions historically because links die at the store install.
- **Join flow** (D1 opt-in): one tap on the event card.
- Winners card, non-winner final-rank state, and (optional) a "you're in" push at join.

### 5a. Big-screen venue display (web, standalone URL)

A dedicated route in the landing-page app — `powr.life/live/<slug>?k=<display_token>`
— designed to run full-screen on a TV/projector at the venue. Not the admin panel,
not the app: its own chromeless page.

- **Auth**: no login on a shared screen. The unguessable `display_token` gates it;
  admin can regenerate to revoke. The same lock rules apply as everywhere else —
  while the event is locked/hidden the display shows the suspense state, never
  scores (server enforces it; the token grants *display* access, not through-blur).
- **Data path**: public edge function `event-board` (mirrors the share-card-og
  pattern) validating slug+token and returning state-appropriate JSON. Edge fn
  rather than an anon-callable definer RPC to stay inside the definer-lint budget.
- **States, driven by event status** (the screen simply follows; admin flips states
  from their phone/laptop): countdown pre-week → **live board** (top 10 large +
  auto-cycling remainder, rank-change animation on refresh) → **locked** ("Scores
  are locked 🔒 — winners revealed tonight") → **reveal** (admin-triggered staged
  podium: 3rd → 2nd → 1st with prize labels) → settled winners.
- **Layout**: landscape TV, huge type, dark POWR brand, avatars, prize labels,
  corner QR (app download CTA — venue foot traffic). Poll every ~10–15s with a
  stale-data indicator; degrade gracefully on venue wifi (keep last data, retry).
  Mind the Tailwind v4 unlayered-anchor gotcha in this codebase.
- **Deploys via landing-page git/main → Vercel** — no OTA/store dependency, so it
  can iterate right up to event day and is the easiest surface to dry-run.

## 6. Build plan → Jira tickets

Order and target dates (event Fri 4 Sept; invite push must be live ~mid-Aug):

| # | Ticket | Scope | Size | Target |
|---|--------|-------|------|--------|
| 1 | Event model + scoring | `live_events`/participants/results tables, RLS, event leaderboard RPCs w/ penalty fix + tie-break; fix penalty exclusion in global views | M | 7 Aug |
| 2 | Invite conversion engine | referral conversion columns + session trigger, config-driven bonuses (per-convert + milestone), deadline | M | 12 Aug |
| 3 | App: invite flow | event invite card, code share/QR, progress UI, prominent code entry at signup | M | 14 Aug → **OTA #1 mid-Aug** |
| 4 | Admin: Events CRUD + status controls | list/editor with every §4 knob, Schedule/Live/Lock/Hide/Settle/Reveal | L | 14 Aug (needed to configure the event for OTA #1) |
| 5 | App: event leaderboard | league-tab event mode, all five states, winners card, server-blur handling | L | 24 Aug → **OTA #2 w/c 24 Aug** |
| 6 | Admin: ops dashboard + verification | through-blur standings + export, invite funnel, top-N review workflow, disqualify | M | 1 Sept |
| 7 | Anti-cheat report | event-window queries: cross-account wearable identity, manual-heavy top scores, short-session bursts | S | 1 Sept |
| 8 | Dry run + release train | internal test event (w/c 24 Aug) end-to-end incl. lock→settle→reveal on a real TV; QA via expo-web Playwright; comms scheduled | S | 28 Aug |
| 9 | Web: big-screen venue display | `/live/<slug>` route + `event-board` edge fn + display_token; all states incl. staged reveal animation (§5a) | M | 21 Aug (before dry run) |

Dependencies: 1 → everything; 2 → 3; 4 before OTA #1 (event must be configurable);
6 depends on 5+7; 9 depends on 1+4 (needs a configured event + token) and must land
before the dry run. Tickets 1/2/4/6/7/9 are deployable server/web-side without app
releases; 3 and 5 ride the two OTA publishes.

## 7. Risks

- **OTA reach**: users on stale/fingerprint-mismatched builds never see the event UI
  (e.g. frozen TestFlight installs). Scoring is server-side so their points still
  count; check version telemetry before the week and chase stragglers.
- **Wearable latency**: 30–90 min behind (Terra poll). Fine Mon–Thu; set expectations
  in copy ("synced workouts count within the hour"). Edge: a Thursday-evening workout
  whose watch syncs after `window_end_at` writes its transaction Friday and misses the
  window (`created_at` bound). Decision needed: strict ingest-time cutoff (simple,
  stated in T&Cs — recommended) vs settling Friday morning against session start
  times (fairer, more moving parts). Either way, settle runs Friday after vetting,
  so late-Thursday ingest arriving overnight is at least *visible* before handout.
- **Fraud**: no cross-account wearable dedup exists (known double-credit precedent);
  device lock only activates on next EAS build. Ticket 7 report + Friday vetting is
  the mitigation for this event; platform dedup is out of scope.
- **Top-end ties**: daily caps compress leading scores; the deterministic tie-break
  (§2) is the answer — never adjudicate live in the room.
- **One LDN geofencing**: per-device fragility (Precise Location, permissions, stale
  builds — see Luke case). The event does not depend on geofencing on the day, and
  member check-ins Mon–Thu use the normal pipeline; don't promise per-visit accuracy.

## 8. Out of scope (this event)

Real-time in-class streaming (Terra SDK/BLE — different integration), deferred deep
linking (Branch/AppsFlyer), platform-wide cross-account wearable dedup, multi-event
concurrency UI polish (schema supports it; admin list handles it plainly).
