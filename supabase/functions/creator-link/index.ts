import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * The page behind https://powr.life/join/<handle> — a creator's invite link.
 *
 * Mirrors challenge-invite-og: crawlers get OG tags so the link unfurls as a
 * card in an Instagram bio preview or a WhatsApp thread, real humans get an
 * HTTP redirect to the /app smart-link carrying ?ref=<code>.
 *
 * Why this function exists at all, rather than linking straight to
 * /app?ref=CODE: iOS has no reliable deferred deep link. We cannot know how
 * many people who tapped a creator's link went on to enter the code, unless we
 * count the taps. This is the click half of that measurement — the conversion
 * half is already in referrals.converted_at. clicks-vs-conversions is the only
 * honest basis for deciding whether to ever buy Branch/AppsFlyer.
 *
 * Two deliberate choices:
 *
 *   * Crawlers are NEVER counted. A WhatsApp unfurl and a Slack preview would
 *     otherwise inflate every creator's click count — and creators are paid on
 *     these numbers.
 *
 *   * No raw IP is ever stored. Only a salted hash, only so admin can spot
 *     farming clusters. It is never shown to the creator.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = "https://powr.life";
const LOGO = `${SUPABASE_URL}/storage/v1/object/public/landing-page-assets/powrlogotext-app.png`;

// Dedicated salt so a click hash can never be correlated with anything else we
// store. Falls back to the service key — still secret, still not the raw IP —
// so a missing env var degrades privacy-neutrally instead of logging plaintext.
const IP_SALT = Deno.env.get("CREATOR_CLICK_SALT") ?? SERVICE_ROLE_KEY;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CRAWLER_RE =
  /WhatsApp|facebookexternalhit|Facebot|Twitterbot|TelegramBot|Slackbot|Discordbot|LinkedInBot|Googlebot|bingbot|Applebot|iMessage|Pinterest|redditbot/i;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function platformOf(ua: string): "ios" | "android" | "other" {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

function uaFamily(ua: string): string {
  if (/Instagram/i.test(ua)) return "instagram";
  if (/FBAN|FBAV/i.test(ua)) return "facebook";
  if (/TikTok/i.test(ua)) return "tiktok";
  if (/CriOS|Chrome/i.test(ua)) return "chrome";
  if (/Safari/i.test(ua)) return "safari";
  return "other";
}

async function hashIp(ip: string): Promise<string | null> {
  if (!ip) return null;
  const bytes = new TextEncoder().encode(`${IP_SALT}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function page(opts: {
  title: string;
  description: string;
  url: string;
  appLink: string;
  image: string;
}): string {
  const { title, description, url, appLink, image } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">

<meta property="og:type" content="profile">
<meta property="og:site_name" content="POWR">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0; url=${esc(appLink)}">
</head>
<body style="margin:0;background:#080808">
<script>window.location.replace(${JSON.stringify(appLink)});</script>
<noscript><a href="${esc(appLink)}" style="color:#E8D200;font-family:sans-serif">Open POWR</a></noscript>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const handle = (url.searchParams.get("handle") ?? "").trim().toLowerCase();

  // A dead link still has to land somewhere useful — it's in someone's bio.
  if (!handle) return Response.redirect(`${SITE}/app`, 302);

  const { data: creator } = await admin
    .from("creators")
    .select("id, handle, code, display_name, avatar_url, bio, status")
    .eq("handle", handle)
    .maybeSingle();

  // Paused/terminated creators keep a working link to the app — we just stop
  // attributing. Sending their audience to a 404 punishes the wrong people.
  if (!creator || creator.status !== "active") {
    return Response.redirect(`${SITE}/app`, 302);
  }

  const campaign = (url.searchParams.get("c") ?? "").slice(0, 64);
  const source = (url.searchParams.get("s") ?? "").slice(0, 64);

  const appLink = `${SITE}/app?ref=${encodeURIComponent(creator.code)}` +
    (campaign ? `&c=${encodeURIComponent(campaign)}` : "");

  const ua = req.headers.get("user-agent") ?? "";

  // ── Crawler: unfurl the card, count nothing ──────────────────────────────
  if (CRAWLER_RE.test(ua)) {
    const title = `${creator.display_name} on POWR`;
    const description = creator.bio?.trim() ||
      "Get paid to train. Join POWR with my code and we both start earning.";
    return new Response(
      page({
        title,
        description,
        url: `${SITE}/join/${creator.handle}`,
        appLink,
        image: creator.avatar_url || LOGO,
      }),
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=600",
        },
      },
    );
  }

  // ── Human: log the tap, then send them on ────────────────────────────────
  // A logging failure must never cost the creator a click-through. The insert
  // is fire-and-forget behind waitUntil so it never sits in the redirect path.
  const ipHeader = req.headers.get("x-forwarded-for") ?? "";
  const ip = ipHeader.split(",")[0].trim();

  const logClick = (async () => {
    try {
      await admin.from("creator_clicks").insert({
        creator_id: creator.id,
        platform: platformOf(ua),
        campaign: campaign || null,
        source: source || null,
        referer_host: (() => {
          try {
            const r = req.headers.get("referer");
            return r ? new URL(r).host.slice(0, 128) : null;
          } catch {
            return null;
          }
        })(),
        ip_hash: await hashIp(ip),
        ua_family: uaFamily(ua),
      });
    } catch (err) {
      console.error("creator-link: click log failed", err);
    }
  })();

  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(logClick);
  else await logClick;

  return Response.redirect(appLink, 302);
});
