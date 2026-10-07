// Email to a gym's team, one function:
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
//   drift_digest  — mornings: who started drifting since yesterday (Retention,
//                   get_gym_drift_digests). Cron gym-drift-digest-email. Only
//                   gyms with someone new; Clash Pro names them, Clash+ gets
//                   the count (and nothing under 5 people). A real run (no
//                   dry_run, only_email or limit) also opens and closes the
//                   drift episodes, so the same person is never sent twice.
//   welcome          someone joined the team. Trigger gym_staff_welcome_mail.
//   package_changed  POWR set the package in /admin/gyms. Owners only.
//                    Trigger gym_portal_settings_package_mail.
//   support_reply    POWR answered a question the team sent from Settings,
//                    then Help. To whoever wrote it. Trigger
//                    support_tickets_gym_reply_mail.
//   clash_night      POWR confirmed, declined or called off a Clash Night.
//                    Owners + whoever asked. Trigger
//                    gym_clash_nights_decision_mail.
//   lifecycle        daily (cron gym-lifecycle-email, 09:45 UTC): invite
//                    links unused after 5 days get a second link; owners
//                    hear 14 and 3 days before the free trial ends, and once
//                    it has (only when the package loses something).
//                    gym_email_log keeps each one to once.
// The Monday recap also says who has come back since POWR told the gym's
// members it is on POWR (get_gym_notice_returns), for 12 weeks after.
// Recipients are the gym's team (gym_staff → auth.users); the weekly and the
// drift email go to those who keep each switch on (Settings, then Email).
// Nothing goes to a gym whose portal is off, except the answer to a question
// it asked while it was on. Never members.
//
// Security: verify_jwt=false (pg_net and pg_cron are not users); access is
// gated by x-resolve-token, validated via verify_resolve_token against
// Vault, like the other cron mail.
//
// Operational body params (all optional):
//   { kind, dry_run, only_email, deliver_to, week_start, limit, sample, decision, event_id,
//     partner_id, user_id, from, to, ticket_id, updated, night_id, was, role, stage }
//   - deliver_to redirects delivery and is honoured only alongside only_email,
//     so a full run can never be re-routed to a single inbox by accident.
//   - sample renders representative data to only_email (still token-gated);
//     decision picks the review_result sample: approved | rejected | pulled,
//     or the clash_night one: confirmed | declined | called_off; role picks
//     welcome's (owner | staff); stage picks trial_ending's (14 | 3); from/to
//     pick package_changed's.
//   - lifecycle with only_email runs for that address only, for real: an
//     invite reminder is a real link, so it never goes to deliver_to.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/mailgun.ts";
import {
  gymWeeklyRecapEmail,
  weekLabel,
  type GymNoticeReturns,
  type GymRecapEvent,
  type GymWeeklyRecapData,
} from "../_shared/emails/gym-weekly-recap.ts";
import {
  gymInviteReminderEmail,
  gymPackageEmail,
  gymTrialEmail,
  gymWelcomeEmail,
} from "../_shared/emails/gym-account-mail.ts";
import { gymClashNightEmail, gymSupportReplyEmail } from "../_shared/emails/gym-reply-mail.ts";
import {
  sampleClashNight,
  sampleInviteReminder,
  sampleNotice,
  samplePackage,
  sampleSupportReply,
  sampleTrial,
  sampleWelcome,
} from "../_shared/emails/gym-mail.samples.ts";
import { gymEventEmail, type GymEventMailData, type GymEventMailKind } from "../_shared/emails/gym-event-mail.ts";
import { gymDriftDigestEmail, type GymDriftDigestData, type GymDriftPerson } from "../_shared/emails/gym-drift-digest.ts";

const REPLY_TO = "support@powr.life";
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://powr.life";
const PACKAGES = ["clash", "clash_plus", "pro", "founding"];
// How long after the members' notice the Monday recap keeps counting returns.
const NOTICE_WEEKS = 12;
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

interface DriftRow {
  partner_id: string;
  name: string;
  tz: string;
  named: boolean;
  too_few: boolean;
  counts: { drifting?: number; slipping?: number } | null;
  new_count: number;
  new: GymDriftPerson[] | null;
  recipients: string[];
}

interface SendResult { to: string; gym?: string; ok: boolean; error?: string }

