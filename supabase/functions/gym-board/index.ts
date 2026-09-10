import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Public JSON feed for a gym's big-screen weekly leaderboard
 * (powr.life/gym/<slug>?k=<display_token>).
 *
 * Sibling of event-board: a TV on the gym floor can't log in, so access is
 * the board's display_token — unguessable, admin-regenerable, and granting
 * DISPLAY access only. verify_jwt = false; the token is the whole auth
 * story, so the explicit column lists below are the contract of what may
 * ever reach the screen. User ids never leave: rows carry a hash scoped to
 * the gym so the display can animate rank changes between polls.
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
      // The screen polls; a cached response would freeze the wall.
      "Cache-Control": "no-store",
    },
  });
}

type ProfileBits = {
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

const NO_PROFILE: ProfileBits = { display_name: null, username: null, avatar_url: null };

type ScoreRow = {
  user_id: string;
  score: number;
  sessions: number;
  active_days?: number;
  rank: number;
  prev_rank?: number | null;
};

async function displayKey(scope: string, userId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`gym-board:${scope}:${userId}`),
  );
  return Array.from(new Uint8Array(digest).slice(0, 6))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function profilesById(ids: string[]): Promise<Map<string, ProfileBits>> {
  if (ids.length === 0) return new Map();
  const { data } = await admin
    .from("profiles")
    .select("id, display_name, username, avatar_url")
    .in("id", ids);
  return new Map((data ?? []).map((p) => [
    p.id,
    { display_name: p.display_name, username: p.username, avatar_url: p.avatar_url },
  ]));
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
    .select(
      "partner_id, slug, display_token, enabled, board_size, tz, partners!inner(name, logo_url, logo_bg, image1_url, address, active)",
    )
    .eq("slug", slug)
    .single();

  // A bad token gets the same shape as a bad slug, a paused board or an
  // inactive partner — no probing which slugs are real.
  const partner = board?.partners as
    | { name: string; logo_url: string | null; logo_bg: string | null; image1_url: string | null; address: string | null; active: boolean }
    | null
    | undefined;
  if (!board || !board.enabled || !partner?.active) return json(404, { error: "not_found" });
  if (board.display_token !== token) return json(404, { error: "not_found" });

  const { data: payload, error } = await admin.rpc("gym_board_payload", { p_partner_id: board.partner_id });
  if (error || !payload) {
    console.error("gym-board payload failed:", error?.message ?? "null payload");
    return json(500, { error: "board_unavailable" });
  }

  const standings = (payload.standings ?? []) as ScoreRow[];
  const podium = (payload.last_week?.podium ?? []) as ScoreRow[];
  const profiles = await profilesById([
    ...standings.map((r) => r.user_id),
    ...podium.map((r) => r.user_id),
  ]);

  const row = async (r: ScoreRow) => ({
    key: await displayKey(board.partner_id, r.user_id),
    rank: r.rank,
    points: r.score,
    sessions: r.sessions,
    active_days: r.active_days ?? null,
    rank_delta: r.prev_rank == null ? null : r.prev_rank - r.rank,
    ...(profiles.get(r.user_id) ?? NO_PROFILE),
  });

  return json(200, {
    gym: {
      name: partner.name,
      logo_url: partner.logo_url,
      logo_bg: partner.logo_bg,
      image_url: partner.image1_url,
      address: partner.address,
    },
    slug: board.slug,
    tz: payload.tz,
    week_start_at: payload.week_start_at,
    week_end_at: payload.week_end_at,
    day_start_at: payload.day_start_at,
    stats: payload.stats ?? { members: 0, points: 0, sessions: 0 },
    community: payload.community ?? 0,
    standings: await Promise.all(standings.map(row)),
    last_week: {
      week_start_at: payload.last_week?.week_start_at ?? null,
      week_end_at: payload.last_week?.week_end_at ?? null,
      podium: await Promise.all(podium.map(row)),
    },
    generated_at: new Date().toISOString(),
  });
});
