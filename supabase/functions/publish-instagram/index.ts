// Studio → Instagram, Phase 1: publishes posts made in the admin Studio to
// POWR's OWN Instagram account (studio_social_posts, studio_social_accounts —
// see supabase/migrations/20261001120000_studio_social_posts.sql).
//
// Modes (POST body):
//   { postId }              admin JWT — publish that scheduled post now.
//   { due: true }           cron (x-resolve-token) — publish every scheduled
//                           post whose time has come. Answers at once and
//                           works in the background (a reel can take minutes).
//   { status: true }        admin JWT — connection state + dry-run flag.
//   { connect: { access_token, ig_user_id } }
//                           admin JWT — validate a long-lived token against
//                           /me and store it (no OAuth redirect in Phase 1).
//   { disconnect: true }    admin JWT — forget the stored token.
//
// Graph API: "Instagram API with Instagram Login" on graph.instagram.com
// (IG_GRAPH_HOST to override, e.g. graph.facebook.com for the Facebook-Login
// variant — note refresh_access_token only exists for Instagram-Login tokens).
// Containers are made from short-lived signed URLs of the private
// `studio-social` bucket; videos are polled until status_code = FINISHED.
//
// Idempotent: a row is claimed with UPDATE … WHERE status = 'scheduled'
// RETURNING, so two ticks (or a tick and a "Post now") can never both publish
// it. A row left in 'publishing' by a dead worker is never retried by itself —
// it's marked failed after STALE_MINUTES with a note to check Instagram first.
//
// DRY_RUN (env, default "true" until Jamie connects for real): every Graph
// call is logged, not made; the row is marked published with permalink null
// and a note saying so.
//
// Security: verify_jwt = false (cron is not a user). Admin modes check the
// caller's JWT against admin_roles; the cron mode is gated by x-resolve-token
// via verify_resolve_token (Vault), like the other cron functions.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const GRAPH_HOST = Deno.env.get("IG_GRAPH_HOST") ?? "graph.instagram.com";
const GRAPH_VERSION = Deno.env.get("IG_GRAPH_VERSION") ?? "v21.0";
const GRAPH = `https://${GRAPH_HOST}/${GRAPH_VERSION}`;
const DRY_RUN = (Deno.env.get("DRY_RUN") ?? "true").toLowerCase() !== "false";
const BUCKET = "studio-social";
const MAX_ATTEMPTS = 3;
const STALE_MINUTES = 20;
const VIDEO_POLL_MS = 5_000;
const VIDEO_TIMEOUT_MS = 5 * 60_000;
const REFRESH_WITHIN_DAYS = 10;
const SIGNED_URL_SECONDS = 60 * 60;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-resolve-token",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type MediaItem = { path: string; type: "image" | "video"; width?: number; height?: number };
type Post = {
  id: string;
  kind: "image" | "carousel" | "reel" | "story";
  caption: string;
  media: MediaItem[];
  attempts: number;
};
type Account = { ig_user_id: string; access_token: string; token_expires_at: string | null; username: string | null };

class GraphError extends Error {}

