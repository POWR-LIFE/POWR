import { colours } from '@/constants/tokens';

/**
 * Vault palette.
 *
 * Sourced from the POWR design tokens rather than held locally, so the Vault
 * moves with the rest of the app.
 *
 * ── A note on the earlier cyan ──────────────────────────────────────────────
 * This surface used to run cold (cyan/steel) on the argument that locked value
 * should look different from spendable value. That was dropped deliberately:
 * an entire screen off-brand is a heavier cost than the distinction was worth,
 * and locked-vs-spendable is already carried by the door, the vesting rail and
 * the copy — none of which depend on hue. If the distinction ever needs to be
 * louder, reach for those, not for a second brand colour.
 */

/** POWR gold. The one accent on this screen. */
export const ACCENT = colours.accent;
/** Fills behind gold strokes/pills — reads as a tint, never a block of colour. */
export const ACCENT_DIM = colours.accentGlow;
/** Secondary gold for supporting labels, dimmer than the headline figure. */
export const ACCENT_SOFT = 'rgba(232,210,0,0.72)';

// ⚠ SURFACES STAY AS THEY WERE. Only the ACCENT was repointed to POWR gold.
// Swapping these for colours.bg/cardBg too lifted the whole page from near-black
// to #1E1E1E, which Jamie caught immediately ("why has the background changed?").
// The vault runs darker than the rest of the app on purpose — the door is a lit
// object and it needs a black room. Don't "finish the job" by tokenising these.
export const POT_BG = '#07090A';
export const POT_SURFACE = 'rgba(18,22,25,0.72)';
export const POT_BORDER = 'rgba(255,255,255,0.07)';

export const TEXT = '#F2F2F2';
export const DIM = 'rgba(255,255,255,0.5)';
export const MUTED = 'rgba(255,255,255,0.28)';
