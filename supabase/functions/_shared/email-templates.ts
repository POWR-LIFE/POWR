// Barrel re-export — import from here or directly from emails/
export { waitlistUserEmail, type WaitlistUserData } from "./emails/waitlist-user.ts";
export { waitlistPartnerEmail, type WaitlistPartnerData } from "./emails/waitlist-partner.ts";
export { welcomeEmail, type WelcomeData } from "./emails/welcome.ts";
export { rewardNotificationEmail, type RewardNotificationData } from "./emails/reward-notification.ts";
export { streakAtRiskEmail, type StreakAtRiskData } from "./emails/streak-at-risk.ts";
export { weeklyChallengeExpiryEmail, type WeeklyChallengeExpiryData } from "./emails/weekly-challenge-expiry.ts";
export { rewardUnlockedEmail, type RewardUnlockedData } from "./emails/reward-unlocked.ts";
export { pointsMilestoneEmail, type PointsMilestoneData } from "./emails/points-milestone.ts";
export { inactivityNudgeEmail, type InactivityNudgeData } from "./emails/inactivity-nudge.ts";
export { weeklySummaryEmail, type WeeklySummaryData } from "./emails/weekly-summary.ts";
