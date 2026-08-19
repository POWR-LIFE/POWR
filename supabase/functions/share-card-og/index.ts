import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Renders the Open Graph page behind https://powr.life/s/<id>.
 *
 * This exists because an attached image *is* the message: WhatsApp, iMessage
 * and X only draw a tappable preview card when they are sent a URL and can
 * scrape og:* tags off it. So the app shares a link to here, and this hands the
 * crawler the captured card as og:image.
 *
 * Crawlers arrive with no JWT and no cookies, hence verify_jwt = false. Nothing
 * secret is served: the response is a title, a subtitle and a public image URL,
 * all of which the member chose to share. The uuid in the path is the only
 * secret, and it is unguessable.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = "https://powr.life";
/** Mirrors share_cards.app_path's CHECK: the /app smart-link and nothing else. */
const APP_PATH_RE = /^\/app(\?[A-Za-z0-9%._~&=-]*)?$/;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

/** Crawlers scrape whatever we emit, so nothing user-supplied goes in raw. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(opts: {
  title: string;
  description: string;
  image: string;
  url: string;
  appLink: string;
}): string {
  const { title, description, image, url, appLink } = opts;
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
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="720">
<meta property="og:image:height" content="1280">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0; url=${esc(appLink)}">
</head>
<body style="margin:0;background:#080808">
<!-- Humans get bounced to the smart-link, which opens the app or the store.
     Crawlers do not run scripts, so they keep the tags above. -->
<script>window.location.replace(${JSON.stringify(appLink)});</script>
<noscript><a href="${esc(appLink)}" style="color:#E8D200;font-family:sans-serif">Open POWR</a></noscript>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  // Known link-preview scrapers. They must receive the full HTML page so they
  // can read the og:* tags. Real browsers get a plain HTTP redirect instead —
  // this is more reliable than meta-refresh or JS across all WebView variants.
  const CRAWLER_RE =
    /WhatsApp|facebookexternalhit|Facebot|Twitterbot|TelegramBot|Slackbot|Discordbot|LinkedInBot|Googlebot|bingbot|Applebot|iMessage/i;

  const id = new URL(req.url).searchParams.get("id");

  // A bad or expired id still has to land somewhere useful rather than 404 —
  // the link is already out in someone's chat thread.
  if (!id) return Response.redirect(`${SITE}/app`, 302);

  const { data: card } = await admin
    .from("share_cards")
    .select("image_path, title, subtitle, referral_code, app_path")
    .eq("id", id)
    .maybeSingle();

  if (!card) return Response.redirect(`${SITE}/app`, 302);

  const image = `${SUPABASE_URL}/storage/v1/object/public/share-cards/${card.image_path}`;
  // A card may name where its humans land (a prize card → its event). The
  // row is member-written, so the path is only honoured when it is the /app
  // smart-link — the same shape the column's CHECK enforces — and never
  // becomes an open redirect off powr.life.
  const appPath =
    typeof card.app_path === "string" && APP_PATH_RE.test(card.app_path)
      ? card.app_path
      : null;
  const appLink = appPath
    ? `${SITE}${appPath}`
    : card.referral_code
      ? `${SITE}/app?ref=${encodeURIComponent(card.referral_code)}`
      : `${SITE}/app`;

  const ua = req.headers.get("user-agent") ?? "";

  // Real browsers: redirect immediately at HTTP level — no HTML parsing needed.
  if (!CRAWLER_RE.test(ua)) {
    return Response.redirect(appLink, 302);
  }

  // Crawlers: serve the full OG page so they can scrape the preview tags.
  return new Response(
    page({
      title: card.title,
      description: card.subtitle ?? "Get rewarded for every workout.",
      image,
      url: `${SITE}/s/${id}`,
      appLink,
    }),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Crawlers refetch on every reshare; the row is immutable once written.
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
});
