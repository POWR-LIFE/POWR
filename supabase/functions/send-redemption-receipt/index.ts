// Redemption receipt — emails the code (or shop link) when a member redeems.
//
// Invoked by the notify_redemption_receipt() trigger (AFTER INSERT on
// redemptions, via pg_net) with { redemption_id }. Transactional: no
// preference gate. Idempotent: redemptions.receipt_emailed_at is claimed
// before sending and released if the send fails.
//
// Security: verify_jwt=false; gated by x-resolve-token (verify_resolve_token).
// Sample mode for design QA: { sample: true, only_email, kind?: "code"|"link"|"all" }
// with the anon key as Bearer renders against a live reward, touching nothing.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/mailgun.ts";
import { redemptionReceiptEmail } from "../_shared/emails/redemption-receipt.ts";
import { discountLabel } from "../_shared/reward-catalogue.ts";

const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const sample = body?.sample === true;

  const token = req.headers.get("x-resolve-token") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let authed = false;
  if (token) {
    const { data: valid } = await admin.rpc("verify_resolve_token", { p_token: token });
    authed = valid === true;
  }
  if (!authed && sample && ANON_KEY && bearer === ANON_KEY) authed = true;
  if (!authed) return new Response("forbidden", { status: 403 });

  if (sample) {
    const onlyEmail = typeof body?.only_email === "string" ? (body.only_email as string) : null;
    if (!onlyEmail) return json({ error: "only_email required for sample" }, 400);
    const { data: reward } = await admin
      .from("rewards")
      .select("title, brand_name, image_url, hero_image_url, value_label, discount_type, discount_value, terms, url, code_expiry_days")
      .eq("active", true)
      .gt("powr_cost", 0)
      .order("powr_cost", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!reward) return json({ error: "no active reward to sample" }, 404);
    const kinds = body?.kind === "code" || body?.kind === "link" ? [body.kind as string] : ["code", "link"];
    const expiresAt = new Date(Date.now() + (reward.code_expiry_days ?? 30) * 86400_000).toISOString();
    for (const kind of kinds) {
      const email = redemptionReceiptEmail({
        name: "Jamie Wright",
        rewardTitle: reward.title,
        brand: reward.brand_name,
        valueLabel: discountLabel(reward) || null,
        integrationType: kind === "link" ? "AFFILIATE" : "POOL",
        code: kind === "link" ? null : "POWR-7K2Q9X",
        checkoutUrl: reward.url ?? "https://powr.life",
        expiresAt,
        powrSpent: 300,
        balanceAfter: 411,
        terms: reward.terms,
        imageUrl: reward.image_url ?? reward.hero_image_url,
      });
      await sendEmail({ to: onlyEmail, subject: `[${kind}] ${email.subject}`, html: email.html, text: email.text, tag: "redemption-receipt-sample" });
    }
    return json({ ok: true, mode: "sample", to: onlyEmail, kinds });
  }

  const redemptionId = typeof body?.redemption_id === "string" ? (body.redemption_id as string) : null;
  if (!redemptionId) return json({ error: "redemption_id required" }, 400);

  // Claim — first writer wins; a null result means already sent (or unknown id).
  const { data: claimed, error: claimErr } = await admin
    .from("redemptions")
    .update({ receipt_emailed_at: new Date().toISOString() })
    .eq("id", redemptionId)
    .is("receipt_emailed_at", null)
    .select("user_id, reward_id, code, checkout_url, expires_at, integration_type, powr_spent, reward_title, partner_name, reward_image_url")
    .maybeSingle();
  if (claimErr) {
    console.error("send-redemption-receipt: claim failed", claimErr);
    return json({ error: "claim_failed" }, 500);
  }
  if (!claimed) return json({ ok: true, skipped: "already_sent_or_unknown" });

  const release = () =>
    admin.from("redemptions").update({ receipt_emailed_at: null }).eq("id", redemptionId);

  const [{ data: reward }, { data: profile }, { data: authUser }, { data: ledger }] = await Promise.all([
    admin.from("rewards")
      .select("title, brand_name, value_label, discount_type, discount_value, terms, image_url, hero_image_url")
      .eq("id", claimed.reward_id).maybeSingle(),
    admin.from("profiles").select("display_name").eq("id", claimed.user_id).maybeSingle(),
    admin.auth.admin.getUserById(claimed.user_id),
    admin.from("point_transactions").select("amount").eq("user_id", claimed.user_id),
  ]);

  const email = authUser?.user?.email ?? null;
  if (!email) return json({ ok: true, skipped: "no_email" });

  const balanceAfter = (ledger ?? []).reduce((sum: number, t: { amount: number | null }) => sum + (t.amount ?? 0), 0);
  const rendered = redemptionReceiptEmail({
    name: profile?.display_name ?? null,
    rewardTitle: claimed.reward_title ?? reward?.title ?? "Your reward",
    brand: reward?.brand_name ?? claimed.partner_name ?? null,
    valueLabel: reward ? discountLabel(reward) || null : null,
    integrationType: claimed.integration_type,
    // AFFILIATE rows store a receipt id in `code` — it is not something to type in.
    code: claimed.integration_type === "AFFILIATE" ? null : claimed.code,
    checkoutUrl: claimed.checkout_url,
    expiresAt: claimed.expires_at,
    powrSpent: claimed.powr_spent ?? 0,
    balanceAfter,
    terms: reward?.terms ?? null,
    imageUrl: reward?.image_url ?? claimed.reward_image_url ?? reward?.hero_image_url ?? null,
  });

  try {
    await sendEmail({ to: email, subject: rendered.subject, html: rendered.html, text: rendered.text, tag: "redemption-receipt" });
  } catch (err) {
    await release();
    console.error(`send-redemption-receipt: send failed for ${redemptionId}:`, err);
    return json({ error: "send_failed" }, 502);
  }

  return json({ ok: true, sent: true });
});
