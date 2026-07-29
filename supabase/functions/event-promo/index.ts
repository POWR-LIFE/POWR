import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Public JSON feed for the shareable event promo page (powr.life/promo/<slug>).
 *
 * Unlike event-board this is deliberately ungated — the promo page is the
 * thing we send out, so a clean slug-only URL is the point. Nothing
 * score-shaped is ever selected here: the payload is pure marketing surface
 * (name, window, prizes, promo media, venue branding).
 *
 * Draft and archived events 404 exactly like event-board — except that the
 * display token (?k=) doubles as an admin preview key, so the page can be
 * styled and checked while the real event row is still draft (the One LDN
 * row stays draft until comms are ready; the promo IS the comms).
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json",
      // Shared widely but edited rarely — a short TTL keeps admin promo
      // tweaks visible within a minute without hammering the function.
      "Cache-Control": "public, max-age=60",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });

  const url = new URL(req.url);
  const slug = url.searchParams.get("slug")?.trim();
  const previewKey = url.searchParams.get("k")?.trim();
  if (!slug) return json(400, { error: "missing_params" });

  // Explicit column list: public endpoint holding a service-role client —
  // the select doubles as the contract of what it may ever expose.
  const { data: ev } = await admin
    .from("live_events")
    .select(
      "id, name, slug, status, window_start_at, window_end_at, prizes, promo_media_url, promo_headline, venue_partner_id, display_token",
    )
    .eq("slug", slug)
    .single();

  const publicStatus = ev && ev.status !== "draft" && ev.status !== "archived";
  const previewOk = ev && previewKey && previewKey === ev.display_token;
  if (!publicStatus && !previewOk) return json(404, { error: "not_found" });

  let venue: { name: string; logo_url: string | null; logo_bg: string | null } | null = null;
  if (ev.venue_partner_id) {
    const { data: partner } = await admin
      .from("partners")
      .select("name, logo_url, logo_bg")
      .eq("id", ev.venue_partner_id)
      .single();
    if (partner) venue = { name: partner.name, logo_url: partner.logo_url, logo_bg: partner.logo_bg };
  }

  const cacheControl = previewOk ? "no-store" : "public, max-age=60";
  return new Response(JSON.stringify({
    name: ev.name,
    slug: ev.slug,
    status: ev.status,
    window_start_at: ev.window_start_at,
    window_end_at: ev.window_end_at,
    prizes: ev.prizes ?? [],
    headline: ev.promo_headline,
    media_url: ev.promo_media_url,
    venue,
    generated_at: new Date().toISOString(),
  }), {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type": "application/json",
      "Cache-Control": cacheControl,
    },
  });
});
