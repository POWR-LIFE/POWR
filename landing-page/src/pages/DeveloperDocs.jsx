import React from 'react';
import { Link } from 'react-router-dom';

// PUBLIC developer documentation for the Partner API + webhooks + JIT minting.
// Deliberately static and dependency-free: a partner's engineer should be able
// to integrate end-to-end from this page alone. Keys and secrets are managed
// in the brand portal (/partner/developers).

const BASE = 'https://powr.life/api/partner/v1';

function CodeBlock({ children, title }) {
    return (
        <div className="my-4 rounded-2xl overflow-hidden border border-[#E6E6E1]">
            {title && (
                <div className="px-5 py-2.5 bg-[#111] border-b border-white/10 text-[10px] uppercase tracking-[0.3em] font-black text-[#888]">{title}</div>
            )}
            <pre className="p-5 bg-[#0d0d0d] text-[12.5px] leading-relaxed text-[#e8e8e2] font-mono overflow-x-auto whitespace-pre">{children}</pre>
        </div>
    );
}

function Method({ verb }) {
    const color = verb === 'GET' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : 'bg-[#E8D200]/15 text-[#8a7600] border-[#E8D200]/40';
    return <span className={`text-[10px] font-black tracking-[0.15em] rounded-full px-3 py-1 border ${color}`}>{verb}</span>;
}

function Endpoint({ verb, path, children }) {
    return (
        <div className="mt-10 mb-6">
            <div className="flex items-center gap-3 flex-wrap">
                <Method verb={verb} />
                <code className="text-[14px] font-mono font-bold text-[#1A1A1A]">{path}</code>
            </div>
            <div className="mt-3 text-[13px] text-[#555] leading-relaxed">{children}</div>
        </div>
    );
}

function Param({ name, type, children, required }) {
    return (
        <div className="flex gap-4 py-2.5 border-b border-[#EFEFEC] text-[12.5px]">
            <code className="font-mono font-bold text-[#1A1A1A] w-44 shrink-0">{name}</code>
            <span className="text-[#999] w-24 shrink-0">{type}{required ? <span className="text-[#8a7600] font-bold"> · req</span> : ''}</span>
            <span className="text-[#555] leading-relaxed">{children}</span>
        </div>
    );
}

function Section({ id, title, children }) {
    return (
        <section id={id} className="mb-16 scroll-mt-24">
            <h2 className="text-3xl font-light tracking-tighter text-[#1A1A1A] mb-4">{title}</h2>
            {children}
        </section>
    );
}

const TOC = [
    ['overview', 'Overview'],
    ['auth', 'Authentication'],
    ['verify', 'Verify your integration'],
    ['conventions', 'Rate limits & idempotency'],
    ['endpoints', 'REST endpoints'],
    ['webhooks', 'Webhooks'],
    ['signatures', 'Verifying signatures'],
    ['jit', 'Just-in-time minting'],
    ['shopify', 'Shopify connector'],
    ['errors', 'Errors'],
];

