// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
// Public edge function backing the signed-out support form on powr.life/support.
//
// Why a function rather than an anon RLS policy: support_tickets' only INSERT
// policy is `auth.uid() = user_id`, so a signed-out visitor cannot write at all.
// Opening an anon policy instead would make a table the admin panel reads
// writable by anyone holding the public anon key, with no way to validate
// lengths, allowlist categories, or throttle. All of that lives here and the
// insert runs with the service role.
//
//   POST { email, category, subject, message, company? } → { ok: true }
//
// `company` is a honeypot: it is hidden from real users, so anything that fills
// it is a bot. Those are accepted with a 200 and silently dropped, because
// telling a bot it failed just invites a retry with the field removed.
//
// Tickets created here have user_id = NULL — that is what distinguishes a web
// ticket from an in-app one (app/help-centre.tsx always stamps user_id). The
// admin triage view keys its "Partner" badge off the category prefix, so these
// land as ordinary user tickets with no admin-side change needed.

import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Mirrors CATEGORIES in app/help-centre.tsx so web and in-app tickets share
// vocabulary and the admin CATEGORY_LABELS map already knows every value.
// Deliberately excludes partner_* (portal-only) and brand_request (its own flow).
const CATEGORIES = [
  'points_rewards',
  'account',
  'health_sync',
  'gym_checkin',
  'challenges',
  'technical',
  'feedback',
];

const SUBJECT_MAX = 200;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 5000;
const EMAIL_MAX = 254; // RFC 5321 practical ceiling

// Deliberately permissive — the goal is rejecting obvious junk, not policing
// valid-but-unusual addresses. Delivery is the real test of an address.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

// Throttle window. Counted against support_tickets itself so this needs no
// extra table. Keyed on email, which a determined abuser can vary — this stops
// accidental double-submits and casual flooding, not a motivated attacker.
const THROTTLE_WINDOW_MIN = 10;
const THROTTLE_MAX = 3;

const trim = (v) => String(v ?? '').trim();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  // Honeypot — pretend it worked, write nothing.
  if (trim(body.company)) return json({ ok: true });

  const email    = trim(body.email).toLowerCase();
  const category = trim(body.category);
  const subject  = trim(body.subject);
  const message  = trim(body.message);

  if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400);
  }
  if (!CATEGORIES.includes(category)) {
    return json({ error: 'Please choose what you need help with.' }, 400);
  }
  if (!subject || subject.length > SUBJECT_MAX) {
    return json({ error: `Please add a subject of up to ${SUBJECT_MAX} characters.` }, 400);
  }
  if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX) {
    return json({
      error: `Please describe the issue in between ${MESSAGE_MIN} and ${MESSAGE_MAX} characters.`,
    }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const since = new Date(Date.now() - THROTTLE_WINDOW_MIN * 60_000).toISOString();
  const { count, error: countError } = await admin
    .from('support_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('email', email)
    .gte('created_at', since);

  // A failed count must not block a genuine ticket — never drop a support
  // request over a throttle bookkeeping error.
  if (!countError && (count ?? 0) >= THROTTLE_MAX) {
    return json({
      error: "You've sent a few messages just now — we have them. Please give us a little time to reply.",
    }, 429);
  }

  // Only these five columns are ever caller-influenced. user_id stays NULL and
  // status/admin_reply/created_at fall to their column defaults.
  const { error } = await admin.from('support_tickets').insert({
    user_id: null,
    email,
    category,
    subject,
    message,
  });

  if (error) {
    console.error('submit-support-ticket insert failed', error);
    return json({ error: 'Could not send your message. Please try again.' }, 500);
  }

  return json({ ok: true });
});
