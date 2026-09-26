// Email to a gym's team, three kinds, one function:
//   weekly_recap  — Monday: what members did at the gym last week. Cron
//                   gym-weekly-recap-email, 10:00 UTC, after the member weekly
//                   and the brand digest so it never competes for the Mailgun
//                   window. Skipped for gyms with nothing to say (no sessions
//                   for two weeks and no event in flight).
//   results_ready — the board sealed and POWR froze the results: reveal them
//                   from your phone. Trigger live_events_gym_mail at settle;
//                   the function re-reads the event after commit and only
//                   sends while it is still sealed, so a gym's own reveal
//                   (which cuts the results then reveals in one transaction)
//                   never produces it.
//   review_result — POWR approved / asked for a change / pulled the event.
//                   Same trigger, on review_status.
// Recipients are the gym's team (gym_staff → auth.users); the weekly goes to
// those who keep the switch on (Settings, then Email). Never members.
//
// Security: verify_jwt=false (pg_net and pg_cron are not users); access is
// gated by x-resolve-token, validated via verify_resolve_token against
// Vault, like the other cron mail.
//
// Operational body params (all optional):
//   { kind, dry_run, only_email, deliver_to, week_start, limit, sample, decision, event_id }
//   - deliver_to redirects delivery and is honoured only alongside only_email,
//     so a full run can never be re-routed to a single inbox by accident.
//   - sample renders representative data to only_email (still token-gated);
//     decision picks the review_result sample: approved | rejected | pulled.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/mailgun.ts";
import {
  gymWeeklyRecapEmail,
  weekLabel,
  type GymRecapEvent,
  type GymWeeklyRecapData,
} from "../_shared/emails/gym-weekly-recap.ts";
import { gymEventEmail, type GymEventMailData, type GymEventMailKind } from "../_shared/emails/gym-event-mail.ts";

const REPLY_TO = "support@powr.life";
const CONCURRENCY = 5;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

interface Totals { sessions: number; athletes: number; minutes: number; points: number }

interface RecapRow {
  partner_id: string;
  name: string;
  tz: string;
  week_start: string;
  week_end: string;
  recipients: string[];
  features: Record<string, boolean> | null;
  this: Totals;
  last: Totals;
  new_faces: number;
  members: number;
  top: { name: string; points: number; sessions: number }[] | null;
  busiest: { dow: number; sessions: number } | null;
  quiet: number | null;
  events: GymRecapEvent[] | null;
  quiet_week: boolean;
}

interface EventMailRow {
  event: {
    id: string; name: string; status: string; review_status: string | null; review_note: string | null;
    managed_by: string; participants: number; window_start_at: string; window_end_at: string;
    doors_open_at: string | null; auto_reveal_at: string | null; results_cut_at: string | null;
  };
  gym: { id: string; name: string; tz: string; trusted: boolean };
  recipients: string[];
  top: { rank: number; name: string; points: number; prize: string | null }[] | null;
}

interface SendResult { to: string; gym?: string; ok: boolean; error?: string }

function recapData(row: RecapRow): GymWeeklyRecapData {
  return {
    gymName: row.name,
    weekLabel: weekLabel(row.week_start, row.week_end, row.tz),
    tz: row.tz,
    sessions: row.this?.sessions ?? 0,
    prevSessions: row.last?.sessions ?? 0,
    athletes: row.this?.athletes ?? 0,
    prevAthletes: row.last?.athletes ?? 0,
    minutes: row.this?.minutes ?? 0,
    newFaces: row.new_faces ?? 0,
    members: row.members ?? 0,
    top: row.top ?? [],
    busiest: row.busiest ? { day: DAYS[(row.busiest.dow - 1 + 7) % 7], sessions: row.busiest.sessions } : null,
    quiet: row.quiet,
    quietNamed: row.features?.people === true,
    events: row.events ?? [],
  };
}

function eventData(row: EventMailRow, kind: GymEventMailKind): GymEventMailData {
  return {
    kind,
    gymName: row.gym.name,
    tz: row.gym.tz,
    event: {
      id: row.event.id,
      name: row.event.name,
      participants: row.event.participants ?? 0,
      window_start_at: row.event.window_start_at,
      window_end_at: row.event.window_end_at,
      doors_open_at: row.event.doors_open_at,
      auto_reveal_at: row.event.auto_reveal_at,
      review_note: row.event.review_note,
    },
    top: row.top ?? [],
    trusted: row.gym.trusted,
  };
}