// ── Graph calls ───────────────────────────────────────────────────────────
// Every call goes through here, so a dry run logs exactly what would be sent.
let dryCounter = 0;
async function graph(
  method: "GET" | "POST",
  path: string,
  params: Record<string, string>,
  token: string,
  log: string[],
): Promise<Record<string, unknown>> {
  const shown = Object.entries(params).map(([k, v]) => `${k}=${k.endsWith("_url") ? v.split("?")[0] + "?…" : v}`).join("&");
  const line = `${method} ${GRAPH}/${path}${shown ? ` ${shown}` : ""}`;
  log.push(line);
  if (DRY_RUN) {
    console.log(`[publish-instagram DRY_RUN] ${line}`);
    dryCounter += 1;
    if (path.endsWith("/media_publish")) return { id: `dry-media-${dryCounter}` };
    if (path.endsWith("/media")) return { id: `dry-container-${dryCounter}` };
    if (params.fields === "status_code") return { status_code: "FINISHED" };
    if (params.fields === "permalink") return { permalink: null };
    return {};
  }
  const url = new URL(`${GRAPH}/${path}`);
  const init: RequestInit = { method };
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", token);
  } else {
    const form = new URLSearchParams({ ...params, access_token: token });
    init.body = form;
    init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
  }
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    const e = body?.error ?? {};
    throw new GraphError(
      `Instagram said: ${e.error_user_msg ?? e.message ?? `HTTP ${res.status}`}${e.code ? ` (code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""})` : ""}`,
    );
  }
  return body;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFinished(id: string, token: string, log: string[]) {
  const started = Date.now();
  while (true) {
    const r = await graph("GET", id, { fields: "status_code" }, token, log);
    const code = String(r.status_code ?? "");
    if (code === "FINISHED") return;
    if (code === "ERROR" || code === "EXPIRED") {
      throw new GraphError(`Instagram couldn't process the video (status ${code}).`);
    }
    if (Date.now() - started > VIDEO_TIMEOUT_MS) {
      throw new GraphError("Instagram took more than 5 minutes to process the video.");
    }
    await sleep(VIDEO_POLL_MS);
  }
}

// ── Token ─────────────────────────────────────────────────────────────────
async function loadAccount(admin: SupabaseClient): Promise<Account | null> {
  const { data } = await admin
    .from("studio_social_accounts")
    .select("ig_user_id, access_token, token_expires_at, username")
    .eq("platform", "instagram")
    .maybeSingle();
  return (data as Account) ?? null;
}

// Long-lived Instagram tokens last 60 days and can be refreshed once they're
// at least 24 h old; refresh when within REFRESH_WITHIN_DAYS of expiry.
async function freshToken(admin: SupabaseClient, acct: Account): Promise<string> {
  const exp = acct.token_expires_at ? Date.parse(acct.token_expires_at) : NaN;
  const due = Number.isFinite(exp) && exp - Date.now() < REFRESH_WITHIN_DAYS * 86_400_000;
  if (!due || DRY_RUN) return acct.access_token;
  try {
    const url = new URL(`https://${GRAPH_HOST}/refresh_access_token`);
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", acct.access_token);
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.access_token) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
    const expiresAt = new Date(Date.now() + Number(body.expires_in ?? 5_184_000) * 1000).toISOString();
    await admin.from("studio_social_accounts").update({
      access_token: body.access_token,
      token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }).eq("platform", "instagram");
    return body.access_token as string;
  } catch (e) {
    // Still valid until it expires — use it, and say so in the logs.
    console.error("[publish-instagram] token refresh failed", e);
    return acct.access_token;
  }
}

// ── Publishing ────────────────────────────────────────────────────────────
async function signedUrl(admin: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(`Couldn't sign ${path}: ${error?.message ?? "no url"}`);
  return data.signedUrl;
}

