import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Public JSON feed for the Gym League big screen
 * (powr.life/league/<slug>?k=<display_token>).
 *
 * Sibling of gym-board and event-board: the TV can't log in, so access is
 * the gym's display_token — the same row, the same credential, a second
 * screen. verify_jwt = false; the token is the whole auth story, so the
 * explicit column lists below are the contract of what may reach a wall.
 *
 * Nothing that identifies a person or a row leaves: gym ids and session
 * ids are hashed per host so the screen can key animations between polls,
 * and members appear as the name they chose to show on leaderboards.
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
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

type GymRow = {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  points_week: number;
  points_today: number;
  sessions_week: number;
  athletes_week: number;
  days: number[];
  in_now: number;
};

type FeedRow = {
  session_id: string;
  user_id: string;
  partner_id: string;
  type: string;
  started_at: string;
  minutes: number;
  points: number;
};

async function displayKey(scope: string, id: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`gym-league:${scope}:${id}`),
  );
  return Array.from(new Uint8Array(digest).slice(0, 6))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function namesById(ids: string[]): Promise<Map<string, { display_name: string | null; username: string | null }>> {
  if (ids.length === 0) return new Map();
  const { data } = await admin.from("profiles").select("id, display_name, username").in("id", ids);
  return new Map((data ?? []).map((p) => [p.id, { display_name: p.display_name, username: p.username }]));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });

  const url = new URL(req.url);
  const slug = url.searchParams.get("slug")?.trim();
  const token = url.searchParams.get("k")?.trim();
  if (!slug || !token) return json(400, { error: "missing_params" });

  const { data: board } = await admin
    .from("gym_boards")
    .select("partner_id, slug, display_token, enabled, league_enabled, league_radius_km, tz, partners!inner(name, logo_url, logo_bg, address, active)")
    .eq("slug", slug)
    .single();

  // A bad token gets the same shape as a bad slug, a paused league or an
  // inactive partner — no probing which slugs are real.
  const partner = board?.partners as
    | { name: string; logo_url: string | null; logo_bg: string | null; address: string | null; active: boolean }
    | null
    | undefined;
  if (!board || !board.league_enabled || !partner?.active) return json(404, { error: "not_found" });
  if (board.display_token !== token) return json(404, { error: "not_found" });

  const { data: payload, error } = await admin.rpc("_gym_league", { p_partner_id: board.partner_id });
  if (error || !payload) {
    console.error("gym-league payload failed:", error?.message ?? "null payload");
    return json(500, { error: "league_unavailable" });
  }

  const gyms = (payload.gyms ?? []) as GymRow[];
  const feedRows = (payload.feed ?? []) as FeedRow[];
  const scope = board.partner_id;

  const gymKeys = new Map<string, string>();
  for (const g of gyms) gymKeys.set(g.id, await displayKey(scope, g.id));
  const names = await namesById([...new Set(feedRows.map((f) => f.user_id))]);

  const gymsOut = gyms.map((g) => ({
    key: gymKeys.get(g.id)!,
    name: g.name,
    address: g.address,
    lat: g.lat,
    lng: g.lng,
    points_week: g.points_week,
    points_today: g.points_today,
    sessions_week: g.sessions_week,
    athletes_week: g.athletes_week,
    days: g.days,
    in_now: g.in_now,
  }));

  // Only sessions at gyms the screen knows about; a session at a gym with
  // no location would have nowhere to land.
  const feed = [];
  for (const f of feedRows) {
    const gymKey = gymKeys.get(f.partner_id);
    if (!gymKey) continue;
    const who = names.get(f.user_id) ?? { display_name: null, username: null };
    feed.push({
      key: await displayKey(scope, f.session_id),
      gym_key: gymKey,
      display_name: who.display_name,
      username: who.username,
      type: f.type,
      started_at: f.started_at,
      minutes: f.minutes,
      points: f.points,
    });
  }

  return json(200, {
    gym: { name: partner.name, logo_url: partner.logo_url, logo_bg: partner.logo_bg, address: partner.address },
    slug: board.slug,
    host_key: gymKeys.get(board.partner_id) ?? null,
    radius_km: payload.radius_km ?? board.league_radius_km ?? 15,
    tz: payload.tz,
    week_start_at: payload.week_start_at,
    week_end_at: payload.week_end_at,
    day_start_at: payload.day_start_at,
    gyms: gymsOut,
    feed,
    generated_at: new Date().toISOString(),
  });
});
