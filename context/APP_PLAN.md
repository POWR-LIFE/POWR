# POWR — Mobile App Master Plan
**iOS & Android · Expo + React Native · v1.0**

---

## 1. Overview

POWR is a dark-mode fitness rewards platform. Users earn POWR points for verified physical activity and redeem them with partner brands. The app is passive-first — geofencing and background tracking remove friction from earning.

**Tagline:** Move More. Earn More.

**Core loop:** Activity → Verification → Points → Rewards

---

## 2. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | Expo SDK 54 + React Native 0.81 | Cross-platform, managed workflow, OTA updates |
| Language | TypeScript (strict) | Type safety, IDE support, scalable codebase |
| Navigation | Expo Router v6 (file-based) | URL-based deep linking, clean file structure |
| Styling | NativeWind v4 + Tailwind | CSS-in-JS with design tokens, consistent with web |
| State | Zustand + React Context | Lightweight, no boilerplate, easy testing |
| Backend | Supabase | Auth, PostgreSQL, Realtime, Edge Functions, Storage |
| Animation | React Native Reanimated v4 | 60fps native animations, gesture handling |
| Tracking | Expo Location + HealthKit/Health Connect | Background GPS, geofencing (50m radius + 5min exit debounce), step/HR data |
| Storage | Expo SecureStore (sensitive) + AsyncStorage (cache) | Encrypted secrets, offline persistence |
| Fonts | @expo-google-fonts/outfit | Brand font across all platforms |

---

## 3. Design System

### 3.1 Colour Palette

| Token | Hex | RGB | Use |
|-------|-----|-----|-----|
| `bg` | `#080808` | 8, 8, 8 | App background (near-black) |
| `surface1` | `#0F0F0F` | 15, 15, 15 | Cards, modals, sheets |
| `surface2` | `#141414` | 20, 20, 20 | Nested cards, inputs |
| `border` | `#1E1E1E` | 30, 30, 30 | Dividers, card outlines |
| `accent` | `#E8D200` | 232, 210, 0 | Gold — CTAs, active states, points |
| `onAccent` | `#080808` | 8, 8, 8 | Text placed ON gold background |
| `textPrimary` | `#F2F2F2` | 242, 242, 242 | Headings, primary UI text |
| `textSecondary` | `#888888` | 136, 136, 136 | Body copy, descriptions |
| `textMuted` | `#444444` | 68, 68, 68 | Labels, captions, metadata |
| `success` | `#00CC66` | 0, 204, 102 | Verified sessions, positive states |
| `warning` | `#FF9944` | 255, 153, 68 | Weak signal, pending states |
| `error` | `#CC3333` | 204, 51, 51 | Flags, rejected transactions |

**Semantic overlays (rgba):**
- Accent glow: `rgba(232, 210, 0, 0.08)` — active card tints
- Accent mid: `rgba(232, 210, 0, 0.26)` — progress fills, rings
- Success glow: `rgba(0, 204, 102, 0.08)`
- Error glow: `rgba(204, 51, 51, 0.08)`

**Category colours:**
- Fashion partners: `#7C3AED`
- Gear/Equipment: `#0EA5E9`
- Nutrition/Food: `#F59E0B`
- Gym/Fitness: `#EF4444`

### 3.2 Typography

**Font:** Outfit (Google Fonts) — geometric grotesque, weights 200–700

