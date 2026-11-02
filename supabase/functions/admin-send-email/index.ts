// admin-send-email — the admin panel's Email page.
//
// Renders admin-written templates the way a recipient will see them, counts an
// audience, sends a test to an admin inbox, and sends to an audience through
// Mailgun with a delivery row per recipient so a send can resume after the
// platform's time limit or a crash.
//
// Auth mirrors admin-broadcast-push (the caller must be in admin_roles). The
// audience is resolved by the SAME code the push broadcast uses
// (audienceUserIds in _shared/broadcastSend.ts), so "Everyone", a segment or a
// live event means the same people in both tools. Addresses come from the
// admin_email_recipients() RPC, which also says who turned Product news off.
//
// Actions (POST JSON { action, … }):
//   count   { audience }               → { recipients, opted_out, with_email }
//   render  { template }               → { subject, html, text, warnings, size_bytes } merged for the caller
//   extract_images { html }            → embedded base64 images uploaded to storage, HTML re-linked
//   test    { template, to? }          → one email to the caller or another admin
//   send    { template_id, audience }  → creates the send, queues every recipient, then works it
//   resume  { send_id }                → keeps working a paused or interrupted send
// send/resume answer { done, send_id, status, sent, failed, queued, recipients }.
// The panel calls resume until done. Each call works for at most TIME_BUDGET_MS,
// well inside the edge runtime's wall clock, and the Mailgun helper already
// waits out the domain's rolling recipient limit (420) instead of dropping mail.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { audienceUserIds, type Audience } from '../_shared/broadcastSend.ts';
import { sendEmail } from '../_shared/mailgun.ts';
import { SERVER_LANGUAGES } from '../_shared/i18n/index.ts';
import {
  type AdminTemplate,
  byteLength,
  findEmbeddedImages,
  formatKB,
  mergeVarsFor,
  renderAdminEmail,
  SAMPLE_VARS,
  sizeWarnings,
  unknownMergeTags,
} from '../_shared/emails/admin-template.ts';

const CONCURRENCY = 4;
const TIME_BUDGET_MS = 90_000;
const STALE_CLAIM_MS = 10 * 60_000;
const RPC_CHUNK = 2000;
// A pasted design export can be several MB before its images are extracted,
// so the paste cap is generous; Gmail's 102 KB clip is reported as a warning.
const HTML_MAX_CHARS = 2_000_000;
const EXTRACT_MAX_CHARS = 20_000_000;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_MAX_COUNT = 60;
const ASSET_BUCKET = 'landing-page-assets';
const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp',
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

interface Recipient {
  user_id: string;
  email: string;
  display_name: string | null;
  username: string | null;
  referral_code: string | null;
  language: string | null;
  balance: number;
  opted_out: boolean;
}

interface SendRow {
  id: string;
  template_id: string | null;
  template_name: string;
  subject: string;
  preheader: string;
  html: string;
  text: string;
  use_shell: boolean;
  reply_to: string | null;
  audience: Audience;
  status: 'sending' | 'paused' | 'sent' | 'failed';
  recipient_count: number;
  opted_out_count: number;
}

const langOf = (lang: string | null | undefined) =>
  lang && (SERVER_LANGUAGES as readonly string[]).includes(lang) ? lang : 'en';

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Address + merge data rows for these user ids (null = everyone with an address). */
async function recipientRows(admin: SupabaseClient, userIds: string[] | null): Promise<Recipient[]> {
  if (userIds === null) {
    const { data, error } = await admin.rpc('admin_email_recipients', { p_user_ids: null });
    if (error) throw new Error(error.message);
    return (data ?? []) as Recipient[];
  }
  const out: Recipient[] = [];
  for (const ids of chunk(userIds, RPC_CHUNK)) {
    const { data, error } = await admin.rpc('admin_email_recipients', { p_user_ids: ids });
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Recipient[]));
  }
  return out;
}

