// Language helpers shared by the member emails (welcome, weekly summary,
// level-up, re-engagement, redemption receipt). The words live in
// _shared/i18n/email/<lang>.ts; these only format around them.
//
// English must come out exactly as it did before translation, so every helper
// here leaves English on its original code path.

import { formatLocale, tEmail } from "../i18n/index.ts";
import type { LevelTier } from "../levels.ts";

/** Desktop-only line break the templates use inside paragraphs (hidden under 620px). */
export const BR_DESKTOP = '<br class="br-d">';

/** A number as the emails show it. English keeps the bare toLocaleString() it always used. */
export function fmtNum(n: number, lang = "en"): string {
  return lang === "en" ? n.toLocaleString() : n.toLocaleString(formatLocale(lang));
}

/** First word of a display name, or the catalog's stand-in ("there"). Plain text: escape it for HTML. */
export function firstNameOf(name: string | null | undefined, lang = "en"): string {
  return name?.trim().split(" ")[0] || tEmail(lang, "common.there");
}

/** Tier label ("Recruit"…) in `lang`. English matches _shared/levels.ts TIER_LABEL, which gym-board still uses. */
export function tierLabel(lang: string, tier: LevelTier): string {
  switch (tier) {
    case "recruit":
      return tEmail(lang, "tiers.recruit");
    case "athlete":
      return tEmail(lang, "tiers.athlete");
    case "elite":
      return tEmail(lang, "tiers.elite");
    case "legend":
      return tEmail(lang, "tiers.legend");
  }
}

/**
 * A reward's discount badge in `lang`, the way the app's RewardCard shows it.
 * Input is _shared/reward-catalogue.ts discountLabel(): "20% OFF" / "£15 OFF"
 * when built from the discount, else the partner's own value_label. English
 * returns it untouched; a partner label that doesn't end in OFF ("FREE GIFT")
 * stays as they wrote it.
 */
export function rewardValueLabel(label: string, lang = "en"): string {
  if (lang === "en" || !label) return label;
  const percent = label.match(/^(\d+(?:\.\d+)?)% OFF$/);
  if (percent) return tEmail(lang, "reward.percentOff", { value: fmtNum(Number(percent[1]), lang) });
  const pounds = label.match(/^£(\d+(?:\.\d+)?) OFF$/);
  if (pounds) return tEmail(lang, "reward.poundsOff", { value: fmtNum(Number(pounds[1]), lang) });
  const other = label.match(/^(.+?)\s*(OFF|off)$/);
  if (other) return tEmail(lang, "reward.amountOff", { amount: other[1].trim() });
  return label;
}
