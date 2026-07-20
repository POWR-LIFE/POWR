import React from 'react';
import { Link } from 'react-router-dom';
import { API_BASE, Callout, CodeBlock, DocsLayout, Endpoint, P, Param, Section, Step, Steps } from './docsShared';

// /docs/api (also served at the legacy /developers) — the reference a
// partner's engineer can integrate from end to end without a call.
// Keys and secrets are managed in the portal at /partner/integration/api.

const BASE = API_BASE;

const TOC = [
    ['overview', 'Overview'],
    ['setup', 'Setting up'],
    ['auth', 'Authentication'],
    ['verify', 'Verify your integration'],
    ['conventions', 'Rate limits & idempotency'],
    ['endpoints', 'REST endpoints'],
    ['webhooks', 'Webhooks'],
    ['signatures', 'Verifying signatures'],
    ['jit', 'Just-in-time minting'],
    ['errors', 'Errors'],
];

export default function DocsApi() {
    return (
        <DocsLayout
            eyebrow="Guide · Partner API v1"
            title="Automate your POWR rewards"
            intro="Push promo codes straight from your commerce system, hear about member redemptions the second they happen, confirm usage programmatically — or skip code pools entirely with just-in-time minting. No more CSV uploads."
            toc={TOC}
        >
            <Section id="overview" title="Overview">
                <P>A promo code moves through four states in POWR:</P>
                <CodeBlock>{`available  → you pushed it into a reward's pool; a member can claim it
reserved   → a member spent points and holds this code in their wallet
used       → you confirmed the code was redeemed in YOUR system
expired    → the code lapsed before being claimed`}</CodeBlock>
                <P>
                    The REST API moves codes in (<code className="font-mono">POST /codes</code>) and confirms usage
                    (<code className="font-mono">POST /reconcile</code>). Webhooks push the other direction — we notify
                    your system on <code className="font-mono">code.assigned</code>, <code className="font-mono">code.used</code> and{' '}
                    <code className="font-mono">pool.low</code>. Base URL:
                </P>
                <CodeBlock>{BASE}</CodeBlock>
                <Callout tone="note" title="Two ways to supply codes">
                    Either <b>pre-load pools</b> and let us reserve from them, or turn on{' '}
                    <a href="#jit" className="underline font-bold">just-in-time minting</a> and we’ll ask your
                    endpoint for a fresh code at each redemption. JIT brands should still keep a small buffer pool
                    loaded so an outage on your side doesn’t become failed redemptions.
                </Callout>
            </Section>

            <Section id="setup" title="Setting up">
                <P>
                    Everything below is configured in the portal under <b>Integration → API</b>, which walks the
                    same four steps and shows live connection health as you go.
                </P>
                <Steps>
                    <Step n="1" title="Create an API key">
                        Portal → <b>Integration → API → Create an API key</b>. It’s shown exactly once — put it
                        in your secret manager before you close the panel. Prove it works with{' '}
                        <code className="font-mono">GET /v1/ping</code> from your server.
                    </Step>
                    <Step n="2" title="Add a webhook endpoint">
                        Register an https URL to receive <code className="font-mono">code.assigned</code>,{' '}
                        <code className="font-mono">code.used</code> and <code className="font-mono">pool.low</code>.
                        Each endpoint gets its own signing secret — verify every delivery against it.
                    </Step>
                    <Step n="3" title="Supply codes">
                        Either push batches with <code className="font-mono">POST /v1/codes</code>, or configure a
                        mint endpoint and turn on JIT so we ask you for a code per redemption.
                    </Step>
                    <Step n="4" title="Verify">
                        Run the portal’s <b>connection test</b> — or the three calls under{' '}
                        <a href="#verify" className="underline font-bold text-[#8a7600]">Verify your integration</a> — and
                        watch every light go green before you go live.
                    </Step>
                </Steps>
            </Section>

            <Section id="auth" title="Authentication">
                <P>
                    Create an API key in the brand portal under <b>Integration → API</b>. The key is shown once —
                    store it in your secret manager. Send it on every request:
                </P>
                <CodeBlock>{`curl ${BASE}/ping \\
  -H "Authorization: Bearer powr_sk_live_…"`}</CodeBlock>
                <P>
                    Keys are scoped to your brand — you can only ever see and act on your own rewards, codes and
                    redemptions. Redemption data never includes member identity. <b>Never use a key in a browser
                    or mobile app</b>; revoke leaked keys immediately in the portal (revocation is instant).
                </P>
            </Section>

            <Section id="verify" title="Verify your integration">
                <P>
                    Three test calls prove every wire is connected — run them during setup, and keep them in
                    your CI or monitoring if you like. None of them touch real codes or members.
                </P>
                <P><b>1. Your key works</b> — and is bound to the right brand:</P>
                <CodeBlock>{`curl ${BASE}/ping -H "Authorization: Bearer powr_sk_live_…"
→ { "ok": true, "brand_name": "Your Brand", "scopes": ["read","write"] }`}</CodeBlock>
                <P><b>2. Your webhook receiver works</b> — fires a signed <code className="font-mono">webhook.test</code> at your endpoint(s) right now and reports each result:</P>
                <CodeBlock>{`curl -X POST ${BASE}/test/webhook -H "Authorization: Bearer powr_sk_live_…"
→ { "ok": true, "results": [{ "url": "https://…", "ok": true, "status": 200 }] }`}</CodeBlock>
                <P><b>3. Your mint endpoint works</b> (JIT only) — sends a <code className="font-mono">test: true</code> mint request and grades the response, telling you exactly which part failed (unreachable, not JSON, bad code format, too slow). Safe to run before you switch minting on:</P>
                <CodeBlock>{`curl -X POST ${BASE}/test/mint -H "Authorization: Bearer powr_sk_live_…"
→ { "ok": true, "elapsed_ms": 412, "code_preview": "SUMMER-9…" }`}</CodeBlock>
                <P>
                    And for the full picture at any time, <code className="font-mono">GET /v1/status</code> returns a one-call
                    health report: key state, each endpoint’s last delivery, JIT state, and live stock per reward.
                    The same checks appear visually as the <b>Connection Health</b> panel on the portal’s API
                    page, so non-developers can see setup is complete too.
                </P>
            </Section>

            <Section id="conventions" title="Rate limits & idempotency">
                <P>
                    Each key may make <b>120 requests per minute</b>; beyond that you’ll receive{' '}
                    <code className="font-mono">429 rate_limited</code>. List endpoints return at most 500 rows per
                    page with a <code className="font-mono">next_cursor</code> to continue.
                </P>
                <P>
                    Mutations (<code className="font-mono">POST /codes</code>, <code className="font-mono">POST /reconcile</code>)
                    accept an <code className="font-mono">Idempotency-Key</code> header. Retrying with the same key within
                    48 hours replays the stored response instead of re-executing — always set one from your retry logic.
                </P>
            </Section>

            <Section id="endpoints" title="REST endpoints">
                <Endpoint verb="GET" path="/v1/ping">
                    Confirms your key works and which brand it is bound to.
                </Endpoint>
                <CodeBlock>{`{ "ok": true, "brand_name": "Your Brand", "scopes": ["read", "write"] }`}</CodeBlock>

                <Endpoint verb="GET" path="/v1/status">
                    One-call connection health report: active keys, each webhook endpoint with its last delivery
                    outcome, JIT/circuit state, and available stock per active reward.
                </Endpoint>

                <Endpoint verb="POST" path="/v1/test/webhook">
                    Sends a signed <code className="font-mono">webhook.test</code> to your active endpoints synchronously and
                    returns each result. Optional body <code className="font-mono">{'{ "endpoint_url": "…" }'}</code> targets one endpoint.
                </Endpoint>

                <Endpoint verb="POST" path="/v1/test/mint">
                    Probes your JIT mint endpoint with a <code className="font-mono">test: true</code> request and grades the
                    response — no code is stored and the mint circuit breaker is untouched.
                </Endpoint>

                <Endpoint verb="GET" path="/v1/rewards">
                    Lists your rewards with live code-pool counts — use this to discover the{' '}
                    <code className="font-mono">reward_id</code> values the other endpoints need.
                </Endpoint>
                <CodeBlock>{`{
  "data": [{
    "id": "1a2b…", "title": "20% off everything", "active": true,
    "integration_type": "POOL", "powr_cost": 180, "code_expiry_days": 90,
    "codes": { "available": 412, "reserved": 38, "used": 129, "expired": 12 }
  }]
}`}</CodeBlock>

                <Endpoint verb="POST" path="/v1/codes">
                    Pushes a batch of codes (max 5,000) into a reward’s pool. Codes are 4–64 characters,
                    letters/digits/hyphens, case-insensitive (stored uppercase).
                </Endpoint>
                <div className="mb-2">
                    <Param name="reward_id" type="uuid" required>The reward to load codes into.</Param>
                    <Param name="codes" type="string[]" required>The codes, exactly as they exist in your system.</Param>
                    <Param name="expires_at" type="ISO 8601">Optional expiry; defaults to the reward’s configured code lifetime.</Param>
                </div>
                <CodeBlock title="Request">{`curl -X POST ${BASE}/codes \\
  -H "Authorization: Bearer powr_sk_live_…" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: batch-2026-07-16" \\
  -d '{ "reward_id": "1a2b…", "codes": ["SUMMER-8FK2Q", "SUMMER-1PX7T"] }'`}</CodeBlock>
                <CodeBlock title="Response">{`{ "accepted": 2, "already_in_pool": 0, "rejected": [], "expires_at": "2026-10-14T…" }`}</CodeBlock>
                <Callout tone="note" title="Codes pushed here can be any shape">
                    Unlike the portal’s manual uploader — which enforces the house{' '}
                    <code className="font-mono">POWR-BRAND-XXXXXX</code> format — the API accepts whatever your
                    system already issues, so you never have to reshape your existing code inventory.
                </Callout>

                <Endpoint verb="GET" path="/v1/codes">
                    Lists a reward’s codes, oldest first.
                    Query params: <code className="font-mono">reward_id</code> (required),{' '}
                    <code className="font-mono">status</code>, <code className="font-mono">limit</code>,{' '}
                    <code className="font-mono">cursor</code>.
                </Endpoint>

                <Endpoint verb="GET" path="/v1/redemptions">
                    Codes assigned to members, oldest first — poll this (or use webhooks) to sync redemptions into
                    your system. Query params: <code className="font-mono">reward_id</code>,{' '}
                    <code className="font-mono">since</code> (ISO 8601), <code className="font-mono">limit</code>,{' '}
                    <code className="font-mono">cursor</code>. Member identity is never included.
                </Endpoint>
                <CodeBlock>{`{
  "data": [{
    "id": "9c8d…", "reward_id": "1a2b…", "reward_title": "20% off everything",
    "code": "SUMMER-8FK2Q", "status": "active", "powr_spent": 180,
    "redeemed_at": "2026-07-16T09:12:33Z", "expires_at": "2026-10-14T…"
  }],
  "next_cursor": "MjAyNi0wNy0…"
}`}</CodeBlock>

                <Endpoint verb="POST" path="/v1/reconcile">
                    Confirms codes were used at your checkout. One-way: only member-assigned
                    (<code className="font-mono">reserved</code>) codes can become <code className="font-mono">used</code> —
                    you can’t release or reassign a code. Send batches (max 5,000) as often as you like;
                    re-sending already-confirmed codes is harmless.
                </Endpoint>
                <div className="mb-2">
                    <Param name="reward_id" type="uuid" required>The reward the codes belong to.</Param>
                    <Param name="codes" type="string[]" required>Codes redeemed in your system.</Param>
                    <Param name="used_at" type="ISO 8601">When they were used (defaults to now; future values are clamped).</Param>
                </div>
                <CodeBlock title="Response">{`{ "submitted": 40, "matched": 38, "marked_used": 31, "already_used": 7, "not_assignable": 0 }`}</CodeBlock>
            </Section>

            <Section id="webhooks" title="Webhooks">
                <P>
                    Register endpoints in the portal under <b>Integration → API → Webhook endpoints</b> (https
                    only). Every event is a signed JSON POST with this envelope:
                </P>
                <CodeBlock>{`{
  "id": "6f0e…",                       // event id (stable across retries)
  "type": "code.assigned",
  "created_at": "2026-07-16T09:12:33Z",
  "data": { … }                         // see per-event fields below
}`}</CodeBlock>
                <div className="mb-2">
                    <Param name="code.assigned" type="event">
                        A member redeemed a reward and now holds one of your codes.{' '}
                        <code className="font-mono">data</code>: brand_name, reward_id, reward_title, code_id, code,
                        assigned_at, expires_at. Use it to activate/verify the code at your checkout in real time.
                    </Param>
                    <Param name="code.used" type="event">
                        A code was confirmed used (by your reconciliation, or POWR staff).{' '}
                        <code className="font-mono">data</code>: brand_name, reward_id, reward_title, code_id, code, used_at.
                    </Param>
                    <Param name="pool.low" type="event">
                        A reward’s available stock dipped to your configured threshold (at most once per reward per
                        24h). <code className="font-mono">data</code>: brand_name, reward_id, reward_title, available,
                        threshold. React by pushing a fresh batch to <code className="font-mono">POST /codes</code>.
                    </Param>
                    <Param name="webhook.test" type="event">
                        Sent by the portal’s Test button.
                    </Param>
                </div>
                <P>
                    Respond with any 2xx within 8 seconds. Non-2xx (or timeouts) are retried with backoff —
                    roughly <b>1m, 5m, 30m, 2h, 6h</b> — then marked failed (manual redelivery is available in the
                    portal). An endpoint failing 30 deliveries in a row is auto-disabled until you re-enable it.
                    Deliveries to the same endpoint arrive in order within a dispatch run, but treat ordering and
                    duplicates defensively: key your handling on the event <code className="font-mono">id</code>.
                </P>
            </Section>

            <Section id="signatures" title="Verifying signatures">
                <P>
                    Every webhook (and JIT mint request) carries an HMAC signature so you can prove it came from POWR:
                </P>
                <CodeBlock>{`X-POWR-Signature: t=1752655953,v1=5257a869e7…
X-POWR-Event: code.assigned
X-POWR-Delivery: 8d3c…                  // unique per delivery attempt`}</CodeBlock>
                <P>
                    Compute HMAC-SHA256 over <code className="font-mono">{'`${t}.${rawBody}`'}</code> with your endpoint’s
                    signing secret (portal → endpoint → “Signing secret”) and compare to <code className="font-mono">v1</code>:
                </P>
                <CodeBlock title="Node.js">{`import crypto from 'node:crypto';

function verifyPowrSignature(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(',').map(p => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // 5 min tolerance
  const expected = crypto.createHmac('sha256', secret)
    .update(\`\${t}.\${rawBody}\`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}`}</CodeBlock>
                <P>
                    Always verify against the <b>raw</b> request body, before any JSON parsing or re-serialisation.
                </P>
            </Section>

            <Section id="jit" title="Just-in-time minting">
                <P>
                    The deepest integration: instead of pre-loading pools, POWR calls <b>your</b> endpoint at the
                    moment a member redeems, and you return a fresh single-use code from your own system. No stock
                    management, no reconciliation — the code is single-use by construction. Configure it in the
                    portal (<b>Integration → API → Just-in-time minting</b>); it applies to rewards using
                    API-validated delivery (ask us to switch a reward over).
                </P>
                <CodeBlock title="POWR → your mint endpoint (signed like a webhook, 3s timeout)">{`{
  "type": "code.mint_request",
  "request_id": "b7e1…",               // idempotency key — same retry, same code
  "brand_name": "Your Brand",
  "reward_id": "1a2b…",
  "reward_title": "20% off everything",
  "expires_at": "2026-10-14T09:12:33Z" // honour this expiry in your system
}`}</CodeBlock>
                <CodeBlock title="Your response (HTTP 200 within 3 seconds)">{`{ "code": "SUMMER-9Q4XN" }`}</CodeBlock>
                <P>
                    If your endpoint times out or errors, POWR falls back to any buffer codes loaded in the reward’s
                    pool; three consecutive failures pause minting for 10 minutes. <b>Keep a small buffer pool
                    loaded</b> so members can still redeem during an outage — the member is never charged points
                    unless a code was secured.
                </P>
                <Callout tone="note" title="Shopify stores get this for free">
                    The <Link to="/docs/shopify" className="underline font-bold">Shopify connector</Link> is JIT
                    minting with POWR supplying the endpoint: connect your store, pick a template discount, and
                    every redemption mints a single-use code in Shopify with no code on your side at all.
                </Callout>
            </Section>

            <Section id="errors" title="Errors">
                <P>Errors return a machine-readable code plus a human message:</P>
                <CodeBlock>{`{ "error": "rate_limited", "message": "Limit is 120 requests per minute per key" }`}</CodeBlock>
                <div>
                    <Param name="401" type="status">missing_key · invalid_key</Param>
                    <Param name="403" type="status">insufficient_scope</Param>
                    <Param name="404" type="status">reward_not_found · not_found</Param>
                    <Param name="400" type="status">invalid_json · missing_codes · too_many_codes · invalid_cursor · invalid_expires_at · reconcile_failed</Param>
                    <Param name="429" type="status">rate_limited — back off and retry after 60s</Param>
                    <Param name="5xx" type="status">Transient — retry with your Idempotency-Key.</Param>
                </div>
            </Section>
        </DocsLayout>
    );
}
