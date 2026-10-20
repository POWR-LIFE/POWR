/**
 * The POWR P, rebuilt as clean geometry from assets/images/powr_transparent.png
 * by scripts/trace-powr-mark.py: the artwork's own slant, flat edges, corner
 * radii, channel and top-right flare, measured from its anti-aliased edges and
 * redrawn as lines + arcs (match vs the artwork: 99.38%).
 * GENERATED — re-run the script rather than editing the paths by hand.
 */

export const POWR_MARK_VB_W = 760.59;
export const POWR_MARK_VB_H = 531.05;

/** The left piece: the full-height leg. Its top-right flares into a point that follows the bowl. */
export const POWR_MARK_LEG = 'M251.65 0.00 L505.45 0.00 A78.00 78.00 0 0 0 465.67 41.58 L283.61 490.33 A65.25 65.25 0 0 1 223.14 531.05 L0.00 531.05 L201.84 33.54 A53.75 53.75 0 0 1 251.65 0.00 Z';

/** The right piece: the bowl, sharp at its bottom-left. */
export const POWR_MARK_BOWL = 'M556.68 0.00 L719.59 0.00 A41.00 41.00 0 0 1 757.59 56.41 L644.27 335.71 A68.25 68.25 0 0 1 581.03 378.30 L361.61 378.30 L499.46 38.54 A61.75 61.75 0 0 1 556.68 0.00 Z';

/** The channel between them: horizontal shift per unit of height along its slant. */
export const POWR_MARK_GAP_K = 0.4057;

/** The channel's centre at mid-height, as a fraction of the width. */
export const POWR_MARK_GAP_X = 0.5142;

/** The channel's horizontal width, in viewBox units. */
export const POWR_MARK_GAP_W = 32.56;
