import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * App → web session handoff for the affiliate portal.
 *
 * POST { ticket } — the one-time ticket the app got from mint_portal_handoff().
 * Burns it (consume_portal_handoff, service role), then mints a magic-link
 * token for that user with the admin API and returns its hash. The browser
 * calls supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }) and has a
 * normal web session — no password, no provider round-trip, works the same
 * for Apple, Google and email accounts.
 *
 * verify_jwt=false: the caller is an anonymous browser tab. The ticket IS the
 * credential (random 32 bytes, hashed at rest, 90 s TTL, single use), and
 * nothing here is reachable without a valid one.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { ticket?: unknown };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const ticket = typeof body.ticket === "string" ? body.ticket.trim() : "";
  if (!/^[0-9a-f]{64}$/.test(ticket)) return json({ error: "invalid_ticket" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: userId, error: consumeErr } = await admin.rpc("consume_portal_handoff", { p_ticket: ticket });
  if (consumeErr) {
    console.error("[portal-handoff] consume failed", consumeErr);
    return json({ error: "handoff_failed" }, 500);
  }
  if (!userId) return json({ error: "invalid_ticket" }, 401);

  const { data: u, error: userErr } = await admin.auth.admin.getUserById(userId);
  const email = u?.user?.email;
  if (userErr || !email) {
    console.error("[portal-handoff] no email for user", userId, userErr);
    return json({ error: "no_email" }, 400);
  }

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    console.error("[portal-handoff] generateLink failed", linkErr);
    return json({ error: "handoff_failed" }, 500);
  }

  return json({ ok: true, token_hash: tokenHash, type: "magiclink" });
});
