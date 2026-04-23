import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { sendEmail } from "../_shared/mailgun.ts";
import {
  waitlistUserEmail,
  waitlistPartnerEmail,
  welcomeEmail,
  rewardNotificationEmail,
  type WaitlistUserData,
  type WaitlistPartnerData,
  type WelcomeData,
  type RewardNotificationData,
} from "../_shared/email-templates.ts";

const SEND_EMAIL_SECRET = Deno.env.get("SEND_EMAIL_SECRET");

type EmailPayload =
  | { type: "waitlist_user"; to: string; data: WaitlistUserData }
  | { type: "waitlist_partner"; to: string; data: WaitlistPartnerData }
  | { type: "welcome"; to: string; data: WelcomeData }
  | { type: "reward"; to: string; data: RewardNotificationData };

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Verify secret token
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
