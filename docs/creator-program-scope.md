# Creator Program & Portal — Scope

> Status: **P0 + P1 + P2 LIVE — programmes/rules/steps/event bonus/fulfilment applied and E2E verified** · Owner: Jamie · Date: 2026-08-25
>
> Inbound creator program: coaches, athletes, gym owners and influencers hand out
> a tracked link and code, drive real POWR installs, and earn **points + physical
> product** for signups that convert. Self-service portal at `/creator`,
> invite-only, with an approval and fulfilment queue on the admin side.

---

## 0. Decisions locked

From the scoping pass (Jamie, 2026-08-25):

| Decision | Choice |
| --- | --- |
| **Direction** | **Inbound.** Creators drive installs *into* POWR. A growth channel, not a commerce-commission product. |
| **Name** | **"Creator", never "affiliate."** |
| **Payout** | **Points + physical product.** No cash, no Stripe, no KYC, no tax handling. |
| **Access** | **Invite-only.** No public application form; admins mint tokenised setup links. |
| **Codes** | `creators.code` is a **vanity alias**, resolved ahead of `profiles.referral_code`. |
| **iOS attribution** | Deliberately unresolved. Lean on the code, **measure the leak**, decide later. |

### Why "Creator" and not "affiliate"

`rewards.integration_type = 'AFFILIATE'` already exists and means the **opposite**
direction — a brand's shared checkout URL that POWR sends members *out* to (1 live
reward, [20260601000001](../supabase/migrations/20260601000001_affiliate_integration_type.sql)).
Nothing in this program reuses that enum, that word in the rewards domain, or the
`/partner` namespace.

### Why the vanity code doesn't break the POWR ID rule

The POWR ID decision says *"the member's ID IS `profiles.referral_code` — never
mint a second identifier."* A creator needs `LUKE20`, not `ABCD2345`, and may not
be a member at all.

**Resolution:** `creators.code` is an **alias**, not an identifier.
`profiles.referral_code` remains the one member ID. Resolution order is *creator
alias first, then member POWR ID*, in a single function
(`resolve_invite_code`) so no two call sites can ever disagree. A member who
becomes a creator keeps one POWR ID and gains one alias pointing at their creator
row.

---

## 1. What already existed (and is being reused, not forked)

The attribution engine was **already built, live, and at zero rows** — 75
profiles, 0 referrals, 0 conversions. That made it free to widen.

