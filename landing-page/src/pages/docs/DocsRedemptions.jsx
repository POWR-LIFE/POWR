import React from 'react';
import { Link } from 'react-router-dom';
import { Callout, DocsLayout, P, Section, Shot, Step, Steps, Table } from './docsShared';

// /docs/redemptions: reading the Redemptions page, what each status means,
// and what a member receives when they claim. Marking codes used belongs to
// the delivery guides, so this page points at them rather than repeating them.

const TOC = [
    ['range', 'Choose a time window'],
    ['figures', 'The three figures'],
    ['by-reward', 'By Reward'],
    ['activity', 'Recent Activity'],
    ['statuses', 'What each status means'],
    ['used', 'Marking codes used'],
    ['export', 'Exporting and the Monday email'],
    ['member', 'What the member receives'],
    ['empty', 'When the page is empty'],
    ['faq', 'Common questions'],
];

const A = 'font-bold text-[#8a7600] hover:underline';

export default function DocsRedemptions() {
    return (
        <DocsLayout
            eyebrow="Partner guide · Redemptions"
            title="Every claim, in one place"
            intro="Redemptions is your record of member claims: how many, on which rewards, and the code each member was handed. This guide explains each figure and status, what you can and can’t do from here, and what a member receives the moment they claim."
            toc={TOC}
            nextNote={{ label: 'Settings & support', detail: 'Invite teammates, change your password and get help from the POWR team.' }}
        >
            <Section id="range" title="Choose a time window">
                <P>
                    The menu at the top right picks the window: <b>Last 7 days</b>, <b>Last 30 days</b> (where the
                    page opens) or <b>Last 90 days</b>. The total, the daily average, <b>By Reward</b> and{' '}
                    <b>Recent Activity</b> all follow it. The menu is hidden until there’s something to report.
                </P>
                <Shot
                    id="partner-redemptions-page"
                    alt="The Redemptions page for the last 30 days"
                    caption="Redemptions"
                    notes={[
                        ['range', 'The time window. The page opens on Last 30 days.'],
                        ['total', 'Total: claims in the window.'],
                        ['avg', 'Daily avg: the total divided by every day in the window.'],
                        ['live', 'Rewards: how many are live now, whatever the window.'],
                        ['byReward', 'By Reward: claims per reward, most claimed first.'],
                        ['activity', 'Recent Activity: the newest claims and the code each member got.'],
                    ]}
                />
            </Section>

            <Section id="figures" title="The three figures">
                <Table
                    head={['Card', 'What it counts']}
                    rows={[
                        ['Total', 'Claims of your rewards in the window you picked.'],
                        ['Daily avg', 'The total divided by every day in the window (7, 30 or 90), not only the days you were live.'],
                        ['Rewards', 'How many of your rewards are live right now. This one ignores the window.'],
                    ]}
                />
            </Section>

            <Section id="by-reward" title="By Reward">
                <P>
                    Each reward claimed at least once in the window, most claimed first, with its count and a bar
                    sized against your top reward. A reward that’s been switched off carries an <b>Inactive</b> tag.
                    Rewards nobody claimed in the window are left out rather than shown as empty bars.
                </P>
            </Section>

            <Section id="activity" title="Recent Activity">
                <P>The newest claims first, in four columns:</P>
                <Table
                    head={['Column', 'Shows']}
                    rows={[
                        ['Date & Time', 'When the member claimed.'],
                        ['Reward', 'Which of your rewards they claimed.'],
                        ['Code', 'The code they were handed. Click it to copy it; a tick confirms.'],
                        ['Status', 'Claimed, Used, Expired or Refunded. See below.'],
                    ]}
                />
                <P>
                    The table lists the 50 most recent claims. When the window holds more, a line under the table
                    says how many. The page shows no names or email addresses: you see the code, the reward and the
                    time, not who claimed it.
                </P>
                <Callout tone="note" title="Shared link rewards">
                    A shared link reward has no code. Its <b>Code</b> cell holds a POWR reference starting{' '}
                    <code className="font-mono">POWR-AFF-</code>, which isn’t something anyone types at checkout. The
                    member gets your link instead.
                </Callout>
            </Section>

            <Section id="statuses" title="What each status means">
                <Table
                    head={['Status', 'Meaning']}
                    rows={[
                        ['Claimed', 'A member holds the code and it’s still in date. Nothing has told POWR it’s been spent.'],
                        ['Used', 'The code was confirmed spent at your checkout. It stays Used after its date passes.'],
                        ['Expired', 'The code’s valid-until date passed before it was confirmed used.'],
                        ['Refunded', 'POWR reversed the claim. It no longer counts towards that member’s Claims per member limit.'],
                    ]}
                />
                <Shot
                    id="partner-redemptions-statuses"
                    alt="Recent Activity rows showing Claimed, Used, Refunded and Expired"
                    caption="Recent Activity, every status"
                    notes={[
                        ['code', 'Click a code to copy it. A tick confirms.'],
                        ['claimed', 'Claimed: the member holds it and it’s in date.'],
                        ['used', 'Used: confirmed spent at your checkout.'],
                        ['refunded', 'Refunded: POWR reversed the claim.'],
                        ['expired', 'Expired: its date passed before it was marked used.'],
                    ]}
                />
                <Callout tone="warn" title="Claimed doesn’t mean unspent">
                    A code only reads <b>Used</b> once it’s been marked used. If you never do that, every code reads{' '}
                    <b>Claimed</b> and then <b>Expired</b>, including the ones your shop accepted.
                </Callout>
            </Section>

            <Section id="used" title="Marking codes used">
                <P>
                    You don’t mark codes used on this page. How it happens depends on your delivery method:
                </P>
                <Table
                    head={['Method', 'How codes become Used']}
                    rows={[
                        [<Link key="p" to="/docs/promo-codes" className={A}>Promo Codes</Link>, 'Paste or import your store’s list of redeemed codes on the Reconcile tab.'],
                        [<Link key="s" to="/docs/shopify" className={A}>Shopify</Link>, 'Automatic: your store tells POWR when a code is used at checkout.'],
                        [<Link key="a" to="/docs/api" className={A}>API</Link>, 'Your system confirms them through the reconcile endpoint.'],
                    ]}
                />
                <P>
                    It only goes one way. A code a member holds can become <b>Used</b>, but it can’t be taken back or
                    handed to someone else. The row here reads <b>Used</b> the next time the page loads.
                </P>
            </Section>

            <Section id="export" title="Exporting and the Monday email">
                <P>
                    Redemptions has no export button. For a unique-code reward on Promo Codes, open <b>Manage pool</b>{' '}
                    on the Promo Codes page and use <b>CSV</b> or <b>Excel</b>: you get every code in your current
                    filter with its claimed, used and expiry dates.
                </P>
                <P>
                    Every Monday morning, everyone with a portal login also gets a summary of the week before: claims
                    against the previous week, POWR spent, your most-redeemed rewards, rewards running low on codes and
                    any submissions still in review.
                </P>
            </Section>

            <Section id="member" title="What the member receives">
                <Steps>
                    <Step n="1" title="Before they confirm">
                        The app tells them the code is single-use, how many days it stays valid, and that POWR points
                        are non-refundable once redeemed.
                    </Step>
                    <Step n="2" title="In the app, straight away">
                        <b>YOUR CODE</b> with <b>Tap to copy</b>, then “Valid until” the date, “Show to staff or enter
                        at checkout”, and a <b>Use code at</b> your brand button when the reward has a website. A shared
                        link reward says the discount is applied automatically at checkout and offers a{' '}
                        <b>Shop at</b> button instead. Either way it’s kept in their wallet.
                    </Step>
                    <Step n="3" title="By email, the same moment">
                        A receipt goes to the email on their POWR account. The subject reads “Your [brand] code:” and
                        the code, or “Your [brand] reward is ready” for a link. Inside: the code in large type, the
                        valid-until date, a button to your shop, the POWR they spent and their balance now, an{' '}
                        <b>Open wallet</b> button and your terms.
                    </Step>
                </Steps>
                <P>
                    The receipt is sent once per claim, whatever the member’s marketing email settings, because it’s
                    the record of something they bought with POWR. You don’t get a copy.
                </P>
                <Callout tone="note" title="Your listing feeds the receipt">
                    The terms and shop link in the email come from your reward’s <b>Terms &amp; conditions</b> and{' '}
                    <b>Website URL</b>. Keep them current with <b>Edit Listing</b>: see{' '}
                    <Link to="/docs/rewards" className={A}>Rewards</Link>.
                </Callout>
            </Section>

            <Section id="empty" title="When the page is empty">
                <Table
                    head={['You see', 'Why', 'What to do']}
                    rows={[
                        ['No redemptions to report', 'Nothing of yours is live and no member has ever claimed.', 'Create your first reward or View my rewards. If you haven’t picked a delivery method, Choose delivery method appears too.'],
                        ['No redemptions in the last 7 days (or 30, or 90)', 'Nobody claimed in that window.', 'Pick a longer window to see older claims.'],
                        ['Couldn’t load your figures', 'The figures didn’t load. Nothing on your account has changed.', 'Hit Try again.'],
                    ]}
                />
                <Shot
                    id="partner-redemptions-empty"
                    alt="Redemptions before a brand has created a reward"
                    caption="Before your first reward"
                    notes={[
                        ['why', 'Nothing of yours is live and no member has ever claimed.'],
                        ['create', 'Create your first reward opens My Rewards.'],
                        ['method', 'Shown until you’ve picked a delivery method.'],
                    ]}
                />
            </Section>

            <Section id="faq" title="Common questions">
                <P><b>A member says their code doesn’t work.</b> Ask them for the code, then:</P>
                <Steps>
                    <Step n="1" title="Find it">
                        Look in <b>Recent Activity</b>, or search any part of the code under <b>Manage pool</b> on the
                        Promo Codes page.
                    </Step>
                    <Step n="2" title="Check its status">
                        <b>Expired</b> means its date has passed. <b>Used</b> means it was already spent.{' '}
                        <b>Claimed</b> means POWR handed it over in date, so the problem is at your checkout.
                    </Step>
                    <Step n="3" title="Check your store knows it">
                        Codes POWR generates for you are only text until you load them into your own system. On
                        Shopify, check nobody has renamed or deleted that code in your store. The{' '}
                        <Link to="/docs/promo-codes" className={A}>Promo Codes</Link> and{' '}
                        <Link to="/docs/shopify" className={A}>Shopify</Link> guides cover both.
                    </Step>
                </Steps>
                <P>
                    If you can’t find the code at all, it may belong to another brand’s reward, or it’s a{' '}
                    <code className="font-mono">POWR-AFF-</code> reference from a shared link, which was never a code.
                </P>
                <P>
                    <b>Can I see who claimed?</b> No. The portal shows the code, the reward and the time, never the
                    member.
                </P>
                <P>
                    <b>A member wants their POWR back.</b> Members are told before they confirm that points are
                    non-refundable once redeemed. If something went wrong on your side, raise it from <b>Support</b>{' '}
                    under <b>Rewards &amp; Codes</b> with the code. Refunds are POWR’s call; a refunded claim reads{' '}
                    <b>Refunded</b> here.
                </P>
                <P>
                    <b>Can I cancel a claim or mark a code used here?</b> No. Mark codes used through your delivery
                    method (see <a href="#used" className={A}>Marking codes used</a>). A code a member holds stays theirs.
                </P>
                <P>
                    <b>These numbers don’t match Overview or my Monday email.</b> They count different stretches.
                    This page counts the window you picked, up to now. The Monday email covers the last full Monday
                    to Sunday, and Overview shows the last 30 days and all time.
                </P>
                <P>
                    <b>The daily average looks low.</b> It divides by every day in the window, including days before
                    your reward went live. Pick a shorter window for a fairer read on a new reward.
                </P>
            </Section>
        </DocsLayout>
    );
}
