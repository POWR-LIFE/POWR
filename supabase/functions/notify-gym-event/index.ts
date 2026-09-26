// Gym-run event → Slack line for POWR.
//
// Invoked by _gym_event_notify() (pg_net) with x-webhook-secret from Vault
// (db_webhook_secret) — the same access model and Slack channel as
// notify-creator-request. Deployed verify_jwt=false; the header check IS the
// access control. pg_net sends after commit, so a rolled-back action never
// pings.
//
// kinds: submitted (a gym's first events wait for review), published (a
// trusted gym went straight out), cancelled, disqualified — and one per gym,
// not per event: package_request (an owner asked to switch package, via
// _gym_notify; POWR sets it in /admin/gyms and invoices).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SLACK_URL = Deno.env.get("SLACK_NEW_USERS_WEBHOOK_URL") ?? "";
const SECRET = Deno.env.get("DB_WEBHOOK_SECRET")!;

const fmtDay = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London",
  });
};

const PACKAGE_LABEL: Record<string, string> = {
  clash: "Clash (free)", clash_plus: "Clash+", pro: "Clash Pro", founding: "Founding Pro",
};

// Slack mrkdwn treats <, > and & as control characters.
const clean = (s: unknown) => String(s ?? "").replace(/[<>&]/g, "").slice(0, 200);

serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!SLACK_URL) {
    console.warn("[notify-gym-event] SLACK_NEW_USERS_WEBHOOK_URL not set");
    return new Response("no slack configured", { status: 200 });
  }

  const { kind, event, gym, actor, detail } = await req.json();
  const gymName = clean(gym?.name) || "A gym";
  const eventName = clean(event?.name) || "an event";
  const who = actor ? ` (${clean(actor)})` : "";
  const starts = fmtDay(event?.window_start_at);

  let text: string;
  const context: string[] = [];
  switch (kind) {
    case "submitted":
      text = `:calendar: *${gymName}* wants to run *${eventName}*${starts ? ` from ${starts}` : ""} — needs your OK`;
      context.push("<https://powr.life/admin/gyms|Review in Gym Portals>");
      break;
    case "published":
      text = `:white_check_mark: *${gymName}* published *${eventName}*${starts ? ` — starts ${starts}` : ""}`;
      context.push("Trusted gym, no review needed", "<https://powr.life/admin/events|Live Events>");
      break;
    case "cancelled":
      text = `:x: *${gymName}* cancelled *${eventName}*${who}`;
      if (detail?.registrants) context.push(`${Number(detail.registrants)} had registered`);
      break;
    case "disqualified":
      text = `:no_entry: *${gymName}* removed someone from *${eventName}*${who}`;
      if (detail?.reason) context.push(`Reason: ${clean(detail.reason)}`);
      context.push("<https://powr.life/admin/audit|Audit log>");
      break;
    case "package_request": {
      const want = PACKAGE_LABEL[detail?.package] ?? clean(detail?.package);
      const now = PACKAGE_LABEL[detail?.current] ?? clean(detail?.current);
      const trial = fmtDay(detail?.trial_ends_at);
      text = `:package: *${gymName}* would like *${want}*${who}`;
      context.push(`Now on ${now}${trial && new Date(detail.trial_ends_at) > new Date() ? ` · free trial until ${trial}` : ""}`);
      context.push("<https://powr.life/admin/gyms|Set it in Gym Portals>");
      break;
    }
    default:
      return new Response("skipped", { status: 200 });
  }

  const body = {
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      ...(context.length ? [{ type: "context", elements: [{ type: "mrkdwn", text: context.join(" · ") }] }] : []),
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
