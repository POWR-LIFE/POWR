import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Public JSON feed for the big-screen venue display (powr.life/live/<slug>).
 *
 * A TV at the venue can't log in, so access is gated by the event's
 * display_token (?k=) — unguessable, admin-regenerable, and granting
 * DISPLAY access only: the lock rules hold here exactly as they do in the
 * app. While the board is locked or hidden the payload contains nothing
 * score-shaped — the blur must be server-side because anything sent to the
 * screen is readable off the wire (verify_jwt = false; the token is the
 * whole auth story).
 *
 * An edge function rather than an anon-callable SECURITY DEFINER RPC to
 * stay inside the definer-lint budget (same reasoning as share-card-og).
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
      // The screen polls; a cached response would freeze the night.
      "Cache-Control": "no-store",
    },
  });
}

type ProfileBits = {
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

// The display animates rank changes, so each row needs an identity that is
// stable across polls — but user ids must not leave the server. A truncated
// hash scoped to the event is stable, non-reversible, and useless anywhere
// else.
async function displayKey(eventId: string, userId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${eventId}:${userId}`),
  );
  return Array.from(new Uint8Array(digest).slice(0, 6))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Keyed by id, but the returned bits deliberately exclude it — this endpoint
// is public and user ids have no business on a TV feed.
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

  // Explicit column list: this is a public endpoint holding a service-role
  // client — the select doubles as the contract of what it may ever expose.
  const { data: ev } = await admin
    .from("live_events")
    .select(
      "id, name, slug, status, window_start_at, window_end_at, lock_at, prizes, board_size, hidden, revealed_at, display_token, entry_gate_mode, entry_gate_n, entry_gate_counting, scope, venue_partner_id, logo_url, doors_open_at, reveal_at",
    )
    .eq("slug", slug)
    .single();

  // Archived events don't exist as far as any screen is concerned, and a
  // bad token gets the same shape as a bad slug — no probing which slugs
  // are real.
  if (!ev || ev.status === "archived") {
    return json(404, { error: "not_found" });
  }
  if (ev.display_token !== token) return json(404, { error: "not_found" });

  // Draft + valid token = the admin styling the screen before the event is
  // announced: render the countdown rather than a dead link. Without the
  // token a draft stays invisible exactly as before, and nothing
  // score-shaped exists on a draft to leak.
  const isDraft = ev.status === "draft";

  // The venue's mark for the header, and how many are in. Neither is
  // score-shaped, so both ride on every state (countdown and locked too).
  // Entrants only means something on an opt-in event — a global one ranks
  // everyone, joined or not.
  const [{ data: venue }, { count: entrants }] = await Promise.all([
    ev.venue_partner_id
      ? admin.from("partners").select("name, logo_url, logo_bg").eq("id", ev.venue_partner_id).maybeSingle()
      : Promise.resolve({ data: null }),
    ev.scope === "opt_in"
      ? admin.from("live_event_participants").select("user_id", { count: "exact", head: true })
        .eq("event_id", ev.id).is("disqualified_at", null)
      : Promise.resolve({ count: null }),
  ]);

  const base = {
    name: ev.name,
    slug: ev.slug,
    window_start_at: ev.window_start_at,
    window_end_at: ev.window_end_at,
    lock_at: ev.lock_at,
    doors_open_at: ev.doors_open_at,
    reveal_at: ev.reveal_at,
    prizes: ev.prizes ?? [],
    logo_url: ev.logo_url,
    venue: venue ? { name: venue.name, logo_url: venue.logo_url, logo_bg: venue.logo_bg } : null,
    entrants: entrants ?? null,
    gate: ev.entry_gate_n > 0
      ? { n: ev.entry_gate_n, counting: ev.entry_gate_counting, mode: ev.entry_gate_mode }
      : null,
    generated_at: new Date().toISOString(),
  };

  // Frozen results once revealed — the winners card the room saw.
  if (ev.status === "revealed" || ev.status === "settled") {
    const { data: rows } = await admin
      .from("live_event_results")
      .select("rank, user_id, final_points, prize_label")
      .eq("event_id", ev.id)
      .order("rank");
    const profiles = await profilesById((rows ?? []).map((r) => r.user_id));
    return json(200, {
      ...base,
      state: "revealed",
      revealed_at: ev.revealed_at,
      settled: ev.status === "settled",
      results: await Promise.all((rows ?? []).map(async (r) => ({
        key: await displayKey(ev.id, r.user_id),
        rank: r.rank,
        points: r.final_points,
        prize_label: r.prize_label,
        ...(profiles.get(r.user_id) ?? { display_name: null, username: null, avatar_url: null }),
      }))),
    });
  }

  const effectiveLocked =
    ev.status === "locked" ||
    ev.hidden ||
    (ev.lock_at && new Date(ev.lock_at) <= new Date());

  // Locked/hidden: the suspense screen. Nothing score-shaped leaves the
  // server — this is the blur.
  if (effectiveLocked) return json(200, { ...base, state: "locked" });

  // Announced ("Coming soon") is pre-registration: a countdown, never a board.
  if (isDraft || ev.status === "announced" || ev.status === "scheduled") {
    return json(200, { ...base, state: "countdown" });
  }

  // Live board: standings from the single scoring definition. In 'deadline'
  // gate mode the room sees everyone registered — the invite requirement is
  // applied at Settle, not here. 'entry' mode keeps the door on the live board.
  const { data: scores, error } = await admin.rpc("_live_event_scores", {
    p_event_id: ev.id,
    p_enforce_gate: ev.entry_gate_mode === "entry",
  });
  if (error) {
    console.error("event-board scores failed:", error.message);
    return json(500, { error: "scores_unavailable" });
  }
  const scorers = (scores ?? [])
    .filter((r: { score: number }) => r.score > 0)
    .sort((a: { rank: number }, b: { rank: number }) => a.rank - b.rank);
  const top = scorers.slice(0, ev.board_size);
  const profiles = await profilesById(top.map((r: { user_id: string }) => r.user_id));

  // Movement since the scoring day began: previous rank per user from the
  // reference snapshot (live_event_rank_snapshots, 15-min cron). Missing
  // reference → no arrow; a failed lookup degrades to no arrows, never to a
  // dead board.
  const prevRank = new Map<string, number>();
  const { data: deltas, error: deltaErr } = await admin.rpc("_live_event_rank_deltas", { p_event_id: ev.id });
  if (deltaErr) console.error("event-board rank deltas failed:", deltaErr.message);
  for (const d of (deltas ?? []) as { user_id: string; prev_rank: number }[]) prevRank.set(d.user_id, d.prev_rank);

  // "Landing now": the latest counted credits of people on the board, from
  // the same ledger the scores come from (so the feed can never show a
  // workout the score didn't count). Anyone not on the board — gated out in
  // entry mode, or below board_size — stays off the feed too. Room totals
  // cover every scorer. A failed read degrades to no feed, never a dead board.
  const keyOf = new Map<string, string>();
  for (const r of top as { user_id: string }[]) keyOf.set(r.user_id, await displayKey(ev.id, r.user_id));
  const scorerIds = new Set(scorers.map((r: { user_id: string }) => r.user_id));
  const { data: ledger, error: ledgerErr } = await admin.rpc("_live_event_ledger", { p_event_id: ev.id });
  if (ledgerErr) console.error("event-board ledger failed:", ledgerErr.message);
  type LedgerRow = { tx_id: string; user_id: string; amount: number; activity: string | null; bucket: string; counted: boolean; counted_at: string | null };
  const counted = ((ledger ?? []) as LedgerRow[]).filter((r) => r.counted && scorerIds.has(r.user_id));
  const feedRows = counted
    .filter((r) => r.amount > 0 && keyOf.has(r.user_id) && r.counted_at)
    .sort((a, b) => (a.counted_at! < b.counted_at! ? 1 : -1))
    .slice(0, 16);
  const feed = await Promise.all(feedRows.map(async (r) => ({
    key: await displayKey(ev.id, r.tx_id),
    who: keyOf.get(r.user_id)!,
    type: r.bucket === "activity" ? (r.activity ?? "session") : r.bucket,
    points: r.amount,
    at: r.counted_at,
    ...(profiles.get(r.user_id) ?? { display_name: null, username: null, avatar_url: null }),
  })));
  const room = {
    points: scorers.reduce((s: number, r: { score: number }) => s + r.score, 0),
    sessions: new Set(counted.filter((r) => r.bucket === "activity").map((r) => r.tx_id)).size,
  };

  return json(200, {
    ...base,
    state: "live",
    scorers: scorers.length,
    room,
    feed,
    standings: await Promise.all(top.map(async (r: { rank: number; score: number; user_id: string }) => ({
      key: await displayKey(ev.id, r.user_id),
      rank: r.rank,
      rank_delta: prevRank.has(r.user_id) ? prevRank.get(r.user_id)! - r.rank : null,
      points: r.score,
      ...(profiles.get(r.user_id) ?? { display_name: null, username: null, avatar_url: null }),
    }))),
  });
});
