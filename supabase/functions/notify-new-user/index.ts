// New signup → Slack ping.
//
// ⚠ CAPTURED FROM PRODUCTION, NOT NEWLY AUTHORED. This function was created in
// the dashboard and had no source in this repo until 2026-07-27; the body below
// is the deployed v12 verbatim (pulled via the management API), so that the
// `new-users` trigger — which 20260727120001 moves into a migration — has an
// auditable counterpart here. Do not treat this as reviewed new code: it is a
// record of what is already running. The only additions are these comments.
//
// Invoked by the `new-users` trigger on public.profiles inserts, which sends
// x-webhook-secret from Vault (db_webhook_secret). That header is the whole of
// the access control — the function runs verify_jwt=false, which is why the
// service_role bearer the trigger used to also carry was decorative, and why
// removing it (GitGuardian 33021769) changed nothing here.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SLACK_URL = Deno.env.get("SLACK_NEW_USERS_WEBHOOK_URL")!;
const SECRET = Deno.env.get("DB_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { type, record } = await req.json();

  // Fire only when a new profile row is created (i.e. a new signup).
  if (type !== "INSERT") {
    return new Response("skipped", { status: 200 });
  }

  // The profiles row carries no email, so look it up from auth (best-effort).
  let email = "";
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${record.id}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (r.ok) {
      const u = await r.json();
      email = u?.email ?? "";
    }
  } catch (_e) {
    // non-fatal: still post the alert without the email
  }

  const name = record.display_name || email || "New user";
  const ts = Math.floor(new Date(record.created_at ?? Date.now()).getTime() / 1000);

  const detail = [];
  if (email) detail.push(email);
  detail.push(`<!date^${ts}^{date_short_pretty} {time}|just now>`);

  const body = {
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `:wave: *New POWR signup* — *${name}*` },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: detail.join(" · ") }],
      },
    ],
  };

  const res = await fetch(SLACK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return res.ok
    ? new Response("ok", { status: 200 })
    : new Response(`Slack error: ${await res.text()}`, { status: 502 });
});
