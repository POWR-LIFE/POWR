// email-previews — TEMPORARY QA rig for reviewing the email set.
//
// Renders every email in the (proposed) lineup with realistic sample data and
// sends the lot to jamie@powr.life so the set can be judged in a real inbox.
// The recipient is hardcoded — this function cannot email anyone else.
// Delete once the set is approved and wired to its real triggers.
//
// POST { key: "powr-email-previews", only?: string[] }
//   `only` filters by preview id: welcome | weekly | invite | partner_welcome |
//   partner_weekly | recovery | level_up

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { sendEmail } from "../_shared/mailgun.ts";
import {
  welcomeEmail,
  weeklySummaryEmail,
  brandInviteEmail,
  partnerWelcomeEmail,
  partnerWeeklySummaryEmail,
  levelUpEmail,
} from "../_shared/email-templates.ts";

const RECIPIENT = "jamie@powr.life";
const PREVIEW_KEY = "powr-email-previews";

/** supabase/templates/recovery.html with GoTrue's {{ .ConfirmationURL }} filled in. */
function recoveryPreview(): { subject: string; html: string; text: string } {
  const url = "https://powr.life/reset-password?token=preview-only";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reset your POWR password</title>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#111111;">Reset your POWR password — tap the button below to set a new one.&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#ffffff;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;border:1px solid #1e1e1e;border-radius:20px;overflow:hidden;">
        <tr>
          <td style="background-color:#080808;padding:36px 40px 32px;text-align:center;border-bottom:1px solid #161616;">
            <img src="https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext-app.png" alt="POWR" height="48" style="height:48px;width:auto;display:block;margin:0 auto;">
          </td>
        </tr>
        <tr>
          <td style="background-color:#080808;padding:44px 40px 40px;text-align:center;border-bottom:1px solid #111111;">
            <h1 style="margin:0 0 6px;font-size:42px;font-weight:200;letter-spacing:0.5px;line-height:1.15;color:#F2F2F2;font-family:Arial,Helvetica,sans-serif;">Reset your<br><em style="font-style:italic;color:#E8D200;">password.</em></h1>
            <p style="margin:16px 0 0;font-size:15px;font-weight:300;color:#555555;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">We received a request to reset your POWR password.<br>Tap the button below to set a new one.</p>
          </td>
        </tr>
        <tr>
          <td style="background-color:#0a0a0a;padding:36px 40px;text-align:center;border-bottom:1px solid #161616;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="border-radius:24px;background-color:#E8D200;">
                  <a href="${url}" style="display:inline-block;padding:14px 32px;font-size:13px;font-weight:700;color:#080808;font-family:Arial,Helvetica,sans-serif;text-decoration:none;letter-spacing:1.5px;text-transform:uppercase;">Reset Password</a>
                </td>
              </tr>
            </table>
            <p style="margin:20px 0 0;font-size:12px;color:#333333;font-family:Arial,Helvetica,sans-serif;">This link expires in 1 hour.<br>If you didn't request this, you can safely ignore this email.</p>
          </td>
        </tr>
        <tr>
          <td style="background-color:#080808;padding:24px 40px;text-align:center;border-bottom:1px solid #161616;">
            <p style="margin:0 0 8px;font-size:11px;color:#2a2a2a;font-family:Arial,Helvetica,sans-serif;">If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="margin:0;font-size:11px;font-family:Arial,Helvetica,sans-serif;word-break:break-all;"><a href="${url}" style="color:#444444;text-decoration:underline;">${url}</a></p>
          </td>
        </tr>
        <tr>
          <td style="background-color:#050505;padding:32px 40px;text-align:center;">
            <img src="https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext-app.png" alt="POWR" height="16" style="height:16px;width:auto;display:block;margin:0 auto 16px;opacity:0.15;">
            <p style="margin:0;font-size:11px;font-weight:300;color:#282828;line-height:2;font-family:Arial,Helvetica,sans-serif;">
              powr.life<br>
              <a href="https://powr.life/privacy" style="color:#333333;text-decoration:none;">Privacy Policy</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
  return {
    subject: "Reset your POWR password",
    html,
    text: `Reset your POWR password\n\nWe received a request to reset your POWR password. Set a new one here:\n${url}\n\nThis link expires in 1 hour. If you didn't request this, you can safely ignore this email.\n\n— POWR\nhttps://powr.life`,
  };
}