| Piece | Where | Reused as |
| --- | --- | --- |
| Conversion engine | [20260729150000](../supabase/migrations/20260729150000_invite_conversion_engine.sql) | Referral converts on first **geofence-or-wearable-verified** workout. **Manual never converts.** Kept verbatim; creator path added alongside. |
| Grace window | [20260822060000](../supabase/migrations/20260822060000_referral_late_entry_window.sql) | 14 days to enter a code. Unchanged. |
| Milestone ledger shape | `live_event_invite_milestones` | PK-as-idempotency-guard, copied for `creator_milestones`. |
| Portal shell | [PartnerLayout.jsx](../landing-page/src/pages/partner/PartnerLayout.jsx), [manage-partner-user](../supabase/functions/manage-partner-user/index.ts) | Tokenised setup links, brand-scoped RLS → `/creator` portal (P1). |
| Smart link | [app.html](../landing-page/public/app.html) | `/app?ref=CODE` already shows + copies the code and store-hops. |
| OG link pattern | [challenge-invite-og](../supabase/functions/challenge-invite-og/index.ts) | Crawler-gets-a-card / human-gets-redirected → `creator-link`. |
| Deep-link capture | [AuthContext.tsx:611](../context/AuthContext.tsx#L611) | `?ref=` → `pending_referral_code` → applied in onboarding. Already works. |

---

## 2. P0 — BUILT

Three files. Nothing here needs an app build.

### `supabase/migrations/20260825120000_creator_program_foundations.sql`

- **`creators`** — handle, vanity code, display name, avatar, bio, status, optional
  `member_user_id`, per-creator `conversion_points` override.
- **`creator_users` / `creator_invites`** — portal access, mirroring
  `reward_brand_users` / `reward_brand_invites`. The token is the credential.
- **`creator_clicks`** + **`creator_click_daily`** rollup.
- **`creator_earnings`**, **`creator_milestone_tiers`**, **`creator_milestones`**.
- **`referrals` widened**: `referrer_id` made nullable, `creator_id` / `source` /
  `campaign` / `click_id` added, with
  `CHECK (num_nonnulls(referrer_id, creator_id) = 1)`.
- **`resolve_invite_code()`** — alias first, then POWR ID.
- **`process_referral()`** — now accepts creator codes. Member behaviour unchanged.
- **`referral_entry_state()`** — **bug fixed** (see §3).
- **`referral_conversion_check()`** — branches creator vs member. Member path
  byte-for-byte as shipped.
- **RLS** on all eight new tables, plus `creator_funnel()` and
  `rollup_creator_clicks()`.

### `supabase/functions/creator-link/index.ts`

The page behind `powr.life/join/<handle>`. Crawlers get an OG card; humans get
their tap logged and a 302 to `/app?ref=CODE`.

- **Crawlers are never counted.** A WhatsApp unfurl would otherwise inflate every
  creator's click count — and creators are paid on these numbers.
- **No raw IP stored** — salted SHA-256 prefix only, admin-only, for farming
  clusters. Never shown to the creator.
- Click logging is fire-and-forget behind `waitUntil`; a logging failure can never
  cost a creator a click-through.
- A paused creator's link still works, it just stops attributing — sending their
  audience to a 404 punishes the wrong people.

### `vercel.json`

`/join/:handle` → `creator-link`. (`/c/:token` was already taken by challenge
invites, hence `/join`.)

---

## 2b. P1 — the portal — BUILT

Forked from `/partner`, because that portal's shape is proven.

| File | What |
| --- | --- |
| [CreatorLayout.jsx](../landing-page/src/pages/creator/CreatorLayout.jsx) | Sidebar, identity card, admin "view as creator" picker, paused-state banner. |
| [CreatorSetup.jsx](../landing-page/src/pages/creator/CreatorSetup.jsx) | `/creator/setup/:token` — token-is-the-credential self-signup, auto sign-in. |
| [CreatorHome.jsx](../landing-page/src/pages/creator/CreatorHome.jsx) | The funnel: taps to signups to converted to points, daily tap chart, 7/30/90D. |
| [CreatorLinks.jsx](../landing-page/src/pages/creator/CreatorLinks.jsx) | Code, link, ready-made message, campaign tag builder, downloadable QR. |
| [CreatorConversions.jsx](../landing-page/src/pages/creator/CreatorConversions.jsx) | Attributed signups, paginated. **No names** - privacy precedent held. |
| [CreatorRewards.jsx](../landing-page/src/pages/creator/CreatorRewards.jsx) | Milestone ladder with progress bars, shipment status, earnings ledger. |
| [CreatorSettings.jsx](../landing-page/src/pages/creator/CreatorSettings.jsx) | Profile, **shipping address**, password. |
| [CreatorManager.jsx](../landing-page/src/pages/admin/CreatorManager.jsx) | Admin: roster + conversions, create creator, mint/revoke setup links, pause. |
| [manage-creator-user](../supabase/functions/manage-creator-user/index.ts) | validate/redeem invite (public); create/update creator, invites, list, remove (admin). |
| [App.jsx](../landing-page/src/App.jsx) | `isCreator`/`creatorData`/`refreshCreator` in auth context, `CreatorLogin`, `CreatorProtectedRoute`, 7 routes, admin nav entry. |

`npm run build` passes.

### Verified end to end against production (2026-08-25)

With a QA creator, two QA invitees and two QA portal users (all deleted after):

| Check | Result |
| --- | --- |
| `/join/<handle>` human → 302 to `/app?ref=CODE` (+ `&c=` campaign) | ✅ |
| `/join/<handle>` crawler → OG card, **not counted** as a click | ✅ |
| Click row: platform, campaign, ua_family, IP **hashed** (32 hex) | ✅ |
| `process_referral('  qatest99  ')` → creator attribution, normalised | ✅ |
| `referral_entry_state()` names the creator (the bug fix) | ✅ |
| **Manual** session → does NOT convert, nobody paid | ✅ |
| **Geofence** session → converts; invitee +20, creator ledger +50 | ✅ |
| Member path (friend's POWR ID) → both sides +20, creator ledger untouched | ✅ |
| Creator raising own `conversion_points` → refused by column grant | ✅ |
| Creator editing own `bio` → allowed | ✅ |
| Random member calling `creator_funnel` → `not_a_creator` | ✅ |
| `resolve_invite_code` not executable by `authenticated`/`anon` | ✅ |
| Setup link: validate → create account → auto sign-in → land on `/creator` → token burned | ✅ (in Chrome) |
| All five portal pages render with live data, zero console errors | ✅ (in Chrome) |

**Not yet verified:** `/admin/creators` in a browser (needs an admin login).

**Still to do before creators go live:**
- Deploy landing-page to Vercel (the `/join/:handle` rewrite and `/creator` routes aren't on powr.life yet).
- **Schedule `rollup_creator_clicks()`** — nothing calls it yet, so portal tap counts sit at 0 until it runs. A pg_cron every 15 min is the obvious shape.
- Privacy-policy line for the shipping address.

**Two things the portal says out loud, deliberately:**
- The home page explains *why* tap-to-signup looks low (iOS can't carry a code
  through an install) so a creator doesn't conclude their audience is dead.
- The signups page explains what "converted" means - first **verified** workout,
  manual never counts - where the word is actually used.

**Deferred to P2:** the `creator_fulfilments` shipping queue. Until then a
`creator_milestones` row with a `product_sku` *is* the owed record, and the
seeded ladder has no SKUs, so nothing can be owed by accident.

---

## 3. Things found while building

- 🐛 **`referral_entry_state()` had a latent bug for this shape.** It INNER JOINed
  `profiles` on `referrer_id`. A creator referral has `referrer_id = NULL`, so the
  join dropped the row, the Settings screen would report "not referred", offer the
  entry field again, and hand back `already_referred` on submit — the exact failure
  the original migration called out for missing display names, same trap, different
  null. Now a LEFT JOIN across both attributors. **Fixed in P0.**
- ⚠️ **The code length bound is load-bearing.** `AuthContext` captures deep-link
  codes with `/[?&]ref=([A-Z0-9]{6,10})/i`. A 5-char vanity code would be
  **silently dropped by every already-shipped client**. `creators.code` is
  therefore constrained to `^[A-Z0-9]{6,10}$`. Widening it requires that regex to
  ship first (P3, OTA-able).
- ✅ **Creator referrals can't unlock event entry.** The live-event gate counts
  `referrals` rows *by referrer*; creator rows have `referrer_id = NULL`. Correct —
  a creator's reach shouldn't buy a race slot. Documented in a column comment so
  it isn't "fixed" later by accident.
- ✅ **The invitee is paid identically on both paths.** Their side of the deal is
  what makes the code worth using; it must not depend on who handed it to them.
- ✅ **A paused creator's conversions still record.** The referral row stands and
  the invitee keeps their points — only the creator's earning stops.
- ✅ **`expo-clipboard@~8.0.8` is already installed** → the paste-code UX in P3
  ships **OTA, no EAS build**.

---

## 2c. P2 — Programmes: rules, steps, event bonus, fulfilment — LIVE

Jamie, 2026-08-25: *"rewards front and centre — full admin controls, rewards for
each step, points for each step, rules like live events, bonus for event signups,
fine-grained per creator."*

**Shape:** a **programme** is a rule set, exactly the way a `live_events` row is
— its columns deliberately reuse that vocabulary (`conversion_verifications`,
`conversion_activities`, invite bonus) so an admin learns it once. **Steps** hang
off a programme. Every creator points at one; a **Default** programme catches
the rest. Per-creator overrides (`conversion_points`) still win.

Migration `20260825131806_creator_programmes` (APPLIED):

| Table / fn | What |
| --- | --- |
| `creator_programs` | verifications, activities, `min_session_minutes`, `conversion_window_days`, `invitee_bonus_points`, `creator_signup_points` (default 0 — farmable), `creator_conversion_points`, `event_signup_points` + `event_signup_requires_conversion`, `step_counting` (conversions / signups). Exactly one `is_default`. |
| `creator_program_steps` | `n`, label, description, **points + product (name/sku) + catalogue `reward_id`** — any combination. |
| `creators.program_id` | null = Default. |
| `creator_milestones` | re-keyed `(creator_id, step_id)`; + carrier, tracking, approved_by/at, shipped_at. A step with a product/reward creates an `owed` row. **Nothing ships itself.** |
| `creator_earnings` | kinds: signup / conversion / milestone / event_signup / manual. Per-kind partial unique indexes replace the single `referral_id` unique. |
| `creator_award_steps()` | loops every reached-but-unawarded rung (a creator moved to a richer programme catches up). |
| `creator_event_signup_bonus()` | AFTER INSERT on `live_event_participants`; only scheduled/live events; once per (signup, event). |
| `admin_update_creator_fulfilment()` | owed → approved → shipped (+carrier/tracking) → delivered / cancelled. |
| `referral_conversion_check()` | creator path now reads its programme; member path byte-for-byte unchanged. **Manual still never converts, whatever a programme says.** |

Admin — `/admin/creators` now has three tabs ([CreatorPrograms.jsx](../landing-page/src/pages/admin/CreatorPrograms.jsx)):
- **Creators** — roster; each card gets a **programme picker + points override** (via the edge fn — column-grant fence).
- **Programmes** — editor with the live-events control set (chips, toggles, number fields), step ladder with points / product / catalogue reward per step, make-default, delete (default protected).
- **Fulfilment** — owed queue with the creator's shipping address, approve → ship (carrier + tracking) → delivered.

Portal — [CreatorRewards.jsx](../landing-page/src/pages/creator/CreatorRewards.jsx) rewritten: **"How you earn"** up top (per-conversion, event bonus, what counts — all read from the programme), step ladder with product/reward badges, shipment status + tracking, address nudge.

**E2E verified against prod (2026-08-25, fixtures since deleted):** QA programme with 20-min floor → 10-min geofence session **refused**, 30-min converted; creator paid 40 (programme value, not the 50 default) + 100 step + 15 event bonus on joining FNL x POWR; invitee paid 10 (not 20); hoodie step landed `owed`; fulfilment RPC owed → approved → shipped with carrier/tracking and admin stamped.

### 2d. Rewards catalogue + member-first creators (2026-08-25, same day)

Jamie's second look: *"Buttons are black. We need a place to add what the rewards
are — some are physical, so images and what the reward actually is. And when
creating a creator we need to search our users — they're app users first, that's
where their share code comes from."*

- **`creator_rewards`** (migration `creator_rewards_catalogue`, APPLIED): name, description, **image**, kind (physical / digital / experience), sku, "Worth £45" label. Images upload to the existing `reward-images` bucket under `creator-rewards/`. A step points at one (`creator_program_steps.creator_reward_id`); `creator_award_steps()` carries it to the milestone and derives product name/sku from it. Free-text `product_name`/`product_sku` on steps are superseded.
- **Admin `/admin/creators/rewards`** — the catalogue: image tile, description, kind, worth, SKU. The step editor's product fields are replaced by a reward picker with thumbnail; the fulfilment queue shows the image.
- **Creators are app users first.** The new-creator form starts with a **member search** (`admin_get_users`, filtered by name / @username / email / POWR ID). Picking one: their **POWR ID becomes the code** (one code per person — the POWR ID rule, kept), name/photo prefill, `member_user_id` set, and `creator_users` is linked so they **log into the portal with their app account** — no setup link. A vanity code is an opt-in on top. The edge fn's clash check now allows a member's *own* POWR ID.
- **Tab buttons were black-on-black** — the documented Tailwind v4 unlayered `a { color: inherit }` bug. Colour moved to an inner `<span>`.
- Portal ladder shows the reward image, name, worth and description.

**Superseded:** `creator_milestone_tiers` (P0's flat ladder) — seeded into the Default programme's steps, no longer read by anything. Drop next release.

---

## 4. Remaining phases

| Phase | Scope | Ships via |
| --- | --- | --- |
| ~~**P1 — Portal**~~ | **BUILT** — see §2b. | Vercel + edge |
| ~~**P2 — Admin & fulfilment**~~ | **LIVE** — see §2c. Fraud signals (device/IP clusters) still open. | Vercel + DB |
| **P3 — App polish** | Prominent code entry, **paste-code button**, relax the capture regex. | **OTA** |
| **P4 — Attribution upgrade** | Android Install Referrer native module; decide on probabilistic matching from P0's measured data. | **EAS build** |

### Portal surfaces (P1)

| Route | Content |
| --- | --- |
| `/creator/login`, `/creator/setup/:token` | Forked from `PartnerLogin` / `PartnerSetup`. |
| `/creator` | The funnel: **clicks → signups → converted → earned.** Headline is *converted*, not clicks. Reads `creator_funnel()` only. |
| `/creator/links` | Code, `/join/<handle>` link, campaign builder (`?c=`), QR, share assets. |
| `/creator/conversions` | Attributed signups over time. **No names** — follows the deliberate `PartnerRedemptions` / `PartnerPromoCodes` privacy precedent. |
| `/creator/rewards` | Milestone ladder progress, points earned, shipments + tracking. |
| `/creator/settings` | Profile, **shipping address**, password. |

---

## 5. The iOS attribution question

**iOS has no reliable first-party deferred deep link.** Apple removed the
mechanisms; SKAdNetwork / AdAttributionKit are for ad networks, not creator links.
There is no supported API that tells the app "this install came from that link."

| Option | Reality |
| --- | --- |
| **App already installed** | Universal Link opens the app with `?ref=`. **100% reliable, already built.** |
| **Code on screen + one-tap paste** ⭐ | Gate on `Clipboard.hasStringAsync()` (no iOS prompt), show *your own* "Paste your code" button. **P3, OTA.** |
| **Creator-branded page** ⭐ | `/join/<handle>` with their face and the code large. **Built in P0.** |
| **Probabilistic match** | What Branch does. Self-hostable, ~50–80%, and **Apple Private Relay actively breaks it**. Revisit at volume. |
| **Branch / AppsFlyer** | Works. New vendor, SDK, EAS build, cost. Overkill at 75 users. |
| **Android Install Referrer** | ~100% reliable, needs a native module. `app.html` already sets the param, inert. **Piggyback the next EAS build.** |

**The point of P0's click logging:** `creator_funnel()` returns `click_to_signup`
as a percentage. That number is the honest basis for the Branch decision — made on
data instead of guesswork.

---

## 6. Anti-abuse

- ✅ **Only geofence/wearable-verified first workouts convert. Manual never
  converts.** The strongest anti-farming primitive in the codebase. Creators have
  *more* incentive to farm than friends do, so this gets stricter, never looser.
- ✅ Self-referral blocked (a creator's own member account typing their own alias);
  `UNIQUE (referred_id)` means one attribution per account, ever.
- ✅ **Nothing ships automatically.** A milestone with a SKU creates an `owed`
  record an admin approves. Points are reversible; hoodies are not. The seeded
  ladder has **no SKUs** until the ladder is agreed and P2 exists.
- 🆕 **Wire in one-account-per-device** (P2) — the best duplicate-account signal we
  have. Flag conversions from previously-seen devices.
- 🆕 Same-IP-cluster and minimum-account-age flags on the admin creator detail page.

Two standing constraints designed around:
- ⚠️ **PostgREST silently caps every response at 1000 rows.** The portal reads
  `creator_funnel()` and `creator_click_daily`, never raw `creator_clicks`.
- ⚠️ **Portal reads have a systemic history of missing owner filters.** Every
  creator-scoped predicate lives in the RLS *policy*, not in a `.eq()` someone can
  forget.

---

## 7. Open questions

1. **Milestone ladder** — seeded at 5 / 25 / 100 conversions for 250 / 1,500 /
   7,500 points, **no products attached**. What ships at each rung?
2. **Conversion rate** — `creator_default_conversion_points()` is **50**/conversion
   (vs 20 for a member invite). Right multiple?
3. **Shipping scope** — UK only for v1? Customs and cost make international a
   different problem.
4. **First creators** — who are the invite-only cohort, so P1's portal can be
   tested against real handles?
