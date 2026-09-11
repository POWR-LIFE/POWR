import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { LEVELS, TIER_COLOR, TIER_LABEL } from "../_shared/levels.ts";

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
  minutes?: number;
  today_points?: number;
  total_earned?: number | null;
  streak?: number;
  is_new?: boolean;
  is_pb?: boolean;
  last_week_points?: number;
  member_since?: string | null;
};

type ActivityRow = {
  session_id: string;
  user_id: string;
  s_type: string;
  started_at: string;
  ended_at: string;
  minutes: number;
  points: number;
  verification: string;
};

// Level from lifetime points — same ladder as the app (constants/levels.ts
// via _shared/levels.ts). Number, name and tier colour; never the raw XP.
function levelBits(totalEarned: number | null | undefined) {
  if (totalEarned == null) return null;
  let def = LEVELS[0];
  for (const l of LEVELS) if (totalEarned >= l.xpMin) def = l;
  return { level: def.level, name: def.name, tier: TIER_LABEL[def.tier], colour: TIER_COLOR[def.tier] };
}

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
      "partner_id, slug, display_token, enabled, board_size, tz, viewing, partners!inner(name, logo_url, logo_bg, image1_url, address, active)",
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

  const [
    { data: payload, error },
    { data: activityRows, error: actErr },
    { data: communityRaw, error: comErr },
    { data: beyondRaw, error: beyErr },
  ] = await Promise.all([
    admin.rpc("gym_board_payload", { p_partner_id: board.partner_id }),
    admin.rpc("_gym_board_activity", { p_partner_id: board.partner_id, p_limit: 24 }),
    admin.rpc("_gym_board_community", { p_partner_id: board.partner_id }),
    admin.rpc("_gym_board_beyond", { p_partner_id: board.partner_id }),
  ]);
  if (error || !payload) {
    console.error("gym-board payload failed:", error?.message ?? "null payload");
    return json(500, { error: "board_unavailable" });
  }
  // The feed is decoration; a failed feed never blanks the board.
  if (actErr) console.error("gym-board activity failed:", actErr.message);
  if (comErr) console.error("gym-board community failed:", comErr.message);
  if (beyErr) console.error("gym-board beyond failed:", beyErr.message);
  // deno-lint-ignore no-explicit-any
  const beyond = (beyondRaw ?? null) as any;
  const longestIds: string[] = Object.values(beyond?.longest ?? {})
    // deno-lint-ignore no-explicit-any
    .map((l: any) => l?.user_id)
    .filter(Boolean) as string[];
  const activity = (activityRows ?? []) as ActivityRow[];
  // deno-lint-ignore no-explicit-any
  const community = (communityRaw ?? null) as any;
  const longestId: string | undefined = community?.streaks?.longest?.user_id;

  const standings = (payload.standings ?? []) as ScoreRow[];
  const podium = (payload.last_week?.podium ?? []) as ScoreRow[];
  const spot = payload.spotlight ?? {};
  const spotIds: string[] = [
    spot.session?.user_id,
    spot.improved?.user_id,
    ...((spot.new_members ?? []) as string[]),
  ].filter(Boolean);
  const profiles = await profilesById([
    ...standings.map((r) => r.user_id),
    ...podium.map((r) => r.user_id),
    ...spotIds,
    ...activity.map((a) => a.user_id),
    ...(longestId ? [longestId] : []),
    ...longestIds,
  ]);

  const who = async (userId: string) => ({
    key: await displayKey(board.partner_id, userId),
    ...(profiles.get(userId) ?? NO_PROFILE),
  });

  const row = async (r: ScoreRow) => ({
    ...(await who(r.user_id)),
    rank: r.rank,
    points: r.score,
    sessions: r.sessions,
    active_days: r.active_days ?? null,
    rank_delta: r.prev_rank == null ? null : r.prev_rank - r.rank,
    minutes: r.minutes ?? 0,
    today_points: r.today_points ?? 0,
    streak: r.streak ?? 0,
    is_new: !!r.is_new,
    is_pb: !!r.is_pb,
    last_week_points: r.last_week_points ?? 0,
    level: levelBits(r.total_earned),
    member_since: r.member_since ?? null,
  });

  const spotlight = {
    session: spot.session
      ? { ...(await who(spot.session.user_id)), points: spot.session.points, type: spot.session.type, started_at: spot.session.started_at, minutes: spot.session.minutes }
      : null,
    improved: spot.improved
      ? { ...(await who(spot.improved.user_id)), this_week: spot.improved.this_week, last_week: spot.improved.last_week, gain: spot.improved.gain }
      : null,
    new_members: await Promise.all(((spot.new_members ?? []) as string[]).map(who)),
  };

  // Session ids are hashed the same way as user ids — stable per poll so
  // the marquee can key on them, meaningless off this screen.
  const feed = await Promise.all(activity.map(async (a) => ({
    ...(await who(a.user_id)),
    // after the spread: one member has many sessions, the card is the session
    key: await displayKey(board.partner_id, a.session_id),
    type: a.s_type,
    started_at: a.started_at,
    ended_at: a.ended_at,
    minutes: a.minutes,
    points: a.points,
    verified: a.verification !== "manual",
  })));

  // Community block: aggregates straight through, the one member id
  // (longest streak) resolved and hashed like every other row.
  const communityOut = community
    ? {
        ...community,
        streaks: {
          on_7plus: community.streaks?.on_7plus ?? 0,
          on_30plus: community.streaks?.on_30plus ?? 0,
          longest: longestId
            ? { ...(await who(longestId)), streak: community.streaks.longest.streak }
            : null,
        },
      }
    : null;

  // Beyond the gym: aggregates straight through; the four longest-effort
  // callouts get a name and avatar, never an id.
  let beyondOut = null;
  if (beyond) {
    const longest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(beyond.longest ?? {})) {
      // deno-lint-ignore no-explicit-any
      const l = v as any;
      longest[k] = l?.user_id
        ? { ...(await who(l.user_id)), km: l.km ?? null, minutes: l.minutes ?? null, steps: l.steps ?? null, started_at: l.started_at }
        : null;
    }
    beyondOut = { ...beyond, longest };
  }

  return json(200, {
    gym: {
      name: partner.name,
      logo_url: partner.logo_url,
      logo_bg: partner.logo_bg,
      image_url: partner.image1_url,
      address: partner.address,
    },
    slug: board.slug,
    viewing: board.viewing ?? "standard",
    tz: payload.tz,
    week_start_at: payload.week_start_at,
    week_end_at: payload.week_end_at,
    day_start_at: payload.day_start_at,
    stats: payload.stats ?? { members: 0, points: 0, sessions: 0, minutes: 0 },
    spotlight,
    activity: feed,
    community_stats: communityOut,
    beyond: beyondOut,
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