/** Every preview in send order, with realistic sample data. */
function buildPreviews(): { id: string; email: { subject: string; html: string; text: string } }[] {
  return [
    {
      id: "welcome",
      email: welcomeEmail({
        name: "Jamie Wright",
        referralCode: "JAMIE20",
        locationGranted: true,
        wearableConnected: false,
        pointsEarned: 40,
      }),
    },
    {
      id: "weekly",
      email: weeklySummaryEmail({
        name: "Jamie Wright",
        weekLabel: "7–13 Jul",
        pointsThisWeek: 240,
        pointsLastWeek: 205,
        workouts: 5,
        activeDays: 5,
        currentStreak: 4,
        topActivity: { type: "gym", count: 3 },
        distanceKm: 18.4,
        steps: 52340,
        prevSteps: 47820,
        activities: [
          { type: "gym", count: 3, prevCount: 2 },
          { type: "running", count: 2, prevCount: 1 },
          { type: "cycling", count: 1, prevCount: 2 },
        ],
        referralCode: "JAMIE20",
        longestSession: { type: "running", durationSec: 3840 },
        gyms: [{ name: "ONE LDN", count: 3 }],
        wearable: "Whoop",
        challengesCompleted: 1,
        challengeTitles: ["Back Again"],
        balance: 385,
        closestReward: {
          brand: "Forge Athletics",
          title: "20% off everything",
          cost: 450,
          valueLabel: "20% OFF",
        },
      }),
    },
    {
      id: "invite",
      email: brandInviteEmail({
        brandName: "Forge Athletics",
        setupUrl: "https://powr.life/partner/setup/preview-token-only",
      }),
    },
    {
      id: "partner_welcome",
      email: partnerWelcomeEmail({
        brandName: "Forge Athletics",
        contactName: "Jamie Wright",
      }),
    },
    {
      id: "partner_weekly",
      email: partnerWeeklySummaryEmail({
        brandName: "Forge Athletics",
        weekLabel: "7–13 Jul",
        redemptions: 23,
        prevRedemptions: 17,
        powrSpent: 9660,
        liveRewards: 4,
        topRewards: [
          { title: "20% off everything", count: 12, valueLabel: "20% OFF" },
          { title: "Free shaker with any order", count: 8, valueLabel: "FREE GIFT" },
          { title: "£15 off orders over £60", count: 3, valueLabel: "£15 OFF" },
        ],
        lowStock: [{ title: "Free shaker with any order", remaining: 9 }],
        pendingSubmissions: 1,
      }),
    },
    { id: "recovery", email: recoveryPreview() },
    {
      id: "level_up",
      email: levelUpEmail({
        name: "Jamie Wright",
        level: 6,
        levelName: "Can't Sit Still",
        tierLabel: "Athlete",
        tierColor: "#fb923c",
        totalEarned: 7040,
        vaultBonus: 50,
        levelImageUrl: "https://auth.powr.life/storage/v1/object/public/powr-level-logo/cant-sit-still.png?v=20260711",
        nextLevelName: "Iron Lungs",
        nextLevelAt: 10000,
      }),
    },
  ];
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: { key?: string; only?: string[] };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  if (body.key !== PREVIEW_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

  const only = Array.isArray(body.only) && body.only.length ? new Set(body.only) : null;
  const previews = buildPreviews().filter((p) => !only || only.has(p.id));

  const sent: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const p of previews) {
    try {
      await sendEmail({
        to: RECIPIENT,
        subject: p.email.subject,
        html: p.email.html,
        text: p.email.text,
      });
      sent.push(p.id);
    } catch (err) {
      failed.push({ id: p.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return new Response(JSON.stringify({ to: RECIPIENT, sent, failed }), {
    status: failed.length ? 502 : 200,
    headers: { "Content-Type": "application/json" },
  });
});