export default function DeveloperDocs() {
    return (
        <div className="min-h-screen bg-[#F4F4F1] font-['Outfit'] text-[#1A1A1A]">
            {/* Top bar */}
            <header className="sticky top-0 z-50 bg-[#F4F4F1]/80 backdrop-blur-xl border-b border-[#E6E6E1]">
                <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-3">
                        <img src="/powr-logo-black.png" alt="POWR" style={{ height: 22 }} />
                        <span className="text-[10px] uppercase tracking-[0.4em] font-black text-[#8a7600] mt-0.5">Developers</span>
                    </Link>
                    <a href="/partner/developers" className="h-9 px-5 flex items-center bg-[#1A1A1A] text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-full hover:bg-[#333] transition-all">
                        Manage keys →
                    </a>
                </div>
            </header>

            <div className="max-w-6xl mx-auto px-6 py-14 flex gap-14">
                {/* TOC */}
                <nav className="hidden lg:block w-52 shrink-0">
                    <div className="sticky top-24 space-y-1">
                        <div className="text-[10px] uppercase tracking-[0.4em] font-black text-[#BBB] mb-4">Contents</div>
                        {TOC.map(([id, label]) => (
                            <a key={id} href={`#${id}`} className="block py-1.5 text-[12px] font-bold text-[#888] hover:text-[#1A1A1A] transition-colors">{label}</a>
                        ))}
                    </div>
                </nav>

                {/* Body */}
                <main className="flex-1 min-w-0 max-w-3xl">
                    <div className="mb-14">
                        <div className="flex items-center gap-3 mb-5">
                            <div className="h-[1px] w-10 bg-[#8a7600]" />
                            <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Partner API v1</span>
                        </div>
                        <h1 className="text-5xl font-light tracking-tighter mb-5">Automate your POWR rewards</h1>
                        <p className="text-[15px] text-[#666] leading-relaxed">
                            Push promo codes straight from your commerce system, hear about member redemptions the
                            second they happen, confirm usage programmatically — or skip code pools entirely with
                            just-in-time minting. No more CSV uploads.
                        </p>
                    </div>

                    <Section id="overview" title="Overview">
                        <p className="text-[13px] text-[#555] leading-relaxed mb-3">
                            A promo code moves through four states in POWR:
                        </p>
                        <CodeBlock>{`available  → you pushed it into a reward's pool; a member can claim it
reserved   → a member spent points and holds this code in their wallet
used       → you confirmed the code was redeemed in YOUR system
expired    → the code lapsed before being claimed`}</CodeBlock>
                        <p className="text-[13px] text-[#555] leading-relaxed">
                            The REST API moves codes in (<code className="font-mono">POST /codes</code>) and confirms usage
                            (<code className="font-mono">POST /reconcile</code>). Webhooks push the other direction — we notify
                            your system on <code className="font-mono">code.assigned</code>, <code className="font-mono">code.used</code> and{' '}
                            <code className="font-mono">pool.low</code>. Base URL:
                        </p>
                        <CodeBlock>{BASE}</CodeBlock>
                    </Section>

                    <Section id="auth" title="Authentication">
                        <p className="text-[13px] text-[#555] leading-relaxed mb-2">
                            Create an API key in the brand portal under <b>Developers → API Keys</b>. The key is shown once —
                            store it in your secret manager. Send it on every request:
                        </p>
                        <CodeBlock>{`curl ${BASE}/ping \\
  -H "Authorization: Bearer powr_sk_live_…"`}</CodeBlock>
                        <p className="text-[13px] text-[#555] leading-relaxed">
                            Keys are scoped to your brand — you can only ever see and act on your own rewards, codes and
                            redemptions. Redemption data never includes member identity. <b>Never use a key in a browser
                            or mobile app</b>; revoke leaked keys immediately in the portal (revocation is instant).
                        </p>
                    </Section>

                    <Section id="verify" title="Verify your integration">
                        <p className="text-[13px] text-[#555] leading-relaxed mb-2">
                            Three test calls prove every wire is connected — run them during setup, and keep them in
                            your CI or monitoring if you like. None of them touch real codes or members.
                        </p>
                        <p className="text-[13px] text-[#555] leading-relaxed mb-1"><b>1. Your key works</b> — and is bound to the right brand:</p>
                        <CodeBlock>{`curl ${BASE}/ping -H "Authorization: Bearer powr_sk_live_…"
→ { "ok": true, "brand_name": "Your Brand", "scopes": ["read","write"] }`}</CodeBlock>
                        <p className="text-[13px] text-[#555] leading-relaxed mb-1"><b>2. Your webhook receiver works</b> — fires a signed <code className="font-mono">webhook.test</code> at your endpoint(s) right now and reports each result:</p>
                        <CodeBlock>{`curl -X POST ${BASE}/test/webhook -H "Authorization: Bearer powr_sk_live_…"
→ { "ok": true, "results": [{ "url": "https://…", "ok": true, "status": 200 }] }`}</CodeBlock>
                        <p className="text-[13px] text-[#555] leading-relaxed mb-1"><b>3. Your mint endpoint works</b> (JIT only) — sends a <code className="font-mono">test: true</code> mint request and grades the response, telling you exactly which part failed (unreachable, not JSON, bad code format, too slow). Safe to run before you switch minting on:</p>
                        <CodeBlock>{`curl -X POST ${BASE}/test/mint -H "Authorization: Bearer powr_sk_live_…"
→ { "ok": true, "elapsed_ms": 412, "code_preview": "SUMMER-9…" }`}</CodeBlock>
                        <p className="text-[13px] text-[#555] leading-relaxed">
                            And for the full picture at any time, <code className="font-mono">GET /v1/status</code> returns a one-call
                            health report: key state, each endpoint's last delivery, JIT state, and live stock per reward.
                            The same checks appear visually as the <b>Connection Health</b> panel in the portal's Developers
                            page, so non-developers can see setup is complete too.
                        </p>
                    </Section>

                    <Section id="conventions" title="Rate limits & idempotency">
                        <p className="text-[13px] text-[#555] leading-relaxed mb-2">
                            Each key may make <b>120 requests per minute</b>; beyond that you'll receive{' '}
                            <code className="font-mono">429 rate_limited</code>. List endpoints return at most 500 rows per
                            page with a <code className="font-mono">next_cursor</code> to continue.
                        </p>
                        <p className="text-[13px] text-[#555] leading-relaxed">
                            Mutations (<code className="font-mono">POST /codes</code>, <code className="font-mono">POST /reconcile</code>)
                            accept an <code className="font-mono">Idempotency-Key</code> header. Retrying with the same key within
                            48 hours replays the stored response instead of re-executing — always set one from your retry logic.
                        </p>
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
                            Pushes a batch of codes (max 5,000) into a reward's pool. Codes are 4–64 characters,
                            letters/digits/hyphens, case-insensitive (stored uppercase).
                        </Endpoint>
                        <div className="mb-2">
                            <Param name="reward_id" type="uuid" required>The reward to load codes into.</Param>
                            <Param name="codes" type="string[]" required>The codes, exactly as they exist in your system.</Param>
                            <Param name="expires_at" type="ISO 8601">Optional expiry; defaults to the reward's configured code lifetime.</Param>
                        </div>
                        <CodeBlock title="Request">{`curl -X POST ${BASE}/codes \\
  -H "Authorization: Bearer powr_sk_live_…" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: batch-2026-07-16" \\
  -d '{ "reward_id": "1a2b…", "codes": ["SUMMER-8FK2Q", "SUMMER-1PX7T"] }'`}</CodeBlock>
                        <CodeBlock title="Response">{`{ "accepted": 2, "already_in_pool": 0, "rejected": [], "expires_at": "2026-10-14T…" }`}</CodeBlock>

                        <Endpoint verb="GET" path="/v1/codes">
                            Lists a reward's codes, oldest first.
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
                            you can't release or reassign a code. Send batches (max 5,000) as often as you like;
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
                        <p className="text-[13px] text-[#555] leading-relaxed mb-2">
                            Register endpoints in the portal under <b>Developers → Webhook Endpoints</b> (https only). Every
                            event is a signed JSON POST with this envelope:
                        </p>
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
                                A reward's available stock dipped to your configured threshold (at most once per reward per
                                24h). <code className="font-mono">data</code>: brand_name, reward_id, reward_title, available,
                                threshold. React by pushing a fresh batch to <code className="font-mono">POST /codes</code>.
                            </Param>
                            <Param name="webhook.test" type="event">
                                Sent by the portal's Test button.
                            </Param>
                        </div>
                        <p className="text-[13px] text-[#555] leading-relaxed">
                            Respond with any 2xx within 8 seconds. Non-2xx (or timeouts) are retried with backoff —
                            roughly <b>1m, 5m, 30m, 2h, 6h</b> — then marked failed (manual redelivery is available in the
                            portal). An endpoint failing 30 deliveries in a row is auto-disabled until you re-enable it.
                            Deliveries to the same endpoint arrive in order within a dispatch run, but treat ordering and
                            duplicates defensively: key your handling on the event <code className="font-mono">id</code>.
                        </p>
                    </Section>

                    <Section id="signatures" title="Verifying signatures">
                        <p className="text-[13px] text-[#555] leading-relaxed mb-2">
                            Every webhook (and JIT mint request) carries an HMAC signature so you can prove it came from POWR:
                        </p>
                        <CodeBlock>{`X-POWR-Signature: t=1752655953,v1=5257a869e7…
X-POWR-Event: code.assigned
X-POWR-Delivery: 8d3c…                  // unique per delivery attempt`}</CodeBlock>
                        <p className="text-[13px] text-[#555] leading-relaxed mb-2">
                            Compute HMAC-SHA256 over <code className="font-mono">{'`${t}.${rawBody}`'}</code> with your endpoint's
                            signing secret (portal → endpoint → "Signing secret") and compare to <code className="font-mono">v1</code>:
                        </p>
                        <CodeBlock title="Node.js">{`import crypto from 'node:crypto';

function verifyPowrSignature(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(',').map(p => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // 5 min tolerance
  const expected = crypto.createHmac('sha256', secret)
    .update(\`\${t}.\${rawBody}\`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}`}</CodeBlock>
                        <p className="text-[13px] text-[#555] leading-relaxed">
                            Always verify against the <b>raw</b> request body, before any JSON parsing or re-serialisation.
                        </p>
                    </Section>

                    <Section id="jit" title="Just-in-time minting">
                        <p className="text-[13px] text-[#555] leading-relaxed mb-2">
                            The deepest integration: instead of pre-loading pools, POWR calls <b>your</b> endpoint at the
                            moment a member redeems, and you return a fresh single-use code from your own system. No stock
                            management, no reconciliation — the code is single-use by construction. Configure it in the
                            portal (<b>Developers → Just-in-time Minting</b>); it applies to rewards using API-validated
                            delivery (ask us to switch a reward over).
                        </p>
                        <CodeBlock title="POWR → your mint endpoint (signed like a webhook, 3s timeout)">{`{
  "type": "code.mint_request",
  "request_id": "b7e1…",               // idempotency key — same retry, same code
  "brand_name": "Your Brand",
  "reward_id": "1a2b…",
  "reward_title": "20% off everything",
  "expires_at": "2026-10-14T09:12:33Z" // honour this expiry in your system
}`}</CodeBlock>
                        <CodeBlock title="Your response (HTTP 200 within 3 seconds)">{`{ "code": "SUMMER-9Q4XN" }`}</CodeBlock>
                        <p className="text-[13px] text-[#555] leading-relaxed">
                            If your endpoint times out or errors, POWR falls back to any buffer codes loaded in the reward's
                            pool; three consecutive failures pause minting for 10 minutes. <b>Keep a small buffer pool
                            loaded</b> so members can still redeem during an outage — the member is never charged points
                            unless a code was secured.
                        </p>
                    </Section>

                    <Section id="shopify" title="Shopify connector">
                        <p className="text-[13px] text-[#555] leading-relaxed mb-2">
                            If your store runs on Shopify you don't need any of the API above. In the portal
                            (<b>Developers → Shopify</b>): enter your store domain, approve two permissions
                            (create discounts, read orders), then pick which of your existing discounts each
                            POWR reward should mint from. That's the entire integration.
                        </p>
                        <p className="text-[13px] text-[#555] leading-relaxed mb-2">
                            <b>Every redemption creates a brand-new, unique code — never a shared one.</b> When a
                            member redeems, POWR clones your template discount into a fresh code (e.g.{' '}
                            <code className="font-mono">POWR-8FK2Q3XN</code>) created directly in your Shopify store with:
                        </p>
                        <CodeBlock>{`usage limit:        1          // Shopify enforces one checkout use, ever
applies once per customer:  yes
expiry:             matches the member's wallet expiry
value & rules:      cloned from your chosen template discount`}</CodeBlock>
                        <p className="text-[13px] text-[#555] leading-relaxed mb-2">
                            So a code shared in a group chat is worthless after its first use — Shopify itself
                            rejects the second attempt. Your template discount is never handed out; it only
                            defines what the minted codes are worth (percentage or fixed amount).
                        </p>
                        <p className="text-[13px] text-[#555] leading-relaxed">
                            Reconciliation is automatic too: the moment a code is used at your checkout, the
                            order webhook marks it <code className="font-mono">used</code> in POWR — no exports, no
                            uploads. If you uninstall the app, minting stops immediately and members fall back
                            to any buffer codes you've loaded.
                        </p>
                    </Section>

                    <Section id="errors" title="Errors">
                        <p className="text-[13px] text-[#555] leading-relaxed mb-2">
                            Errors return a machine-readable code plus a human message:
                        </p>
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

                    <div className="pt-8 pb-20 border-t border-[#E6E6E1]">
                        <p className="text-[13px] text-[#777]">
                            Questions or want a reward switched to just-in-time minting?{' '}
                            <a href="mailto:partners@powr.life" className="font-bold text-[#8a7600] hover:underline">partners@powr.life</a>
                        </p>
                    </div>
                </main>
            </div>
        </div>
    );
}