async function publishPost(admin: SupabaseClient, post: Post, acct: Account, token: string) {
  const log: string[] = [];
  const user = acct.ig_user_id;
  const items = post.media ?? [];
  if (!items.length) throw new Error("The post has no media.");
  const urls = await Promise.all(items.map((m) => signedUrl(admin, m.path)));
  const mediaParam = (m: MediaItem, url: string): Record<string, string> => (m.type === "video" ? { video_url: url } : { image_url: url });
  let creationId: string;

  if (post.kind === "carousel") {
    if (items.length < 2 || items.length > 10) throw new Error("A carousel needs 2 to 10 slides.");
    const children: string[] = [];
    for (const [i, m] of items.entries()) {
      const r = await graph("POST", `${user}/media`, {
        ...mediaParam(m, urls[i]),
        ...(m.type === "video" ? { media_type: "VIDEO" } : {}),
        is_carousel_item: "true",
      }, token, log);
      const id = String(r.id);
      if (m.type === "video") await waitFinished(id, token, log);
      children.push(id);
    }
    const r = await graph("POST", `${user}/media`, {
      media_type: "CAROUSEL",
      children: children.join(","),
      caption: post.caption ?? "",
    }, token, log);
    creationId = String(r.id);
    await waitFinished(creationId, token, log);
  } else {
    const m = items[0];
    const params: Record<string, string> = { ...mediaParam(m, urls[0]) };
    if (post.kind === "reel") {
      if (m.type !== "video") throw new Error("A reel needs a video.");
      params.media_type = "REELS";
      params.caption = post.caption ?? "";
    } else if (post.kind === "story") {
      params.media_type = "STORIES"; // stories take no caption
    } else {
      if (m.type !== "image") throw new Error("A feed image post needs a JPEG.");
      params.caption = post.caption ?? "";
    }
    const r = await graph("POST", `${user}/media`, params, token, log);
    creationId = String(r.id);
    if (m.type === "video") await waitFinished(creationId, token, log);
  }

  const pub = await graph("POST", `${user}/media_publish`, { creation_id: creationId }, token, log);
  const mediaId = String(pub.id);
  let permalink: string | null = null;
  try {
    const p = await graph("GET", mediaId, { fields: "permalink" }, token, log);
    permalink = (p.permalink as string) ?? null;
  } catch (e) {
    console.error("[publish-instagram] permalink lookup failed", e);
  }
  return { mediaId, permalink, log };
}

// Claim, publish, record. Never throws.
async function runOne(admin: SupabaseClient, postId: string, opts: { force?: boolean } = {}) {
  const now = new Date().toISOString();
  let q = admin.from("studio_social_posts")
    .update({ status: "publishing", claimed_at: now, updated_at: now, error: null })
    .eq("id", postId)
    .eq("status", "scheduled")
    .lt("attempts", MAX_ATTEMPTS);
  if (!opts.force) q = q.lte("scheduled_at", now);
  const { data: claimed, error } = await q.select("id, kind, caption, media, attempts").maybeSingle();
  if (error) return { id: postId, ok: false, error: error.message };
  if (!claimed) return { id: postId, ok: false, error: "Not claimable (already publishing, published, cancelled, or out of attempts)." };
  const post = claimed as Post;
  const attempts = (post.attempts ?? 0) + 1;

  try {
    const acct = await loadAccount(admin);
    if (!acct && !DRY_RUN) throw new Error("Instagram isn't connected — connect it in Studio → Instagram.");
    const account = acct ?? { ig_user_id: "DRY_RUN_USER", access_token: "DRY_RUN", token_expires_at: null, username: null };
    const token = await freshToken(admin, account);
    const { mediaId, permalink, log } = await publishPost(admin, post, account, token);
    await admin.from("studio_social_posts").update({
      status: "published",
      published_at: new Date().toISOString(),
      ig_media_id: DRY_RUN ? null : mediaId,
      permalink: DRY_RUN ? null : permalink,
      note: DRY_RUN ? `Dry run — nothing was posted. Would have called:\n${log.join("\n")}` : null,
      attempts,
      updated_at: new Date().toISOString(),
    }).eq("id", post.id);
    return { id: post.id, ok: true, dry_run: DRY_RUN, permalink, calls: log };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("studio_social_posts").update({
      status: "failed",
      error: msg.slice(0, 1000),
      attempts,
      updated_at: new Date().toISOString(),
    }).eq("id", post.id);
    return { id: post.id, ok: false, error: msg };
  }
}

async function runDue(admin: SupabaseClient) {
  // A worker that died mid-publish: don't guess whether Instagram got it.
  const stale = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
  await admin.from("studio_social_posts").update({
    status: "failed",
    error: "Stopped mid-publish. Check Instagram before retrying — it may have gone out.",
    updated_at: new Date().toISOString(),
  }).eq("status", "publishing").lt("claimed_at", stale);

  const { data } = await admin.from("studio_social_posts")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .lt("attempts", MAX_ATTEMPTS)
    .order("scheduled_at")
    .limit(10);
  const results = [];
  for (const row of data ?? []) results.push(await runOne(admin, row.id));
  console.log(`[publish-instagram] due run: ${results.length} post(s)`, JSON.stringify(results.map((r) => ({ id: r.id, ok: r.ok, error: r.error }))));
  return results;
}

