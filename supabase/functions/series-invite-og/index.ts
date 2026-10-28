import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * The page behind https://powr.life/series/<code> — a Series invite link.
 *
 * Mirrors challenge-invite-og: crawlers get OG tags so the link unfurls as
 * the Series card in WhatsApp/iMessage — the P on the season's ground,
 * "POWR · Autumn Series", powr.life — and real browsers get an HTTP redirect
 * to the /app smart-link (add-friend with the sharer's code), which opens the
 * app or falls back to the store. Stateless on purpose: SHARE writes nothing,
 * so the share sheet opens at once, and a link reshared months later previews
 * whatever season is on then. Nothing is served beyond the published season's
 * name and look; the code only rides the redirect, exactly as the QR's link
 * carries it.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = "https://powr.life";
/** One card per season look (components/series/season.tsx), in landing-page/public/share. */
const LOOKS = new Set(["autumn", "winter", "spring", "summer"]);
/** profiles.referral_code: 6–10 of the unambiguous uppercase set (lib/social/friendCode.ts). */
const CODE_RE = /^[A-Z0-9]{6,10}$/i;
/** Known link-preview scrapers: they need the HTML; everyone else gets the redirect. */
const CRAWLER_RE =
  /WhatsApp|facebookexternalhit|Facebot|Twitterbot|TelegramBot|Slackbot|Discordbot|LinkedInBot|Googlebot|bingbot|Applebot|iMessage/i;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

/** Crawlers scrape whatever we emit, so nothing user-supplied goes in raw. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The preview: the card, the title, the site. No og:description on purpose —
 * the member's own message beneath the bubble carries the ask ("Autumn
 * Series starts on the 15th. You in?"), and a second grey line under the
 * title would only repeat it.
 */
function page(opts: { title: string; image: string; url: string; appLink: string }): string {
  const { title, image, url, appLink } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>

<meta property="og:type" content="website">
<meta property="og:site_name" content="POWR">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0; url=${esc(appLink)}">
</head>
<body style="margin:0;background:#013E37">
<!-- Humans get bounced to the smart-link, which opens the app or the store.
     Crawlers do not run scripts, so they keep the tags above. -->
<script>window.location.replace(${JSON.stringify(appLink)});</script>
<noscript><a href="${esc(appLink)}" style="color:#FFEFB3;font-family:sans-serif">Open POWR</a></noscript>
</body>
</html>`;
}

/**
 * The season the app wears — series_status()'s pick, made here because the
 * crawler has no member: the published season on today (London), else the
 * next to start, else the last to end. Null before any season is published.
 */
async function currentSeason(): Promise<{ name: string; look: string } | null> {
  const { data } = await admin
    .from("series_seasons")
    .select("name, look, starts_on, ends_on")
    .eq("published", true);
  const rows = (data ?? []) as Array<{ name: string; look: string; starts_on: string; ends_on: string }>;
  if (rows.length === 0) return null;
  // en-CA formats as YYYY-MM-DD, which compares as a string against the date columns.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const on = rows.filter((s) => s.starts_on <= today && today <= s.ends_on).sort((a, b) => b.ends_on.localeCompare(a.ends_on))[0];
  if (on) return on;
  const next = rows.filter((s) => s.starts_on > today).sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0];
  if (next) return next;
  return rows.sort((a, b) => b.ends_on.localeCompare(a.ends_on))[0];
}

Deno.serve(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get("ref") ?? "";
  // A malformed code is dropped, never echoed: the link still lands on the app.
  const code = CODE_RE.test(raw) ? raw.toUpperCase() : null;
  const appLink = code
    ? `${SITE}/app?to=add-friend&ref=${encodeURIComponent(code)}`
    : `${SITE}/app`;

  const ua = req.headers.get("user-agent") ?? "";
  // Real browsers: redirect at HTTP level — no HTML parsing needed, and no
  // database read for the tap that matters.
  if (!CRAWLER_RE.test(ua)) return Response.redirect(appLink, 302);

  const season = await currentSeason();
  const look = season && LOOKS.has(season.look) ? season.look : "autumn";
  const title = season ? `POWR · ${season.name}` : "POWR · The Series";

  return new Response(
    page({
      title,
      image: `${SITE}/share/series-${look}.jpg`,
      url: code ? `${SITE}/series/${code}` : `${SITE}/series`,
      appLink,
    }),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // The season changes a few times a year; a reshare refetches anyway.
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
});
