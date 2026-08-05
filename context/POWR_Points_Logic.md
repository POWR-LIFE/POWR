# POWR Points Logic
**v0.3 · Internal Reference Document**  
8 Activities · 5 Data Signals · Geofencing-first verification

---

## Overview

POWR awards points (POWR) for verified physical activity across 8 activity types. The system is designed to be **accessibility-first**, rewarding all levels of effort while keeping the premium earning lane reserved for consistent gym users.

**Core principles:**
- Passive tracking is the default — users should never need to check in manually
- Geofencing + dwell time is the primary gym/venue verification method
- Manual logging is a fallback only, and carries a 20% point penalty
- Streak multipliers reward consistency, not just volume

---

## Activity Types

---

### 🚶 Walking
**Tag:** Mass Market  
**Daily Cap:** 5 POWR  
**Verification:** Steps / Wearable

**Eligibility:** Any steps counted via wearable. No minimum threshold.

| Tier | POWR |
|------|------|
| 4,000–6,000 steps | 2 |
| 6,000–8,000 steps | 3 |
| 8,000–10,000 steps | 4 |
| 10,000+ steps | 5 |

**Streak:** No streak multiplier. Daily cap keeps ceiling controlled.

**Rationale:** Entry point for older, rural and low-activity users. Intentionally generous ceiling to drive adoption.

---

### 🏃 Running
**Tag:** Effort-Based  
**Daily Cap:** 10 POWR  
**Verification:** GPS · Heart Rate · Wearable

**Eligibility:** 15+ min OR 2km+ distance. HR Zone 3+ sustained.

| Tier | POWR |
|------|------|
| 2–3 km / 15–20 min | 5 |
| 3–5 km / 20–30 min | 6 |
| 5–10 km / 30–60 min | 8 |
| 10 km+ / 60+ min | 10 |

**Streak:** +1 POWR at 3-day streak · +2 POWR at 5-day · 1.5× at 7-day

**Rationale:** Effort threshold filters casual jogs. GPS is primary signal; HR confirms intensity.

---

### 🚴 Cycling
**Tag:** Effort-Based  
**Daily Cap:** 10 POWR  
**Verification:** GPS · Heart Rate · Wearable

**Eligibility:** 20+ min OR 8km+. Sustained movement required (anti-spoof: stop-start city patterns are flagged).

| Tier | POWR |
|------|------|
| 20–30 min / 6–12 km | 4 |
| 30–60 min / 12–25 km | 6 |
| 60–90 min / 25–50 km | 8 |
| 90+ min / 50+ km | 10 |

**Streak:** +1 POWR at 3-day streak · +2 POWR at 5-day · 1.5× at 7-day

**Rationale:** GPS validates sustained movement. Cycling is lower exertion than running at equivalent time, reflected in the lower base tier.

---

### 🏊 Swimming
**Tag:** Verified Sport  
**Daily Cap:** 10 POWR  
**Verification:** Wearable (laps) · Manual Log

**Eligibility:** 15+ min OR 500m+. Wearable lap count is primary; manual log is secondary fallback.

| Tier | POWR |
|------|------|
| 500m / 15–20 min | 5 |
| 1 km / 20–40 min | 7 |
| 2 km / 40–60 min | 9 |
| 2 km+ / 60+ min | 10 |

**Streak:** +1 POWR at 3-day streak · +2 POWR at 5-day · 1.5× at 7-day

**Rationale:** No GPS signal underwater. Wearable stroke/lap detection is the primary signal; manual log used as fallback with standard 20% penalty applied.

---

### 🏋️ Gym
**Tag:** Premium Lane  
**Daily Cap:** 30 POWR  
**Verification:** Geofencing · Heart Rate · Background Location

**Eligibility:** Geofence entry at verified gym or partner location. 30+ min dwell time required.

| Tier | POWR |
|------|------|
| 30–40 min session | 15 |
| 40+ min session | 20 |

**Streak Multipliers:**

| Streak | Multiplier | Earn Range |
|--------|-----------|------------|
| No streak | 1.0× | 15–20 POWR |
| 3-session streak | 1.2× | 18–24 POWR |
| 5-session streak | 1.5× | 22–30 POWR |
| 7-session streak | 2.0× | 30–40 POWR |
| 10+ session streak | 3.0× | 45–60 POWR |

**Weekly consistency bonus:** +5 POWR flat for 5+ sessions in a week.

**Rationale:** Fully passive — background location detects geofence entry automatically. Dwell time confirms a real session vs. passing through. Multipliers make gym the highest-ceiling activity to reward long-term commitment.

---

### 🔥 HIIT / Classes
**Tag:** High Intensity · **Strength lane** (scores identically to Gym)  
**Daily Cap:** 30 POWR  
**Verification:** Geofencing · Heart Rate · Manual Log

**Eligibility:** HR Zone 4+ sustained 10+ min OR geofenced partner studio entry with 20+ min dwell.

| Tier | POWR |
|------|------|
| 20+ min | 15 |
| `gym_upgrade_minutes`+ (default 40) | 20 |

**Streak Multipliers:** the same ladder as Gym — 1.2× at 3, 1.5× at 5, 2.0× at 7, 3.0× at 10+.

**Rationale (2026-08-05):** gym and HIIT/classes are one **strength lane**. A hard
session shouldn't pay less because a wearable — or the venue — labelled it a class
rather than a gym visit, so the two share one base table, one streak ladder and one
daily cap. The single deliberate asymmetry is the entry gate: HIIT qualifies at 20
minutes where gym uses the tunable `min_gym_dwell_minutes` (default 30), so a short
class keeps earning instead of dropping to zero. The upgrade rung is the shared
`gym_upgrade_minutes`, so an admin retune moves both together.