/** The audience as people with an address, split into who gets mail and who opted out. */
async function audienceRecipients(admin: SupabaseClient, audience: Audience) {
  const ids = await audienceUserIds(admin, audience);
  if (ids !== null && ids.size === 0) return { eligible: [] as Recipient[], optedOut: 0, withEmail: 0 };
  const rows = await recipientRows(admin, ids === null ? null : [...ids]);
  const seen = new Set<string>();
  const eligible: Recipient[] = [];
  let optedOut = 0;
  for (const row of rows) {
    const key = row.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (row.opted_out) { optedOut++; continue; }
    eligible.push(row);
  }
  return { eligible, optedOut, withEmail: seen.size };
}

/** Same audience checks as the push broadcast; device filters are ignored (mail has no device). */
function audienceError(audience: Audience): string | null {
  if (!['all', 'segment', 'users', 'event', undefined].includes(audience.mode)) {
    return `Unknown audience mode: ${audience.mode}`;
  }
  if (audience.mode === 'users' && (audience.user_ids ?? []).filter(Boolean).length === 0) {
    return 'No users selected';
  }
  if (audience.mode === 'event' && !UUID_RE.test(String(audience.event_id ?? '').trim())) {
    return 'No live event selected';
  }
  return null;
}

/** The template as the editor sends it (render/test), bounded like the table's checks. */
function templateFromBody(raw: unknown): AdminTemplate | string {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const subject = String(t.subject ?? '').trim();
  const preheader = String(t.preheader ?? '').trim();
  const html = String(t.html ?? '');
  const text = String(t.text ?? '');
  if (subject.length > 200) return 'Subject is too long (200 characters max)';
  if (preheader.length > 300) return 'Preheader is too long (300 characters max)';
  if (html.length > HTML_MAX_CHARS) return `HTML is too long (${HTML_MAX_CHARS.toLocaleString('en-GB')} characters max) — extract its embedded images first`;
  if (text.length > 100_000) return 'Plain text is too long (100,000 characters max)';
  return { subject, preheader, html, text, use_shell: t.use_shell !== false };
}

function warningsFor(t: AdminTemplate, renderedHtml: string): string[] {
  const unknown = unknownMergeTags(`${t.subject}\n${t.preheader}\n${t.html}\n${t.text}`);
  const out = unknown.map((tag) => `Unknown merge tag {{${tag}}} — it will be sent as written`);
  if (/<script\b/i.test(t.html)) out.push('Scripts never run in email — <script> blocks are removed before sending');
  if (t.use_shell && /<(html|body)\b/i.test(t.html)) out.push('The POWR shell is on but the HTML is a full document — turn the shell off or paste just the body');
  if (!t.use_shell && !/unsubscribe/i.test(t.html)) out.push('No unsubscribe link — add %unsubscribe_url% or turn the POWR shell on');
  out.push(...sizeWarnings(t.html, renderedHtml));
  return out;
}

