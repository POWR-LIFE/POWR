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

  const response = await fetch(`${MAILGUN_BASE_URL}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Mailgun API error (${response.status}): ${errorText}`);
  }
}
