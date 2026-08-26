// Creator programme request → Slack ping for admins.
//
// Invoked by trg_notify_creator_invite_request (pg_net) with x-webhook-secret
// from Vault (db_webhook_secret) — the same access model as notify-new-user,
// and the same Slack channel, so the people watching signups see requests
// too. Deployed verify_jwt=false; the header check IS the access control.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SLACK_URL = Deno.env.get("SLACK_NEW_USERS_WEBHOOK_URL") ?? "";
const SECRET = Deno.env.get("DB_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { type, record } = await req.json();
  if (type !== "INSERT" || !record?.user_id) {
    return new Response("skipped", { status: 200 });
  }
  if (!SLACK_URL) {
    console.warn("[notify-creator-request] SLACK_NEW_USERS_WEBHOOK_URL not set");
    return new Response("no slack configured", { status: 200 });
  }

  // Who is it — best-effort, the ping still goes out without a name.
  let name = "A member";
  let email = "";
  let memberId = "";
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${record.user_id}&select=display_name,username,referral_code`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    if (r.ok) {
      const rows = await r.json();
      const p = rows?.[0];
      if (p) {
        name = p.display_name || (p.username ? `@${p.username}` : name);
        memberId = p.referral_code ?? "";
      }
    }
  } catch (_e) { /* non-fatal */ }
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${record.user_id}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (r.ok) email = (await r.json())?.email ?? "";
  } catch (_e) { /* non-fatal */ }

  const detail: string[] = [];
  if (email) detail.push(email);
  if (memberId) detail.push(`POWR ID ${memberId}`);
  detail.push(`${record.converted_count ?? 0} converted referrals (bar: ${record.threshold ?? "?"})`);
  detail.push("<https://powr.life/admin/creators/requests|Review in admin>");

  const body = {
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `:sparkles: *Affiliate programme request* — *${name}* wants in` } },
      { type: "context", elements: [{ type: "mrkdwn", text: detail.join(" · ") }] },
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
