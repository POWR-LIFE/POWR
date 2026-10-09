import React from 'react';
import { Link } from 'react-router-dom';
import { Callout, DocsLayout, P, PLACEMENTS_LIVE, Section, Shot, Step, Steps, Table } from './docsShared';

// /docs/whats-on — the featured slot. Mirrors the portal's What's On page
// (PartnerFeatured.jsx): the calendar, the request form, and what a request
// turns into once POWR has looked at it.

const TOC = [
    ['what', 'What the featured slot is'],
    ['before', 'Before you ask'],
    ['calendar', 'Reading the calendar'],
    ['request', 'Request a week'],
    ['review', 'What POWR checks'],
    ['status', 'Following your request'],
    ['members', 'What members see'],
    ['faq', 'Common questions'],
];

const link = 'font-bold text-[#8a7600] hover:underline';

export default function DocsWhatsOn() {
    return (
        <DocsLayout
            eyebrow="Partner guide · What’s On"
            title="Get your reward featured"
            intro="What’s On is the calendar for the featured slot: the one reward shown at the top of the POWR rewards screen. You pick a week, POWR confirms it, and for those days your reward is the first thing members see when they open their rewards."
            toc={TOC}
            nextNote={PLACEMENTS_LIVE ? { label: 'Want to be seen in a place, not a week?', detail: 'Placements boost your reward for members in an area you choose, at the hours you choose.' } : undefined}
        >
            <Section id="what" title="What the featured slot is">
                <P>
                    Only one reward is featured at a time. While a week is yours, your reward takes the large card at
                    the top of the <b>Rewards</b> screen in the POWR app, and it also appears on members’ Home screen
                    under their weekly challenges.
                </P>
                <P>
                    Every brand can see the same calendar, so you can tell at a glance which weeks are taken and who
                    has them. What other brands have <i>asked</i> for stays private: you only ever see your own
                    requests.
                </P>
                <Callout tone="note" title="A request holds nothing">
                    Asking for a week doesn’t reserve it. Several brands can ask for the same days, and nothing is
                    booked until POWR confirms one of them. The week turns solid on the calendar when it’s yours.
                </Callout>
            </Section>

            <Section id="before" title="Before you ask">
                <P>
                    You need at least one <b>live reward</b>. The featured card sends members straight to an offer they
                    can claim, so the request form only lists rewards that are live in the app. Without one, the page
                    shows <b>A featured week needs a live reward</b> and links you to <b>My Rewards</b>.
                </P>
                <P>
                    The card is built from the reward itself: its hero image (or video), logo, points cost and offer.
                    Check those look right before your week starts. See the{' '}
                    <Link to="/docs/rewards" className={link}>Rewards guide</Link> for setting them up.
                </P>
            </Section>

            <Section id="calendar" title="Reading the calendar">
                <P>
                    Open <b>What’s On</b> in the portal. The calendar shows one month at a time; use the arrows to move
                    between months. Today’s date is circled in gold.
                </P>
                <Shot
                    id="partner-whatson-page"
                    alt="The What’s On page in the partner portal"
                    caption="The What’s On page"
                    notes={[
                        ['request', 'Request A Week: start a request from next Monday.'],
                        ['now', 'Featured Now: who has the slot today.'],
                        ['windows', 'Your featured windows: your confirmed weeks still to come.'],
                        ['calendar', 'The calendar, one month at a time.'],
                    ]}
                />
                <Table
                    head={['On the calendar', 'What it means']}
                    rows={[
                        ['Solid band with a logo at each end', 'A confirmed week. Nobody else can be featured on those days.'],
                        ['Solid band ringed in gold', 'A confirmed week that’s yours.'],
                        ['Dashed, hollow band', 'Your own request, still waiting for POWR. Click it to withdraw.'],
                        ['A free day', 'Hover and a + appears. Click it to start a request from that day.'],
                        ['A day you can’t click', 'It’s in the past, or a confirmed week already covers it.'],
                    ]}
                />
                <Shot
                    id="partner-whatson-calendar"
                    alt="A month on the What’s On calendar, with confirmed weeks, your own week and a request"
                    caption="The calendar"
                    notes={[
                        ['yours', 'A confirmed week that’s yours, ringed in gold.'],
                        ['today', 'Today, circled in gold.'],
                        ['confirmed', 'A confirmed week: another brand has those days.'],
                        ['request', 'Your request, dashed and hollow until POWR confirms it.'],
                        ['months', 'The arrows move between months.'],
                    ]}
                />
                <P>
                    Above the calendar, <b>Featured Now</b> shows who has the slot today (with a <b>You</b> tag when
                    it’s you), and <b>Your featured windows</b> lists every confirmed week of yours that hasn’t ended.
                </P>
            </Section>

            <Section id="request" title="Request a week">
                <Steps>
                    <Step n="1" title="Open the form">
                        Press <b>Request A Week</b> at the top of the page, or click a free day on the calendar. The
                        button starts on next Monday; a day you click starts on that day. Either way the window begins
                        as one week long.
                    </Step>
                    <Step n="2" title="Choose the reward">
                        Pick it from <b>Reward to feature</b>. If you have only one live reward it’s already chosen.
                    </Step>
                    <Step n="3" title="Set the dates">
                        Adjust <b>From</b> and <b>Until</b>, or use the <b>Quick fill</b> buttons for any of the next four
                        weeks. A week that’s already booked shows as <b>taken</b> and can’t be picked. You can ask for
                        more or less than a week; POWR decides what it can give.
                    </Step>
                    <Step n="4" title="Add a note (optional)">
                        Use <b>Anything we should know?</b> for the reason behind the dates: a launch, a campaign you’re
                        running, why this week matters. It helps POWR choose when two brands want the same days.
                    </Step>
                    <Step n="5" title="Send it">
                        Press <b>Send Request</b>. The week appears on the calendar as a dashed band and the request is
                        listed under <b>Your Requests</b> as <b>Awaiting review</b>.
                    </Step>
                </Steps>
                <Shot
                    id="partner-whatson-form"
                    alt="The Request a week form, filled in"
                    caption="Request a week"
                    notes={[
                        ['reward', 'Reward to feature: already chosen if you have one live reward.'],
                        ['dates', 'From and Until. Until is the day after your last featured day.'],
                        ['quick', 'Quick fill: any of the next four weeks. A booked week shows as taken.'],
                        ['note', 'Why these dates matter. It helps when two brands want the same week.'],
                        ['send', 'Send Request. Nothing is booked until POWR confirms it.'],
                    ]}
                />
                <Callout tone="note" title="How the dates are counted">
                    A window runs from the start of the <b>From</b> day to the start of the <b>Until</b> day. So a
                    request for 12 Oct until 19 Oct covers Monday 12 to Sunday 18, and the following Monday is free for
                    someone else. Set <b>Until</b> to the day after your last featured day.
                </Callout>
            </Section>

            <Section id="review" title="What POWR checks">
                <P>
                    The POWR team confirms every slot by hand. It looks at what else is planned for those days, your
                    note, and whether the reward is ready to sit at the top of the app. Then it either confirms the
                    week or declines it, sometimes with a short note back to you.
                </P>
                <P>
                    When POWR confirms one brand’s request, every other request still waiting on any of those days is
                    declined at the same moment, with the note <b>That week was taken before we could confirm your
                    request.</b> You can then ask for different dates straight away.
                </P>
            </Section>

            <Section id="status" title="Following your request">
                <P>
                    Decisions show on the What’s On page itself, under <b>Your Requests</b>. Waiting requests sit at
                    the top, and any note from POWR appears under the request it belongs to.
                </P>
                <Shot
                    id="partner-whatson-requests"
                    alt="Your Requests on the What’s On page, one awaiting review, two confirmed and one declined"
                    caption="Your Requests"
                    notes={[
                        ['pending', 'Awaiting review: waiting requests sit at the top.'],
                        ['withdraw', 'Withdraw a request that’s still waiting.'],
                        ['confirmed', 'Confirmed: the week is yours.'],
                        ['declined', 'Not this time, with POWR’s note under the request.'],
                    ]}
                />
                <Table
                    head={['Status', 'Meaning', 'What you can do']}
                    rows={[
                        ['Awaiting review', 'POWR hasn’t decided yet. Nothing is booked.', 'Withdraw it, from the list or by clicking its dashed band.'],
                        ['Confirmed', 'The week is yours. It now shows as a solid band ringed in gold.', 'Nothing. To move or cancel it, ask from Support.'],
                        ['Not this time', 'POWR declined it, or another brand was confirmed for those days first.', 'Read the note, then request other dates.'],
                        ['Withdrawn', 'You took the request back.', 'Ask again whenever you like.'],
                    ]}
                />
            </Section>

            <Section id="members" title="What members see">
                <P>
                    From the first day of your window to the last, the featured card at the top of the app’s{' '}
                    <b>Rewards</b> screen is yours. It shows your hero image or video, your logo, the points cost and
                    your offer, with a <b>Redeem</b> button for members who have enough points. Members who don’t have
                    enough yet see how many points they still need, so the card works as a goal as well as an offer.
                </P>
                <P>
                    The same reward shows on members’ Home screen, below their weekly challenges, marked{' '}
                    <b>Ready to redeem</b> or with the points still to go. Tapping it opens the rewards screen.
                </P>
                <P>
                    When no brand holds the slot, the app chooses a reward to feature by itself, so the top of the
                    screen is never empty. A confirmed week always comes before that choice.
                </P>
            </Section>

            <Section id="faq" title="Common questions">
                <P>
                    <b>The request form says I have no rewards.</b> Only live rewards can be featured. Get one live
                    under <b>My Rewards</b>, then come back. A reward that isn’t live in the app yet
                    doesn’t count.
                </P>
                <P>
                    <b>“You already have a request open on those dates.”</b> You can only have one waiting request on
                    any given day. Withdraw the first one, or pick days that don’t overlap it.
                </P>
                <P>
                    <b>“Part of that window is already booked.”</b> A confirmed week covers at least one of your days.
                    Shorten the window, or move it to days the calendar shows as free.
                </P>
                <P>
                    <b>“Pick a window that has not already passed.”</b> The <b>Until</b> date is today or earlier.
                    Move it into the future. Remember the window ends at the start of the <b>Until</b> day.
                </P>
                <P>
                    <b>Can I see what other brands have asked for?</b> No. Other brands’ confirmed weeks are visible to
                    everyone, but requests are private to the brand that made them. Equally, nobody else can see yours.
                </P>
                <P>
                    <b>What if I switch my reward off during my week?</b> The app only features live rewards. If yours
                    is switched off, the card goes back to the app’s own choice until it’s live again. The week stays
                    yours on the calendar, but members won’t see your card until the reward is live again.
                </P>
                {PLACEMENTS_LIVE && (
                    <P>
                        <b>Will every member see my card all week?</b> Nearly. A member standing in another brand’s{' '}
                        <Link to="/docs/placements" className={link}>placement</Link> area may see that reward in the top
                        slot while they’re there. Everyone else sees yours.
                    </P>
                )}
                <P>
                    <b>Can I change a confirmed week?</b> Not from the portal. Confirmed weeks are fixed on the
                    calendar. Ask from <b>Support</b> and POWR will move or cancel it for you.
                </P>
                <P>
                    <b>How do I change what the card shows?</b> Edit the reward under <b>My Rewards</b>. Changes to a
                    live reward go to POWR for review first, so make them a few days before your week starts.
                </P>
            </Section>
        </DocsLayout>
    );
}
