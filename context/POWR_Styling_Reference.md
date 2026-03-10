# POWR — UI Styling Reference
**For use by AI assistants when building POWR app screens and components.**

---

## Brand
- **App:** POWR (Move More. Earn More.) — dark-mode fitness rewards app
- **Tone:** Sleek, premium, performance-focused. Not heavy or aggressive.

---

## Typography
- **Font:** Outfit (Google Fonts) — geometric grotesque, all weights 100–800
- **Rule:** Use weight contrast for hierarchy. Never use the same weight twice in a headline pair.

| Token | Size | Weight | Tracking | Leading | Colour | Use |
|-------|------|--------|----------|---------|--------|-----|
| hero | 56px | 200 | −1.5px | 1.0 | #F2F2F2 / #E8D200 | Campaign / splash |
| display | 44px | 200 | −1px | 1.0 | #F2F2F2 / #E8D200 | Onboarding headlines |
| h1 | 32px | 300 | −0.5px | 1.2 | #F2F2F2 | Screen titles |
| h2 | 24px | 400 | 0 | 1.3 | #F2F2F2 | Section headings |
| h3 | 20px | 500 | 0 | 1.3 | #F2F2F2 | Subsections |
| body-lg | 16px | 400 | 0 | 1.5 | #888888 | Primary UI text |
| body | 14px | 300 | 0 | 1.7 | #888888 | Descriptions |
| label | 12px | 500 | +1.5px | 1.0 | #444444 | UPPERCASE tags, nav, badges |
| caption | 11px | 300 | 0 | 1.6 | #444444 | Timestamps, legal |
| stat | 48–96px | 200 | −2px | 1.0 | #E8D200 | Points, streaks, scores |
| cta | 13px | 700 | +1.5px | 1.0 | #080808 on #E8D200 | Primary buttons — UPPERCASE |

---

## Colours

| Token | Hex | Use |
|-------|-----|-----|
| background | #080808 | App background — near-black |
| surface-1 | #0F0F0F | Cards, modals |
| surface-2 | #141414 | Nested cards, inputs |
| border | #1E1E1E | Dividers, card outlines |
| accent | #E8D200 | Gold — highlights, CTAs, active states, points |
| on-accent | #080808 | Text placed ON the gold accent |
| text-primary | #F2F2F2 | Main headings and UI text |
| text-secondary | #888888 | Body copy, descriptions |
| text-muted | #444444 | Labels, captions, metadata |
| success | #00CC66 | Verified sessions, positive states |
| warning | #FF9944 | Weak signal, pending states |
| error | #CC3333 | Flags, rejected transactions |

---

## Component Rules

**Buttons**
- Primary: background #E8D200, text #080808, weight 700, 13px, UPPERCASE, tracking +1.5px, border-radius 4px, height 48px
- Ghost: border 1px solid #E8D200, text #E8D200, weight 500, same sizing
- Destructive: border 1px solid #CC3333, text #CC3333

**Cards**
- Background: #0F0F0F
- Border: 1px solid #1E1E1E
- Border-radius: 6px
- Padding: 16px
- Active/selected: border-color #E8D200, background #141400

**Navigation**
- Active item: weight 600, colour #E8D200, underline 1.5px solid #E8D200
- Inactive: weight 400, colour #444444
- Font-size: 12px UPPERCASE tracking +1.5px

**Stat/Points Display**
- Large number: Outfit 200, 48–96px, colour #E8D200, tracking −2px
- Supporting label: 10px, weight 400, UPPERCASE, tracking +2px, colour #444444
- Always stack: LABEL above → NUMBER large → unit below

**Input Fields**
- Background: #0F0F0F
- Border: 1px solid #1E1E1E
- Focus border: 1px solid #E8D200
- Text: 14px weight 300 #F2F2F2
- Placeholder: #444444
- Border-radius: 4px, height: 48px, padding: 0 16px