interface TeamMember { user_id: string; role: "owner" | "staff"; email: string; name: string | null }

interface MailContext {
  gym: { id: string; name: string; logo_url: string | null; logo_bg: string | null; tz: string };
  live: boolean;
  package: string | null;
  billing: string | null;
  trial_ends_at: string | null;
  on_trial: boolean;
  member_notice_at: string | null;
  member_notice_count: number | null;
  team: TeamMember[];
}

interface TrialDue {
  partner_id: string; gym: string; tz: string;
  kind: "trial_ending" | "trial_ended"; ref: string;
  package: string; trial_ends_at: string; days_left: number; lost: string[]; owners: string[];
}

interface InviteDue {
  invite_id: string; partner_id: string; gym: string; tz: string; logo_url: string | null;
  role: "owner" | "staff"; email: string; created_at: string; expires_at: string;
}

interface NoticeRow {
  sent_at: string; told: number; away: number; unseen: number;
  back: number; unseen_back: number; back_in: number; unseen_back_in: number;
}

function noticeData(row: NoticeRow | null, weekEnd: string): GymNoticeReturns | null {
  if (!row?.sent_at || !(row.told > 0)) return null;
  const sent = new Date(row.sent_at).getTime();
  const end = new Date(weekEnd).getTime();
  if (!(sent < end) || end - sent > NOTICE_WEEKS * 7 * 24 * 60 * 60 * 1000) return null;
  return {
    sentAt: row.sent_at, told: row.told, away: row.away, unseen: row.unseen,
    back: row.back, unseenBack: row.unseen_back, backIn: row.back_in, unseenBackIn: row.unseen_back_in,
  };
}

const owners = (ctx: MailContext) => ctx.team.filter((t) => t.role === "owner").map((t) => t.email);

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Same shape as manage-gym-staff's setup tokens.
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function recapData(row: RecapRow, notice: GymNoticeReturns | null = null): GymWeeklyRecapData {
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
    notice,
  };
}

function driftData(row: DriftRow): GymDriftDigestData {
  return {
    gymName: row.name,
    named: row.named,
    newCount: row.new_count ?? 0,
    people: row.new ?? [],
    drifting: row.counts?.drifting ?? 0,
    slipping: row.counts?.slipping ?? 0,
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
    notice: sampleNotice(now),
    events: [
      { id: "sample-live", name: "October Challenge", status: "live", participants: 23, window_start_at: new Date(now - 6 * day).toISOString(), window_end_at: new Date(now + 22 * day).toISOString() },
      { id: "sample-next", name: "Points Week", status: "scheduled", participants: 9, window_start_at: new Date(now + 10 * day).toISOString(), window_end_at: new Date(now + 17 * day).toISOString() },
    ],
  };
}

