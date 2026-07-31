import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * The page behind https://powr.life/c/<token> — a shared-challenge invite link.
 *
 * Mirrors share-card-og: crawlers get OG tags so the link unfurls as a card in
 * WhatsApp/iMessage ("Join Jamie's 35K Steps challenge on POWR"), real browsers
 * get an HTTP redirect to the /app smart-link, which opens the app at
 * powr://join-challenge?token=… or falls back to the store. The token is the
 * only secret and it's unguessable; nothing is served beyond the creator's
 * display name and the challenge title/goal — exactly what the creator is
 * choosing to put in a chat thread by sharing the link.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = "https://powr.life";
const LOGO = `${SUPABASE_URL}/storage/v1/object/public/landing-page-assets/powrlogotext-app.png`;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(opts: { title: string; description: string; url: string; appLink: string }): string {
  const { title, description, url, appLink } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="POWR">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(LOGO)}">

<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta http-equiv="refresh" content="0; url=${esc(appLink)}">
</head>
<body style="margin:0;background:#080808">
<script>window.location.replace(${JSON.stringify(appLink)});</script>
<noscript><a href="${esc(appLink)}" style="color:#E8D200;font-family:sans-serif">Open POWR</a></noscript>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  const CRAWLER_RE =
    /WhatsApp|facebookexternalhit|Facebot|Twitterbot|TelegramBot|Slackbot|Discordbot|LinkedInBot|Googlebot|bingbot|Applebot|iMessage/i;

  const token = new URL(req.url).searchParams.get("token");
  // A dead link still has to land somewhere useful — it's in a chat thread.
  if (!token) return Response.redirect(`${SITE}/app`, 302);

  const { data: ch } = await admin
    .from("shared_challenges")
    .select("id, status, template, creator_id")
    .eq("invite_token", token)
    .maybeSingle();
  if (!ch) return Response.redirect(`${SITE}/app`, 302);

  const { data: prof } = await admin
    .from("profiles")
    .select("username, display_name")
    .eq("id", ch.creator_id)
    .maybeSingle();
  const name = prof?.display_name || prof?.username || "A friend";
  const challengeTitle = ch.template?.title ?? "a challenge";
  const live = ch.status === "forming" || ch.status === "active";

  const title = live
    ? `Join ${name}'s ${challengeTitle} challenge on POWR`
    : `${name}'s ${challengeTitle} challenge on POWR`;
  const description = live
    ? `${ch.template?.goal ? `${ch.template.goal} ` : ""}Do it together and everyone earns a bonus.`
    : "This one has finished — start your own on POWR.";
  // Ended challenge → plain app open; live → straight into the join flow.
  const appLink = live
    ? `${SITE}/app?to=join-challenge&token=${encodeURIComponent(token)}`
    : `${SITE}/app`;

  const ua = req.headers.get("user-agent") ?? "";
  if (!CRAWLER_RE.test(ua)) return Response.redirect(appLink, 302);

  return new Response(
    page({ title, description, url: `${SITE}/c/${token}`, appLink }),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Status can flip (forming → active → ended), so cache only briefly.
        "Cache-Control": "public, max-age=300",
      },
    },
  );
});
