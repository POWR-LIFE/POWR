import React from 'react';
import { Link } from 'react-router-dom';
import { Callout, CodeBlock, DocsLayout, GUIDES, P, Section, Table } from './docsShared';

// /docs — the shared mental model, then the three ways to deliver codes.
// Everything method-specific lives in the three guides; this page's job is to
// get a partner to the right one in under a minute.

const TOC = [
    ['lifecycle', 'How a code moves'],
    ['methods', 'The three methods'],
    ['choose', 'Which one is right'],
    ['rewards', 'Where rewards fit'],
    ['redemption', 'At the moment of redemption'],
    ['fallback', 'The fallback pool'],
    ['expiry', 'Expiry & stock'],
    ['switching', 'Switching methods'],
];

const METHOD_BLURB = {
    '/docs/promo-codes': 'Upload a batch of codes — or have POWR generate them — right in the portal. No engineering, live in minutes.',
    '/docs/shopify': 'Connect your store once. Every redemption mints a fresh single-use discount in Shopify and marks itself used at checkout.',
    '/docs/api': 'Your system supplies codes over REST, hears about redemptions via signed webhooks, or mints on demand at redemption time.',
};

export default function DocsOverview() {
    return (
        <DocsLayout
            eyebrow="Partner Docs"
            title="Getting your rewards delivering"
            intro="When a member spends their POWR on one of your rewards, we hand them a code. There are three ways those codes can reach us — pick one, follow its guide, and you’re live. Everything below is shared ground: it’s true whichever method you choose."
            toc={TOC}
        >
            <Section id="lifecycle" title="How a code moves">
                <P>Every promo code in POWR sits in exactly one of four states:</P>
                <CodeBlock>{`available  → in a reward's pool (or mintable on demand); nobody holds it
reserved   → a member spent their POWR and it's now in their wallet
used       → confirmed redeemed in YOUR system
expired    → it lapsed before anyone claimed it`}</CodeBlock>
                <P>
                    Two of those transitions are ours: we move a code to <b>reserved</b> the moment a member
                    redeems, and to <b>expired</b> when its lifetime runs out. One is yours: telling us a
                    code was actually spent at your checkout moves it to <b>used</b>. How you do that — a CSV
                    paste, an API call, or nothing at all — is the main thing that separates the three methods.
                </P>
                <Callout tone="note" title="One-way by design">
                    Only <code className="font-mono">reserved</code> codes can become <code className="font-mono">used</code>.
                    Nothing you or we do can un-assign a code that’s already sitting in a member’s wallet — so a
                    member can never watch a reward vanish after they’ve paid for it.
                </Callout>
            </Section>

            <Section id="methods" title="The three methods">
                <P>
                    You choose one in the portal under <b>Integration</b>. It’s a per-brand setting, and exactly
                    one method delivers at a time.
                </P>
                <div className="space-y-4 my-6">
                    {GUIDES.filter(g => g.path !== '/docs').map((g, i) => (
                        <Link key={g.path} to={g.path}
                            className="group flex items-start gap-5 p-6 bg-white border border-[#E6E6E1] rounded-3xl hover:border-[#E8D200]/50 transition-all">
                            <div className="w-11 h-11 rounded-2xl bg-[#F4F4F1] flex items-center justify-center shrink-0">
                                <g.icon size={19} className="text-[#8a7600]" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-3 mb-1.5">
                                    <span className="text-[9px] uppercase tracking-[0.3em] font-black text-[#CCC]">{`0${i + 1}`}</span>
                                    <h3 className="text-[17px] font-bold tracking-tight text-[#1A1A1A] group-hover:text-[#8a7600] transition-colors">{g.label}</h3>
                                </div>
                                <p className="text-[12.5px] text-[#777] leading-relaxed">{METHOD_BLURB[g.path]}</p>
                            </div>
                            <span className="text-[#CCC] group-hover:text-[#8a7600] transition-colors text-xl shrink-0">→</span>
                        </Link>
                    ))}
                </div>
                <Table
                    head={['', 'Promo Codes', 'Shopify', 'API']}
                    rows={[
                        ['Engineering needed', 'None', 'None', 'A server you control'],
                        ['Time to live', 'Minutes', '~10 minutes', 'Half a day'],
                        ['Where codes come from', 'You upload, or POWR generates', 'Cloned from a template discount in your store', 'You push batches, or we call you per redemption'],
                        ['Codes are single-use', 'By convention — one code per member', 'Enforced by Shopify itself', 'Yours to enforce (JIT codes are single-use by construction)'],
                        ['Marking codes used', 'Paste or upload a list when you like', 'Automatic, at checkout', 'POST /reconcile, or automatic with JIT'],
                        ['You find out about a redemption', 'In the portal, or by export', 'In the portal', 'Signed webhook, in real time'],
                        ['Stock to manage', 'Yes — top the pool up', 'No', 'Only if you pre-load pools'],
                    ]}
                />
            </Section>

            <Section id="choose" title="Which one is right">
                <P>Three questions get you there:</P>
                <P>
                    <b>Is your store on Shopify?</b> Use the Shopify connector. It’s the least work of the three
                    and the only one where single use is enforced by the store rather than trusted — a code
                    shared in a group chat is worthless after its first checkout.
                </P>
                <P>
                    <b>Do you have engineers and a system that already owns discount codes?</b> Use the API. You
                    get redemptions pushed to you the second they happen, and just-in-time minting means you
                    never hand POWR a code that hasn’t been asked for.
                </P>
                <P>
                    <b>Neither?</b> Use Promo Codes. It is not a downgrade — plenty of live brands run on it
                    permanently. You upload a batch (or let POWR generate one), members draw from it, and you
                    reconcile whenever it suits you.
                </P>
                <Callout tone="note" title="Not sure yet">
                    Start with Promo Codes. It takes minutes, it proves the whole loop end to end with real
                    members, and switching later costs you nothing — see <a href="#switching" className="underline font-bold">Switching methods</a>.
                </Callout>
            </Section>

            <Section id="rewards" title="Where rewards fit">
                <P>
                    Codes always belong to a <b>reward</b> — the thing a member is actually buying with their
                    POWR. Create rewards under <b>My Rewards</b> in the portal; each keeps its own separate pool
                    and its own settings. A method delivers for your whole brand, but the wiring is per reward:
                    you map each reward to a Shopify discount, or load each reward’s pool, one at a time.
                </P>
                <P>Two reward settings decide whether codes are involved at all:</P>
                <Table
                    head={['Reward setup', 'What members get', 'Codes?']}
                    rows={[
                        ['Digital · unique code', 'A code from your pool, in their wallet', 'Yes — this is what these guides cover'],
                        ['Digital · shared link', 'Your affiliate destination URL', 'No pool, nothing to upload'],
                        ['Physical', 'A claim your team fulfils by hand', 'No pool — you ship the item'],
                    ]}
                />
                <P>
                    Only <b>digital · unique code</b> rewards appear in the Promo Codes workspace and the Shopify
                    mapping list. If a reward you expect isn’t showing up, that setting is almost always why.
                </P>
            </Section>

            <Section id="redemption" title="At the moment of redemption">
                <P>
                    A member taps redeem. We charge their POWR, secure a code, and drop it into their wallet —
                    all inside one request. Where the code comes from depends on your method:
                </P>
                <CodeBlock>{`Promo Codes   → the oldest available code in that reward's pool is reserved

Shopify       → we clone your template discount into a brand-new code in your
                store (usage limit 1, expires with the member's wallet entry)

API + JIT     → we POST a signed mint request to your endpoint and use the
                code you return (3s timeout)

API, no JIT   → same as Promo Codes: we reserve from the pool you pushed`}</CodeBlock>
                <Callout tone="good" title="Members are never charged for nothing">
                    If no code can be secured, the redemption fails and the member keeps their POWR. We’d rather
                    show them “try again shortly” than take points for a code that doesn’t exist.
                </Callout>
            </Section>

            <Section id="fallback" title="The fallback pool">
                <P>
                    Shopify and API brands can still load a small batch of plain codes into a reward’s pool. We
                    only touch it if your integration can’t be reached at redemption time — Shopify session
                    expired, your mint endpoint timing out, that sort of thing. Members redeem successfully and
                    never see the difference.
                </P>
                <P>
                    It’s optional, but a few dozen codes per active reward is cheap insurance. You’ll find it at{' '}
                    <b>Manage fallback pool</b> on your method’s page, which drops you into the same workspace the
                    Promo Codes guide describes.
                </P>
                <P>
                    On the API, three consecutive mint failures pause minting for ten minutes and we lean on the
                    pool for that window — so the buffer is what stands between a partner outage and a wall of
                    failed redemptions.
                </P>
            </Section>

            <Section id="expiry" title="Expiry & stock">
                <P>
                    Every code carries an expiry, and it gets set <em>twice</em>. When a code enters POWR it’s
                    stamped with the reward’s <b>code lifetime</b> (90 days unless you asked for something else)
                    counted from that moment. Then, when a member actually claims it, the clock restarts — the
                    member gets the full lifetime from their redemption, not whatever was left over.
                </P>
                <Callout tone="warn" title="Codes can go stale in the pool">
                    We only hand out codes whose expiry is still in the future, so a batch that sits unclaimed
                    past its lifetime stops being claimable even though the ledger still reads{' '}
                    <code className="font-mono">available</code>. If you load a big pool that drains slowly, check
                    the <b>Expires</b> column now and again rather than trusting the available count alone.
                </Callout>
                <P>
                    <b>Stock</b> is a separate cap you can set on the reward itself — the total number of times it
                    can ever be claimed. A reward can go quiet for either reason: an empty pool, or a stock limit
                    reached. The Overview page in the portal flags a live reward with no available codes, and API
                    brands can also get a <code className="font-mono">pool.low</code> webhook at a threshold you pick.
                </P>
            </Section>

            <Section id="switching" title="Switching methods">
                <P>
                    Nothing is deleted when you switch. Your API keys keep existing, your Shopify store stays
                    connected, your pools keep their codes — the only thing that changes is which one we reach
                    for at redemption time. You can switch back the same day.
                </P>
                <P>
                    You can also set the next method up before you commit: open its page from{' '}
                    <b>Integration → Change method</b> and work through it. The portal flags that it isn’t the
                    live one yet, and nothing takes over until you say so.
                </P>
                <Callout tone="warn" title="One thing to watch">
                    Mapping a reward to a Shopify discount switches that reward to mint-on-redemption delivery.
                    If you later move to Promo Codes, load that reward’s pool before the switch — otherwise it
                    has no codes to hand out.
                </Callout>
            </Section>
        </DocsLayout>
    );
}
