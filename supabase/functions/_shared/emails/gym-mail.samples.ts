// Representative data for the gym team's account and reply emails, for
// design QA: send-gym-email { sample: true, kind, … } renders these to one
// inbox, and the same objects render the local previews. Nothing here is a
// real gym or person.

import type { GymInviteReminderData, GymPackageData, GymTrialData, GymWelcomeData } from "./gym-account-mail.ts";
import type { GymClashNightData, GymSupportReplyData } from "./gym-reply-mail.ts";
import type { GymNoticeReturns } from "./gym-weekly-recap.ts";

const GYM = "POWR Gym Leamington";
const TZ = "Europe/London";
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number, now = Date.now()) => new Date(now + offsetDays * DAY).toISOString();
const ymd = (offsetDays: number, now = Date.now()) => iso(offsetDays, now).slice(0, 10);

export function sampleWelcome(role: "owner" | "staff" = "owner", now = Date.now()): GymWelcomeData {
  return {
    gymName: GYM,
    role,
    tz: TZ,
    trialEndsAt: role === "owner" ? iso(90, now) : null,
    notice: role === "owner" ? { sentAt: iso(-1, now), count: 38 } : null,
  };
}

export function sampleInviteReminder(siteUrl = "https://powr.life", now = Date.now()): GymInviteReminderData {
  return {
    gymName: GYM,
    role: "owner",
    tz: TZ,
    setupUrl: `${siteUrl}/venue/setup/sample-link-does-not-work`,
    invitedAt: iso(-5, now),
    expiresAt: iso(9, now),
  };
}

export function sampleTrial(kind: "trial_ending" | "trial_ended" = "trial_ending", daysLeft = 14, now = Date.now()): GymTrialData {
  return {
    kind,
    gymName: GYM,
    tz: TZ,
    trialEndsAt: kind === "trial_ended" ? iso(-1, now) : iso(daysLeft, now),
    daysLeft: kind === "trial_ended" ? 0 : daysLeft,
    package: "clash",
    lost: ["events", "insights", "people", "studio"],
  };
}

export function samplePackage(from = "clash", to = "clash_plus", now = Date.now()): GymPackageData {
  return {
    gymName: GYM,
    tz: TZ,
    from,
    to,
    billing: to === "founding" ? "annual" : to === "clash" ? null : "monthly",
    onTrial: to !== "clash",
    trialEndsAt: iso(40, now),
  };
}

export function sampleSupportReply(updated = false): GymSupportReplyData {
  return {
    gymName: GYM,
    subject: "The board on our TV stopped updating",
    message: "[Screens] Since Saturday the leaderboard on the TV by reception shows last week's names. We've refreshed the browser and it's the same.\n\nIs there something we need to do?",
    reply: "Thanks for flagging it. The TV was still on last week's link from before you renamed the gym.\n\nOpen Screens in your portal, copy the board link again and paste it into the TV's browser. It updates every few minutes from there.",
    updated,
  };
}

export function sampleClashNight(decision: "confirmed" | "declined" | "called_off" = "confirmed", now = Date.now()): GymClashNightData {
  return {
    gymName: GYM,
    decision: decision === "confirmed" ? "confirmed" : "declined",
    was: decision === "called_off" ? "confirmed" : "requested",
    nightDate: ymd(45, now),
    startTime: "19:00:00",
    backupDate: decision === "declined" ? ymd(52, now) : null,
    note: decision === "confirmed"
      ? "Our crew arrives at 5pm to set up. Can someone meet them at the side door?"
      : decision === "called_off"
        ? "Our DJ for that week has pulled out and we won't send a night without one."
        : "We already have a night in Leamington that week. Any Thursday in November works.",
  };
}

export function sampleNotice(now = Date.now()): GymNoticeReturns {
  return {
    sentAt: iso(-23, now),
    told: 38,
    away: 9,
    unseen: 5,
    back: 4,
    unseenBack: 2,
    backIn: 1,
    unseenBackIn: 1,
  };
}
