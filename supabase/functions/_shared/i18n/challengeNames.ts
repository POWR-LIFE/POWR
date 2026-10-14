// Which catalog key names a challenge, so its name can be shown in the reader's
// language. Pure (no Deno or Node APIs): the app imports it too.
//
// Two kinds of challenge, keyed differently because they live in different
// places:
//   - Weekly challenges are code (shared/weeklyChallenges.js and its mirrors),
//     each with a stable id ("run-just-run"): the id IS the key.
//   - Together templates are rows an admin writes in shared_challenge_templates.
//     Their only stable handle is the English title as stored, so it maps to a
//     key here. A title not in this map (a template added since) is shown as
//     the admin wrote it, in every language — add it here and to the catalogs
//     (app: shared/i18n/<lang>/app/challenges.json templates.*; pushes:
//     push/<lang>.ts challengeNames.templates.*) to translate it.
//
// Live challenges keep a SNAPSHOT of the template (shared_challenges.template),
// so a renamed template's in-flight challenges still carry the old title; keep
// an old title in the map for as long as challenges using it can be on screen.

/** Stored English title (shared_challenge_templates.title) → key under templates.* */
export const TEMPLATE_TITLE_KEYS: Readonly<Record<string, string>> = {
  "Back Again": "backAgain",
  "10K Days": "10kDays",
  "Just Run": "justRun",
  "Four of a Kind": "fourOfAKind",
  "35K Steps": "35kSteps",
  "Early Bird": "earlyBird",
  "Full House": "fullHouse",
  "Step It Up": "stepItUp",
  "50K Steps": "50kSteps",
  "100K Together": "100kTogether",
  "Three Runs": "threeRuns",
  "10K Runner": "10kRunner",
  "Distance Pool": "distancePool",
  "Wheels Up": "wheelsUp",
  "Gym Pile-Up": "gymPileUp",
  "Saddle Time": "saddleTime",
  "Test Shared Challenge": "testSharedChallenge",
  "Century Split": "centurySplit",
  "Mix It Up": "mixItUp",
  "Step Squad": "stepSquad",
  "Miles Together": "milesTogether",
  "Quarter Million": "quarterMillion",
  "Gym Grind": "gymGrind",
  "Full Gym": "fullGym",
  "Run Club": "runClub",
  "Marathon Pool": "marathonPool",
  "Pedal Party": "pedalParty",
  "Road Pedal Pool": "roadPedalPool",
  "Everest Ride": "everestRide",
  "All In": "allIn",
  "Mega Mix": "megaMix",
};

/** The templates.* key for a stored template title, or null for one we don't know. */
export function templateTitleKey(title: unknown): string | null {
  if (typeof title !== "string") return null;
  return Object.prototype.hasOwnProperty.call(TEMPLATE_TITLE_KEYS, title) ? TEMPLATE_TITLE_KEYS[title] : null;
}

/** A weekly-challenge id that can safely be used inside a catalog key. */
export function weeklyChallengeKey(id: unknown): string | null {
  return typeof id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ? id : null;
}