| Token | Size | Weight | Tracking | Leading | Colour | Use |
|-------|------|--------|----------|---------|--------|-----|
| `hero` | 56px | 200 | −1.5px | 1.0 | `#F2F2F2` / `#E8D200` | Splash, onboarding |
| `display` | 44px | 200 | −1px | 1.0 | `#F2F2F2` / `#E8D200` | Onboarding headlines |
| `h1` | 32px | 300 | −0.5px | 1.2 | `#F2F2F2` | Screen titles |
| `h2` | 24px | 400 | 0 | 1.3 | `#F2F2F2` | Section headings |
| `h3` | 20px | 500 | 0 | 1.3 | `#F2F2F2` | Subsection headings |
| `bodyLg` | 16px | 400 | 0 | 1.5 | `#888888` | Primary UI text |
| `body` | 14px | 300 | 0 | 1.7 | `#888888` | Descriptions |
| `label` | 12px | 500 | +1.5px | 1.0 | `#444444` | UPPERCASE tags, nav, badges |
| `caption` | 11px | 300 | 0 | 1.6 | `#444444` | Timestamps, legal |
| `stat` | 48–96px | 200 | −2px | 1.0 | `#E8D200` | Points, streaks, scores |
| `cta` | 13px | 700 | +1.5px | 1.0 | `#080808` on `#E8D200` | Button text — UPPERCASE |

### 3.3 Spacing System (8px base grid)

| Token | Value | Use |
|-------|-------|-----|
| `xs` | 4px | Icon gaps, tight inline spacing |
| `sm` | 8px | Inner card padding, row gaps |
| `md` | 16px | Card padding, section gaps |
| `lg` | 24px | Between sections |
| `xl` | 32px | Page section separation |
| `2xl` | 48px | Major layout sections |
| `page` | 20px | Horizontal screen margin |

### 3.4 Border Radius

| Token | Value | Use |
|-------|-------|-----|
| `interactive` | 4px | Buttons, inputs, chips |
| `card` | 6px | Cards, list items |
| `sheet` | 12px | Bottom sheets, modals |
| `pill` | 999px | Tags, badges |

### 3.5 Component Specs

**Primary Button**
- Height: 48px · Full width on mobile
- Background: `#E8D200` · Text: `#080808`
- Font: Outfit 700, 13px, UPPERCASE, tracking +1.5px
- Border radius: 4px

**Ghost Button**
- Height: 48px · Border: 1px solid `#E8D200`
- Text: `#E8D200` · Font: Outfit 500, 13px, UPPERCASE, tracking +1.5px

**Destructive Button**
- Height: 48px · Border: 1px solid `#CC3333` · Text: `#CC3333`

**Card**
- Background: `#0F0F0F` · Border: 1px solid `#1E1E1E`
- Border radius: 6px · Padding: 16px
- Active state: border `#E8D200`, background `#141400`

**Input Field**
- Height: 48px · Background: `#0F0F0F` · Border: 1px solid `#1E1E1E`
- Focus border: 1px solid `#E8D200`
- Font: Outfit 300, 14px, `#F2F2F2` · Placeholder: `#444444`
- Border radius: 4px · Padding: 0 16px

**Stat/Points Display** (stack layout)
```
LABEL       ← 10px Outfit 400, UPPERCASE, tracking +2px, #444444
96           ← Outfit 200, 72px, #E8D200, tracking -2px
POWR        ← 10px Outfit 400, UPPERCASE, tracking +2px, #444444
```

**Badge / Tag**
- Border: 1px solid `#1E1E1E` · Font: 9px Outfit 500, UPPERCASE, tracking +1.5px, `#444444`
- Active: border `#E8D200`, text `#E8D200`, background `rgba(232,210,0,0.08)`

**Bottom Tab Bar**
- Background: `#0F0F0F` · Top border: 1px solid `#1E1E1E`
- Active icon + label: `#E8D200` · Inactive: `#444444`
- Label: 10px Outfit 500, UPPERCASE, tracking +1.5px

---

## 4. Screen Map

### 4.1 Auth / Onboarding Flow
```
splash.tsx                  → Auto-redirect based on auth state
onboarding.tsx              → Welcome / value proposition (exists)
onboarding-account.tsx      → Create account / sign in (exists)
onboarding-health.tsx       → HealthKit / Health Connect permission (exists)
onboarding-permission.tsx   → Location + Notifications permission (exists)
onboarding-achievement.tsx  → First badge unlock celebration (exists)
(auth)/sign-in.tsx          → Returning user sign in
(auth)/sign-up.tsx          → New user registration
(auth)/forgot-password.tsx  → Password reset
(auth)/verify-email.tsx     → Email verification gate
```

