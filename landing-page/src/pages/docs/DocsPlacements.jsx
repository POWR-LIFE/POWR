import React from 'react';
import { Link } from 'react-router-dom';
import { Callout, DocsLayout, P, Section, Shot, Step, Steps, Table } from './docsShared';

// /docs/placements: self-serve location boosts. Mirrors the portal's
// Placements page (PartnerPlacements.jsx): the three-stage campaign builder,
// the map, review, and the list's statuses. Describes WHAT members get, never
// how the app knows where they are.

const TOC = [
    ['what', 'What a placement does'],
    ['access', 'When you can use it'],
    ['before', 'Before you start'],
    ['create', 'Build a campaign'],
    ['map', 'Painting the map'],
    ['timing', 'Days, hours and audience'],
    ['review', 'Review and going live'],
    ['statuses', 'Your campaigns'],
    ['members', 'What members see'],
    ['results', 'Reading the numbers'],
    ['faq', 'Common questions'],
];

const link = 'font-bold text-[#8a7600] hover:underline';

export default function DocsPlacements() {
    return (
        <DocsLayout
            eyebrow="Partner guide · Placements"
            title="Boost a reward where it matters"
            intro="A placement puts one of your rewards at the front of the app for members in a place you choose, at the times you choose. You paint the area on a map, set the days and hours, and send it to POWR. Once it’s approved, members in that area see your offer first."
            toc={TOC}
            nextNote={{ label: 'Need something to post?', detail: 'Studio turns your reward into branded posts, stories and print, ready to download.' }}
        >
            <Section id="what" title="What a placement does">
                <P>
                    Think of it as renting a piece of the map. Pick a high street, a park, the blocks around a gym or
                    your own shop. While a member is inside that area during your hours, your reward moves to the top
                    of their rewards, priced in the points they’ve already earned.
                </P>
                <P>
                    One brand per square. While your approved campaign holds a square for a time slot, no other brand
                    can book that square for those times.
                </P>
            </Section>

            <Section id="access" title="When you can use it">
                <P>
                    Placements is in beta, and POWR opens it to brands with a single switch. Until that switch is on,{' '}
                    <b>Placements</b> doesn’t appear in your portal sidebar, and opening the page directly takes you
                    back to <b>Overview</b>. There’s nothing to buy or turn on from your side: when it opens, it opens
                    for every brand at once.
                </P>
                <Callout tone="note" title="Don’t see Placements?">
                    It isn’t open yet. Ask from <b>Support</b> if you’d like to be told when it is, or tell POWR about
                    a campaign you have in mind.
                </Callout>
            </Section>

            <Section id="before" title="Before you start">
                <P>
                    A placement always boosts a reward you already run, so you need at least one <b>live reward</b>.
                    Without one, the Placements page asks you to get one live first, with a <b>Go to my rewards</b>{' '}
                    button. See the <Link to="/docs/rewards" className={link}>Rewards guide</Link>.
                </P>
                <P>
                    With no campaigns yet, the page opens on a short walkthrough of how placements work. Once you have
                    campaigns, the same walkthrough is behind <b>How placements work</b> under the page title.
                </P>
            </Section>

            <Section id="create" title="Build a campaign">
                <P>
                    Press <b>New Placement</b> (or <b>Create your first placement</b>). A campaign is built in three
                    stages, shown across the top of the screen. Each <b>Save &amp; continue</b> saves a draft, so you
                    can leave at any point and pick it up later.
                </P>
                <Shot
                    id="partner-placements-offer"
                    alt="The campaign builder on its first stage, Offer"
                    caption="The builder: Offer"
                    notes={[
                        ['stages', 'The three stages. A tick marks each one you’ve passed.'],
                        ['name', 'Campaign name: private to your team.'],
                        ['reward', 'The live reward to boost.'],
                        ['save', 'Save draft saves wherever you are.'],
                        ['next', 'Save & continue saves a draft and moves on.'],
                    ]}
                />
                <Steps>
                    <Step n="1" title="Offer: choose the reward">
                        Give the campaign a <b>Campaign name</b>, for example “Weekend studio launch”. It’s private to
                        your team and only helps you find the campaign later. Then choose the <b>Reward</b> to boost from
                        your live rewards. Both are required before you can move on.
                    </Step>
                    <Step n="2" title="Place & time: set where and when">
                        Paint your <b>Coverage area</b> on the map (see below). On the right, set <b>Run dates</b> if
                        the campaign should start and stop on set days; leave them empty and it runs for as long as it’s
                        live. Pick <b>Days</b> to limit it to certain days of the week; pick none and it runs every day.
                        You need at least one square before you can continue.
                    </Step>
                    <Step n="3" title="Audience & review: confirm your plan">
                        Narrow the hours and the audience if you want to (see{' '}
                        <a href="#timing" className={link}>Days, hours and audience</a>), check the summary of reward,
                        area and timing, then press <b>Submit for review</b>.
                    </Step>
                </Steps>
                <P>
                    <b>Save draft</b> at the top saves wherever you are, <b>Back</b> steps back without losing
                    anything, and <b>Cancel</b> or <b>Back to Placements</b> leaves the builder. Anything you saved
                    stays as a draft in your list.
                </P>
            </Section>

            <Section id="map" title="Painting the map">
                <P>
                    The map is a grid of squares. Zoom in for smaller squares and a tighter area; zoom out to cover more
                    ground with bigger ones. Use <b>Search a place or address</b> to jump to a spot, and{' '}
                    <b>Satellite</b> to see the buildings underneath.
                </P>
                <Table
                    head={['Tool', 'How it works']}
                    rows={[
                        ['Pan', 'Drag to move the map. A single click adds or removes one square.'],
                        ['Paint', 'Drag a box. Every free square inside it is added.'],
                        ['Draw', 'Drag a loop around an area, like a lasso. Squares inside the loop fill in.'],
                        ['Erase', 'Drag a box over squares to remove them.'],
                        ['Clear', 'Removes every square at once. It sits beside the square count.'],
                    ]}
                />
                <P>The colours tell you what’s free for the days and hours you’ve set:</P>
                <Table
                    head={['Colour', 'Meaning']}
                    rows={[
                        ['Gold', 'Selected: part of your campaign.'],
                        ['Red', 'Booked: a live campaign already holds it at these times. You can’t paint it.'],
                        ['Amber', 'Requested by another brand, still in review. You can paint it, but whichever campaign POWR approves first gets it.'],
                    ]}
                />
                <Shot
                    id="partner-placements-map"
                    alt="The coverage map with painted squares, booked squares and requested squares"
                    caption="Painting the map"
                    notes={[
                        ['tools', 'Pan, Paint, Draw and Erase.'],
                        ['search', 'Search a place or address. Satellite shows the buildings underneath.'],
                        ['count', 'How many squares you’ve painted, and Clear to start again.'],
                        ['selected', 'Gold: your campaign’s squares.'],
                        ['booked', 'Red: booked by a live campaign at these times.'],
                        ['requested', 'Amber: requested by another brand, still in review.'],
                    ]}
                />
                <Callout tone="note" title="Zoom in if it says so">
                    If the map shows <b>Zoom in to select squares</b>, or a drag says <b>Area too large</b>, you’re
                    trying to work across too many squares at once. Zoom in a little and paint in smaller sections.
                </Callout>
            </Section>

            <Section id="timing" title="Days, hours and audience">
                <Table
                    head={['Setting', 'Leave it empty and…', 'Use it to…']}
                    rows={[
                        ['Run dates', 'The campaign runs for as long as it’s live.', 'Match a launch, a sale or a season. The end date is included.'],
                        ['Days', 'It runs every day.', 'Run weekdays only, or just the weekend.'],
                        ['Only certain hours', 'It runs all day.', 'Catch the morning run or the evening commute. Ticking it starts you on 8:00 to 20:00.'],
                        ['Who sees it', 'Everyone in the area sees it.', 'Reach members by the activities they’ve told POWR they care about: walking, running, cycling, swimming, gym, hiit, sports, yoga, dance or sleep.'],
                        ['Show at most (per member / day)', 'No limit.', 'Stop your boost feeling like it follows people around.'],
                    ]}
                />
                <Shot
                    id="partner-placements-review"
                    alt="The builder’s last stage, Audience & review, ready to submit"
                    caption="The builder: Audience & review"
                    notes={[
                        ['summary', 'The summary: reward, area and timing.'],
                        ['hours', 'Only certain hours. The last hour you pick is included.'],
                        ['who', 'Who sees it: members by the activities they care about.'],
                        ['cap', 'Show at most: a daily limit for each member.'],
                        ['submit', 'Submit for review. It never goes live by itself.'],
                    ]}
                />
                <P>
                    Hours are whole hours in the member’s local time, and the last hour you pick is included: 8:00 to
                    20:00 keeps the boost on until 21:00. An end hour earlier than the start runs overnight, so 20:00 to
                    6:00 covers the evening and the early morning.
                </P>
                <P>
                    Picking activities narrows your audience. Members who haven’t chosen any activities in the app won’t
                    be matched, so only target when the offer really is for one kind of member.
                </P>
            </Section>

            <Section id="review" title="Review and going live">
                <P>
                    Submitting never makes a campaign live by itself. The POWR team reviews every one, confirms the
                    squares are still free for your times, and agrees launch timing before switching it on. While it’s
                    with POWR the campaign is locked and shows <b>POWR is reviewing</b>.
                </P>
                <P>
                    If POWR approves it, it goes <b>Live</b>, or <b>Scheduled</b> if your start date hasn’t arrived.
                    If something needs to change (another brand was approved for the same squares first, for example),
                    it comes back as <b>Needs changes</b>. Press <b>Revise</b>, fix it and submit again.
                </P>
                <Callout tone="warn" title="Submitted campaigns can’t be edited from the portal">
                    Once you press <b>Submit for review</b>, you can’t change, withdraw or delete the campaign
                    yourself, and that stays true once it’s live. To change dates, pause it or end it early, ask from{' '}
                    <b>Support</b>.
                </Callout>
            </Section>

            <Section id="statuses" title="Your campaigns">
                <P>Every campaign is listed on the Placements page with its squares, days, hours, dates and audience.</P>
                <Shot
                    id="partner-placements-list"
                    alt="The Placements page with five campaigns in different states"
                    caption="The Placements page"
                    notes={[
                        ['create', 'New Placement starts a campaign.'],
                        ['draft', 'A draft: Continue it, or delete it with the bin.'],
                        ['review', 'In review: locked while POWR looks at it.'],
                        ['revise', 'Needs changes: Revise it and submit again.'],
                        ['live', 'Live, with its counts beside it.'],
                    ]}
                />
                <Table
                    head={['Status', 'Meaning', 'What you can do']}
                    rows={[
                        ['Draft', 'Saved but not sent.', 'Continue, or delete it with the bin icon.'],
                        ['In review', 'With POWR.', 'Wait. It’s locked while POWR looks at it.'],
                        ['Needs changes', 'POWR sent it back.', 'Revise and submit again, or delete it.'],
                        ['Scheduled', 'Approved, starting on its start date.', 'Nothing: it’s managed by POWR from here.'],
                        ['Live', 'Running now for members in your area.', 'Watch the numbers.'],
                        ['Paused', 'Approved but switched off for now.', 'Ask from Support if you didn’t expect it.'],
                        ['Ended', 'Its end date has passed.', 'Start a new campaign for another run.'],
                    ]}
                />
            </Section>

            <Section id="members" title="What members see">
                <P>
                    <b>At the top of their rewards.</b> While a member is in your area during your hours, your reward
                    moves to the front of their rewards list. It can also take the large card at the top of the{' '}
                    <b>Rewards</b> screen, marked with a small <b>AD</b> tag so members know it’s a paid boost. When
                    they leave the area, the screen goes back to normal.
                </P>
                <P>
                    <b>Sometimes, a notification.</b> A member may get a push that reads “[your brand] is nearby” with
                    “[your reward] is boosted where you are right now, open to redeem.” POWR keeps these rare: they go
                    only to members who allow notifications, never more than one such nudge a day, and members can
                    switch them off.
                </P>
                <P>
                    Nothing changes about the reward itself. Members pay the same points and get the same code or link
                    as anyone else who redeems it.
                </P>
            </Section>

            <Section id="results" title="Reading the numbers">
                <P>
                    Once a campaign has activity, its row shows four counts (on a wide enough screen):
                </P>
                <Shot
                    id="partner-placements-counts"
                    alt="A live campaign’s row with its four counts"
                    caption="A live campaign’s counts"
                    notes={[
                        ['seen', 'Seen'],
                        ['visited', 'Visited'],
                        ['pushed', 'Pushed'],
                        ['redeemed', 'Redeemed'],
                    ]}
                />
                <Table
                    head={['Count', 'What it counts']}
                    rows={[
                        ['Seen', 'Times your boosted reward was shown in the app.'],
                        ['Visited', 'Times a member was counted in your squares during your hours.'],
                        ['Pushed', 'Notifications sent for this campaign. Only shown once there’s at least one.'],
                        ['Redeemed', 'Redemptions of your reward that came from this campaign.'],
                    ]}
                />
                <P>
                    For the full picture of codes claimed and used, see{' '}
                    <Link to="/docs/redemptions" className={link}>Redemptions</Link>.
                </P>
            </Section>

            <Section id="faq" title="Common questions">
                <P>
                    <b>“Some squares are already booked for these times.”</b> A live campaign now holds some of
                    your squares at your times, usually one approved since you painted them. Go back to{' '}
                    <b>Place &amp; time</b>, erase the red squares (or change your days and hours) and save again.
                </P>
                <P>
                    <b>“Paint at least one square on the map.”</b> You can save a draft without an area, but you can’t
                    move past <b>Place &amp; time</b> or submit until you’ve painted one.
                </P>
                <P>
                    <b>My reward shows “(inactive)”.</b> The reward was switched off after you started the draft. A
                    placement only boosts a live reward, so pick a live one or get that reward live again first.
                </P>
                <P>
                    <b>Can two of my own campaigns overlap?</b> Not on the same squares at the same times. Your own live
                    campaigns count too: their squares show red, so a second campaign can’t take them.
                </P>
                <P>
                    <b>My campaign says Needs changes. What should I change?</b> If it isn’t obvious from the map
                    (red squares are the usual reason), ask from <b>Support</b> and POWR will tell you.
                </P>
                <P>
                    <b>Can I delete a campaign?</b> Drafts and campaigns marked <b>Needs changes</b>, yes: use{' '}
                    <b>Delete</b> in the builder or the bin icon in the list. Deleting can’t be undone. Anything you’ve
                    submitted is managed by POWR, so ask from <b>Support</b>.
                </P>
                <P>
                    <b>Does a placement replace my featured week?</b> No, they work side by side. A{' '}
                    <Link to="/docs/whats-on" className={link}>What’s On</Link> week puts your reward in front of
                    everyone; a placement puts it in front of members in one place.
                </P>
            </Section>
        </DocsLayout>
    );
}