/** Representative data for design QA (send to one address via `sample: true`). */
function sampleRecap(): GymWeeklyRecapData {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const monday = new Date(now); monday.setUTCHours(0, 0, 0, 0); monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const start = new Date(monday.getTime() - 7 * day).toISOString();
  return {
    gymName: "POWR Gym Leamington",
    weekLabel: weekLabel(start, monday.toISOString(), "Europe/London"),
    tz: "Europe/London",
    sessions: 84, prevSessions: 71, athletes: 31, prevAthletes: 28, minutes: 4620,
    newFaces: 3, members: 41,
    top: [{ name: "Aisha K", points: 240, sessions: 7 }, { name: "Tom Reid", points: 223, sessions: 6 }, { name: "Maya Chen", points: 206, sessions: 6 }],
    busiest: { day: "Tuesday", sessions: 21 },
    quiet: 4, quietNamed: true,
    events: [
      { id: "sample-live", name: "October Challenge", status: "live", participants: 23, window_start_at: new Date(now - 6 * day).toISOString(), window_end_at: new Date(now + 22 * day).toISOString() },
      { id: "sample-next", name: "Points Week", status: "scheduled", participants: 9, window_start_at: new Date(now + 10 * day).toISOString(), window_end_at: new Date(now + 17 * day).toISOString() },
    ],
  };
}

function sampleEvent(kind: GymEventMailKind): GymEventMailData {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  return {
    kind,
    gymName: "POWR Gym Leamington",
    tz: "Europe/London",
    event: {
      id: "sample-event",
      name: "October Challenge",
      participants: 23,
      window_start_at: new Date(now + (kind === "results_ready" ? -28 : 5) * day).toISOString(),
      window_end_at: new Date(now + (kind === "results_ready" ? 0 : 33) * day).toISOString(),
      auto_reveal_at: kind === "results_ready" ? new Date(now + 3 * day).toISOString() : null,
      review_note: kind === "rejected" ? "The first prize says 'free membership' but the rules say a month. Make them match and send it again." : kind === "pulled" ? "Two members told us the prize photo isn't yours to use." : null,
    },
    top: [
      { rank: 1, name: "Aisha K", points: 410, prize: "Free month" },
      { rank: 2, name: "Tom Reid", points: 379, prize: "PT session" },
      { rank: 3, name: "Maya Chen", points: 348, prize: "POWR hoodie" },
    ],
    trusted: true,
  };
}

