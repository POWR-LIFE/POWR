# POWR — UI Styling Reference
**For use by AI assistants when building POWR app screens and components.**

> **Source of truth:** The homepage components (`components/home/`) are the canonical design reference. Values here reflect what is actually implemented, not an aspirational spec.

---

## Brand
- **App:** POWR (Move More. Earn More.) — dark-mode fitness rewards app
- **Tone:** Sleek, premium, performance-focused. Not heavy or aggressive.

---

## Typography
- **Font:** Outfit (Google Fonts) — geometric grotesque, all weights 100–800
- **Rule:** Use weight contrast for hierarchy. Never use the same weight twice in a headline pair.
- **Implementation:** Use inline `fontWeight` strings (e.g. `'100'`, `'300'`, `'700'`). The Outfit_XXX fontFamily tokens in `constants/tokens.ts` exist but are not used in practice — components use `fontWeight` directly.

| Token | Size | Weight | Tracking | Leading | Colour | Use |
|-------|------|--------|----------|---------|--------|-----|
| hero | 56px | 100–200 | −1.5px | 1.0 | #F2F2F2 / #facc15 | Campaign / splash |
| display | 44px | 100–200 | −1.5px | 1.0 | #F2F2F2 / #facc15 | Onboarding headlines |
| h1 | 32px | 200–300 | −0.5px | 1.2 | #F2F2F2 | Screen titles |
| h2 | 24px | 300 | 0 | 1.3 | #F2F2F2 | Section headings |
| h3 / card title | 13–15px | 300 | 0 | 1.3 | #F2F2F2 | Card titles |
| body | 11–12px | 300 | 0 | 1.5 | rgba(255,255,255,0.5) | Descriptions, subtitles |
| label | 9–10px | 500 | +1.5–2px | 1.0 | rgba(255,255,255,0.25–0.35) | UPPERCASE metadata, section labels |
| caption | 8–9px | 300–400 | 0–0.5px | 1.6 | rgba(255,255,255,0.25) | Timestamps, fine print |
| stat large | 56–72px | 100 | −2px | 1.0 | #facc15 | Points, streaks, big scores |
| stat small | 20–32px | 100–200 | −1.5px | 1.0 | #facc15 | Secondary numbers |
| cta | 10–13px | 700 | +1–1.5px | 1.0 | #0a0a0a on #facc15 | Button labels — UPPERCASE |

---

## Colours

| Token | Hex / rgba | Use |
|-------|-----------|-----|
| background | #0d0d0d | App background — near-black |
| card-bg | rgba(40,40,40,0.85) | Cards, list rows — semi-transparent dark |
| card-bg-alt | rgba(50,50,50,0.75) | Activity grid tiles, nested cards |
| surface-1 | #0F0F0F | Tab bar, inputs, static surfaces |
| border | rgba(255,255,255,0.07–0.10) | Card outlines — **always semi-transparent white, never a solid dark value** |
| border-strong | rgba(255,255,255,0.20–0.30) | Active states, focused inputs |
| accent / gold | #facc15 | Gold — highlights, CTAs, active states, points, streaks |
| on-accent | #0a0a0a | Text placed ON the gold accent |
| text-primary | #F2F2F2 | Main headings and UI text |
| text-secondary | rgba(255,255,255,0.5) | Body copy, descriptions, subtitles |
| text-muted | rgba(255,255,255,0.25) | Labels, captions, metadata |
| success | #00CC66 | Verified sessions, positive states |
| warning | #f97316 | Weak signal, pending states, streak fire dot |
| error | #CC3333 | Flags, rejected transactions |

---

## Component Rules

**Buttons**
- Primary: background `#facc15`, text `#0a0a0a`, `fontWeight: '700'`, 10–13px, UPPERCASE, tracking +1–1.5px, `borderRadius: 20` (pill), padding `7–12px` vertical / `18–22px` horizontal
- Ghost: `borderWidth: 1`, `borderColor: rgba(250,204,21,0.25–1.0)`, text `#facc15`, same sizing
- No square/sharp buttons — always pill shape (`borderRadius: 20`)

**Cards**
- Background: `rgba(40,40,40,0.85)`
- Border: `1px solid rgba(255,255,255,0.07–0.10)`
- Border-radius: **16px standard**, 18–20px for large/hero cards
- Padding: `12–14px`
- Active/selected: border-color `#facc15` at 50% opacity, background `rgba(250,204,21,0.05)`

**Accent bars**
- Vertical left edge: `width: 2`, full height, `backgroundColor: #facc15` — used on challenge/action cards
- Horizontal top: `height: 2`, full width, `backgroundColor: #facc15` — used on featured/hero cards

