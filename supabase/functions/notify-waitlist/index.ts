// Waitlist signup → Slack ping only.
//
// Invoked by the `notify-slack-on-waitlist` trigger on public.waitlist inserts
// (see 20260727120001_webhook_triggers_drop_leaked_service_role.sql). The
// confirmation emails this used to send were retired 2026-07-17 with the
// email-set overhaul — the app is live, so the waitlist flow no longer emails;
// the Slack heads-up stays.
//
// Caller authorization: this function used to have NONE — it ran verify_jwt=true
// and the platform JWT gate was the whole of its access control, satisfied by a
// service_role bearer baked into the trigger definition. That bearer was the
// service_role JWT leaked to the public repo (GitGuardian 33021769), so the gate
// moves in-code and the trigger moves to the shared x-resolve-token (Vault).
// Both credentials are accepted: the resolve token is what the trigger sends
// now, and the service-role bearer is kept because it is read from the
// environment (never a literal) and rotates with the platform key.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WAITLIST_WEBHOOK_URL");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let authorized = bearer !== "" && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorized) {
    const { data: valid } = await admin.rpc("verify_resolve_token", {
      p_token: req.headers.get("x-resolve-token") ?? "",
    });
    authorized = valid === true;
  }
  if (!authorized) return new Response("forbidden", { status: 403 });

  try {
    const payload = await req.json();
    const record = payload.record;

    if (!record) {
      return new Response("No record in payload", { status: 400 });
    }

    const { name, email, typ, website, created_at } = record;

    const isPartner = typ === "partner";
    const emoji = isPartner ? "🤝" : "🏋️";
    const label = isPartner ? "Partner" : "User";

    const lines = [
      `${emoji} *New ${label} on the waitlist!*`,
      name  ? `• *Name:* ${name}`    : null,
      `• *Email:* ${email}`,
      website ? `• *Website:* ${website}` : null,
      `• *Joined:* <!date^${Math.floor(new Date(created_at).getTime() / 1000)}^{date_short_pretty} at {time}|${created_at}>`,
    ].filter(Boolean).join("\n");

    if (!SLACK_WEBHOOK_URL) {
      console.error("SLACK_WAITLIST_WEBHOOK_URL is not set");
      return new Response("Slack webhook URL not configured", { status: 500 });
    }

    const slackRes = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: lines }),
    });

    if (!slackRes.ok) {
      const err = await slackRes.text();
      console.error("Slack error:", err);
      return new Response("Failed to notify Slack", { status: 500 });
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response("Internal error", { status: 500 });
  }
});
