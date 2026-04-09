import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WAITLIST_WEBHOOK_URL");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

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
