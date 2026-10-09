import React from 'react';
import { Link } from 'react-router-dom';
import { Callout, DocsLayout, P, PLACEMENTS_LIVE, Section, Shot, Step, Steps, Table } from './docsShared';

// /docs/getting-started: the first page a brand reads. Gets them signed in,
// shows them round the Overview, and lays out the order of setup to go live.
// Rewards and code delivery each have their own guide; this page links to
// them rather than repeating them.

const TOC = [
    ['access', 'Getting access'],
    ['sign-in', 'Signing in'],
    ['around', 'Finding your way around'],
    ['overview', 'Reading the Overview'],
    ['headlines', 'What the headline means'],
    ['live', 'Going live, step by step'],
    ['checks', 'What POWR checks'],
    ['faq', 'Common questions'],
];

const A = 'font-bold text-[#8a7600] hover:underline';

export default function DocsGettingStarted() {
    return (
        <DocsLayout
            eyebrow="Partner guide · Getting started"
            title="Getting started with the partner portal"
            intro="The partner portal is where your brand puts rewards in front of POWR members, chooses how codes reach them, and watches the claims come in. This page gets you signed in, shows you round the Overview, and sets out the order of setup, from your first login to a reward members can claim."
            toc={TOC}
            nextNote={{ label: 'Rewards', detail: 'Put up your first reward and send it to POWR for review.' }}
        >
            <Section id="access" title="Getting access">
                <P>
                    The portal is invite only. You get in with a <b>setup link</b>: a private link that creates
                    your own login for your brand. It reaches you in one of two ways:
                </P>
                <P>
                    <b>From POWR.</b> When POWR approves your brand’s first reward, or invites your brand onto
                    the portal, the setup link arrives by email.
                </P>
                <P>
                    <b>From a teammate.</b> Anyone already on your brand’s portal can invite you from{' '}
                    <b>Settings</b>. See <Link to="/docs/settings" className={A}>Settings &amp; support</Link>.
                </P>
                <Steps>
                    <Step n="1" title="Open the setup link">
                        The page reads <b>Partner Portal Setup</b> with your brand’s name, and its logo if POWR
                        already has one.
                    </Step>
                    <Step n="2" title="Fill in the form">
                        <b>Your name</b> is optional. <b>Email address</b> is the address you’ll sign in with.{' '}
                        <b>Password</b> must be at least 8 characters, and <b>Confirm password</b> must match it.
                    </Step>
                    <Step n="3" title="Press Create Account">
                        POWR creates your login, signs you straight in and opens the <b>Overview</b>. A welcome
                        email follows. If the automatic sign-in doesn’t go through, you land on the sign-in page
                        instead: your account is made, so just sign in.
                    </Step>
                </Steps>
                <Shot
                    id="partner-setup"
                    alt="The partner portal setup page, filled in"
                    caption="The setup page"
                    notes={[
                        ['brand', 'Your brand’s name, with its logo if POWR already has one.'],
                        ['name', 'Your name. This one is optional.'],
                        ['email', 'The address you’ll sign in with.'],
                        ['password', 'At least 8 characters, then the same again to confirm.'],
                        ['create', 'Create Account makes your login and signs you in.'],
                    ]}
                />
                <Callout tone="warn" title="Each link creates one login">
                    A setup link works once. Open it again afterwards and you’ll see <b>Already set up</b> with
                    a <b>Sign In</b> button. Until it’s used, anyone holding the link can create a login for your
                    brand, so treat it like a password and don’t forward it on. Each teammate needs a link of
                    their own.
                </Callout>
            </Section>

            <Section id="sign-in" title="Signing in">
                <P>
                    Go to <a href="/partner" className={A}>powr.life/partner</a>, or use the <b>Partner portal</b>{' '}
                    button at the top of these guides. Enter your <b>Email address</b> and <b>Password</b>, then
                    press <b>Sign In</b>. You land on the <b>Overview</b>. If the details are wrong, the page says
                    so under the form.
                </P>
                <Shot
                    id="partner-login"
                    alt="The partner portal sign-in page"
                    caption="The sign-in page"
                    notes={[
                        ['email', 'The address you set up your login with.'],
                        ['password', 'Your password. There’s no reset link here.'],
                        ['signin', 'Sign In takes you to the Overview.'],
                    ]}
                />
                <P>
                    The address you’re signed in with sits at the foot of the sidebar under <b>Signed in as</b>,
                    with <b>Sign Out</b> just below it.
                </P>
                <P>
                    <b>Forgotten your password?</b> The sign-in page has no reset link. Email{' '}
                    <a href="mailto:support@powr.life" className={A}>support@powr.life</a> from the address you
                    sign in with and the POWR team will help you back in. If you can still sign in and simply want
                    a new password, change it under <b>Settings</b>: see{' '}
                    <Link to="/docs/settings" className={A}>Changing your password</Link>.
                </P>
            </Section>

            <Section id="around" title="Finding your way around">
                <P>The sidebar holds every page of the portal. From top to bottom:</P>
                <Shot
                    id="partner-sidebar"
                    alt="The partner portal sidebar"
                    caption="The sidebar"
                    notes={[
                        ['brand', 'Your brand, with the logo from your newest reward.'],
                        ['pages', 'Every page of the portal. The one you’re on is gold.'],
                        ['method', 'Integration, named after your delivery method once you’ve chosen one.'],
                        ['support', 'Support: ask the POWR team and read their answers.'],
                        ['guides', 'Guides: these pages, in a new tab.'],
                    ]}
                />
                <Table
                    head={['In the sidebar', 'What it’s for']}
                    rows={[
                        ['Overview', 'Your home page. One line on how your brand is doing, and the one thing to do next.'],
                        ['My Rewards', <>Submit rewards for review and edit your listings. See <Link to="/docs/rewards" className={A}>Rewards</Link>.</>],
                        ['Integration', 'Choose how codes reach members. Once you’ve chosen, this item takes the name of your method: Promo Codes, Shopify or API.'],
                        ['What’s On', 'Ask for a week as the featured reward at the top of the rewards screen in the app.'],
                        ...(PLACEMENTS_LIVE ? [['Placements', 'Boost a reward for members in an area and at the hours you choose.']] : []),
                        ['Studio', 'Make social posts from templates, filled in from your reward.'],
                        ['Redemptions', 'Every claim of your rewards.'],
                        ['Settings', 'Your brand info, your team’s logins and your password.'],
                        ['Support', 'At the foot of the sidebar. Send the POWR team a ticket and read their answers.'],
                        ['Guides', 'Opens these guides in a new tab.'],
                    ]}
                />
                <P>
                    Until you’ve chosen how codes are delivered, the portal opens the delivery method page for
                    you once per visit. Pick a method there, or press <b>Decide later</b> at the bottom of the
                    page to stop it. You can choose at any time from <b>Integration</b> in the sidebar.
                </P>
            </Section>

            <Section id="overview" title="Reading the Overview">
                <P>
                    The <b>Overview</b> answers one question: can members claim your rewards right now, and if
                    not, why not. It checks every time you open it. From top to bottom:
                </P>
                <Shot
                    id="partner-overview"
                    alt="The partner portal Overview for a brand where everything is running"
                    caption="The Overview, with everything running"
                    notes={[
                        ['headline', 'The headline: one sentence on how things stand.'],
                        ['because', 'Because: three figures that back it up.'],
                        ['delivery', 'Delivery: five links from your listing to the checkout.'],
                        ['strip', 'Last 30 days: a tick for each day with a claim.'],
                        ['phone', 'The phone: your reward as members see it in the app.'],
                    ]}
                />
                <P>
                    <b>The headline.</b> One sentence on the most important thing, with a coloured dot beside
                    your brand name and “checked just now”. Green means everything’s running. Amber means
                    something needs you but no member is stuck. Red means members can’t claim.
                </P>
                <P>
                    <b>The button.</b> At most one yellow button, under the headline: the next thing to do. No
                    button means nothing needs you today.
                </P>
                <P>
                    <b>Because.</b> Three figures that back up the headline, such as reward slots used, your
                    delivery method and its status, or claims in the last 30 days.
                </P>
                <P>
                    <b>More things need you.</b> Anything else waiting on you, one row each, linking to the page
                    that fixes it: a reward to revise, a draft to finish, a reward that has run out of codes, or a
                    delivery method still to connect. The list is open by default. Click its title to fold it away.
                </P>
                <P>
                    <b>Delivery.</b> A chain of five links: <b>Listed</b> · <b>Stocked</b> · <b>Connected</b> ·{' '}
                    <b>Delivered</b> · <b>Used</b>. It shows whether a problem is in your setup or in demand.
                    Green is working, red is broken, and grey is a step nothing has reached yet, which is not an
                    error. The line underneath explains the first link that isn’t green.
                </P>
                <Shot
                    id="partner-overview-delivery"
                    alt="The Delivery chain with Listed in red and the other four links grey"
                    caption="Delivery for a reward that’s approved but not live yet"
                    notes={[
                        ['listed', 'Red: this link is broken. The reward isn’t live yet.'],
                        ['connected', 'Grey: nothing has reached this link yet. Not an error.'],
                        ['line', 'The first link that isn’t green, explained.'],
                    ]}
                />
                <P>
                    <b>Last 30 days.</b> One tick for each day with a claim, and a taller gold tick on your
                    busiest day. It appears after your first claim. Refunded claims aren’t counted.
                </P>
                <P>
                    <b>The phone.</b> On a wide screen, your reward exactly as members see it in the app.{' '}
                    <b>Live in app</b> means members can see it now. <b>Needs finishing</b> means it’s approved
                    but waiting for codes to reach members. With more than one reward, the dots underneath switch
                    between them.
                </P>
                <Callout tone="note" title="The most urgent thing wins">
                    The headline only ever states one thing, and members being blocked always comes first. A
                    rejected draft won’t take the headline while a live reward is out of codes, for example. Whatever
                    the headline doesn’t say appears in the list underneath, so nothing is hidden.
                </Callout>
            </Section>

            <Section id="headlines" title="What the headline means">
                <P>
                    Here’s the Overview the day after POWR approves a brand’s first reward, before the brand
                    has chosen how codes reach members:
                </P>
                <Shot
                    id="partner-overview-verdict"
                    alt="The Overview headline for an approved reward with no delivery method yet"
                    caption="An approved reward with no way to deliver codes yet"
                    notes={[
                        ['status', 'Checked just now, with a red dot: members can’t claim.'],
                        ['headline', 'The headline names the problem. The line under it says why.'],
                        ['button', 'The one button: the next thing to do.'],
                        ['because', 'Because: the three figures behind the headline.'],
                        ['more', 'Anything else waiting on you. Here, a half-written second reward.'],
                    ]}
                />
                <Table
                    head={['When it says', 'It means', 'The button']}
                    rows={[
                        ['Members can’t claim anything from you right now', 'You have rewards, but none are live. Usually an approved reward with no way to deliver codes yet.', 'Choose delivery method, or Finish connecting'],
                        ['You’re out of codes', 'A live reward’s code pool is empty, so members who try to claim it are turned away.', 'Top up your codes'],
                        ['Your method isn’t connected', 'Your rewards are listed but your delivery method isn’t working, so claims fail at the last step.', 'Reconnect'],
                        ['Nothing’s live yet', 'You haven’t submitted a reward. It tells you whether it’s one step or two from live.', 'Choose delivery method, or Create your first reward'],
                        ['Your reward needs changes', 'POWR sent your reward back. Its note appears under the headline.', 'Revise your reward'],
                        ['You’ve a reward half-written', 'A draft is saved but hasn’t been sent to POWR.', 'Finish your draft'],
                        ['You’re waiting on POWR', 'Your reward is in review, usually for about a day.', 'None. Nothing needs you.'],
                        ['You’re live, and no one’s claimed yet', 'Delivery is healthy, so it’s reach. Check your listing reads well and the price feels attainable.', 'Review your listing'],
                        ['You’re live and quiet', 'More than 30 days since your last claim.', 'Review your listing'],
                        ['Everything’s running', 'Codes are reaching members.', 'None. Nothing needs you.'],
                    ]}
                />
            </Section>

            <Section id="live" title="Going live, step by step">
                <P>A reward reaches members once three things are true: POWR has approved it, codes can reach members, and POWR has switched it on.</P>
                <Steps>
                    <Step n="1" title="Sign in">
                        Done once you’ve used your setup link. Everything below happens in the portal.
                    </Step>
                    <Step n="2" title="Put up a reward">
                        On <b>My Rewards</b>, press <b>Submit Reward</b>, work through the steps and press{' '}
                        <b>Submit for Review</b> on the last one. POWR’s team sets the points price and reviews it.
                        By default a brand can have two rewards live or in review at once. The full walkthrough is
                        in <Link to="/docs/rewards" className={A}>Rewards</Link>.
                    </Step>
                    <Step n="3" title="Choose how codes are delivered">
                        Open <b>Integration</b> and pick <b>Promo Codes</b>, <b>Shopify</b> or <b>API</b>. Each card
                        has <b>Read the guide</b> if you’re unsure which suits you. You can switch later without
                        losing anything. <Link to="/docs" className={A}>How codes flow</Link> compares the three.
                    </Step>
                    <Step n="4" title="Get codes flowing">
                        Upload or generate codes, connect your Shopify store, or finish your API setup, depending
                        on what you chose. On the <b>Overview</b>, <b>Connected</b> in the Delivery chain turns green
                        once codes have a route to members.
                    </Step>
                    <Step n="5" title="POWR puts it live">
                        Our part. Once your reward is approved and codes can reach members, POWR checks the codes
                        work and switches the reward on. The phone on the Overview then shows <b>Live in app</b>.
                    </Step>
                </Steps>
                <P>
                    Steps 2 and 3 can go in either order. The button on the <b>Overview</b> always points at
                    whichever comes next. POWR emails you a reminder each week until setup is done.
                </P>
            </Section>

            <Section id="checks" title="What POWR checks">
                <P>Nothing reaches members without passing the POWR team first.</P>
                <P>
                    <b>New rewards are reviewed.</b> POWR checks your submission and sets its points price. If
                    something needs changing, the reward comes back to you with a note, and the Overview says{' '}
                    <b>Your reward needs changes</b>. Revise it and send it back.
                </P>
                <P>
                    <b>Approval doesn’t switch a reward on by itself.</b> An approved reward waits until codes
                    can reach members. POWR then checks the codes work and switches it on.
                </P>
                <P>
                    <b>Changes to a live listing are reviewed too.</b> Your live listing stays as it is until POWR
                    approves the changes. See <Link to="/docs/rewards" className={A}>Rewards</Link>.
                </P>
                <P>
                    <b>Your brand name is set by POWR.</b> To change it, raise a ticket from <b>Support</b>.
                </P>
            </Section>

            <Section id="faq" title="Common questions">
                <P>
                    <b>My setup link says Invalid link.</b> It has been revoked, or it was cut short when it was
                    copied. Ask a teammate for a new one from <b>Settings</b>, or ask POWR at{' '}
                    <a href="mailto:support@powr.life" className={A}>support@powr.life</a>.
                </P>
                <P>
                    <b>It says Already set up.</b> The link has been used. If it was you, press <b>Sign In</b>.
                    If it wasn’t, ask a teammate for a fresh link: each person needs their own.
                </P>
                <P>
                    <b>It says an account with this email already exists.</b> That address already has a POWR
                    login, often from the POWR app. Use a different address, or contact POWR to link the existing
                    one to your brand.
                </P>
                <P>
                    <b>I signed in but the portal doesn’t open.</b> Your login may not be linked to your brand,
                    for example if a teammate removed your access. Email{' '}
                    <a href="mailto:support@powr.life" className={A}>support@powr.life</a> and the POWR team will
                    sort it out.
                </P>
                <P>
                    <b>The portal keeps taking me to the delivery method page.</b> That’s the first-run chooser.
                    Pick a method, or press <b>Decide later</b> at the bottom of the page.
                </P>
                <P>
                    <b>The Overview says it couldn’t reach my figures.</b> Something failed while the page loaded.
                    Nothing on your account has changed. Press <b>Try again</b>.
                </P>
                <P>
                    <b>My reward is approved, so why isn’t it live?</b> Codes can’t reach members yet. Follow the
                    button on the <b>Overview</b> to choose or finish your delivery method, and POWR switches the
                    reward on once codes are in.
                </P>
                <P>
                    <b>Can we have more than two rewards?</b> When you reach your limit, the button on{' '}
                    <b>My Rewards</b> becomes <b>Request More</b>. Tell POWR what you’d like to add and the team
                    will get in touch.
                </P>
            </Section>
        </DocsLayout>
    );
}