// Backed by a fresh ArrayBuffer (never a SharedArrayBuffer), which is what
// crypto.subtle and Blob accept under the newer TypeScript array-buffer types.
function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function tally(admin: SupabaseClient, sendId: string) {
  const count = async (status: string) => {
    const { count, error } = await admin
      .from('email_send_deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('send_id', sendId)
      .eq('status', status);
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  return {
    queued: await count('queued'),
    sending: await count('sending'),
    sent: await count('sent'),
    failed: await count('failed'),
  };
}

/**
 * Work a send's queued deliveries until they run out or the time budget does.
 * Each batch is CLAIMED (queued → sending) before any mail goes out, so two
 * overlapping runs can never email the same person twice.
 */
async function workSend(admin: SupabaseClient, send: SendRow, adminId: string) {
  const template: AdminTemplate = {
    subject: send.subject,
    preheader: send.preheader,
    html: send.html,
    text: send.text,
    use_shell: send.use_shell,
  };
  const started = Date.now();

  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data: batch, error: batchErr } = await admin
      .from('email_send_deliveries')
      .select('id')
      .eq('send_id', send.id)
      .eq('status', 'queued')
      .order('email')
      .limit(CONCURRENCY);
    if (batchErr) throw new Error(batchErr.message);
    if (!batch?.length) break;

    const { data: claimed, error: claimErr } = await admin
      .from('email_send_deliveries')
      .update({ status: 'sending', claimed_at: new Date().toISOString() })
      .in('id', batch.map((b: { id: string }) => b.id))
      .eq('status', 'queued')
      .select('id, user_id, email');
    if (claimErr) throw new Error(claimErr.message);
    if (!claimed?.length) continue; // another run took this batch

    const claimedRows = claimed as { id: string; user_id: string | null; email: string }[];
    const rows = await recipientRows(admin, claimedRows.map((c) => c.user_id).filter((id): id is string => Boolean(id)));
    const byId = new Map(rows.map((r) => [r.user_id, r]));

    const outcomes = await Promise.all(claimedRows.map(async (d) => {
      const row = d.user_id ? byId.get(d.user_id) : undefined;
      const vars = mergeVarsFor({ ...(row ?? {}), email: d.email });
      const rendered = renderAdminEmail(template, vars, langOf(row?.language));
      try {
        await sendEmail({
          to: d.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text || undefined,
          replyTo: send.reply_to ?? undefined,
          tag: 'admin-email',
        });
        return { id: d.id, ok: true as const };
      } catch (err) {
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        return { id: d.id, ok: false as const, error: message };
      }
    }));

    const now = new Date().toISOString();
    const okIds = outcomes.filter((o) => o.ok).map((o) => o.id);
    if (okIds.length) {
      await admin.from('email_send_deliveries')
        .update({ status: 'sent', sent_at: now, error: null })
        .in('id', okIds);
    }
    for (const o of outcomes) {
      if (o.ok) continue;
      await admin.from('email_send_deliveries')
        .update({ status: 'failed', sent_at: now, error: o.error })
        .eq('id', o.id);
    }
  }

  const counts = await tally(admin, send.id);
  const done = counts.queued === 0 && counts.sending === 0;
  // No queued rows but some still "sending": an earlier run was cut off
  // mid-batch. Those claims expire after STALE_CLAIM_MS; resume again then.
  const stalled = !done && counts.queued === 0;
  const status = done ? (counts.sent > 0 ? 'sent' : 'failed') : 'paused';
  const now = new Date().toISOString();
  const { error: updErr } = await admin.from('email_sends').update({
    status,
    sent_count: counts.sent,
    failed_count: counts.failed,
    completed_at: done ? now : null,
  }).eq('id', send.id);
  if (updErr) console.error('[admin-send-email] send row update failed', updErr.message);

  if (done) {
    if (send.template_id) {
      await admin.from('email_templates').update({ last_sent_at: now }).eq('id', send.template_id);
    }
    await admin.from('admin_audit_log').insert({
      admin_id: adminId,
      action: 'email_send',
      target_type: 'email_send',
      target_id: send.id,
      metadata: {
        template_id: send.template_id,
        template_name: send.template_name,
        subject: send.subject,
        audience: send.audience,
        recipients: send.recipient_count,
        opted_out: send.opted_out_count,
        sent: counts.sent,
        failed: counts.failed,
      },
    });
  }

  return {
    done,
    stalled,
    send_id: send.id,
    status,
    sent: counts.sent,
    failed: counts.failed,
    queued: counts.queued + counts.sending,
    recipients: send.recipient_count,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // ── Auth: caller must be a logged-in admin ──────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization' }, 401);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  const { data: adminRow } = await admin
    .from('admin_roles').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!adminRow) return json({ error: 'Forbidden: admin access required' }, 403);

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const action = String(body.action ?? '');

  try {
    // ── count ─────────────────────────────────────────────────────────────
    if (action === 'count') {
      const audience: Audience = body.audience ?? { mode: 'all' };
      const err = audienceError(audience);
      if (err) return json({ error: err }, 400);
      const { eligible, optedOut, withEmail } = await audienceRecipients(admin, audience);
      return json({ recipients: eligible.length, opted_out: optedOut, with_email: withEmail });
    }

    // ── render (preview for the caller) ───────────────────────────────────
    if (action === 'render') {
      const template = templateFromBody(body.template);
      if (typeof template === 'string') return json({ error: template }, 400);
      const me = (await recipientRows(admin, [user.id]))[0];
      const vars = me ? mergeVarsFor(me) : { ...SAMPLE_VARS, email: user.email ?? SAMPLE_VARS.email };
      const rendered = renderAdminEmail(template, vars, langOf(me?.language));
      return json({
        ...rendered,
        warnings: warningsFor(template, rendered.html),
        size_bytes: byteLength(rendered.html),
        rendered_for: me ? 'you' : 'sample',
      });
    }

    // ── extract_images (base64 → storage, HTML re-linked) ─────────────────
    // Design exports embed every image as a data: URI. Gmail never shows
    // those and the HTML blows past its clip limit, so each unique image is
    // uploaded once (content-addressed, public bucket) and the HTML points
    // at the URL instead. Nothing else in the HTML is touched.
    if (action === 'extract_images') {
      const html = String(body.html ?? '');
      if (html.length > EXTRACT_MAX_CHARS) {
        return json({ error: `HTML is too long to process (${formatKB(EXTRACT_MAX_CHARS)} max)` }, 400);
      }
      const images = findEmbeddedImages(html);
      if (images.length > IMAGE_MAX_COUNT) {
        return json({ error: `Too many embedded images (${images.length}; ${IMAGE_MAX_COUNT} max)` }, 400);
      }
      let out = html;
      const uploaded: { url: string; bytes: number; mime: string }[] = [];
      const failed: { mime: string; bytes: number; error: string }[] = [];
      for (const img of images) {
        const ext = IMAGE_EXT[img.mime];
        if (!ext) { failed.push({ mime: img.mime, bytes: img.bytes, error: 'Unsupported image type' }); continue; }
        let bytes: ReturnType<typeof base64ToBytes>;
        try { bytes = base64ToBytes(img.base64); } catch { failed.push({ mime: img.mime, bytes: img.bytes, error: 'Not valid base64' }); continue; }
        if (bytes.length > IMAGE_MAX_BYTES) { failed.push({ mime: img.mime, bytes: bytes.length, error: `Over ${formatKB(IMAGE_MAX_BYTES)}` }); continue; }
        const path = `email/templates/${(await sha256Hex(bytes)).slice(0, 32)}.${ext}`;
        const { error: upErr } = await admin.storage.from(ASSET_BUCKET).upload(
          path,
          new Blob([bytes], { type: img.mime }),
          { contentType: img.mime, upsert: true, cacheControl: '31536000' },
        );
        if (upErr) { failed.push({ mime: img.mime, bytes: bytes.length, error: upErr.message }); continue; }
        const { data: { publicUrl } } = admin.storage.from(ASSET_BUCKET).getPublicUrl(path);
        out = out.split(img.uri).join(publicUrl);
        uploaded.push({ url: publicUrl, bytes: bytes.length, mime: img.mime });
      }
      await admin.from('admin_audit_log').insert({
        admin_id: user.id,
        action: 'email_extract_images',
        target_type: 'email_template',
        target_id: UUID_RE.test(String(body.template_id ?? '')) ? body.template_id : null,
        metadata: { uploaded: uploaded.length, failed: failed.length, before_chars: html.length, after_chars: out.length },
      });
      return json({ html: out, images: uploaded, failed, before_chars: html.length, after_chars: out.length });
    }

    // ── test (one email to an admin inbox) ────────────────────────────────
    if (action === 'test') {
      const template = templateFromBody(body.template);
      if (typeof template === 'string') return json({ error: template }, 400);
      if (!template.subject || !template.html.trim()) {
        return json({ error: 'Add a subject and some HTML before sending a test' }, 400);
      }
      const to = String(body.to ?? user.email ?? '').trim().toLowerCase();
      if (!to) return json({ error: 'Your admin account has no email address' }, 400);
      if (to !== (user.email ?? '').toLowerCase()) {
        const { data: admins, error: adminsErr } = await admin.from('admin_roles').select('user_id');
        if (adminsErr) throw new Error(adminsErr.message);
        const adminRows = await recipientRows(admin, (admins ?? []).map((a) => a.user_id));
        if (!adminRows.some((r) => r.email.toLowerCase() === to)) {
          return json({ error: 'Tests can only go to admin accounts' }, 400);
        }
      }
      const me = (await recipientRows(admin, [user.id]))[0];
      const vars = me ? mergeVarsFor({ ...me, email: to }) : { ...SAMPLE_VARS, email: to };
      const rendered = renderAdminEmail(template, vars, langOf(me?.language));
      await sendEmail({
        to,
        subject: `[TEST] ${rendered.subject}`,
        html: rendered.html,
        text: rendered.text || undefined,
        replyTo: typeof body.reply_to === 'string' && body.reply_to.includes('@') ? body.reply_to : undefined,
        tag: 'admin-email-test',
      });
      await admin.from('admin_audit_log').insert({
        admin_id: user.id,
        action: 'email_test',
        target_type: 'email_template',
        target_id: UUID_RE.test(String(body.template_id ?? '')) ? body.template_id : null,
        metadata: { to, subject: rendered.subject },
      });
      return json({ ok: true, sent_to: to });
    }

    // ── send (create + queue + work) ──────────────────────────────────────
    if (action === 'send') {
      const templateId = String(body.template_id ?? '');
      if (!UUID_RE.test(templateId)) return json({ error: 'template_id is required' }, 400);
      const audience: Audience = body.audience ?? { mode: 'all' };
      const audErr = audienceError(audience);
      if (audErr) return json({ error: audErr }, 400);

      const { data: tpl, error: tplErr } = await admin
        .from('email_templates').select('*').eq('id', templateId).maybeSingle();
      if (tplErr) throw new Error(tplErr.message);
      if (!tpl) return json({ error: 'Template not found' }, 404);
      if (!String(tpl.subject).trim() || !String(tpl.html).trim()) {
        return json({ error: 'The template needs a subject and HTML before it can be sent' }, 400);
      }

      const { eligible, optedOut } = await audienceRecipients(admin, audience);
      if (eligible.length === 0) return json({ error: 'Nobody in this audience can be emailed' }, 400);

      const { data: send, error: sendErr } = await admin.from('email_sends').insert({
        template_id: tpl.id,
        template_name: tpl.name,
        subject: tpl.subject,
        preheader: tpl.preheader,
        html: tpl.html,
        text: tpl.text,
        use_shell: tpl.use_shell,
        reply_to: tpl.reply_to,
        audience,
        status: 'sending',
        recipient_count: eligible.length,
        opted_out_count: optedOut,
        sent_by: user.id,
      }).select('*').single();
      if (sendErr) throw new Error(sendErr.message);

      for (const group of chunk(eligible, 500)) {
        const { error: qErr } = await admin.from('email_send_deliveries').insert(
          group.map((r) => ({ send_id: send.id, user_id: r.user_id, email: r.email, status: 'queued' })),
        );
        if (qErr) throw new Error(qErr.message);
      }

      return json(await workSend(admin, send as SendRow, user.id));
    }

    // ── resume ────────────────────────────────────────────────────────────
    if (action === 'resume') {
      const sendId = String(body.send_id ?? '');
      if (!UUID_RE.test(sendId)) return json({ error: 'send_id is required' }, 400);
      const { data: send, error: sendErr } = await admin
        .from('email_sends').select('*').eq('id', sendId).maybeSingle();
      if (sendErr) throw new Error(sendErr.message);
      if (!send) return json({ error: 'Send not found' }, 404);
      if (send.status === 'sent' || send.status === 'failed') {
        return json({ error: 'This send has already finished' }, 409);
      }
      // Claims older than STALE_CLAIM_MS belong to a run that was cut off; free them.
      const stale = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
      await admin.from('email_send_deliveries')
        .update({ status: 'queued', claimed_at: null })
        .eq('send_id', sendId)
        .eq('status', 'sending')
        .lt('claimed_at', stale);
      await admin.from('email_sends').update({ status: 'sending' }).eq('id', sendId);
      return json(await workSend(admin, send as SendRow, user.id));
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error('[admin-send-email] failed', err);
    return json({ error: err instanceof Error ? err.message : 'Email request failed' }, 500);
  }
});