function sampleDrift(): GymDriftDigestData {
  return {
    gymName: "POWR Gym Leamington",
    named: true,
    newCount: 3,
    people: [
      { name: "Callum R.", gap_days: 12, per_week: 3.1, part: "morning", dows: [1, 3, 5] },
      { name: "Theo B.", gap_days: 15, per_week: 2.8, part: "morning", dows: null },
      { name: "Esme W.", gap_days: 11, per_week: 2.0, part: null, dows: [2, 6] },
    ],
    drifting: 4,
    slipping: 2,
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
  const str = (k: string) => (typeof body?.[k] === "string" ? (body[k] as string) : null);

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
    } else if (kind === "drift_digest") {
      rendered = gymDriftDigestEmail(sampleDrift());
      tag = "gym-drift-digest";
    } else if (kind === "review_result") {
      const decision = ["approved", "rejected", "pulled"].includes(String(body?.decision)) ? (body.decision as GymEventMailKind) : "approved";
      rendered = gymEventEmail(sampleEvent(decision));
      tag = "gym-review-result";
    } else if (kind === "welcome") {
      rendered = gymWelcomeEmail(sampleWelcome(str("role") === "staff" ? "staff" : "owner"));
      tag = "gym-welcome";
    } else if (kind === "invite_reminder") {
      rendered = gymInviteReminderEmail(sampleInviteReminder(SITE_URL));
      tag = "gym-invite-reminder";
    } else if (kind === "trial_ending") {
      rendered = gymTrialEmail(sampleTrial("trial_ending", Number(body?.stage) === 3 ? 3 : 14));
      tag = "gym-trial";
    } else if (kind === "trial_ended") {
      rendered = gymTrialEmail(sampleTrial("trial_ended"));
      tag = "gym-trial";
    } else if (kind === "package_changed") {
      const from = PACKAGES.includes(str("from") ?? "") ? str("from")! : "clash";
      const to = PACKAGES.includes(str("to") ?? "") ? str("to")! : "clash_plus";
      rendered = gymPackageEmail(samplePackage(from, to));
      tag = "gym-package";
    } else if (kind === "support_reply") {
      rendered = gymSupportReplyEmail(sampleSupportReply(body?.updated === true));
      tag = "gym-support-reply";
    } else if (kind === "clash_night") {
      const d = str("decision");
      rendered = gymClashNightEmail(sampleClashNight(d === "declined" || d === "called_off" ? d : "confirmed"));
      tag = "gym-clash-night";
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
      // Who has been back since POWR told the gym's people it is on POWR.
      // A failure here only drops that section, never the recap.
      const { data: nr, error: nrErr } = await admin.rpc("get_gym_notice_returns", {
        p_partner_id: row.partner_id, p_from: row.week_start, p_to: row.week_end,
      }) as { data: NoticeRow | null; error: unknown };
      if (nrErr) console.error(`get_gym_notice_returns (${row.name}) error:`, nrErr);
      const rendered = gymWeeklyRecapEmail(recapData(row, nrErr ? null : noticeData(nr, row.week_end)));
      sent += await deliver(tos.map((to) => deliverTo ?? to), rendered, "gym-weekly-recap", dryRun, results, row.name);
    }
    const week = rows[0] ? weekLabel(rows[0].week_start, rows[0].week_end, rows[0].tz) : null;
    return json({ kind, week, gyms: rows.length, sent, dry_run: dryRun, skipped, results });
  }

  // ── Mornings: who started drifting since yesterday ────────────────────
  if (kind === "drift_digest") {
    // Only a full, real run moves the episodes on; a test to one inbox, a
    // dry run or a limited run only looks.
    const commit = !dryRun && !onlyEmail && limit === null;
    const { data, error } = await admin.rpc("get_gym_drift_digests", { p_commit: commit }) as { data: DriftRow[] | null; error: unknown };
    if (error) {
      console.error("get_gym_drift_digests error:", error);
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
      if (!row.new_count) { skipped.push({ gym: row.name, why: "nobody_new" }); continue; }
      if (row.too_few) { skipped.push({ gym: row.name, why: "too_few" }); continue; }
      if (tos.length === 0) { skipped.push({ gym: row.name, why: "no_recipients" }); continue; }
      const rendered = gymDriftDigestEmail(driftData(row));
      sent += await deliver(tos.map((to) => deliverTo ?? to), rendered, "gym-drift-digest", dryRun, results, row.name);
    }
    return json({ kind, committed: commit, gyms: rows.length, sent, dry_run: dryRun, skipped, results });
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

  const context = async (partnerId: string | null): Promise<MailContext | null> => {
    if (!partnerId) return null;
    const { data, error } = await admin.rpc("get_gym_mail_context", { p_partner_id: partnerId }) as { data: MailContext | null; error: unknown };
    if (error) throw new Error(`get_gym_mail_context: ${String((error as { message?: string })?.message ?? error)}`);
    return data?.gym ? data : null;
  };
  const only = (emails: string[]) => [...new Set(emails.map((e) => e.toLowerCase()))].filter((e) => !onlyEmail || e === onlyEmail);
  const one = async (tos: string[], rendered: { subject: string; html: string; text: string }, tag: string, gym: string, extra: Record<string, unknown> = {}) => {
    if (tos.length === 0) return json({ kind, ...extra, gym, skipped: "no_recipients" });
    const results: SendResult[] = [];
    const sent = await deliver(tos.map((to) => deliverTo ?? to), rendered, tag, dryRun, results, gym);
    return json({ kind, ...extra, gym, sent, dry_run: dryRun, subject: rendered.subject, results });
  };

  try {
    // ── Someone joined the team ──────────────────────────────────────────
    if (kind === "welcome") {
      const ctx = await context(str("partner_id"));
      if (!ctx) return json({ kind, skipped: "not_found" }, 404);
      if (!ctx.live) return json({ kind, gym: ctx.gym.name, skipped: "portal_off" });
      const who = ctx.team.find((t) => t.user_id === str("user_id"));
      if (!who) return json({ kind, gym: ctx.gym.name, skipped: "not_on_team" });
      // Portals switched on before the notice existed have a time but no count.
      const notice = !ctx.member_notice_at
        ? { sentAt: null, count: null }
        : ctx.member_notice_count != null ? { sentAt: ctx.member_notice_at, count: ctx.member_notice_count } : null;
      const rendered = gymWelcomeEmail({
        gymName: ctx.gym.name, role: who.role, tz: ctx.gym.tz,
        trialEndsAt: ctx.on_trial ? ctx.trial_ends_at : null, notice,
      });
      return await one(only([who.email]), rendered, "gym-welcome", ctx.gym.name, { role: who.role });
    }

    // ── POWR set the package (owners) ────────────────────────────────────
    if (kind === "package_changed") {
      const from = str("from");
      const to = str("to");
      if (!from || !to || !PACKAGES.includes(from) || !PACKAGES.includes(to) || from === to) {
        return json({ kind, skipped: "no_change" });
      }
      const ctx = await context(str("partner_id"));
      if (!ctx) return json({ kind, skipped: "not_found" }, 404);
      if (!ctx.live) return json({ kind, gym: ctx.gym.name, skipped: "portal_off" });
      const rendered = gymPackageEmail({
        gymName: ctx.gym.name, tz: ctx.gym.tz, from, to, billing: ctx.billing,
        onTrial: ctx.on_trial, trialEndsAt: ctx.trial_ends_at,
      });
      return await one(only(owners(ctx)), rendered, "gym-package", ctx.gym.name, { from, to });
    }

    // ── POWR answered a question from Settings, then Help ────────────────
    if (kind === "support_reply") {
      const ticketId = str("ticket_id");
      if (!ticketId) return json({ error: "ticket_id required" }, 400);
      const { data: t } = await admin.from("support_tickets")
        .select("id, email, subject, message, admin_reply, category, gym_partner_id")
        .eq("id", ticketId).maybeSingle();
      if (!t) return json({ kind, skipped: "not_found" }, 404);
      if (t.category !== "gym_help" || !t.gym_partner_id) return json({ kind, skipped: "not_gym_help" });
      if (!String(t.admin_reply ?? "").trim()) return json({ kind, skipped: "no_reply" });
      // The answer goes even if the portal has since been switched off: they
      // asked while it was on.
      const ctx = await context(t.gym_partner_id);
      if (!ctx) return json({ kind, skipped: "gym_not_found" }, 404);
      const rendered = gymSupportReplyEmail({
        gymName: ctx.gym.name, subject: t.subject, message: t.message, reply: t.admin_reply,
        updated: body?.updated === true,
      });
      return await one(only([t.email]), rendered, "gym-support-reply", ctx.gym.name, { ticket_id: ticketId });
    }

    // ── POWR decided a Clash Night (owners + whoever asked) ──────────────
    if (kind === "clash_night") {
      const nightId = str("night_id");
      if (!nightId) return json({ error: "night_id required" }, 400);
      const { data: night } = await admin.from("gym_clash_nights")
        .select("id, partner_id, night_date, start_time, backup_date, status, admin_note, requested_by")
        .eq("id", nightId).maybeSingle();
      if (!night) return json({ kind, skipped: "not_found" }, 404);
      // Re-read after commit: a night cancelled since has nothing to tell.
      if (night.status !== "confirmed" && night.status !== "declined") return json({ kind, skipped: `status_${night.status}` });
      const ctx = await context(night.partner_id);
      if (!ctx) return json({ kind, skipped: "gym_not_found" }, 404);
      if (!ctx.live) return json({ kind, gym: ctx.gym.name, skipped: "portal_off" });
      const asker = ctx.team.find((m) => m.user_id === night.requested_by)?.email;
      const rendered = gymClashNightEmail({
        gymName: ctx.gym.name, decision: night.status, was: str("was") ?? "requested",
        nightDate: night.night_date, startTime: night.start_time, backupDate: night.backup_date, note: night.admin_note,
      });
      return await one(only([...owners(ctx), ...(asker ? [asker] : [])]), rendered, "gym-clash-night", ctx.gym.name, { night_id: nightId, status: night.status });
    }

    // ── Daily: invite reminders and the free trial ───────────────────────
    if (kind === "lifecycle") {
      const { data, error } = await admin.rpc("get_gym_lifecycle_mail") as { data: { trial: TrialDue[]; invites: InviteDue[] } | null; error: unknown };
      if (error) {
        console.error("get_gym_lifecycle_mail error:", error);
        return json({ error: "rpc_failed", detail: String(error) }, 500);
      }
      // Only a full real run (or one aimed at one address) records anything.
      const commit = !dryRun;
      const results: SendResult[] = [];
      const skipped: { gym: string; what: string; why: string }[] = [];
      let sent = 0;

      for (const t of data?.trial ?? []) {
        const tos = only(t.owners ?? []);
        if (tos.length === 0) { if (!onlyEmail) skipped.push({ gym: t.gym, what: t.kind, why: "no_owner" }); continue; }
        // A test to one inbox (deliver_to) never marks the real one as sent.
        const record = commit && !deliverTo;
        if (record) {
          const { error: claimErr } = await admin.from("gym_email_log")
            .insert({ partner_id: t.partner_id, kind: t.kind, ref: t.ref, detail: { days_left: t.days_left, package: t.package } });
          if (claimErr) {
            const dup = (claimErr as { code?: string }).code === "23505";
            if (!dup) console.error(`gym_email_log claim (${t.gym}) error:`, claimErr);
            skipped.push({ gym: t.gym, what: t.kind, why: dup ? "already_sent" : "claim_failed" });
            continue;
          }
        }
        const rendered = gymTrialEmail({
          kind: t.kind, gymName: t.gym, tz: t.tz, trialEndsAt: t.trial_ends_at,
          daysLeft: t.days_left, package: t.package, lost: t.lost ?? [],
        });
        const n = await deliver(tos.map((to) => deliverTo ?? to), rendered, "gym-trial", dryRun, results, t.gym);
        sent += n;
        if (record && n === 0) {
          await admin.from("gym_email_log").delete().match({ partner_id: t.partner_id, kind: t.kind, ref: t.ref });
        }
      }

      for (const inv of data?.invites ?? []) {
        if (onlyEmail && inv.email !== onlyEmail) continue;
        if (dryRun) { results.push({ to: inv.email, gym: inv.gym, ok: true }); sent++; continue; }
        // A second link for the same invite; the first keeps working.
        const token = newToken();
        const { data: upd, error: updErr } = await admin.from("gym_staff_invites")
          .update({ reminder_token_hash: await sha256Hex(token), reminded_at: new Date().toISOString() })
          .eq("id", inv.invite_id).eq("status", "invited").is("reminded_at", null)
          .select("id");
        if (updErr || (upd ?? []).length !== 1) {
          if (updErr) console.error(`invite reminder (${inv.gym}) error:`, updErr);
          skipped.push({ gym: inv.gym, what: "invite_reminder", why: updErr ? "update_failed" : "taken" });
          continue;
        }
        const rendered = gymInviteReminderEmail({
          gymName: inv.gym, role: inv.role, tz: inv.tz, setupUrl: `${SITE_URL}/venue/setup/${token}`,
          invitedAt: inv.created_at, expiresAt: inv.expires_at,
        });
        // A real setup link: only ever to the person it was meant for.
        const n = await deliver([inv.email], rendered, "gym-invite-reminder", false, results, inv.gym);
        sent += n;
        if (n === 0) {
          await admin.from("gym_staff_invites").update({ reminder_token_hash: null, reminded_at: null }).eq("id", inv.invite_id);
        }
      }

      return json({
        kind, dry_run: dryRun, sent, skipped, results,
        due: { trial: (data?.trial ?? []).length, invites: (data?.invites ?? []).length },
      });
    }
  } catch (err) {
    console.error(`[send-gym-email] ${kind} failed:`, err);
    return json({ kind, error: "failed", detail: String(err) }, 500);
  }

  return json({ error: "unknown_kind" }, 400);
});
