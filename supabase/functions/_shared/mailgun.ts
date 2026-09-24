const MAILGUN_API_KEY = Deno.env.get("MAILGUN_API_KEY");
const MAILGUN_DOMAIN = Deno.env.get("MAILGUN_DOMAIN") ?? "powr.life";
const MAILGUN_BASE_URL = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}`;
// A human sender reads better in the inbox than postmaster@ (and replies land
// somewhere). Same domain, so SPF/DKIM alignment is unchanged. Env-overridable.
const MAILGUN_FROM = Deno.env.get("MAILGUN_FROM") ?? `POWR <hello@${MAILGUN_DOMAIN}>`;

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /** Mailgun tag — one per email type ("weekly-summary", "welcome"…) so opens and
   *  deliveries can be split by type in the Mailgun dashboard. */
  tag?: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  if (!MAILGUN_API_KEY) {
    throw new Error("MAILGUN_API_KEY environment variable is not set");
  }

  const body = new FormData();
  body.append("from", MAILGUN_FROM);
  body.append("to", opts.to);
  body.append("subject", opts.subject);
  body.append("html", opts.html);
  if (opts.text) body.append("text", opts.text);
  if (opts.replyTo) body.append("h:Reply-To", opts.replyTo);
  if (opts.tag) {
    body.append("o:tag", opts.tag);
    // Opens only. Click tracking is left at the domain default on purpose: it
    // rewrites every href through a Mailgun redirect, which stops the
    // powr.life/app Universal/App Link from opening the app directly.
    body.append("o:tracking-opens", "yes");
  }

  const credentials = btoa(`api:${MAILGUN_API_KEY}`);

  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${MAILGUN_BASE_URL}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
      },
      body,
    });
    if (response.ok) return;

    const errorText = await response.text();
    // 420 = the domain's rolling recipient limit (26 per ~30 s on the current
    // plan), 429 = generic rate limit. Both clear on their own, so wait out the
    // window instead of dropping the email — the Monday weekly lost 10-13
    // recipients a week to this before retries existed.
    const rateLimited = response.status === 420 || response.status === 429;
    if (!rateLimited || attempt >= MAX_ATTEMPTS) {
      throw new Error(`Mailgun API error (${response.status}): ${errorText}`);
    }
    await sleep(retryDelayMs(response, errorText, attempt));
  }
}

const MAX_ATTEMPTS = 5;
const MAX_WAIT_MS = 65_000;

/** Mailgun's 420 body says "try again after Mon, 21 Sep 2026 08:00:36 UTC";
 *  honour that (plus a little slack), else Retry-After, else back off. */
function retryDelayMs(response: Response, errorText: string, attempt: number): number {
  const jitter = Math.floor(Math.random() * 1500);
  const after = errorText.match(/try again after ([^"}]+?UTC)/i)?.[1];
  const at = after ? Date.parse(after) : NaN;
  if (!Number.isNaN(at)) {
    return Math.min(Math.max(at - Date.now(), 0) + 1000 + jitter, MAX_WAIT_MS);
  }
  const retryAfter = Number(response.headers.get("retry-after"));
  if (retryAfter > 0) return Math.min(retryAfter * 1000 + jitter, MAX_WAIT_MS);
  return Math.min(5000 * 2 ** (attempt - 1) + jitter, MAX_WAIT_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
