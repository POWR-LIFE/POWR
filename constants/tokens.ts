/**
 * POWR Design Tokens
 * Single source of truth for all design values across iOS and Android.
 * Mirrors the CSS variables defined in landing-page/style.css.
 */

// ─── Colours ────────────────────────────────────────────────────────────────

export const colours = {
  // Backgrounds
  bg:       '#0d0d0d',
  surface1: '#0F0F0F',
  surface2: '#141414',
  border:   '#1E1E1E',         // for tab bar / input borders (solid)
  borderCard: 'rgba(255,255,255,0.08)', // for card/row borders (semi-transparent white)

  // Card surfaces (semi-transparent — floats above bg)
  cardBg:    'rgba(40,40,40,0.85)',
  cardBgAlt: 'rgba(50,50,50,0.75)',

  // Brand accent — Tailwind yellow-400, matches homepage components
  accent:   '#facc15',
  onAccent: '#0a0a0a',

  // Accent overlays
  accentGlow: 'rgba(250, 204, 21, 0.08)',
  accentMid:  'rgba(250, 204, 21, 0.25)',
  accentDim:  'rgba(250, 204, 21, 0.12)',

  // Text
  textPrimary:   '#F2F2F2',
  textSecondary: 'rgba(255,255,255,0.5)',
  textMuted:     'rgba(255,255,255,0.25)',

  // Semantic
  success:     '#00CC66',
  successGlow: 'rgba(0, 204, 102, 0.08)',
  warning:     '#FF9944',
  warningGlow: 'rgba(255, 153, 68, 0.08)',
  error:       '#CC3333',
  errorGlow:   'rgba(204, 51, 51, 0.08)',

  // Partner / Category colours
  categoryFashion:   '#7C3AED',
  categoryGear:      '#0EA5E9',
  categoryNutrition: '#F59E0B',
  categoryGym:       '#EF4444',
} as const;

export type ColourKey = keyof typeof colours;

// ─── Typography ─────────────────────────────────────────────────────────────

/**
 * Font family names as registered via @expo-google-fonts/outfit.
 * Install: npx expo install @expo-google-fonts/outfit
 */
export const fontFamily = {
  extraLight: 'Outfit_200ExtraLight',
  light:      'Outfit_300Light',
  regular:    'Outfit_400Regular',
  medium:     'Outfit_500Medium',
  semiBold:   'Outfit_600SemiBold',
  bold:       'Outfit_700Bold',
} as const;

/**
 * Typography scale.
 * fontSize in dp (density-independent pixels).
 * letterSpacing in dp (React Native uses dp, not em).
 * lineHeight in dp.
 */
export const typography = {
  hero: {
    fontFamily:    fontFamily.extraLight,
    fontSize:      56,
    letterSpacing: -1.5,
    lineHeight:    56,
    color:         colours.textPrimary,
  },
  display: {
    fontFamily:    fontFamily.extraLight,
    fontSize:      44,
    letterSpacing: -1,
    lineHeight:    44,
    color:         colours.textPrimary,
  },
  h1: {
    fontFamily:    fontFamily.light,
    fontSize:      32,
    letterSpacing: -0.5,
    lineHeight:    38,
    color:         colours.textPrimary,
  },
  h2: {
    fontFamily:    fontFamily.regular,
    fontSize:      24,
    letterSpacing: 0,
    lineHeight:    31,
    color:         colours.textPrimary,
  },
  h3: {
    fontFamily:    fontFamily.medium,
    fontSize:      20,
    letterSpacing: 0,
    lineHeight:    26,
    color:         colours.textPrimary,
  },
  bodyLg: {
    fontFamily:    fontFamily.regular,
    fontSize:      16,
    letterSpacing: 0,
    lineHeight:    24,
    color:         colours.textSecondary,
  },
  body: {
    fontFamily:    fontFamily.light,
    fontSize:      14,
    letterSpacing: 0,
    lineHeight:    24,
    color:         colours.textSecondary,
  },
  label: {
    fontFamily:    fontFamily.medium,
    fontSize:      12,
    letterSpacing: 1.5,
    lineHeight:    12,
    color:         colours.textMuted,
    textTransform: 'uppercase' as const,
  },
  caption: {
    fontFamily:    fontFamily.light,
    fontSize:      11,
    letterSpacing: 0,
    lineHeight:    18,
    color:         colours.textMuted,
  },
  stat: {
    fontFamily:    fontFamily.extraLight,
    fontSize:      72,
    letterSpacing: -2,
    lineHeight:    72,
    color:         colours.accent,
  },
  statSm: {
    fontFamily:    fontFamily.extraLight,
    fontSize:      48,
    letterSpacing: -2,
    lineHeight:    48,
    color:         colours.accent,
  },
  statLg: {
    fontFamily:    fontFamily.extraLight,
    fontSize:      96,
    letterSpacing: -2,
    lineHeight:    96,
    color:         colours.accent,
  },
  cta: {
    fontFamily:    fontFamily.bold,
    fontSize:      13,
    letterSpacing: 1.5,
    lineHeight:    13,
    color:         colours.onAccent,
    textTransform: 'uppercase' as const,
  },
} as const;

export type TypographyKey = keyof typeof typography;

// ─── Spacing (8px base grid) ─────────────────────────────────────────────────

export const spacing = {
  xs:   4,
  sm:   8,
  md:   16,
  lg:   24,
  xl:   32,
  '2xl': 48,
  page: 20,   // Horizontal screen margin
} as const;

export type SpacingKey = keyof typeof spacing;

// ─── Border Radius ───────────────────────────────────────────────────────────

export const radius = {
  interactive: 4,   // Inputs only
  card:        16,  // Cards, list rows (standard)
  cardLg:      20,  // Hero / streak cards
  sheet:       20,  // Bottom sheets, modals
  pill:        20,  // Buttons, badges, tags
} as const;

// ─── Component Tokens ────────────────────────────────────────────────────────

export const components = {
  button: {
    paddingH:      18,
    paddingV:      7,
    borderRadius:  radius.pill,  // always pill
  },
  card: {
    padding:       12,
    borderRadius:  radius.card,
    borderWidth:   1,
    background:    colours.cardBg,
    border:        colours.borderCard,
    activeBorder:  'rgba(250,204,21,0.5)',
    activeBackground: 'rgba(250,204,21,0.05)',
  },
  input: {
    height:        48,
    paddingH:      spacing.md,
    borderRadius:  radius.interactive,
    borderWidth:   1,
    background:    colours.surface1,
    border:        colours.border,
    focusBorder:   colours.accent,
  },
  tabBar: {
    height:        60,
    background:    colours.surface1,
    border:        colours.border,
    activeColor:   colours.accent,
    inactiveColor: colours.textMuted,
  },
  badge: {
    paddingH:      10,
    paddingV:      3,
    borderRadius:  radius.pill,
    borderWidth:   1,
    background:    'rgba(250,204,21,0.10)',
    border:        'rgba(250,204,21,0.25)',
  },
} as const;

// ─── Icon Sizes ──────────────────────────────────────────────────────────────

export const iconSize = {
  xs:  12,
  sm:  16,
  md:  20,
  lg:  24,
  xl:  32,
  '2xl': 48,
} as const;

// ─── Z-Index Scale ───────────────────────────────────────────────────────────

export const zIndex = {
  base:    0,
  card:    10,
  overlay: 100,
  modal:   200,
  toast:   300,
} as const;

// ─── Animation Durations (ms) ────────────────────────────────────────────────

export const duration = {
  fast:    150,
  normal:  250,
  slow:    400,
  xslow:   600,
} as const;
