import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Public JSON feed for the Series screen on a gym's TV
 * (powr.life/series/tv/<slug>?k=<display_token>).
 *
 * Third sibling of gym-board and gym-league: the TV can't log in, so access
 * is the gym's display_token — the same row, the same credential, a third
 * screen. verify_jwt = false; the token is the whole auth story, so the
 * explicit fields below are the contract of what may reach a wall.
 *
 * Nothing per member is served. The screen shows the season, the round's
 * dates, the prizes entered in /admin/series, and the size of the crowd on
 * the start line (the same sum the app shows) — never a name.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = "https://powr.life";

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

type SeasonRow = { id: string; slug: string; name: string; look: string; number: number; code: string | null; starts_on: string; ends_on: string };
type RoundRow = { id: string; slug: string; name: string; starts_at: string; ends_at: string; invite_from: string | null; draw_days: number };

/**
 * The season the app wears — series_status()'s pick, made here because the
 * screen has no member: the published season on today (London), else the
 * next to start, else the last to end.
 */
async function currentSeason(): Promise<SeasonRow | null> {
  const { data } = await admin
    .from("series_seasons")
    .select("id, slug, name, look, number, code, starts_on, ends_on")
    .eq("published", true);
  const rows = (data ?? []) as SeasonRow[];
  if (rows.length === 0) return null;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const on = rows.filter((s) => s.starts_on <= today && today <= s.ends_on).sort((a, b) => b.ends_on.localeCompare(a.ends_on))[0];
  if (on) return on;
  const next = rows.filter((s) => s.starts_on > today).sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0];
  if (next) return next;
  return rows.sort((a, b) => b.ends_on.localeCompare(a.ends_on))[0];
}

/** The round the screen is about: on now, else the next to start, else the last to end — and the one after it. */
function pickRounds(rounds: RoundRow[], nowMs: number): { round: RoundRow | null; next: RoundRow | null } {
  const sorted = [...rounds].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const on = sorted.find((r) => Date.parse(r.starts_at) <= nowMs && nowMs < Date.parse(r.ends_at));
  const upcoming = sorted.filter((r) => Date.parse(r.starts_at) > nowMs);
  const round = on ?? upcoming[0] ?? [...sorted].reverse().find((r) => Date.parse(r.ends_at) <= nowMs) ?? null;
  const next = round ? sorted.find((r) => Date.parse(r.starts_at) >= Date.parse(round.ends_at)) ?? null : null;
  return { round, next };
}

const pub = (r: RoundRow | null) =>
  r ? { slug: r.slug, name: r.name, starts_at: r.starts_at, ends_at: r.ends_at, invite_from: r.invite_from, draw_days: r.draw_days } : null;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });

  const url = new URL(req.url);
  const slug = url.searchParams.get("slug")?.trim();
  const token = url.searchParams.get("k")?.trim();
  if (!slug || !token) return json(400, { error: "missing_params" });

  // `*` on the board row so the screen keeps answering while series_enabled
  // is still rolling out; only the fields named below ever leave.
  const { data: board } = await admin
    .from("gym_boards")
    .select("*, partners!inner(name, city, active)")
    .eq("slug", slug)
    .single();

  // A bad token gets the same shape as a bad slug, a paused screen or an
  // inactive partner — no probing which slugs are real.
  const partner = board?.partners as { name: string; city: string | null; active: boolean } | null | undefined;
  if (!board || board.series_enabled === false || !partner?.active) return json(404, { error: "not_found" });
  if (board.display_token !== token) return json(404, { error: "not_found" });

  const nowMs = Date.now();
  const season = await currentSeason();

  let round: RoundRow | null = null;
  let next: RoundRow | null = null;
  if (season) {
    const { data: rounds } = await admin
      .from("series_rounds")
      .select("id, slug, name, starts_at, ends_at, invite_from, draw_days")
      .eq("season_id", season.id)
      .eq("published", true);
    ({ round, next } = pickRounds((rounds ?? []) as RoundRow[], nowMs));
  }

  let prizes: unknown[] = [];
  let crowd: unknown = null;
  if (round) {
    const { data: prizeRows } = await admin
      .from("series_prizes")
      .select("kind, place, name, sponsor, detail, winners")
      .eq("round_id", round.id)
      .order("place", { ascending: true, nullsFirst: false });
    prizes = prizeRows ?? [];
    // Null until 20261102150000 is applied, or on any error: the rail then
    // simply has no crowd line.
    const { data: crowdRow, error: crowdErr } = await admin.rpc("_series_screen_crowd", { p_round: round.id });
    if (crowdErr) console.error("series-screen crowd failed:", crowdErr.message);
    crowd = crowdErr ? null : crowdRow ?? null;
  }

  return json(200, {
    slug: board.slug,
    tz: board.tz ?? "Europe/London",
    gym: { name: partner.name, city: partner.city ?? null },
    season: season ? { slug: season.slug, name: season.name, look: season.look, number: season.number, code: season.code } : null,
    round: pub(round),
    next_round: pub(next),
    prizes,
    crowd,
    join_url: `${SITE}/series`,
    generated_at: new Date(nowMs).toISOString(),
  });
});
