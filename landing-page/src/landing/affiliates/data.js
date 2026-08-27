/**
 * The numbers this page makes promises with.
 *
 * None of these tables are anon-readable (creator_programs / creator_program_steps /
 * system_config are all gated to admins or linked affiliates), so the page
 * carries the Default programme's values as constants. Every figure below
 * was read from production on 2026-08-27 — keep them in step with:
 *
 *   creator_programs (is_default)         → CONVERSION / INVITEE points
 *   creator_program_steps (Default)       → LADDER
 *   system_config.creator_invite_threshold / creator_invite_window_days → WAY_IN
 *
 * Step rewards are described generically ("a reward") on purpose: the
 * catalogue is admin-edited, the row names change, and rewards can be
 * physical OR digital; the STRUCTURE (points + a reward at these steps) is
 * what the programme promises. Never say "parcel" — half of them won't be.
 */

/** Points to the affiliate, per verified conversion (creator_conversion_points). */
export const CONVERSION_PTS = 50;

/** Points to the person they brought in, the moment they convert (invitee_bonus_points). */
export const INVITEE_PTS = 20;

/** Days a new member has to enter a code after signing up (referral grace window). */
export const CODE_GRACE_DAYS = 14;

/** The step ladder — counted in conversions (step_counting = 'conversions'). */
export const LADDER = [
  { n: 5, label: 'First five', points: 250, reward: true },
  { n: 25, label: 'Twenty-five', points: 1500, reward: true },
  { n: 100, label: 'Century', points: 7500, reward: false },
];

/** The earned invite: converted referrals as a plain member, inside the window. */
export const WAY_IN = { threshold: 5, windowDays: 90 };

/**
 * The illustrative affiliate the hero and the ladder both show. One person,
 * one set of numbers, so the page never contradicts itself between sections
 * (the homepage film does the same with its balance across acts).
 *
 * Maths that must hold: converted × CONVERSION_PTS + reached-step points = points.
 *   41 × 50 = 2,050  +  250 + 1,500 (steps 5 and 25 reached)  = 3,800
 */
export const DEMO = {
  code: 'COACHLEE',
  handle: 'coachlee',
  name: 'Lee Okafor',
  taps: 1204,
  signups: 86,
  converted: 41,
  points: 3800,
};

export const SITE = 'https://powr.life';
