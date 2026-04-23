const MAILGUN_API_KEY = Deno.env.get("MAILGUN_API_KEY");
const MAILGUN_DOMAIN = Deno.env.get("MAILGUN_DOMAIN") ?? "powr.life";
const MAILGUN_BASE_URL = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}`;

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  if (!MAILGUN_API_KEY) {
    throw new Error("MAILGUN_API_KEY environment variable is not set");
  }

  const body = new FormData();
  body.append("from", `POWR <postmaster@${MAILGUN_DOMAIN}>`);
  body.append("to", opts.to);
  body.append("subject", opts.subject);
  body.append("html", opts.html);
  if (opts.text) body.append("text", opts.text);
  if (opts.replyTo) body.append("h:Reply-To", opts.replyTo);

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
