// Barrel re-export — import from here or directly from emails/
// (Waitlist templates retired 2026-07-17 — the app is live, waitlist no longer emails.)
export { welcomeEmail, type WelcomeData } from "./emails/welcome.ts";
export { rewardNotificationEmail, type RewardNotificationData } from "./emails/reward-notification.ts";
export { streakAtRiskEmail, type StreakAtRiskData } from "./emails/streak-at-risk.ts";
export { weeklyChallengeExpiryEmail, type WeeklyChallengeExpiryData } from "./emails/weekly-challenge-expiry.ts";
export { rewardUnlockedEmail, type RewardUnlockedData } from "./emails/reward-unlocked.ts";
export { pointsMilestoneEmail, type PointsMilestoneData } from "./emails/points-milestone.ts";
export { inactivityNudgeEmail, type InactivityNudgeData } from "./emails/inactivity-nudge.ts";
export { weeklySummaryEmail, type WeeklySummaryData } from "./emails/weekly-summary.ts";
export { brandInviteEmail, type BrandInviteData } from "./emails/brand-invite.ts";
export { partnerWelcomeEmail, type PartnerWelcomeData } from "./emails/partner-welcome.ts";
export { partnerWeeklySummaryEmail, type PartnerWeeklySummaryData } from "./emails/partner-weekly-summary.ts";
export { levelUpEmail, type LevelUpData } from "./emails/level-up.ts";
