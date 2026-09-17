// Representative weekly-summary payloads for design QA — one per shape the email
// takes in the wild, so a preview run shows every branch, not just the best case.
// Used by send-weekly-summary { sample: true } and the email-previews rig.
import type { WeeklyRewardTile, WeeklySummaryData } from "./weekly-summary.ts";

const IMG = "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/";
const HERO = `${IMG}reward-images/heroes/1780820340343-3z0403.jpeg`;
const MATHAN: WeeklyRewardTile = { brand: "MATHAN", title: "MATHAN", cost: 300, valueLabel: "£15 OFF", image: `${IMG}reward-submissions/logos/1780493633701-o9l9sp.png`, hero: HERO };
const TRIBE: WeeklyRewardTile = { brand: "Tribe", title: "Tribe", cost: 220, valueLabel: "50% OFF", image: `${IMG}reward-images/rewards/1776850967371-0q1bco.png`, hero: HERO };
const OMNITY: WeeklyRewardTile = { brand: "OMNITY", title: "OMNITY", cost: 150, valueLabel: "20% OFF", image: `${IMG}reward-images/rewards/1781177374575-acu6oe.png`, hero: HERO };
const LEVEL_ART = "https://auth.powr.life/storage/v1/object/public/powr-level-logo/";

/** Mon–Sun of the sample week; only the weekday matters to the template. */
const week = (points: number[]) =>
  points.map((p, i) => ({ date: `2026-09-${String(7 + i).padStart(2, "0")}`, points: p, active: p > 0 }));

export type WeeklySampleId = "up" | "down" | "starter";

export const WEEKLY_SAMPLES: Record<WeeklySampleId, WeeklySummaryData> = {
  // The common case: holds more than every reward costs → "ready to redeem".
  up: {
    name: "Jamie Wright",
    weekLabel: "7–13 Sep",
    pointsThisWeek: 312,
    pointsLastWeek: 240,
    workouts: 6,
    activeDays: 6,
    currentStreak: 12,
    distanceKm: 18.4,
    steps: 52340,
    prevSteps: 47100,
    activities: [
      { type: "gym", count: 4, prevCount: 2 },
      { type: "running", count: 2, prevCount: 3 },
      { type: "hiit", count: 1, prevCount: 0 },
    ],
    referralCode: "JAMIE20",
    longestSession: { type: "gym", durationSec: 4920, partner: "ONE LDN" },
    gyms: [{ name: "ONE LDN", count: 3 }, { name: "PureGym Holborn", count: 1 }],
    wearable: "Whoop",
    challengesCompleted: 2,
    challengeTitles: ["No Days Off", "5 Days Active"],
    balance: 674,
    rewardsReady: [MATHAN, TRIBE, OMNITY],
    affordableCount: 10,
    days: week([45, 60, 0, 85, 40, 52, 30]),
    level: { level: 3, name: "Streak Freak", tierLabel: "Recruit", tierColor: "#999999", totalEarned: 1840, levelAt: 1200, nextName: "Motion Magic", nextAt: 2500, imageUrl: `${LEVEL_ART}streak-freak.png?v=20260711` },
    vaultBanked: 85,
  },
  // A lighter week (the majority of sends): leads with what held, some rewards in reach.
  down: {
    name: "Jamie Wright",
    weekLabel: "7–13 Sep",
    pointsThisWeek: 118,
    pointsLastWeek: 205,
    workouts: 2,
    activeDays: 4,
    currentStreak: 9,
    distanceKm: 6.2,
    steps: 38410,
    prevSteps: 51200,
    activities: [{ type: "gym", count: 2, prevCount: 4 }],
    referralCode: "JAMIE20",
    // A 12 h cap-hit: must NOT be featured.
    longestSession: { type: "gym", durationSec: 43200, partner: "ONE LDN" },
    gyms: [{ name: "ONE LDN", count: 2 }],
    wearable: "Apple Health",
    challengesCompleted: 0,
    balance: 190,
    rewardsReady: [OMNITY],
    affordableCount: 1,
    closestReward: TRIBE,
    days: week([0, 42, 0, 0, 51, 15, 10]),
    level: { level: 2, name: "Cardio Goblin", tierLabel: "Recruit", tierColor: "#999999", totalEarned: 905, levelAt: 500, nextName: "Streak Freak", nextAt: 1200, imageUrl: `${LEVEL_ART}the-cardio-goblin.png?v=20260711` },
  },
  // First real week: no prior week, nothing affordable yet, no wearable.
  starter: {
    name: "Alex",
    weekLabel: "7–13 Sep",
    pointsThisWeek: 64,
    pointsLastWeek: 0,
    isFirstWeek: true,
    workouts: 1,
    activeDays: 3,
    currentStreak: 2,
    steps: 21800,
    prevSteps: 0,
    activities: [{ type: "running", count: 1, prevCount: 0 }],
    referralCode: "ALEX7Q",
    longestSession: { type: "running", durationSec: 1980 },
    wearable: null,
    challengesCompleted: 0,
    balance: 104,
    topRewards: [MATHAN, TRIBE, OMNITY],
    upcomingRewards: [OMNITY, TRIBE, MATHAN],
    closestReward: OMNITY,
    days: week([0, 0, 22, 0, 30, 12, 0]),
    level: { level: 1, name: "Touching Grass", tierLabel: "Recruit", tierColor: "#999999", totalEarned: 104, levelAt: 0, nextName: "Cardio Goblin", nextAt: 500, imageUrl: `${LEVEL_ART}touching-grass-1.png?v=20260711` },
  },
};