**Dividers / Rules**
- Standard: 1px solid #1E1E1E
- Accent: 1px solid #E8D200 (use sparingly — section emphasis only)
- Gold bar accent: 2–3px tall, 24–32px wide, #E8D200 (before section titles)

**Badges / Tags**
- Border: 1px solid #1E1E1E
- Text: 9px UPPERCASE weight 500 tracking +1.5px #444444
- Active badge: border #E8D200, text #E8D200, background rgba(232,210,0,0.08)

**Notifications / Alerts**
- Title: 13px weight 600 — gold for success, #FF9944 for warning, #CC3333 for error
- Body: 12px weight 300 #888888
- Background tint: accent colour at 8% opacity

---

## Spacing System (8px base grid)

| Token | Value | Use |
|-------|-------|-----|
| xs | 4px | Icon gaps, tight inline spacing |
| sm | 8px | Inner card padding, row gaps |
| md | 16px | Card padding, section gaps |
| lg | 24px | Between sections |
| xl | 32px | Page section separation |
| 2xl | 48px | Major layout sections |
| page | 20–24px | Horizontal screen margin |

---

## Key Patterns

- **Headlines always pair weight 200 (white) + weight 700 (gold).** Never same weight.
- **Numbers are always gold (#E8D200) at light weight (200).** Supporting text is dim.
- **CTAs are always full-width on mobile**, gold background, dark text, uppercase, weight 700.
- **Dark mode only.** No light mode. Background never goes above #1A1A1A.
- **No drop shadows.** Use border contrast instead.
- **Corners: 4px for interactive elements (buttons, inputs), 6px for cards.**
- **Uppercase labels always need tracking** — minimum +1.5px, never 0.

---

## React Native Implementation

```typescript
// Install: npx expo install @expo-google-fonts/outfit

import {
  Outfit_200ExtraLight,
  Outfit_300Light,
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from '@expo-google-fonts/outfit';

// typography.ts
export const typography = {
  hero:    { fontFamily: 'Outfit_200ExtraLight', fontSize: 56, letterSpacing: -1.5, lineHeight: 56 },
  display: { fontFamily: 'Outfit_200ExtraLight', fontSize: 44, letterSpacing: -1,   lineHeight: 44 },
  h1:      { fontFamily: 'Outfit_300Light',      fontSize: 32, letterSpacing: -0.5, lineHeight: 38 },
  h2:      { fontFamily: 'Outfit_400Regular',    fontSize: 24, letterSpacing: 0,    lineHeight: 31 },
  h3:      { fontFamily: 'Outfit_500Medium',     fontSize: 20, letterSpacing: 0,    lineHeight: 26 },
  bodyLg:  { fontFamily: 'Outfit_400Regular',    fontSize: 16, letterSpacing: 0,    lineHeight: 24 },
  body:    { fontFamily: 'Outfit_300Light',       fontSize: 14, letterSpacing: 0,    lineHeight: 24 },
  label:   { fontFamily: 'Outfit_500Medium',     fontSize: 12, letterSpacing: 1.5,  lineHeight: 12, textTransform: 'uppercase' },
  caption: { fontFamily: 'Outfit_300Light',       fontSize: 11, letterSpacing: 0,    lineHeight: 18 },
  stat:    { fontFamily: 'Outfit_200ExtraLight', fontSize: 72, letterSpacing: -2,   lineHeight: 72 },
  cta:     { fontFamily: 'Outfit_700Bold',       fontSize: 13, letterSpacing: 1.5,  lineHeight: 13, textTransform: 'uppercase' },
};

// colours.ts
export const colours = {
  bg:          '#080808',
  surface1:    '#0F0F0F',
  surface2:    '#141414',
  border:      '#1E1E1E',
  accent:      '#E8D200',
  onAccent:    '#080808',
  textPrimary: '#F2F2F2',
  textSec:     '#888888',
  textMuted:   '#444444',
  success:     '#00CC66',
  warning:     '#FF9944',
  error:       '#CC3333',
};
```

---

*POWR · Internal Reference · v1.0 · 2025*