### 4.2 Main App — Tab Navigation

Tracking is **passive-first** — no Track tab. The app detects partner venues via geofencing and starts automatically. A live session banner on Home is the only tracking UI the user sees during an active session.

**Tab 1: Home** (`(tabs)/index.tsx`)
- Today's POWR balance (large stat)
- Active streak indicator with flame animation
- Live session banner (auto-appears when inside a partner geofence — shows elapsed time + POWR accumulating)
- Weekly progress ring (Mon–Sun)
- Recent activity feed (last 5 sessions)
- Partner spotlight (1 featured reward)

**Tab 2: Discover** (`(tabs)/discover.tsx`)
- Real map (react-native-maps) centered on user location
- Partner venue markers with gold POWR pins
- 50m geofence radius rings visible on map
- Dark map style matching POWR palette (#0d0d0d)
- Filter chips: Open Now / Nearest / Filters
- Category pills: All / Gym / Yoga / Pilates / Cycling / Running
- Scrollable partner list below map (distance, pts, status)

**Tab 3: Spend** (`(tabs)/rewards.tsx`)
- POWR balance header
- Featured weekly reward card
- Filter by category (Move / Eat / Mind / Sleep)
- Reward rows (partner offers, with POWR cost + Redeem CTA)
- "Find nearby" link → Discover tab map

**Tab 4: Profile** (`(tabs)/profile.tsx`)
- Avatar + username + level badge
- Total POWR earned (lifetime) / Sessions / Best streak
- Weekly activity bar chart
- Monthly history chart
- Achievements shelf
- Level progress (XP bar)

### 4.3 Stack Screens (Supplementary)

**Activity Flow:**
```
(activity)/tracking.tsx         → Live GPS/HR session screen
(activity)/[id].tsx             → Post-session summary + POWR earned
(activity)/log.tsx              → Manual activity log form
(activity)/history.tsx          → Full activity history list
```

**Rewards Flow:**
```
(rewards)/[id].tsx              → Reward detail + redeem CTA
(rewards)/redeem.tsx            → Redemption confirmation + code reveal
(rewards)/history.tsx           → Redemption history / transactions
```

**Profile / Settings:**
```
(profile)/achievements.tsx      → Full achievements gallery
(profile)/stats.tsx             → Detailed stats (charts, PRs)
(profile)/settings.tsx          → App settings hub
(profile)/account.tsx           → Name, email, password
(profile)/privacy.tsx           → Data sharing, account deletion
(profile)/wearables.tsx         → Apple Watch / Garmin / Fitbit connect
(profile)/notifications.tsx     → Push notification preferences
(profile)/security.tsx          → Active sessions, device management
```

**Global:**
```
notifications.tsx               → Notification centre (all alerts)
```

---

## 5. Navigation Architecture

```
Root Stack
├── Splash (auto-redirect)
├── Onboarding Stack (unauthenticated)
│   ├── onboarding
│   ├── onboarding-account
│   ├── onboarding-health
│   ├── onboarding-permission
│   └── onboarding-achievement
├── Auth Stack (returning users)
│   ├── sign-in
│   ├── sign-up
│   ├── forgot-password
│   └── verify-email
└── Main Tab Navigator (authenticated)
    ├── Tab: Home
    │   ├── (stack) Activity Detail
    │   └── (stack) Live Tracking (background — no tab)
    ├── Tab: Discover
    │   └── (stack) Partner Detail
    ├── Tab: Spend
    │   ├── (stack) Reward Detail
    │   └── (stack) Redeem
    └── Tab: Profile
        ├── (stack) Achievements
        ├── (stack) Stats
        ├── (stack) Settings
        │   ├── Account
        │   ├── Wearables
        │   ├── Notifications
        │   ├── Privacy
        │   └── Security
        └── (stack) Notifications
```

---

## 6. Folder Structure

```
/POWR
├── app/                            # Expo Router screens (file-based routing)
│   ├── _layout.tsx                 # Root layout — auth guard + providers
│   ├── splash.tsx                  # Splash + redirect logic
│   ├── onboarding.tsx              # Onboarding step 1
│   ├── onboarding-account.tsx      # Onboarding step 2
│   ├── onboarding-health.tsx       # Onboarding step 3
│   ├── onboarding-permission.tsx   # Onboarding step 4
│   ├── onboarding-achievement.tsx  # Onboarding step 5
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── sign-in.tsx
│   │   ├── sign-up.tsx
│   │   ├── forgot-password.tsx
│   │   └── verify-email.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx             # Tab bar config
│   │   ├── index.tsx               # Home
│   │   ├── track.tsx               # Track
│   │   ├── rewards.tsx             # Rewards
│   │   └── profile.tsx             # Profile
│   ├── (activity)/
│   │   ├── tracking.tsx            # Live tracking
│   │   ├── [id].tsx                # Session detail
│   │   ├── log.tsx                 # Manual log
│   │   └── history.tsx             # History
│   ├── (rewards)/
│   │   ├── [id].tsx                # Reward detail
│   │   ├── redeem.tsx              # Redemption
│   │   └── history.tsx             # Transactions
│   ├── (profile)/
│   │   ├── achievements.tsx
│   │   ├── stats.tsx
│   │   ├── settings.tsx
│   │   ├── account.tsx
│   │   ├── privacy.tsx
│   │   ├── wearables.tsx
│   │   ├── notifications.tsx
│   │   └── security.tsx
│   ├── notifications.tsx
│   └── map.tsx
│
├── components/
│   ├── ui/                         # Primitive design system components
│   │   ├── Button.tsx              # Primary / Ghost / Destructive variants
│   │   ├── Card.tsx                # Card container with border/active states
│   │   ├── Badge.tsx               # Tag / chip component
│   │   ├── Input.tsx               # Text input with focus states
│   │   ├── StatDisplay.tsx         # LABEL / NUMBER / unit stack
│   │   ├── ProgressRing.tsx        # Circular SVG progress indicator
│   │   ├── ProgressBar.tsx         # Horizontal progress bar
│   │   ├── ActivityIcon.tsx        # Activity type icon + colour
│   │   ├── StreakFlame.tsx          # Animated flame for streaks
│   │   ├── Divider.tsx             # Horizontal rule variants
│   │   ├── Sheet.tsx               # Bottom sheet (reanimated)
│   │   ├── Toast.tsx               # In-app notification
│   │   ├── Skeleton.tsx            # Loading placeholder
│   │   └── POWRLogo.tsx            # Brand logo component
│   ├── layout/
│   │   ├── Screen.tsx              # SafeAreaView wrapper + bg
│   │   ├── Header.tsx              # Screen header with back button
│   │   ├── TabBar.tsx              # Custom bottom tab bar
│   │   └── SectionHeader.tsx       # Section title + gold bar accent
│   ├── home/
│   │   ├── POWRBalance.tsx         # Today's points + streak display
│   │   ├── StreakCard.tsx          # Streak card with flame animation
│   │   ├── WeeklyRing.tsx          # Weekly progress ring (Mon–Sun)
│   │   ├── RecentActivity.tsx      # Activity feed list
│   │   └── LiveSessionBanner.tsx   # Active session indicator
│   ├── activity/
│   │   ├── ActivityCard.tsx        # Single activity record
│   │   ├── ActivityTypeGrid.tsx    # 8-type selector grid
│   │   ├── LiveTracker.tsx         # Real-time GPS + HR + timer
│   │   ├── SessionSummary.tsx      # Post-session POWR breakdown
│   │   └── ManualLogForm.tsx       # Manual activity form
│   └── rewards/
│       ├── RewardCard.tsx          # Partner offer card
│       ├── CategoryFilter.tsx      # Horizontal category tabs
│       ├── PartnerLogo.tsx         # Partner brand logo
│       └── RedemptionModal.tsx     # Confirm + reveal code
│
├── lib/
│   ├── supabase.ts                 # Supabase client init
│   ├── auth.ts                     # Auth helpers (sign in, sign out, session)
│   ├── api/
│   │   ├── activity.ts             # Activity CRUD operations
│   │   ├── points.ts               # Point claim + calculation API
│   │   ├── rewards.ts              # Reward catalog + redemption
│   │   └── user.ts                 # User profile read/write
│   ├── tracking/
│   │   ├── gps.ts                  # Background GPS + distance calc
│   │   ├── geofence.ts             # Geofence register/trigger
│   │   ├── health.ts               # HealthKit (iOS) / Health Connect (Android)
│   │   └── heartRate.ts            # HR zone detection
│   └── utils/
│       ├── points.ts               # Point tier calculations (mirrors backend)
│       ├── validation.ts           # Input validation schemas (Zod)
│       ├── format.ts               # Number, date, distance formatting
│       └── anti-abuse.ts           # Client-side pre-check flags
│
├── stores/                         # Zustand global state
│   ├── auth.store.ts               # User session + JWT
│   ├── activity.store.ts           # Live session state
│   ├── points.store.ts             # Balance + history cache
│   └── rewards.store.ts            # Catalog cache
│
├── context/
│   ├── AuthContext.tsx             # Auth state provider
│   ├── ThemeContext.tsx            # Theme variant provider (exists)
│   └── ActivityContext.tsx         # Live tracking session provider
│
├── hooks/
│   ├── useAuth.ts                  # Current user + session
│   ├── useActivity.ts              # Start/stop/save activity
│   ├── usePoints.ts                # Balance, history, claims
│   ├── useGeofence.ts              # Register + listen for geofence events
│   ├── useHealthKit.ts             # HealthKit / Health Connect
│   ├── useRewards.ts               # Catalog + redemptions
│   └── useStreaks.ts               # Streak state + multipliers
│
├── types/
│   ├── user.ts
│   ├── activity.ts
│   ├── points.ts
│   ├── rewards.ts
│   └── api.ts
│
├── constants/
│   ├── tokens.ts                   # Design tokens (colours, typography, spacing)
│   ├── activities.ts               # Activity type definitions + icons + caps
│   └── points.ts                   # Point tier config (mirrors POWR_Points_Logic.md)
│
└── context/                        # Documentation (already exists)
    ├── POWR_Styling_Reference.md
    ├── POWR_Points_Logic.md
    └── APP_PLAN.md                 # This file
```

---

## 7. Data Architecture (Supabase)

### 7.1 Core Tables

```sql
-- Users (extends Supabase auth.users)
profiles
  id            uuid PK (references auth.users)
  username      text UNIQUE
  display_name  text
  avatar_url    text
  level         int DEFAULT 1
  created_at    timestamptz

-- Activity sessions
activity_sessions
  id            uuid PK
  user_id       uuid FK profiles
  type          enum (walking|running|cycling|swimming|gym|hiit|sports|yoga)
  started_at    timestamptz
  ended_at      timestamptz
  duration_sec  int
  distance_m    float
  steps         int
  hr_avg        int
  hr_zone_pct   float
  verification  enum (geofence|gps|hr|wearable|manual)
  trust_score   float
  flagged       bool DEFAULT false
  raw_gps       jsonb       -- encrypted GPS path
  created_at    timestamptz

-- Point transactions
point_transactions
  id            uuid PK
  user_id       uuid FK profiles
  session_id    uuid FK activity_sessions NULLABLE
  amount        int           -- can be negative (redemptions)
  type          enum (earn|redeem|bonus|streak|penalty|adjustment)
  description   text
  multiplier    float DEFAULT 1.0
  created_at    timestamptz

-- Streaks
user_streaks
  user_id       uuid PK FK profiles
  current_streak int DEFAULT 0
  longest_streak int DEFAULT 0
  last_activity_date date
  freeze_tokens  int DEFAULT 1

-- Rewards catalog
rewards
  id            uuid PK
  partner_id    uuid FK partners
  title         text
  description   text
  powr_cost     int
  category      enum (fashion|gear|nutrition|gym|food|health)
  expires_at    timestamptz NULLABLE
  stock         int NULLABLE
  active        bool DEFAULT true

-- Partners
partners
  id            uuid PK
  name          text
  logo_url      text
  category      enum
  locations     jsonb       -- array of {lat, lng, radius, name}
  active        bool

-- Redemptions
redemptions
  id            uuid PK
  user_id       uuid FK profiles
  reward_id     uuid FK rewards
  code          text        -- encrypted at rest
  redeemed_at   timestamptz
  used_at       timestamptz NULLABLE
  status        enum (active|used|expired)
```

### 7.2 Row-Level Security (RLS) Rules

- `profiles`: Users can read their own row only. Service role for updates.
- `activity_sessions`: Users read/insert their own sessions. No client-side deletes.
- `point_transactions`: Users read their own. Inserts via Edge Function only (never direct).
- `user_streaks`: Users read their own. Updates via Edge Function only.
- `rewards`: Public read. Admin write only.
- `redemptions`: Users read their own. Insert via Edge Function only.

---

## 8. Security Architecture

### 8.1 Authentication
- Supabase Auth (email/password + Apple Sign In + Google Sign In)
- JWT access tokens (1-hour expiry) + refresh tokens (30-day expiry)
- **Single device enforcement:** new login via Edge Function invalidates all other refresh tokens
- Session stored in `expo-secure-store` (keychain on iOS, keystore on Android)
- No session data in AsyncStorage

### 8.2 Point Claim Security
All point awards flow through a single Supabase Edge Function (`/functions/claim-points`):
1. Validate JWT + extract user_id
2. Check daily cap for activity type
3. Check session doesn't already have a claim
4. Verify trust score meets minimum threshold
5. Run anti-abuse checks (duplicate detection, impossible travel, velocity)
6. Calculate points using server-side logic (never trust client)
7. Insert `point_transactions` row + update `user_streaks`
8. Return result

### 8.3 Anti-Abuse
- **Rate limiting:** Max 3 point claims per hour per user (Postgres-level)
- **Duplicate detection:** Same activity type + same day = reject
- **Impossible travel:** GPS velocity check between consecutive sessions
- **Manual log penalty:** 80% of tier POWR, no streak credit, flagged for review
- **Anomaly threshold:** 3+ flagged sessions in 7 days → manual review queue
- **Session fingerprinting:** Device ID stored with sessions for cross-device fraud detection

### 8.4 Data Privacy
- GPS paths encrypted at rest in Supabase (pgcrypto)
- HR data never leaves device if HealthKit is the source (processed locally)
- GDPR-compliant data deletion: cascade delete on account removal
- Privacy settings screen allows users to disable GPS storage

### 8.5 Network Security
- All API calls via HTTPS (TLS 1.3)
- Supabase anon key is public-safe (RLS enforces all access control)
- Service role key never in app bundle — Edge Functions only
- Certificate pinning (future: when using custom domain)

---

## 9. Performance & Scalability

### 9.1 Client-Side
- **Lazy loading:** All tab screens loaded on first visit, not on app start
- **Virtualised lists:** FlashList for activity history and reward catalog
- **Optimistic updates:** Points balance updates immediately, reconciled on server response
- **Offline queue:** Activity sessions queued locally (AsyncStorage) if offline, synced on reconnect
- **Image caching:** Expo Image with memory + disk cache for partner logos and avatars
- **Animation budget:** All animations on the UI thread (Reanimated worklets), never JS thread

### 9.2 Backend (Supabase)
- **Connection pooling:** PgBouncer enabled
- **Indexes:** On `user_id`, `created_at`, `type` for all high-read tables
- **Edge Functions:** Point claim logic in Deno runtime at the edge (low latency globally)
- **Realtime:** Used only for live session updates — not enabled on all tables
- **CDN:** Supabase Storage CDN for all partner assets (logos, reward images)
- **Pagination:** Cursor-based pagination on all list endpoints (no OFFSET)

### 9.3 Scale Milestones
| Users | Architecture Change |
|-------|---------------------|
| 0–10K | Supabase free/pro, no changes needed |
| 10K–100K | Add read replicas, tune indexes, enable PgBouncer pooler |
| 100K–1M | Shard activity_sessions by date, add Redis for leaderboards |
| 1M+ | Separate microservice for point engine, Kafka for event streaming |

---

## 10. Build & Deployment

### 10.1 Environments
- **Development:** Local Supabase instance (`supabase start`)
- **Staging:** Supabase staging project + Expo internal distribution
- **Production:** Supabase production + EAS Build + App Store / Play Store

### 10.2 OTA Updates
- Expo EAS Update for JS-only fixes (bypasses App Store review)
- Native code changes (new permissions, SDK upgrades) require full store submission

### 10.3 CI/CD
- GitHub Actions: lint + typecheck + test on every PR
- EAS Build: auto-build on merge to `main`
- EAS Update: auto-publish OTA on merge to `main`

---

## 11. Screen Design Notes

### Home Screen
- Top: Small POWR logo + notifications bell
- Hero: Huge POWR balance in gold (stat token) with "TODAY" label
- Streak card: flame icon + streak number + "day streak" label
- Week rings: 7 circles (Mon–Sun), filled gold for active days
- Live session banner: appears when tracking is active (pulsing gold border)
- Activity feed: last 5 sessions as cards (icon, type, POWR earned, time)
- Partner spotlight: single reward card, "FEATURED REWARD" label

### Track Screen
- Top: "START TRACKING" heading
- Grid: 2×4 activity type selector (icon + label, tappable cards)
- Selected activity: card turns gold border, expand to show CTA
- GPS / HR status row: coloured dots (green = locked, yellow = searching)
- Geofence banner: "GYM DETECTED — TAP TO START" (auto-appears near partners)
- Manual log link: small ghost button at bottom

### Live Tracking Screen (full screen, no tabs)
- Dark overlay over map (blurred background map)
- Timer: huge white number (elapsed time)
- Metrics row: Distance | Heart Rate | POWR estimate (gold)
- GPS path map (small, in-screen)
- Stop button: large red ghost button at bottom
- Live POWR counter: animates up as points accumulate

### Rewards Screen
- Top: POWR balance + "AVAILABLE" label
- Category tabs: All / Fashion / Gear / Nutrition / Gym (horizontal scroll)
- Grid: 2-column reward cards
- Reward card: partner logo, reward name, POWR cost (gold), category badge
- "WITHIN REACH" section: rewards you can afford highlighted

### Profile Screen
- Top: Avatar (initials fallback) + display name + level badge
- Stats row: Total POWR | Sessions | Best Streak
- Chart: 7-day activity bars
- Achievements: horizontal scroll of earned badges
- Settings link: gear icon top right

---

## 12. Build Order (Phase 1 MVP)

1. **Design tokens** — Update `constants/tokens.ts` with full POWR palette
2. **Core UI components** — Button, Card, Input, StatDisplay, Badge
3. **Auth flow** — Sign in, Sign up, onboarding (refine existing screens)
4. **Home screen** — Balance, streak, weekly rings, recent activity
5. **Track screen** — Activity selector, manual log, GPS session start
6. **Live tracking** — Background location, timer, stop/save flow
7. **Session summary** — Post-activity POWR breakdown
8. **Rewards screen** — Catalog, filter, reward detail
9. **Redemption flow** — Confirm, deduct points, reveal code
10. **Profile screen** — Stats, achievements, settings
11. **Points engine** — Supabase Edge Function for claim validation
12. **Geofencing** — Background geofence registration for partner venues
13. **Push notifications** — Streak reminders, point confirmations, rewards

---

*POWR App Plan · v1.0 · 2026*