// ── Auth ──────────────────────────────────────────────────────────────────
async function isAdminCaller(req: Request, admin: SupabaseClient): Promise<boolean> {
  const auth = req.headers.get("Authorization");
  if (!auth) return false;
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return false;
  const { data } = await admin.from("admin_roles").select("user_id").eq("user_id", user.id).maybeSingle();
  return !!data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  // Cron: publish what's due, in the background.
  if (body?.due === true) {
    const token = req.headers.get("x-resolve-token") ?? "";
    const { data: valid } = token ? await admin.rpc("verify_resolve_token", { p_token: token }) : { data: false };
    if (valid !== true) return json({ error: "forbidden" }, 403);
    const work = runDue(admin).catch((e) => console.error("[publish-instagram] due run failed", e));
    // @ts-ignore EdgeRuntime is provided by the Supabase runtime
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work); else await work;
    return json({ ok: true, accepted: true, dry_run: DRY_RUN });
  }

  if (!(await isAdminCaller(req, admin))) return json({ error: "Forbidden: admin access required" }, 403);

  if (body?.status === true) {
    const acct = await loadAccount(admin);
    return json({
      connected: !!acct,
      username: acct?.username ?? null,
      token_expires_at: acct?.token_expires_at ?? null,
      dry_run: DRY_RUN,
    });
  }

  if (body?.disconnect === true) {
    await admin.from("studio_social_accounts").delete().eq("platform", "instagram");
    return json({ ok: true });
  }

  if (body?.connect && typeof body.connect === "object") {
    const c = body.connect as Record<string, unknown>;
    const accessToken = String(c.access_token ?? "").trim();
    const igUserId = String(c.ig_user_id ?? "").trim();
    if (!accessToken || !/^\d+$/.test(igUserId)) return json({ error: "Paste the long-lived token and the numeric Instagram user id." }, 400);
    // Validated for real even in a dry run: this is a read, it posts nothing.
    const url = new URL(`${GRAPH}/me`);
    url.searchParams.set("fields", "user_id,username,account_type");
    url.searchParams.set("access_token", accessToken);
    const res = await fetch(url);
    const me = await res.json().catch(() => ({}));
    if (!res.ok || me?.error) return json({ error: `Instagram rejected the token: ${me?.error?.message ?? `HTTP ${res.status}`}` }, 400);
    const meId = String(me.user_id ?? me.id ?? "");
    if (meId && meId !== igUserId && String(me.id ?? "") !== igUserId) {
      return json({ error: `That token belongs to user ${meId} (@${me.username ?? "?"}), not ${igUserId}.` }, 400);
    }
    const expiresIn = Number(c.expires_in ?? 0);
    const expiresAt = new Date(Date.now() + (expiresIn > 0 ? expiresIn : 60 * 86_400) * 1000).toISOString();
    const { error } = await admin.from("studio_social_accounts").upsert({
      platform: "instagram",
      ig_user_id: igUserId,
      access_token: accessToken,
      token_expires_at: expiresAt,
      username: me.username ?? null,
      updated_at: new Date().toISOString(),
    });
    if (error) return json({ error: error.message }, 500);
    return json({ connected: true, username: me.username ?? null, token_expires_at: expiresAt, dry_run: DRY_RUN });
  }

  if (typeof body?.postId === "string") {
    // "Post now" (or Retry, which first puts the row back to 'scheduled').
    const r = await runOne(admin, body.postId as string, { force: true });
    return json(r, r.ok ? 200 : 422);
  }

  return json({ error: "Unknown request" }, 400);
});
