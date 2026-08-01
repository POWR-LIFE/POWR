import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { marked } from "npm:marked@15.0.12";
import sanitizeHtml from "npm:sanitize-html@2.17.0";
import { sendEmail } from "../_shared/mailgun.ts";
import { teamLetterEmail, type TeamLetterReport } from "../_shared/emails/team-letter.ts";

const REPLY_TO = "hello@powr.life";
const CONCURRENCY = 5;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface TeamLetterRow {
  id: string;
  title: string;
  subject: string;
  preview_text: string;
  reporting_start: string;
  reporting_end: string;
  body_markdown: string;
  report_data: TeamLetterReport | Record<string, never>;
  generated_at: string | null;
  generation_version: number;
  status: "draft" | "sending" | "sent" | "failed";
}

interface RecipientRow {
  id: string;
  email: string;
  name: string | null;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function formatWeekLabel(start: string, end: string): string {
  const from = new Date(`${start}T00:00:00Z`);
  const until = new Date(`${end}T00:00:00Z`);
  const day = (date: Date) => date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return `${day(from)} - ${day(until)} ${until.getUTCFullYear()}`;
}

async function renderLetter(letter: TeamLetterRow) {
  const parsed = await marked.parse(letter.body_markdown, { gfm: true });
  const bodyHtml = sanitizeHtml(parsed, {
    allowedTags: [
      "h1", "h2", "h3", "p", "ul", "ol", "li", "strong", "em", "a",
      "blockquote", "hr", "br", "code", "pre", "table", "thead", "tbody",
      "tr", "th", "td",
    ],
    allowedAttributes: { a: ["href", "title"] },
    allowedSchemes: ["http", "https", "mailto"],
    disallowedTagsMode: "discard",
  });

  return teamLetterEmail({
    subject: letter.subject,
    title: letter.title,
    previewText: letter.preview_text,
    weekLabel: formatWeekLabel(letter.reporting_start, letter.reporting_end),
    report: "sections" in letter.report_data ? letter.report_data as TeamLetterReport : undefined,
    bodyHtml,
    bodyText: letter.body_markdown,
  });
}

async function generateReport(
  admin: ReturnType<typeof createClient>,
  letter: TeamLetterRow,
  userId: string,
): Promise<TeamLetterRow> {
  const { data: report, error: reportError } = await admin.rpc("generate_team_letter_report", {
    p_start: letter.reporting_start,
    p_end: letter.reporting_end,
  }) as { data: TeamLetterReport | null; error: { message: string } | null };
  if (reportError) throw new Error(reportError.message);
  if (!report?.headline?.length || !report.sections?.length) {
    throw new Error("The reporting window could not be generated");
  }

  const metrics = Object.fromEntries(report.headline.map((metric) => [metric.key, metric]));
  const activeMembers = Number(metrics.active_members?.value ?? 0).toLocaleString("en-GB");
  const workouts = Number(metrics.trusted_workouts?.value ?? 0).toLocaleString("en-GB");
  const appSessions = Number(metrics.app_sessions?.value ?? 0).toLocaleString("en-GB");
  const points = Number(metrics.points_issued?.value ?? 0).toLocaleString("en-GB");
  const partners = Number(metrics.partner_sessions?.value ?? 0).toLocaleString("en-GB");
  const weekLabel = formatWeekLabel(letter.reporting_start, letter.reporting_end);
  const generatedAt = new Date().toISOString();
  const updates = {
    title: "POWR Platform Pulse",
    subject: `[POWR Weekly] ${activeMembers} active members, ${workouts} workouts | ${weekLabel}`,
    preview_text: `${appSessions} app sessions, ${points} POWR issued and ${partners} partner sessions.`,
    body_markdown: "Automated weekly platform report. See report_data for the archived snapshot.",
    report_data: report,
    generated_at: generatedAt,
    generation_version: report.version,
    updated_by: userId,
  };
  const { data: updated, error: updateError } = await admin
    .from("team_letters")
    .update(updates)
    .eq("id", letter.id)
    .in("status", ["draft", "failed"])
    .select("*")
    .maybeSingle<TeamLetterRow>();
  if (updateError) throw new Error(updateError.message);
  if (!updated) throw new Error("This report changed before generation; refresh and try again");
  return updated;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  const { data: adminRole } = await admin
    .from("admin_roles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!adminRole) return json({ error: "Admin access required" }, 403);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = typeof body.action === "string" ? body.action : "";
  const letterId = typeof body.letter_id === "string" ? body.letter_id : "";
  if (!letterId || !["generate", "render", "test", "send"].includes(action)) {
    return json({ error: "action and letter_id are required" }, 400);
  }

  const { data: letter, error: letterError } = await admin
    .from("team_letters")
    .select("*")
    .eq("id", letterId)
    .maybeSingle<TeamLetterRow>();
  if (letterError) return json({ error: letterError.message }, 500);
  if (!letter) return json({ error: "Team letter not found" }, 404);

  if (action === "generate" && ["sent", "sending"].includes(letter.status)) {
    return json({ error: "Sent reports cannot be regenerated" }, 409);
  }
  if (action === "send" && letter.status === "sent") {
    return json({ error: "This team report has already been sent" }, 409);
  }
  if (action === "send" && letter.status === "sending") {
    return json({ error: "This team report is already sending" }, 409);
  }

  let currentLetter = letter;
  if (letter.status !== "sent") {
    try {
      currentLetter = await generateReport(admin, letter, user.id);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  if (action === "generate") {
    return json({
      ok: true,
      letter: currentLetter,
      report: currentLetter.report_data,
    });
  }

  const rendered = await renderLetter(currentLetter);
  if (action === "render") {
    return json({
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      letter: currentLetter,
      report: currentLetter.report_data,
    });
  }

  if (action === "test") {
    if (!user.email) return json({ error: "Your admin account has no email address" }, 400);
    try {
      await sendEmail({
        to: user.email,
        subject: `[TEST] ${rendered.subject}`,
        html: rendered.html,
        text: rendered.text,
        replyTo: REPLY_TO,
      });
      await admin.from("admin_audit_log").insert({
        admin_id: user.id,
        action: "team_letter_test",
        target_type: "team_letter",
        target_id: currentLetter.id,
        metadata: { email: user.email },
      });
      return json({ ok: true, sent_to: user.email });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
  }

  const { data: recipients, error: recipientError } = await admin
    .from("team_letter_recipients")
    .select("id, email, name")
    .eq("active", true)
    .order("created_at", { ascending: true }) as { data: RecipientRow[] | null; error: { message: string } | null };
  if (recipientError) return json({ error: recipientError.message }, 500);
  if (!recipients?.length) return json({ error: "Add at least one active team recipient before sending" }, 400);

  const { data: claimed, error: claimError } = await admin
    .from("team_letters")
    .update({ status: "sending", updated_by: user.id })
    .eq("id", currentLetter.id)
    .in("status", ["draft", "failed"])
    .select("id")
    .maybeSingle();
  if (claimError) return json({ error: claimError.message }, 500);
  if (!claimed) return json({ error: "The letter changed before sending; refresh and try again" }, 409);

  const outcomes: Array<RecipientRow & { status: "sent" | "failed"; error: string | null }> = [];
  let deliveryLogFailures = 0;

  for (const batch of chunks(recipients, CONCURRENCY)) {
    const batchOutcomes = await Promise.all(batch.map(async (recipient) => {
      try {
        await sendEmail({
          to: recipient.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          replyTo: REPLY_TO,
        });
        return { ...recipient, status: "sent" as const, error: null };
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
        return { ...recipient, status: "failed" as const, error: message };
      }
    }));
    outcomes.push(...batchOutcomes);

    const { error: logError } = await admin.from("team_letter_deliveries").upsert(
      batchOutcomes.map((outcome) => ({
        letter_id: currentLetter.id,
        recipient_id: outcome.id,
        recipient_email: outcome.email,
        recipient_name: outcome.name,
        status: outcome.status,
        error: outcome.error,
        sent_at: new Date().toISOString(),
      })),
      { onConflict: "letter_id,recipient_email" },
    );
    if (logError) {
      deliveryLogFailures += batchOutcomes.length;
      console.error("team letter delivery log failed:", logError.message);
    }
  }

  const sentCount = outcomes.filter((outcome) => outcome.status === "sent").length;
  const failedCount = outcomes.length - sentCount;
  const finalStatus = sentCount > 0 ? "sent" : "failed";
  const completedAt = new Date().toISOString();
  const { error: finalError } = await admin
    .from("team_letters")
    .update({
      status: finalStatus,
      recipient_count: outcomes.length,
      sent_count: sentCount,
      failed_count: failedCount,
      delivery_report: { sent: sentCount, failed: failedCount, delivery_log_failures: deliveryLogFailures },
      sent_by: user.id,
      sent_at: sentCount > 0 ? completedAt : null,
      updated_by: user.id,
    })
    .eq("id", currentLetter.id);
  if (finalError) {
    console.error("team letter archive update failed:", finalError.message);
    return json({ error: "Email delivery finished but the archive could not be updated" }, 500);
  }

  await admin.from("admin_audit_log").insert({
    admin_id: user.id,
    action: "team_letter_send",
    target_type: "team_letter",
    target_id: currentLetter.id,
    metadata: { recipients: outcomes.length, sent: sentCount, failed: failedCount },
  });

  return json({
    ok: sentCount > 0,
    status: finalStatus,
    recipients: outcomes.length,
    sent: sentCount,
    failed: failedCount,
  }, sentCount > 0 ? 200 : 502);
});