// Sends the value-led welcome email after a user finishes onboarding.
//
// Called by the app (with the user's JWT) once onboarding completes. The
// function gathers everything the email needs server-side — the user's email,
// name, referral code, and which signup-journey actions they completed
// (location, wearable) — so the client never has to assemble it. Idempotent:
// the email is only ever sent once per user (tracked via user metadata).
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../_shared/mailgun.ts";
import { welcomeEmail } from "../_shared/emails/welcome.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401 });
  }

  // Resolve the caller from their JWT. All reads below run as this user, so RLS
  // guarantees we can only ever read the caller's own profile / points.
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  // Allow re-sending only when explicitly forced (e.g. internal preview/test).
  let force = false;
  try {
    const body = await req.json();
    force = body?.force === true;
  } catch {
    // No body is fine — default behaviour.
  }

  if (!force && user.user_metadata?.welcome_email_sent) {
    return new Response(JSON.stringify({ ok: true, skipped: "already_sent" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!user.email) {
    return new Response(JSON.stringify({ error: "User has no email" }), { status: 400 });
  }

  // Gather the personalisation inputs.
  const { data: profile } = await userClient
    .from("profiles")
    .select("display_name, referral_code, location_granted, health_provider_connections")
    .eq("id", user.id)
    .single();

  const { data: bonuses } = await userClient
    .from("point_transactions")
    .select("amount")
    .eq("user_id", user.id)
    .eq("type", "bonus");

  const pointsEarned = (bonuses ?? []).reduce((sum, t) => sum + (t.amount ?? 0), 0);
  const connections = (profile?.health_provider_connections ?? {}) as Record<string, unknown>;
  const wearableConnected = Object.keys(connections).length > 0;

  const name =
    profile?.display_name ??
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    null;

  const email = welcomeEmail({
    name,
    referralCode: profile?.referral_code ?? null,
    locationGranted: profile?.location_granted ?? false,
    wearableConnected,
    pointsEarned: pointsEarned > 0 ? pointsEarned : null,
  });

  try {
    await sendEmail({
      to: user.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  } catch (err) {
    console.error("send-welcome-email: failed to send:", err);
    return new Response(JSON.stringify({ error: "Failed to send email" }), { status: 500 });
  }

  // Mark as sent so we never double-send on a retry of onboarding completion.
  await userClient.auth.updateUser({ data: { welcome_email_sent: true } });

  return new Response(JSON.stringify({ ok: true, sent_to: user.email }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