async function deliver(
  tos: string[], rendered: { subject: string; html: string; text: string }, tag: string,
  dryRun: boolean, results: SendResult[], gym?: string,
): Promise<number> {
  let sent = 0;
  for (let i = 0; i < tos.length; i += CONCURRENCY) {
    await Promise.all(tos.slice(i, i + CONCURRENCY).map(async (to) => {
      try {
        if (!dryRun) await sendEmail({ to, subject: rendered.subject, html: rendered.html, text: rendered.text, replyTo: REPLY_TO, tag });
        results.push({ to, gym, ok: true });
        sent++;
      } catch (err) {
        console.error(`[send-gym-email] ${tag} to ${to}${gym ? ` (${gym})` : ""} failed:`, err);
        results.push({ to, gym, ok: false, error: String(err) });
      }
    }));
  }
  return sent;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

  const token = req.headers.get("x-resolve-token") ?? "";
  let authed = false;
  if (token) {
    const { data: valid } = await admin.rpc("verify_resolve_token", { p_token: token });
    authed = valid === true;
  }
  if (!authed) return new Response("forbidden", { status: 403 });

  const kind = typeof body?.kind === "string" ? (body.kind as string) : "weekly_recap";
  const dryRun = body?.dry_run === true;
  const sample = body?.sample === true;
  const onlyEmail = typeof body?.only_email === "string" ? (body.only_email as string).toLowerCase() : null;
  const deliverTo = onlyEmail && typeof body?.deliver_to === "string" ? (body.deliver_to as string) : null;
  const limit = Number.isInteger(body?.limit) ? (body.limit as number) : null;
  const weekStart = typeof body?.week_start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.week_start as string) ? (body.week_start as string) : null;
  const eventId = typeof body?.event_id === "string" ? (body.event_id as string) : null;

  // ── Samples: one representative email to one address ──────────────────
  if (sample) {
    if (!onlyEmail) return json({ error: "only_email required for sample" }, 400);
    let rendered: { subject: string; html: string; text: string };
    let tag: string;
    if (kind === "weekly_recap") {
      rendered = gymWeeklyRecapEmail(sampleRecap());
      tag = "gym-weekly-recap";
    } else if (kind === "results_ready") {
      rendered = gymEventEmail(sampleEvent("results_ready"));
      tag = "gym-results-ready";
    } else if (kind === "review_result") {
      const decision = ["approved", "rejected", "pulled"].includes(String(body?.decision)) ? (body.decision as GymEventMailKind) : "approved";
      rendered = gymEventEmail(sampleEvent(decision));
      tag = "gym-review-result";
    } else {
      return json({ error: "unknown_kind" }, 400);
    }
    if (!dryRun) await sendEmail({ to: onlyEmail, subject: rendered.subject, html: rendered.html, text: rendered.text, replyTo: REPLY_TO, tag });
    return json({ sent: dryRun ? 0 : 1, dry_run: dryRun, mode: "sample", kind, to: onlyEmail, subject: rendered.subject });
  }

  // ── Monday: every gym's week ──────────────────────────────────────────
  if (kind === "weekly_recap") {
    const { data, error } = await admin.rpc("get_gym_weekly_recaps", { p_week_start: weekStart }) as { data: RecapRow[] | null; error: unknown };
    if (error) {
      console.error("get_gym_weekly_recaps error:", error);
      return json({ error: "rpc_failed", detail: String(error) }, 500);
    }
    let rows = data ?? [];
    if (onlyEmail) rows = rows.filter((r) => (r.recipients ?? []).map((e) => e.toLowerCase()).includes(onlyEmail));
    if (limit !== null) rows = rows.slice(0, limit);

    const results: SendResult[] = [];
    const skipped: { gym: string; why: string }[] = [];
    let sent = 0;
    for (const row of rows) {
      const tos = (row.recipients ?? []).map((e) => e.toLowerCase()).filter((e) => !onlyEmail || e === onlyEmail);
      if (row.quiet_week) { skipped.push({ gym: row.name, why: "quiet_week" }); continue; }
      if (tos.length === 0) { skipped.push({ gym: row.name, why: "no_recipients" }); continue; }
      const rendered = gymWeeklyRecapEmail(recapData(row));
      sent += await deliver(tos.map((to) => deliverTo ?? to), rendered, "gym-weekly-recap", dryRun, results, row.name);
    }
    const week = rows[0] ? weekLabel(rows[0].week_start, rows[0].week_end, rows[0].tz) : null;
    return json({ kind, week, gyms: rows.length, sent, dry_run: dryRun, skipped, results });
  }

  // ── One event: results ready, or POWR's decision ──────────────────────
  if (kind === "results_ready" || kind === "review_result") {
    if (!eventId) return json({ error: "event_id required" }, 400);
    const { data, error } = await admin.rpc("get_gym_event_mail", { p_event_id: eventId }) as { data: EventMailRow | null; error: unknown };
    if (error) {
      console.error("get_gym_event_mail error:", error);
      return json({ error: "rpc_failed", detail: String(error) }, 500);
    }
    if (!data?.event) return json({ kind, event_id: eventId, skipped: "not_found" }, 404);
    if (data.event.managed_by !== "gym") return json({ kind, event_id: eventId, skipped: "not_gym_run" });

    let mailKind: GymEventMailKind;
    let tag: string;
    if (kind === "results_ready") {
      // Sent only while the board is still sealed. A reveal cuts the results
      // and reveals in one transaction, so by the time this runs the event
      // has moved on and there is nothing to ask the gym to do.
      if (data.event.status !== "locked") return json({ kind, event_id: eventId, skipped: `status_${data.event.status}` });
      mailKind = "results_ready";
      tag = "gym-results-ready";
    } else {
      const rs = data.event.review_status;
      if (rs !== "approved" && rs !== "rejected" && rs !== "pulled") return json({ kind, event_id: eventId, skipped: `review_${rs ?? "none"}` });
      mailKind = rs;
      tag = "gym-review-result";
    }

    const tos = (data.recipients ?? []).map((e) => e.toLowerCase()).filter((e) => !onlyEmail || e === onlyEmail);
    if (tos.length === 0) return json({ kind, event_id: eventId, skipped: "no_recipients" });
    const rendered = gymEventEmail(eventData(data, mailKind));
    const results: SendResult[] = [];
    const sent = await deliver(tos.map((to) => deliverTo ?? to), rendered, tag, dryRun, results, data.gym.name);
    return json({ kind, mail: mailKind, event_id: eventId, event: data.event.name, gym: data.gym.name, sent, dry_run: dryRun, subject: rendered.subject, results });
  }

  return json({ error: "unknown_kind" }, 400);
});