**The strength lane pays the same on every path**, including wearables. The
Terra webhook and the native HealthKit / Health Connect sync used to pay a flat
10 for both gym and HIIT; they now run the 15/20 table off the same
`min_gym_dwell_minutes` / `gym_upgrade_minutes` config the check-in path reads, so
a retune moves all of them together. A tracked session is worth what the session
is worth, whatever recorded it.

⚠ Streak multipliers remain a **check-in-only** bonus, for every activity type —
they're awarded in `claim-points`, which in practice only fires for geofence gym.
Neither the wearable path nor the manual log has ever paid a streak bonus, so this
is a verification-path difference, not an activity one.

⚠ The geofence path always writes `type: 'gym'` regardless of venue, so a check-in
at a partner studio already scored at gym rates before this change.

---

### ⚽ Sports
**Tag:** Social / Casual  
**Daily Cap:** 10 POWR  
**Verification:** GPS · Heart Rate · Manual Log

**Eligibility:** 30+ min. HR Zone 3+ sustained. Manual sport-type log required to confirm activity type.

| Tier | POWR |
|------|------|
| 30–60 min | 6 |
| 60–90 min | 8 |
| 90+ min | 10 |

**Streak:** No streak multiplier (accounts for irregular scheduling). Weekly bonus: +3 POWR for 2+ sessions.

**Rationale:** Covers football, tennis, basketball, padel etc. Manual log selects sport type for context and trust scoring.

---

### 🧘 Yoga / Pilates
**Tag:** Low Intensity  
**Daily Cap:** 6 POWR  
**Verification:** Wearable (duration) · Manual Log

**Eligibility:** 20+ min. HR Zone 1–2 acceptable. Manual log required.

| Tier | POWR |
|------|------|
| 20–30 min | 3 |
| 30–45 min | 4 |
| 45–60 min | 5 |
| 60+ min | 6 |

**Streak:** +1 POWR at 5-day streak. Encourages a daily mindfulness habit.

**Rationale:** Accessibility-first. Low intensity is the point — no HR minimum threshold applied. The lower cap reflects lower physical exertion relative to other activities.

---

## Streaks & Global Bonuses

| Trigger | Bonus | Applies To |
|---------|-------|------------|
| 3-day active streak | +1 POWR / session | Running, Cycling, Swimming, Yoga |
| 5-day active streak | +2 POWR / session | Running, Cycling, Swimming, Yoga |
| 7-day active streak | 1.5× base POWR | Running, Cycling, Swimming |
| Strength-lane multipliers | 1.2× / 1.5× / 2.0× / 3.0× at 3 / 5 / 7 / 10 days | Gym (check-in only; HIIT sessions do not receive a streak multiplier because check-ins always write type `gym`) |
| Weekly consistency (5+ sessions) | +5 POWR flat | All activities |
| Monthly milestone (20+ sessions) | +15 POWR flat | All activities |

### Streak Break Rules

- Missing 1 day resets streak to 0. Consider offering 1 freeze token per week for UX.
- A session must meet the activity's eligibility gate to count toward streak.
- Multiple activities in one day count as **1 streak day** — sessions do not stack.
- Streak multipliers apply to **base POWR only**, not to other bonuses.

---

## Verification & Trust Levels

| Signal | Trust Score |
|--------|-------------|
| Geofencing (Partner Location) | 94% |
| GPS Tracking | 92% |
| Heart Rate Zones | 85% |
| Wearable Step / Lap Count | 78% |
| Manual User Log | 55% |

### Signal Hierarchy Rules

| Rule | Detail |
|------|--------|
| Dual signal required for 10 POWR activities | Geofence + dwell time, or GPS + HR |
| Geofence dwell minimum: 20 min | Prevents drive-by or passing-through false triggers |
| Manual log alone = 80% of tier POWR | Anti-abuse discount; rounded down to nearest integer |
| Conflicting signals trigger review flag | e.g. Geofence entry confirmed but HR flat for entire session |
| Daily anomaly threshold | 3+ flagged sessions in 7 days → manual review queue |

---

## Daily Caps Summary

| Activity | Daily Cap |
|----------|-----------|
| Walking | 5 POWR |
| Running | 10 POWR |
| Cycling | 10 POWR |
| Swimming | 10 POWR |
| Gym | 30 POWR |
| HIIT / Classes | 30 POWR |
| Sports | 10 POWR |
| Yoga / Pilates | 6 POWR |

> **Note:** The daily cap covers base POWR **and** the streak bonus together — not
> base only. `enforce_point_award_cap` sums `type='earn'` and `type='streak'` rows
> for the day and clamps the total; anything above the cap is banked to the Vault
> rather than paid to the spendable balance. So a 7- or 10-session gym streak does
> not pay 40 or 60 POWR into the balance on the day — it pays 30, and the overflow
> vaults. Verified against the deployed trigger, 2026-07-24.

---

## Anti-Abuse Rules

- **One active session per activity type per day** — duplicate sessions are flagged
- **Manual log penalty** — 80% of tier POWR awarded (rounded down), no streak credit
- **Impossible travel detection** — GPS velocity check between consecutive transactions; physically impossible movement rejects the transaction
- **Single device enforcement** — new login invalidates previous JWTs; one active session per user ID
- **Transaction throttling** — Postgres-level rate limiting on claims per hour/day
- **Stop-start cycling detection** — GPS pattern analysis flags urban cycling spoofing attempts

---

*POWR Points Logic · Internal Working Document · v0.3*
