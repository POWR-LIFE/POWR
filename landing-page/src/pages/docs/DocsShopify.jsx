import React from 'react';
import { Callout, CodeBlock, DocsLayout, NextUp, P, Section, Step, Steps, Table } from './docsShared';

// /docs/shopify — the connector, documented for a store owner rather than a
// developer. Mirrors the portal's three-step Shopify setup flow.

const TOC = [
    ['how', 'How it works'],
    ['before', 'Before you start'],
    ['connect', 'Step 1 · Connect your store'],
    ['permissions', 'What you’re approving'],
    ['template', 'Choosing a template discount'],
    ['map', 'Step 2 · Map your rewards'],
    ['test', 'Step 3 · Test the loop'],
    ['minted', 'What a minted code looks like'],
    ['reconcile', 'Reconciliation'],
    ['fallback', 'Outages & the fallback pool'],
    ['troubleshoot', 'Troubleshooting'],
];

export default function DocsShopify() {
    return (
        <DocsLayout
            eyebrow="Guide · Shopify"
            title="Connect Shopify, forget about codes"
            intro="The least work of the three methods, and the only one where single use is enforced by your store rather than trusted. Connect once, tell us which discount each reward should be based on, and every redemption mints its own fresh code — marked used the moment it’s spent at your checkout."
            toc={TOC}
        >
            <Section id="how" title="How it works">
                <P>
                    You create one ordinary discount in Shopify — your <b>template</b> — and it never gets handed
                    to anyone. It exists only to describe what a reward is worth: 20% off, £10 off, restricted to
                    a collection, whatever you configure.
                </P>
                <P>
                    When a member redeems, POWR clones that template into a brand-new discount code in your
                    store, with a usage limit of one, and gives that code to the member. Nobody ever shares a
                    code that works twice — Shopify itself rejects the second attempt. When the code is spent,
                    your store tells us, and we mark it used.
                </P>
                <CodeBlock>{`your template discount        (never given out — just the recipe)
        │
        │  member redeems
        ▼
POWR-8FK2Q3XN                 (created in your store, usage limit 1)
        │
        │  spent at your checkout
        ▼
marked used in POWR           (automatic — no export, no upload)`}</CodeBlock>
                <P>
                    There is nothing to host, no keys to store, and no stock to keep topped up. Codes are minted
                    on demand, so you can never run out.
                </P>
            </Section>

            <Section id="before" title="Before you start">
                <P>
                    <b>A Shopify store you can install apps on.</b> You’ll need permission to approve an app —
                    on most plans that means the store owner or a staff account with app permissions.
                </P>
                <P>
                    <b>At least one digital reward.</b> Create it under <b>My Rewards</b>, set to{' '}
                    <b>Digital · unique code</b>. It does <em>not</em> need to be live in the app yet — in fact
                    wiring up minting before you go live is the right order, so no member can ever meet a live
                    reward that can’t deliver.
                </P>
                <P>
                    <b>Shopify as your delivery method.</b> Portal → <b>Integration</b> → choose <b>Shopify</b>.
                </P>
            </Section>

            <Section id="connect" title="Step 1 · Connect your store">
                <Steps>
                    <Step n="1" title="Enter your store domain">
                        On the Shopify page, type your <code className="font-mono">.myshopify.com</code> domain —
                        the permanent one, not a custom domain you’ve pointed at the store:
                        <CodeBlock>{`your-store.myshopify.com        ✓
shop.yourbrand.com              ✗ (custom domain)
yourbrand.com                   ✗`}</CodeBlock>
                        You can find it in Shopify under <b>Settings → Domains</b>, listed as the
                        “myshopify.com domain”.
                    </Step>
                    <Step n="2" title="Approve the app on Shopify">
                        You’ll be sent to Shopify’s own approval screen showing exactly what POWR Rewards is
                        asking for, then dropped straight back into the portal. The page should now show your
                        domain with a green <b>Connected</b> badge.
                    </Step>
                    <Step n="3" title="Check Store Health">
                        The rail on the right shows three lights. <b>Store connection</b> and <b>Order tracking</b>{' '}
                        should both be green. If order tracking is amber, fix it now —{' '}
                        <a href="#permissions" className="underline font-bold text-[#8a7600]">see below</a> — because
                        without it, codes never confirm as used.
                    </Step>
                </Steps>
            </Section>

            <Section id="permissions" title="What you’re approving">
                <P>POWR asks for three permissions, and nothing else:</P>
                <Table
                    head={['Permission', 'Why we need it']}
                    rows={[
                        ['Manage discounts', 'To create the single-use code each time a member redeems. This is the whole integration.'],
                        ['Read orders', 'To spot when one of those codes is used at checkout, so it can be marked used in POWR automatically.'],
                        ['Read products', 'To copy your template’s product or collection restrictions onto minted codes, so a cloned code is never more generous than the template.'],
                    ]}
                />
                <Callout tone="warn" title="Order tracking needs one extra approval">
                    Shopify treats order data as protected customer data, so reading orders needs a separate
                    opt-in. If the Store Health rail says order tracking isn’t active: in your Shopify admin, open
                    the POWR Rewards app’s settings, approve <b>Protected customer data</b> access (reason:{' '}
                    <em>app functionality</em>), then reload the portal page. It repairs itself from there.
                    Until it’s on, minting still works — codes just never flip to <code className="font-mono">used</code>.
                </Callout>
                <P>
                    POWR stores no Shopify customer data. Orders are read for their discount codes and nothing
                    else, and the mandatory data-request and redaction webhooks have nothing to return as a
                    result.
                </P>
            </Section>

            <Section id="template" title="Choosing a template discount">
                <P>
                    Create the discount in Shopify the way you normally would (<b>Discounts → Create discount →
                    Amount off products</b> or <b>Amount off order</b>), then leave it alone. Requirements:
                </P>
                <Table
                    head={['Requirement', 'Detail']}
                    rows={[
                        ['A discount code, not an automatic discount', 'Automatic discounts have no code to clone.'],
                        ['Active', 'Only active discounts appear in the picker.'],
                        ['Percentage or fixed amount off', 'Buy-X-get-Y, free shipping and other types can’t be cloned — the portal will tell you if you pick one.'],
                        ['Order-wide, product- or collection-restricted', 'All three clone fine, with the restriction carried across. More exotic targeting is rejected rather than silently widened.'],
                    ]}
                />
                <P>
                    Usage limits and per-customer settings on the template don’t matter much — minted codes are
                    always given a usage limit of one regardless. Set the template up to describe the <em>value</em>,
                    and let POWR handle uniqueness.
                </P>
                <Callout tone="note" title="The picker hides POWR’s own codes">
                    Every code we mint is itself an active discount in your store, so we filter anything named{' '}
                    <code className="font-mono">POWR · …</code> out of the template list — otherwise it would fill
                    up with single-use codes after a few dozen redemptions. The picker shows your first 50 active
                    discounts; if the one you want is missing, check it’s active and that you don’t have a very
                    long discount list.
                </Callout>
            </Section>

            <Section id="map" title="Step 2 · Map your rewards">
                <P>
                    Back on the Shopify page, each of your rewards gets a dropdown listing your cloneable
                    discounts. Pick the one that reward should mint from and it saves immediately — the line
                    underneath changes to “Mints from <em>your discount name</em>”.
                </P>
                <P>
                    Rewards that aren’t live in the app yet are included on purpose, tagged “Not live in app yet”,
                    so you can wire delivery up first and flip the switch second.
                </P>
                <P>
                    Choosing <b>No minting</b> removes the mapping. The reward then has no way to deliver unless
                    it has pool codes loaded, so only do that deliberately.
                </P>
                <Callout tone="note" title="Mapping changes how the reward delivers">
                    A mapped reward switches to minting at redemption time — it stops drawing from its code pool
                    as the primary source. Any codes already in that pool stay put and become the fallback buffer.
                </Callout>
            </Section>

            <Section id="test" title="Step 3 · Test the loop">
                <P>
                    Worth the five minutes: it proves minting <em>and</em> order tracking, which is the half
                    people usually discover is missing weeks later.
                </P>
                <Steps>
                    <Step n="1" title="Mint a test code">
                        Hit <b>Create test code</b>. POWR mints one code from your mapped template — exactly like
                        a member redemption, minus the member. It’s a real, single-use discount in your store,
                        named <code className="font-mono">POWR TEST · …</code> and set to expire in 7 days.
                    </Step>
                    <Step n="2" title="Spend it at your own checkout">
                        Place a real order on your store using that code. A cheap product and a refund afterwards
                        is fine — what matters is that the order goes through with the discount applied.
                    </Step>
                    <Step n="3" title="Watch it confirm">
                        Within about a minute the badge in the portal flips from <b>Waiting for checkout</b> to{' '}
                        <b>Used — reconciled</b>. That’s the full loop: minted in Shopify, spent at checkout,
                        confirmed back into POWR without you touching anything.
                    </Step>
                </Steps>
                <Callout tone="warn" title="If it never flips to used">
                    Minting works but order tracking doesn’t. That’s the protected customer data approval —{' '}
                    <a href="#permissions" className="underline font-bold">see above</a>. Fix it and mint a fresh
                    test code; the old one won’t retroactively reconcile.
                </Callout>
            </Section>

            <Section id="minted" title="What a minted code looks like">
                <P>In your Shopify discount list, each redemption produces something like this:</P>
                <CodeBlock>{`name:                       POWR · Summer 20% · POWR-8FK2Q3XN
code:                       POWR-8FK2Q3XN
usage limit:                1              ← Shopify enforces this, not POWR
applies once per customer:  yes
expires:                    matches the member's wallet expiry
value & restrictions:       cloned from your template discount`}</CodeBlock>
                <P>
                    The naming is deliberate — it keeps every POWR-issued code grouped together in your admin and
                    tells you at a glance which template it came from. Don’t rename or delete them while they’re
                    live in members’ wallets; a deleted code stops working at checkout and the member is left
                    holding something worthless.
                </P>
            </Section>

            <Section id="reconcile" title="Reconciliation">
                <P>
                    There isn’t any to do. When an order comes in carrying one of our codes, your store’s
                    order webhook tells us, and we mark that code <code className="font-mono">used</code> with the
                    order’s own timestamp. No exports, no uploads, nothing to remember weekly.
                </P>
                <P>
                    That’s the practical advantage over the manual method: your POWR redemption numbers reflect
                    what was actually spent, automatically, without anyone maintaining a process.
                </P>
            </Section>

            <Section id="fallback" title="Outages & the fallback pool">
                <P>
                    If your store can’t be reached at the moment a member redeems — an expired session, an
                    uninstall, a Shopify incident — we fall back to any plain codes loaded in that reward’s pool
                    and the member redeems successfully anyway.
                </P>
                <P>
                    Use <b>Manage fallback pool</b> on the Shopify page to load a couple of dozen per active
                    reward. They sit there indefinitely and cost you nothing; the{' '}
                    <a href="/docs/promo-codes" className="underline font-bold text-[#8a7600]">Promo Codes guide</a>{' '}
                    covers the workspace. Without a buffer, an outage means failed redemptions.
                </P>
            </Section>

            <Section id="troubleshoot" title="Troubleshooting">
                <P>
                    <b>“Shopify session expired”.</b> Access tokens don’t last forever. Hit <b>Connect Shopify</b>{' '}
                    again with the same domain — it restores minting and order tracking in one go.
                </P>
                <P>
                    <b>“The POWR app was uninstalled from your store”.</b> Someone removed the app in Shopify
                    admin. Minting stopped at that moment. Reconnect from step 1 to resume.
                </P>
                <P>
                    <b>Order tracking amber.</b> Protected customer data approval —{' '}
                    <a href="#permissions" className="underline font-bold text-[#8a7600]">see above</a>.
                </P>
                <P>
                    <b>My discount isn’t in the dropdown.</b> It must be an active <em>code</em> discount of the
                    basic percentage or fixed-amount type. Automatic discounts, buy-X-get-Y and free shipping
                    aren’t cloneable. The list also shows only your first 50 active discounts.
                </P>
                <P>
                    <b>“Only basic percentage or fixed-amount code discounts can be used as templates”.</b> You
                    picked an unsupported type. Create a simple percentage or amount-off discount to act as the
                    template — it never gets used directly, so it doesn’t matter that it’s plain.
                </P>
                <P>
                    <b>A member says their code was rejected.</b> Check the code still exists in your Shopify
                    discount list and hasn’t been deleted or hit its expiry. Each code is single-use, so it will
                    also be rejected if it’s already been spent.
                </P>
                <P>
                    <b>Disconnecting.</b> <b>Disconnect</b> stops minting immediately; mapped rewards fall back
                    to pool codes. Your mappings survive, so reconnecting later picks up where you left off.
                </P>
            </Section>

            <NextUp
                to="/docs/api"
                label="Need more control than the connector gives you?"
                detail="The API adds signed webhooks, code pushes from your own system, and just-in-time minting."
            />
        </DocsLayout>
    );
}