**Badges / Tags**
- Background: `rgba(255,255,255,0.06–0.15)` or `rgba(250,204,21,0.10)` for gold
- Border: `1px solid rgba(255,255,255,0.12)` or `rgba(250,204,21,0.25)` for gold
- Border-radius: 20px (pill)
- Text: 8–9px, UPPERCASE, `fontWeight: '500'`, tracking +1–1.5px
- Gold badge text: `#facc15`

**Navigation (tab bar)**
- Active item: colour `#facc15`
- Inactive: colour `rgba(255,255,255,0.25–0.35)` (textMuted)
- Font-size: 9px UPPERCASE tracking +1.5px
- Background: `#0F0F0F`, border-top: `1px solid #1E1E1E`

**Stat/Points Display**
- Large number: `fontWeight: '100'`, 56–72px, colour `#facc15`, tracking −2px
- Supporting label: 9–10px, `fontWeight: '500'`, UPPERCASE, tracking +2px, colour `rgba(255,255,255,0.25)`
- Always stack: LABEL above → NUMBER large → unit below

**Input Fields**
- Background: `#0F0F0F`
- Border: `1px solid #1E1E1E`
- Focus border: `1px solid #facc15`
- Text: 14px `fontWeight: '300'` `#F2F2F2`
- Placeholder: `rgba(255,255,255,0.25)`
- Border-radius: 4px, height: 48px, padding: 0 16px

**Dividers / Rules**
- Standard: `1px solid rgba(255,255,255,0.07)`
- Accent: `1px solid #facc15` (use sparingly — section emphasis only)

**Logo boxes / Partner avatars**
- Dark: `backgroundColor: 'rgba(255,255,255,0.06)'`, `borderRadius: 10–12`, white text
- Light: `backgroundColor: '#F2F2F2'`, `borderRadius: 10–12`, dark text
- Size: 48–56px square

---

## Spacing System (8px base grid)

| Token | Value | Use |
|-------|-------|-----|
| xs | 4px | Icon gaps, tight inline spacing |
| sm | 8px | Inner card gaps, row spacing |
| md | 12–16px | Card padding |
| lg | 24px | Between sections |
| xl | 32px | Page section separation |
| page | 10–16px | Horizontal screen margin (screens use `paddingHorizontal: 10–16`) |

---

## Key Patterns

- **Headlines pair `fontWeight: '100–200'` (white) + `fontWeight: '700'` (gold).** Never same weight.
- **Numbers are always gold (`#facc15`) at ultra-light weight (`'100'`).** Supporting text is dim.
- **CTAs are pill-shaped** (`borderRadius: 20`), gold background, dark text, uppercase, `fontWeight: '700'`.
- **Dark mode only.** No light mode. Background never goes above `#1A1A1A`.
- **No drop shadows.** Use border contrast instead.
- **Corners: 20px for all interactive elements (buttons, badges, pill tags), 16–20px for cards, 4px for inputs.**
- **Uppercase labels always need tracking** — minimum +1.5px, never 0.
- **Card borders are always semi-transparent white**, not a solid dark colour.
- **Screen background is `#0d0d0d`**, not pure black.
- **Cards float** — `rgba(40,40,40,0.85)` background makes them feel layered above the screen.

---

## React Native Implementation

```typescript
// Canonical colour/value reference matching actual homepage components

const GOLD   = '#facc15';
const BG     = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';

// Card
{
  borderRadius: 16,
  borderWidth: 1,
  borderColor: BORDER,
  backgroundColor: CARD_BG,
  padding: 12,
}

// Primary button (pill)
{
  backgroundColor: GOLD,
  borderRadius: 20,
  paddingHorizontal: 18,
  paddingVertical: 7,
}
// Button label
{
  fontSize: 10,
  fontWeight: '700',
  color: '#0a0a0a',
  letterSpacing: 1,
  textTransform: 'uppercase',
}

// Ghost button (pill)
{
  borderWidth: 1,
  borderColor: 'rgba(250,204,21,0.35)',
  borderRadius: 20,
  paddingHorizontal: 14,
  paddingVertical: 6,
}

// UPPERCASE label / metadata
{
  fontSize: 9,
  fontWeight: '500',
  letterSpacing: 2,
  color: 'rgba(255,255,255,0.25)',
  textTransform: 'uppercase',
}

// Large stat number
{
  fontSize: 64,
  fontWeight: '100',
  letterSpacing: -2,
  color: GOLD,
}

// Badge (gold tint)
{
  paddingHorizontal: 10,
  paddingVertical: 3,
  borderRadius: 20,
  backgroundColor: 'rgba(250,204,21,0.10)',
  borderWidth: 1,
  borderColor: 'rgba(250,204,21,0.25)',
}
```

---

*POWR · Internal Reference · v2.0 · 2026 — updated to match homepage implementation*
