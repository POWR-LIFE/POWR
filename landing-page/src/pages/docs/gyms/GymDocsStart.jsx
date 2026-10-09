import React from 'react';
import { Link } from 'react-router-dom';
import { Callout, DocsLayout, P, Section, Shot, Step, Steps, Table } from '../docsShared';

// /docs/gyms: the first page a gym reads. Gets them in (setup link, sign
// in), walks the Overview card by card, names what each package unlocks, and
// sends them off to do the three things that matter in week one.

const TOC = [
    ['what', 'What the portal is for'],
    ['access', 'Getting access'],
    ['signin', 'Signing in'],
    ['around', 'Finding your way around'],
    ['overview', 'The Overview, card by card'],
    ['packages', 'Packages and locks'],
    ['first', 'Your first week'],
    ['next', 'Where to next'],
    ['faq', 'Common questions'],
];

const A = 'font-bold text-[#8a7600] hover:underline';

export default function GymDocsStart() {
    return (
        <DocsLayout
            eyebrow="Gym guide · Getting started"
            title="Your gym on POWR"
            intro="The gym portal is where you run your gym on POWR: your leaderboard on the gym TV, your own challenges, the people who train with you, and posts made from your week. This page gets you signed in, shows you around the Overview, and points you at the three things worth doing first."
            toc={TOC}
            nextNote={{ label: 'Settings & team', detail: 'Your gym’s details, your page in the app, your team and your package.' }}
        >
            <Section id="what" title="What the portal is for">
                <P>
                    Members earn POWR by training and spend it on rewards. Everything in the portal counts the
                    members who picked your gym as their gym in the app, so the more of them who do, the more your
                    board, your league and your numbers fill up.
                </P>
                <P>
                    The portal lives at <b>powr.life/venue</b>. It works on a laptop and on a phone, and you sign in
                    with the same POWR account you use in the app.
                </P>
            </Section>

            <Section id="access" title="Getting access">
                <P>
                    You can’t sign up for the portal yourself. POWR switches it on for your gym, then sends the
                    owner an email called <b>Set up [your gym] on POWR</b> with a <b>Set up your access</b> button.
                    Owners can then bring in their own team the same way (see{' '}
                    <Link to="/docs/gyms/settings" className={A}>Settings & team</Link>).
                </P>
                <Shot
                    id="gym-setup"
                    alt="The setup page a gym owner opens from their invite email"
                    caption="The setup page"
                    notes={[
                        ['role', 'Your gym, and whether the link gives Owner access or Team access.'],
                        ['existing', 'I use POWR: sign in with the account you already use in the app.'],
                        ['fresh', 'New to POWR: make a login here instead.'],
                        ['password', 'Optional. Leave it blank and we email you a sign-in link.'],
                        ['send', 'Reads Sign In once you’ve typed a password.'],
                    ]}
                />
                <Steps>
                    <Step n="1" title="Open the setup link">
                        The page shows your gym’s name and logo, and whether the link gives <b>Owner access</b> or{' '}
                        <b>Team access</b>. The link works once and lasts 14 days. If you haven’t used it after
                        five days, we email a second link for the same invite; either one works.
                    </Step>
                    <Step n="2" title="Already use the POWR app? Choose I use POWR">
                        Enter the email you use in the app. Type your password and press <b>Sign In</b>, or, if you
                        sign in to the app with Google or Apple, leave the password blank and press{' '}
                        <b>Email me a sign-in link</b>. Open that email on the same device and it brings you back
                        to the setup page. Then press <b>Add [your gym]</b>.
                    </Step>
                    <Step n="3" title="New to POWR? Choose New to POWR">
                        Fill in <b>Your name</b>, <b>Email address</b>, <b>Password</b> (at least 8 characters)
                        and <b>Confirm password</b>, then press <b>Create login</b>. You’re signed straight in.
                        If that email already has a POWR account, we say so and switch you to{' '}
                        <b>I use POWR</b> so the gym is added to the account you already have.
                    </Step>
                    <Step n="4" title="You’re in">
                        You land on the <b>Overview</b>. You also get a short welcome email, and your three-month
                        free trial is already running: see <a href="#packages" className={A}>Packages and locks</a>.
                    </Step>
                </Steps>
                <Callout tone="warn" title="Treat a setup link like a key">
                    Whoever opens it first gets in, with whatever email they use. Send it only to the person it’s
                    for. If it went to the wrong place, the owner can cancel it from <b>Settings</b> before
                    it’s used.
                </Callout>
                <P>If the link doesn’t open the setup page, it tells you why:</P>
                <Table
                    head={['You see', 'What it means']}
                    rows={[
                        ['Already used', 'Someone has set up access with this link. If it was you, just sign in.'],
                        ['Link expired', 'More than 14 days have passed. Ask whoever sent it for a new one.'],
                        ['Invalid link', 'It was cancelled, or it was copied wrongly. Ask for a new one.'],
                    ]}
                />
            </Section>

            <Section id="signin" title="Signing in">
                <P>
                    Go to <b>powr.life/venue</b> and enter your <b>Email address</b>. The password is optional:
                    with one, the button reads <b>Sign In</b>; without one, it reads{' '}
                    <b>Email me a sign-in link</b> and we email you a link that signs you in. Open it on the device
                    you want to use the portal on.
                </P>
                <Shot
                    id="gym-login"
                    alt="The gym portal sign-in page with an email and password typed in"
                    caption="Signing in at powr.life/venue"
                    notes={[
                        ['email', 'The email you use in the POWR app, or the one your invite was for.'],
                        ['password', 'Optional. Without one, the button emails you a sign-in link.'],
                        ['signin', 'With a password typed, the button reads Sign In.'],
                        ['forgot', 'Forgotten it? This emails you a sign-in link instead.'],
                    ]}
                />
                <P>
                    <b>Forgotten your password?</b> There’s no reset to wait for. Leave the password blank and use
                    the emailed link, or, once you’ve typed a password, press{' '}
                    <b>Forgot it? Email me a sign-in link</b> under the button.
                </P>
                <P>
                    If we can’t find an account for the email you typed, use the one your invite was for, or open
                    your invite link again. If you see <b>Not on a gym team</b>, you’re signed in with an account
                    that hasn’t accepted an invite. If you see <b>Portal paused</b>, your gym’s portal is switched
                    off for now: <a href="mailto:support@powr.life" className={A}>get in touch</a> and we’ll sort it.
                </P>
            </Section>

            <Section id="around" title="Finding your way around">
                <P>
                    On a laptop, the sidebar holds every page: <b>Overview</b>, <b>Events</b>, <b>Discounts</b>,{' '}
                    <b>Clash Nights</b>, <b>Studio</b>, <b>Screens</b>, <b>Members</b>, <b>Retention</b> and{' '}
                    <b>Settings</b>. Your gym’s card sits above them with your role (<b>Owner</b> or{' '}
                    <b>Team</b>) and your package. A small lock next to a page means your package doesn’t
                    include it yet.
                </P>
                <P>
                    On a phone, the six most used pages are tabs along the bottom: <b>Home</b>, <b>Events</b>,{' '}
                    <b>Studio</b>, <b>Members</b>, <b>Retention</b> and <b>Settings</b>. Tap your gym’s logo, top
                    right, for the rest: your package, <b>Discounts</b>, <b>Clash Nights</b>, <b>Screens</b> and{' '}
                    <b>Sign Out</b>.
                </P>
                <Shot
                    id="gym-overview-phone"
                    alt="The Overview on a phone, with the tabs along the bottom"
                    caption="On a phone"
                    notes={[
                        ['page', 'The page you’re on.'],
                        ['account', 'Your gym’s logo: your package, Discounts, Clash Nights, Screens and Sign Out.'],
                        ['tabs', 'The six most used pages, as tabs along the bottom.'],
                    ]}
                />
                <P>
                    On more than one gym’s team? A <b>Switch gym</b> button appears under your gym’s card. Each
                    gym’s pages only ever show that gym.
                </P>
            </Section>

            <Section id="overview" title="The Overview, card by card">
                <P>
                    The page you’ll open most. Across the top: the week’s dates, and whether your{' '}
                    <b>Leaderboard</b> and <b>League</b> screens are live or paused (tap to go to{' '}
                    <b>Screens</b>). The numbers refresh themselves while the page is open.
                </P>
                <Shot
                    id="gym-overview-page"
                    alt="The gym portal Overview for Northpoint Strength, a made-up gym"
                    caption="The Overview"
                    notes={[
                        ['week', 'This week: how busy you are, and who’s in right now.'],
                        ['moves', 'Worth doing this week: up to three things, each with its button.'],
                        ['posts', 'Posts for this week: seven posts made from your week.'],
                        ['app', 'Your gym in the app: your page as members see it, with its checklist.'],
                        ['people', 'Your people: who’s worth a word this week.'],
                        ['clash', 'Gym Clash: where you stand against the gyms near you.'],
                        ['since', 'Since …: everything POWR has recorded at your gym since you joined.'],
                    ]}
                />
                <Table
                    head={['Card', 'What it tells you']}
                    rows={[
                        ['This week', 'Sessions at your gym this week and how many people trained, with a sentence on how the week is going. A bar shows sessions so far and where the week is heading by Sunday; on Clash+ and above it also marks a usual week and your best recent one. Below, Monday to Sunday against last week, today in gold, and how many are in the gym right now.'],
                        ['Worth doing this week', 'Up to three things to do, picked from your own numbers, each with the button that does it. Some name the package that unlocks them instead.'],
                        ['Posts for this week', 'Seven posts, one for each day, made from your week and your gym’s photo. A new set every Monday. Pick a look (Mixed, Colour or Film) and tap one to see it at every size. Downloading them comes with Clash Pro.'],
                        ['Your gym in the app', 'Your gym’s page exactly as a member sees it on a phone, with a checklist of what a finished page has. Tap anything on the phone to change it.'],
                        ['Your people', 'Who’s worth a word this week: who leads the board, the most improved, the session of the week, the longest streak and the new faces. Underneath, your member count.'],
                        ['Gym Clash', 'Where you stand against the POWR gyms near you this week, who you’re chasing and how many sessions would close the gap, and your rank per member, where size doesn’t win. It resets every Monday.'],
                        ['Since …', 'Everything POWR has recorded at your gym since you joined: sessions, people, hours and POWR earned. On Clash+ and above, the last eight weeks as a chart.'],
                    ]}
                />
                <Shot
                    id="gym-overview-week"
                    alt="The This week card: sessions so far, the pace bar and the days of the week"
                    caption="This week"
                    notes={[
                        ['count', 'Sessions at your gym this week, and how many people trained.'],
                        ['now', 'How many are in the gym right now.'],
                        ['story', 'One sentence on how the week is going.'],
                        ['pace', 'Sessions so far, where the week is heading by Sunday, a usual week and your best recent one.'],
                        ['days', 'Monday to Sunday against last week, with today in gold.'],
                    ]}
                />
                <Shot
                    id="gym-overview-moves"
                    alt="The Worth doing this week card with three suggestions"
                    caption="Worth doing this week"
                    notes={[
                        ['first', 'Picked from your own numbers: here, regulars going quiet.'],
                        ['nudge', 'Each one has the button that does it. The first is in gold.'],
                        ['event', 'What’s running now, like a live event, and where to see it.'],
                        ['league', 'The race in Gym Clash, and how to close the gap.'],
                    ]}
                />
                <P>
                    <b>Your people</b> only ever shows names your own leaderboard already shows. Members who hide
                    from leaderboards never appear. <b>Your people</b>, <b>Gym Clash</b> and the all-time numbers
                    fill in once your screens are switched on.
                </P>
                <Shot
                    id="gym-overview-people"
                    alt="The Your people card naming this week’s leader, most improved and new faces"
                    caption="Your people"
                    notes={[
                        ['lead', 'Who leads your board this week.'],
                        ['improved', 'The most improved on last week.'],
                        ['session', 'The session of the week.'],
                        ['streak', 'The longest streak.'],
                        ['fresh', 'New faces this week.'],
                        ['counts', 'Your member count, how many are drifting, and the new faces.'],
                    ]}
                />
                <Shot
                    id="gym-overview-clash"
                    alt="The Gym Clash card: second of eight gyms within 10 km"
                    caption="Gym Clash"
                    notes={[
                        ['rank', 'Your place among the POWR gyms near you this week.'],
                        ['table', 'The top four, with you in gold, who’s in now and their POWR.'],
                        ['gap', 'Who you’re chasing, and about how many sessions would close the gap.'],
                        ['effort', 'Your rank per member, where size doesn’t win. It resets every Monday.'],
                    ]}
                />
                <Callout tone="note" title="Not now">
                    Everyday suggestions in <b>Worth doing</b> have a <b>Not now</b> button that puts them away
                    until tomorrow or for a week, on this device, and the next one steps up. Anything waiting on
                    you, like winners to reveal or a change POWR asked for, stays until you’ve dealt with it.
                    When there’s nothing left you’ll see <b>You’re all caught up.</b>
                </Callout>
                <P>
                    The <b>Ready for members</b> count on <b>Your gym in the app</b> is your first-week checklist:
                    cover photo, logo, name and address, opening hours, about, and your team. It reads{' '}
                    <b>Your page is complete</b> when all six are done.
                </P>
            </Section>

            <Section id="packages" title="Packages and locks">
                <P>
                    Every gym starts with a three-month free trial with everything switched on. After that your
                    gym runs on the package you chose, or on Clash if you didn’t choose one. Each package includes
                    everything in the one before it.
                </P>
                <Table
                    head={['Package', 'What it unlocks']}
                    rows={[
                        ['Clash', 'Your gym in Gym Clash against the gyms near you, scored per active member. Your own member leaderboard, your screens and your live ranking. The join poster, your team and Settings.'],
                        ['Clash+', 'Your own in-gym challenges (Events). Partner discounts on prizes and kit (Discounts), and a partner brand’s code for everyone in an event. The Members dashboard, and Retention: how many are drifting from their usual visits.'],
                        ['Clash Pro', 'Four POWR Clash Nights a year, one a quarter (Clash Nights). The Studio and event kits, including your own photos and clips. Retention by name, with a morning email and a one-tap nudge. Full activity for members who share all their training with you. Guest leads from every event.'],
                        ['Founding Pro', 'Clash Pro at the founding price, locked in on renewal, for the first ten gyms. All four Clash Night dates booked at signing, and Founding gym status on the leaderboard. Only offered during the free trial.'],
                    ]}
                />
                <P>Where each locked part shows:</P>
                <Table
                    head={['Page', 'Comes with']}
                    rows={[
                        ['Events (new events)', 'Clash+'],
                        ['Discounts', 'Clash+'],
                        ['Members', 'Clash+ (names: Clash Pro)'],
                        ['Retention', 'Clash+ (names: Clash Pro)'],
                        ['Studio, and downloading the week’s posts', 'Clash Pro'],
                        ['Clash Nights', 'Clash Pro and Founding Pro, not during the trial'],
                    ]}
                />
                <P>
                    A locked page shows a panel instead: what the part does, which package it comes with, the
                    package you’re on, and a <b>See packages</b> button. To change package, open <b>Package</b>:
                    see <Link to="/docs/gyms/settings" className={A}>Settings & team</Link>.
                </P>
                <Shot
                    id="gym-locked"
                    alt="The Members page on the Clash package, showing the lock panel"
                    caption="A locked page, on Clash"
                    notes={[
                        ['line', 'The package you’re on. Tap it to open Package.'],
                        ['lock', 'A lock marks a page your package doesn’t include yet.'],
                        ['comes', 'Which packages include it.'],
                        ['yours', 'The package you’re on now.'],
                        ['see', 'See packages opens the Package page.'],
                    ]}
                />
            </Section>

            <Section id="first" title="Your first week">
                <P>Three things, in this order. Each takes a few minutes.</P>
                <Steps>
                    <Step n="1" title="Get the join poster up">
                        Members count for you once they pick your gym in the app, and the join poster is how you
                        tell them. Press <b>Print it</b> or <b>Get the link</b> on the Overview, or{' '}
                        <b>The join poster</b> under <b>Settings</b> → <b>Help</b>. <b>Download the poster kit</b>{' '}
                        gets one ZIP with an A4 for the wall, an A5 for the counter, three sizes for your feed and
                        the caption. <b>Copy the link</b> gives you the same QR as a link for your welcome email or
                        WhatsApp group. It’s on every package.
                    </Step>
                    <Step n="2" title="Put the board on a screen">
                        Open <b>Screens</b>, pick your screen link name once and press{' '}
                        <b>Switch on the screens</b> (owners only). You get two: your weekly leaderboard, and Gym
                        Clash. Open the link in the TV’s browser, go full screen and leave it running. It refreshes
                        itself and starts a new week every Monday. Switching on also puts your gym into Gym Clash.
                        More in <Link to="/docs/gyms/screens" className={A}>Screens</Link>.
                    </Step>
                    <Step n="3" title="Finish your page in the app">
                        On the Overview, work through <b>Your gym in the app</b> until it reads{' '}
                        <b>Your page is complete</b>: a cover photo, your logo, opening hours, a line about the
                        gym, and your trainers with a booking link each. Owners make the changes; see{' '}
                        <Link to="/docs/gyms/settings" className={A}>Settings & team</Link>.
                    </Step>
                </Steps>
                <Callout tone="good" title="Then">
                    On Clash+ or above, run your first event: a monthly challenge runs itself, with the board, the
                    pushes and the reveal. POWR checks your first event before it goes out. And keep the Monday
                    recap email on, so last week lands in your inbox.
                </Callout>
            </Section>

            <Section id="next" title="Where to next">
                <Table
                    head={['Guide', 'For when you want to']}
                    rows={[
                        [<Link key="s" to="/docs/gyms/settings" className={A}>Settings & team</Link>, 'Change your details, your page in the app, your team, your package, or ask POWR something.'],
                        [<Link key="e" to="/docs/gyms/events" className={A}>Events</Link>, 'Run your own challenges, from draft to reveal.'],
                        [<Link key="d" to="/docs/gyms/discounts" className={A}>Discounts</Link>, 'Buy prizes and kit at the POWR members’ price.'],
                        [<Link key="c" to="/docs/gyms/clash-nights" className={A}>Clash Nights</Link>, 'Book your quarterly POWR nights.'],
                        [<Link key="t" to="/docs/gyms/screens" className={A}>Screens</Link>, 'Put the board and Gym Clash on your TVs.'],
                        [<Link key="o" to="/docs/gyms/studio" className={A}>Studio</Link>, 'Turn your photos, clips and numbers into posts.'],
                        [<Link key="m" to="/docs/gyms/members" className={A}>Members & Retention</Link>, 'See who trains, when, and who’s drifting.'],
                    ]}
                />
            </Section>

            <Section id="faq" title="Common questions">
                <P>
                    <b>My numbers are all zero.</b> They count members who picked your gym in the app and have
                    trained there since. Get the join poster up and they fill in as members check in.
                </P>
                <P>
                    <b>A member trains here but isn’t on our board.</b> They haven’t picked your gym in the app
                    yet. Send them your join link: it opens the app on your gym, where{' '}
                    <b>Set as Home Gym</b> makes them one of yours. Members who hide from leaderboards are counted
                    but never named.
                </P>
                <P>
                    <b>What happens when the trial ends?</b> The pages your package doesn’t include lock. If
                    that’s anything at all, owners get an email 14 and 3 days before, and once it has ended. Anything already under way finishes: an event that’s
                    running when the trial ends still reveals its winners. Your leaderboard, screens, join poster
                    and team stay on every package.
                </P>
                <P>
                    <b>Who can change things?</b> Owners can change the gym’s details, its page in the app, the
                    team and the package, and switch on the screens. Team members can see all of it and use the
                    rest of the portal. The roles are in{' '}
                    <Link to="/docs/gyms/settings" className={A}>Settings & team</Link>.
                </P>
                <P>
                    <b>A suggestion I put off is back.</b> <b>Not now</b> is remembered on the device you pressed
                    it on, for a day or a week. On another laptop or phone it may still show.
                </P>
                <P>
                    <b>The Overview says it couldn’t load your gym.</b> Press <b>Try again</b>. If it keeps
                    happening, ask us from <b>Settings</b> → <b>Help</b>.
                </P>
            </Section>
        </DocsLayout>
    );
}
