import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { sendEmail } from "../_shared/mailgun.ts";
import {
  waitlistUserEmail,
  waitlistPartnerEmail,
  welcomeEmail,
  rewardNotificationEmail,
  streakAtRiskEmail,
  weeklyChallengeExpiryEmail,
  rewardUnlockedEmail,
  pointsMilestoneEmail,
  inactivityNudgeEmail,
  type WaitlistUserData,
  type WaitlistPartnerData,
  type WelcomeData,
  type RewardNotificationData,
  type StreakAtRiskData,
  type WeeklyChallengeExpiryData,
  type RewardUnlockedData,
  type PointsMilestoneData,
  type InactivityNudgeData,
} from "../_shared/email-templates.ts";

const SEND_EMAIL_SECRET = Deno.env.get("SEND_EMAIL_SECRET");

type EmailPayload =
  | { type: "waitlist_user"; to: string; data: WaitlistUserData }
  | { type: "waitlist_partner"; to: string; data: WaitlistPartnerData }
  | { type: "welcome"; to: string; data: WelcomeData }
  | { type: "reward"; to: string; data: RewardNotificationData }
  | { type: "streak_at_risk"; to: string; data: StreakAtRiskData }
  | { type: "weekly_challenge_expiry"; to: string; data: WeeklyChallengeExpiryData }
  | { type: "reward_unlocked"; to: string; data: RewardUnlockedData }
  | { type: "points_milestone"; to: string; data: PointsMilestoneData }
  | { type: "inactivity_nudge"; to: string; data: InactivityNudgeData };

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (SEND_EMAIL_SECRET) {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (token !== SEND_EMAIL_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  let payload: EmailPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  if (!payload.type || !payload.to) {
    return new Response("Missing required fields: type, to", { status: 400 });
  }

  try {
    let email: { subject: string; html: string; text: string };

    switch (payload.type) {
      case "waitlist_user":
        email = waitlistUserEmail(payload.data);
        break;
      case "waitlist_partner":
        email = waitlistPartnerEmail(payload.data);
        break;
      case "welcome":
        email = welcomeEmail(payload.data);
        break;
      case "reward":
        email = rewardNotificationEmail(payload.data);
        break;
      case "streak_at_risk":
        email = streakAtRiskEmail(payload.data);
        break;
      case "weekly_challenge_expiry":
        email = weeklyChallengeExpiryEmail(payload.data);
        break;
      case "reward_unlocked":
        email = rewardUnlockedEmail(payload.data);
        break;
      case "points_milestone":
        email = pointsMilestoneEmail(payload.data);
        break;
      case "inactivity_nudge":
        email = inactivityNudgeEmail(payload.data);
        break;
      default:
        return new Response(`Unknown email type: ${(payload as { type: string }).type}`, { status: 400 });
    }

    await sendEmail({
      to: payload.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-email error:", err);
    return new Response("Failed to send email", { status: 500 });
  }
});
