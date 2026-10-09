import React from 'react';
import { Link } from 'react-router-dom';
import { Callout, DocsLayout, P, Section, Shot, Step, Steps, Table } from '../docsShared';

// /docs/gyms/events: the gym's own challenges, end to end: the list, the
// six-step builder, POWR's first-event check, running it live (board,
// people, the finale-night door, notifications, the content kit), the
// reveal, prizes, and what can still change at each stage.

const TOC = [
    ['about', 'What Events is for'],
    ['list', 'Your events list'],
    ['build', 'Build an event'],
    ['counts', 'What counts on the board'],
    ['prizes', 'Prizes and the partner code'],
    ['pushes', 'Notifications'],
    ['publish', 'Publishing and POWR’s check'],
    ['run', 'Running it'],
    ['door', 'The finale night door'],
    ['content', 'Event content'],
    ['reveal', 'Revealing the winners'],
    ['after', 'After the reveal'],
    ['change', 'Editing, cancelling, running it again'],
    ['faq', 'Common questions'],
];

const A = 'font-bold text-[#8a7600] hover:underline';

export default function GymDocsEvents() {
    return (
        <DocsLayout
            eyebrow="Gym guide · Events"
            title="Run your own events"
            intro="Events are your gym’s own challenges in the POWR app: a month of sessions, a short sprint, or a points week with a finale night at the gym. You choose the format, the dates and the prizes. POWR runs the board, sends the notifications and keeps the results sealed until you reveal the winners. This guide follows an event from the first draft to the last prize handed over."
            toc={TOC}
            nextNote={{ label: 'Buying the prizes?', detail: 'Partner discounts get you the price POWR members pay, one code when you need it.' }}
        >
            <Section id="about" title="What Events is for">
                <P>
                    Open <b>Events</b> in the portal. Members see your event in the POWR app, join it, and climb a
                    leaderboard that runs itself. You give out the prizes; POWR never sets them for you.
                </P>
                <Callout tone="note" title="Comes with Clash+">
                    Creating and publishing events comes with <b>Clash+</b>, <b>Clash Pro</b> and <b>Founding Pro</b>,
                    and with the free trial. On Clash, <b>Events</b> shows <b>Your own challenges come with Clash+</b>, or{' '}
                    <b>New events come with Clash+</b> where the <b>New event</b> button would be. See <b>Package</b> in the portal to change it. An event that’s already running always finishes
                    and reveals its winners, whatever happens to your package.
                </Callout>
                <P>
                    Events marked <b>Run by POWR</b> are ones POWR runs at your gym, such as a{' '}
                    <Link to="/docs/gyms/clash-nights" className={A}>Clash Night</Link>. POWR writes them, sends the
                    notifications and reveals the results. You can see who’s in, follow the board and put it on your TV,
                    but you can’t change them.
                </P>
            </Section>

            <Section id="list" title="Your events list">
                <P>
                    <b>Events</b> sorts everything into <b>On now and coming up</b>, <b>Drafts</b> and <b>Finished</b>.
                    Each card shows the status, the format, the scoring dates, how many are in and the first prize. With
                    no events yet you see <b>Run your first event</b> and a <b>New event</b> button.
                </P>
                <Shot
                    id="gym-events-list"
                    alt="The Events page of the gym portal, with a live event, a scheduled one, a draft and two finished events"
                    caption="Your events"
                    notes={[
                        ['groups', 'Three groups: On now and coming up, Drafts and Finished.'],
                        ['status', 'Each event’s status. The table below says what each one means.'],
                        ['card', 'The format and the scoring dates, then how many are in and the first prize.'],
                        ['again', 'Run again, on a finished event: a copy without the dates.'],
                        ['new', 'New event opens the builder.'],
                    ]}
                />
                <Table
                    head={['Status', 'What it means']}
                    rows={[
                        ['Draft', 'Saved, not published. Only your team can see it, in the app too, so you can check how it looks.'],
                        ['Waiting for POWR', 'Your first event, with POWR for a quick check.'],
                        ['Changes needed', 'POWR asked for a change. Its note is on the event page.'],
                        ['Scheduled', 'Published. Members can see it and join. Scoring hasn’t started.'],
                        ['Live', 'Scoring. The board moves as members train.'],
                        ['Board sealed', 'Scoring has ended. Members can’t see the standings until you reveal.'],
                        ['Winners out', 'You (or POWR) revealed the winners. Time to hand over the prizes.'],
                        ['Finished', 'Wrapped up, three days after the reveal.'],
                        ['Cancelled', 'Called off before it started. It no longer shows in the app.'],
                        ['Pulled by POWR', 'POWR took it down. The reason is on the event page.'],
                    ]}
                />
            </Section>

            <Section id="build" title="Build an event">
                <P>
                    Press <b>New event</b>. The builder has six steps down the side. <b>Next</b> stays greyed out, with
                    the reason beside it, until the step is complete. A phone preview shows the event as members will
                    see it in the app (on a smaller screen, tap <b>See it in the app</b>).
                </P>
                <Steps>
                    <Step n="1" title="Format">
                        Pick the kind of event. You can’t change the format once the event is saved. Today there are three:
                        <Table
                            head={['Format', 'How long', 'What counts at first']}
                            rows={[
                                ['Monthly challenge', '2, 3, 4 or 6 weeks', 'Only sessions at your gym'],
                                ['Weekend sprint', '2, 3 or 4 days', 'Any verified workout, anywhere'],
                                ['Points week + finale night', '5, 7 or 10 days, then a night at your gym', 'Any verified workout, anywhere'],
                            ]}
                        />
                        Every format lets you change what counts in step 3.
                        <Shot
                            id="gym-events-builder-format"
                            alt="Step 1 of the event builder, with Points week + finale night picked"
                            caption="Step 1 · Format"
                            notes={[
                                ['rail', 'The six steps. Once you’re past one, you can go back to it.'],
                                ['length', 'How long each format can run.'],
                                ['counts', 'What counts at first. You can change it in step 3.'],
                                ['picked', 'The format you picked. It’s fixed once the event is saved.'],
                                ['next', 'Next is greyed out, with the reason beside it, until the step is complete.'],
                            ]}
                        />
                    </Step>
                    <Step n="2" title="When: name, dates, reveal">
                        <b>Event name</b>, 3 to 48 characters. <b>First day</b>, up to 90 days ahead: scoring starts at
                        midnight. <b>How long</b> sets the last day. A finale format adds <b>Finale night starts</b> (5pm to
                        8pm) and <b>And lasts</b> (2, 3 or 4 hours). The box underneath shows every date. The board seals at
                        midnight after the last day, and members can join until then. With a finale night, the last
                        scoring day is the day before the night. Then choose <b>Revealing the winners</b>:{' '}
                        <b>I’ll reveal them</b>, or <b>At a set time</b> after the board seals and within a week of it.
                        <Shot
                            id="gym-events-builder-when"
                            alt="Step 2 of the event builder, When, filled in for The Northpoint Open, with the app preview beside it"
                            caption="Step 2 · When"
                            notes={[
                                ['name', 'Event name, 3 to 48 characters.'],
                                ['long', 'First day and How long. Scoring starts at midnight on the first day.'],
                                ['night', 'A finale format adds when the night starts and how long it lasts.'],
                                ['dates', 'Every date your choices make, updated as you go.'],
                                ['reveal', 'Revealing the winners: you press it, or it happens at a set time.'],
                                ['phone', 'The event as members will see it in the app.'],
                            ]}
                        />
                    </Step>
                    <Step n="3" title="Scoring: what counts">
                        Choose what moves the board, the <b>Leaderboard</b> size (<b>Top 10</b>, <b>Top 20</b> or{' '}
                        <b>Top 50</b>) and, for a finale night, the <b>Finale night bonus</b>. See{' '}
                        <a href="#counts" className={A}>What counts on the board</a>.
                    </Step>
                    <Step n="4" title="Prizes">
                        1st place first, up to five. Optionally, a partner code for everyone who takes part. See{' '}
                        <a href="#prizes" className={A}>Prizes and the partner code</a>.
                    </Step>
                    <Step n="5" title="Promote: look and reach">
                        All optional. <b>Logo</b> (an image up to 5 MB; switch on <b>Show the logo instead of the name</b>{' '}
                        if it reads well). <b>Headline</b>, one line under the name, up to 80 characters.{' '}
                        <b>Picture or video</b>, the big picture on the event’s card and share cards, up to 80 MB; a short
                        video plays silently. <b>Booking link</b>, if members book a place on your own system: it starts
                        with https:// and the app shows a <b>Book</b> button; <code className="font-mono">{'{name}'}</code>{' '}
                        fills in the member’s name, and a link can’t ask for their email address.{' '}
                        <b>Who sees it in the app</b>: <b>Just my members</b>, or one of the <b>Also within … km</b> choices
                        to show it to POWR members near your gym too. Your members and anyone who’s trained at your gym
                        lately always see it, and anyone can join from your QR code or link. Last, the{' '}
                        <a href="#pushes" className={A}>Notifications</a>.
                        <Shot
                            id="gym-events-builder-look"
                            alt="Step 5 of the event builder, Promote, with a headline and a picture added"
                            caption="Step 5 · Promote"
                            notes={[
                                ['logo', 'Logo, an image up to 5 MB.'],
                                ['headline', 'Headline: one line under the name, up to 80 characters.'],
                                ['media', 'Picture or video: the big picture on the event’s card and share cards.'],
                                ['booking', 'Booking link, if members book a place on your own system.'],
                                ['reach', 'Who sees it in the app: just your members, or POWR members nearby too.'],
                            ]}
                        />
                    </Step>
                    <Step n="6" title="Review: check and save">
                        Every choice on one page, each with <b>Change</b>. Press <b>Save as a draft</b> to come back later,
                        or <b>Send to POWR</b> (your first event) or <b>Publish</b>. See{' '}
                        <a href="#publish" className={A}>Publishing and POWR’s check</a>.
                    </Step>
                </Steps>
                <Callout tone="note" title="Switching format keeps your words">
                    Change your mind in step 1 before saving and the builder keeps the name, first day, prizes, partner
                    code, your own rules and everything in Promote. The format’s own choices start again from its defaults.
                </Callout>
            </Section>

            <Section id="counts" title="What counts on the board">
                <P>
                    The board ranks members by the POWR they earn from activity that counts, between the first day and
                    the last. Pick one:
                </P>
                <Table
                    head={['Choice', 'What counts']}
                    rows={[
                        ['Every verified workout', 'Anything members do, anywhere: gym check-ins and workouts from their watch or phone. Walking doesn’t count.'],
                        ['Only sessions at your gym', 'Members check in with POWR when they arrive. The hardest to game, and footfall you can see.'],
                        ['Pick the activities', 'Any of Gym, Running, Cycling, Swimming, HIIT, Yoga, Sports, Dance, and Walking and steps. Pick at least one.'],
                    ]}
                />
                <P>
                    Workouts typed in by hand never count, and sleep never counts. <b>Walking and steps</b> brings in
                    everyone’s daily steps, so it can outweigh workouts; the builder warns you when you pick it.
                </P>
                <P>
                    <b>Finale night bonus</b> (finale formats only): <b>No bonus</b>, <b>+25 for turning up</b> or{' '}
                    <b>+50 for turning up</b>. POWR pays it to members who joined and come to your gym on the night. It’s
                    paid as POWR, never added to anyone’s score on the board.
                </P>
                <P>
                    <b>Rules.</b> POWR writes the rules members read first from your choices, so they always match how
                    the board scores. Add up to eight of your own with <b>Add a rule of your own</b>, up to 200
                    characters each.
                </P>
                <Shot
                    id="gym-events-builder-scoring"
                    alt="Step 3 of the event builder, What counts, with Every verified workout picked"
                    caption="Step 3 · Scoring"
                    notes={[
                        ['choices', 'Pick one: every verified workout, only sessions at your gym, or the activities you choose.'],
                        ['board', 'Leaderboard: how many places show, in the app and on your screen.'],
                        ['bonus', 'Finale night bonus, on finale formats only.'],
                        ['rules', 'The rules POWR writes from your choices.'],
                        ['own', 'Up to eight rules of your own.'],
                    ]}
                />
            </Section>

            <Section id="prizes" title="Prizes and the partner code">
                <P>
                    Name each prize in 2 to 60 characters, 1st place first, up to five. <b>Add a photo</b> (an image up
                    to 5 MB) and it shows with the prize in the app, on the share page and on your screen. You give the
                    prizes out: winners show their POWR ID at the front desk. Buying them? Your{' '}
                    <Link to="/docs/gyms/discounts" className={A}>partner discounts</Link> get you the price POWR members pay.
                </P>
                <P>
                    <b>A partner code for everyone who takes part</b> is optional and off until you switch it on. Pick a
                    POWR partner brand that has codes to give. Each shows <b>One code for everyone</b> or how many codes
                    are left. When the winners are revealed, everyone still in the event with points gets one code each
                    in their Wallet in the app, and the reveal notification names the brand.
                </P>
                <Shot
                    id="gym-events-builder-prizes"
                    alt="Step 4 of the event builder, Prizes, with three prizes and the partner code switched on"
                    caption="Step 4 · Prizes"
                    notes={[
                        ['prize', '1st place first, up to five prizes.'],
                        ['photo', 'Add a photo, if you like, to show with the prize.'],
                        ['more', 'Add a prize for the next place down.'],
                        ['partner', 'The partner code for everyone who takes part: off until you switch it on.'],
                        ['brand', 'The brand whose code they get, and how many codes it has to give.'],
                    ]}
                />
                <Callout tone="warn" title="Codes can run short">
                    If the brand runs low, the top of the board get theirs first. A member who already holds that brand’s
                    shared code keeps the one they have, and the brand’s own limit per person still applies. Say it in
                    your headline so members know it’s coming. If no brand has codes, you see{' '}
                    <b>No partner has codes to give right now</b>.
                </Callout>
            </Section>

            <Section id="pushes" title="Notifications">
                <P>
                    POWR writes every word and sends each one at the right moment. You choose which go out, and each
                    switch shows a preview of the exact message. Nothing goes out until the event is published, and
                    members can turn notifications off in the app. Each format switches on the ones that suit it.
                </P>
                <Table
                    head={['Notification', 'Who gets it', 'When']}
                    rows={[
                        ['Announcement', 'Your members and anyone who’s trained at your gym in the last 60 days, who haven’t joined. People nearby see the event in the app but don’t get this.', 'Once, in the daytime, at least 30 minutes after you publish.'],
                        ['Day one', 'Everyone who’s joined.', 'Once, the morning scoring starts.'],
                        ['Finale night', 'Everyone who’s joined.', 'Once, the morning of the finale. With a bonus, it asks them to check in when they arrive.'],
                        ['Daily standings', 'Everyone who’s joined: their own rank and points, and how far they are from the place above.', 'Every day at the hour you pick, 7am to 9pm, only while the board is live.'],
                    ]}
                />
                <P>
                    On the event page the same switches sit under <b>Promote</b>, with how many people each would reach
                    right now and how many have notifications on. Once one has gone, it says when and to how many. While
                    the board is live, <b>Send today’s standings now</b> sends an extra standings push: once a day, and
                    the scheduled one still goes out.
                </P>
                <Shot
                    id="gym-events-pushes"
                    alt="The notifications of a live event under Promote, with who each one reaches and when it went"
                    caption="Promote · Notifications"
                    notes={[
                        ['reach', 'Who it reaches right now, and how many have notifications on.'],
                        ['sent', 'Once one has gone: when, and to how many.'],
                        ['preview', 'The exact message, written by POWR.'],
                        ['time', 'Daily standings: the hour it goes out, or Off.'],
                        ['now', 'An extra standings push, once a day while the board is live.'],
                    ]}
                />
            </Section>

            <Section id="publish" title="Publishing and POWR’s check">
                <P>
                    <b>Your first event</b> gets a quick check from POWR before it goes out, usually within a day. Press{' '}
                    <b>Send to POWR</b> and it shows <b>Waiting for POWR</b>. Your team gets an email when POWR approves
                    it or asks for a change. Need to edit while it waits? Press <b>Pull it back to edit</b> on the event
                    page and it goes back to your drafts.
                </P>
                <Shot
                    id="gym-events-pending"
                    alt="An event page showing Waiting for POWR, with the Pull it back to edit button"
                    caption="Waiting for POWR"
                    notes={[
                        ['status', 'Your first event, with POWR for a quick check.'],
                        ['back', 'Pull it back to edit: it goes back to your drafts.'],
                    ]}
                />
                <Shot
                    id="gym-events-changes"
                    alt="What happens next on an event POWR sent back, with POWR’s note and Send again"
                    caption="Changes needed"
                    notes={[
                        ['note', 'POWR’s note: what to change.'],
                        ['again', 'Edit it, then Send again.'],
                    ]}
                />
                <P>
                    <b>Once POWR has approved one</b>, the button reads <b>Publish</b> and your events go straight out.
                    The event becomes <b>Scheduled</b>: members can see it and join. At midnight on the first day it
                    goes <b>Live</b> on its own.
                </P>
                <P>Publishing checks a few things first. If one fails, the event stays saved as a draft and you see why:</P>
                <Table
                    head={['You see', 'Fix']}
                    rows={[
                        ['A new event needs at least 2 hours’ notice', 'Move the first day later. Scoring starts at midnight, so a first day of today never publishes.'],
                        ['Events can be published up to 90 days ahead', 'Pick a nearer first day.'],
                        ['You already have 2 events on the go', 'Scheduled, live, sealed and waiting-for-POWR events all count. Publish once one has finished.'],
                        ['Your gym has no location on POWR yet', 'Your gym needs to be on POWR’s map first. Contact POWR.'],
                        ['Publishing needs Clash+', 'See Package in the portal.'],
                    ]}
                />
            </Section>

            <Section id="run" title="Running it">
                <P>
                    Open the event from <b>Events</b>. The top shows where it stands: how many are in, who leads, the
                    last day and the finale. Below that, <b>What happens next</b> holds the one button that moves it on.
                    Then four tabs:
                </P>
                <Shot
                    id="gym-events-page"
                    alt="The event page of The Northpoint Grind, a live monthly challenge, open on its board"
                    caption="An event page"
                    notes={[
                        ['status', 'Its status and format.'],
                        ['facts', 'Where it stands: who’s in, guests, who leads, the last day, the prizes.'],
                        ['next', 'What happens next, with the button that moves it on when there is one.'],
                        ['tabs', 'Board, People, Details and Promote.'],
                        ['board', 'The live board, with each place’s prize.'],
                    ]}
                />
                <P>
                    <b>Board.</b> The live leaderboard, with each place’s prize. It refreshes every minute while the page
                    is open. Once the board seals you still see the real standings, marked{' '}
                    <b>Only your team sees this until you reveal</b>, so you can get the prizes ready.
                </P>
                <P>
                    <b>People.</b> <b>Who’s in</b>, with each person’s POWR ID and the day they joined. Search with{' '}
                    <b>Find someone</b>, filter by <b>Members</b>, <b>Guests</b> or <b>Removed</b>, and press{' '}
                    <b>Export</b> for a spreadsheet. A <b>Guest</b> joined without picking your gym as theirs in the app:
                    worth a word at the front desk. To take someone out, press <b>Remove</b> and say why (3 to 200
                    characters; POWR sees the reason). They drop off the board and their points in it stop counting.
                    Their POWR account isn’t touched, and <b>Put back</b> undoes it.
                </P>
                <Shot
                    id="gym-events-people"
                    alt="The People tab of a scheduled weekend sprint, with two guests and one person removed"
                    caption="People"
                    notes={[
                        ['find', 'Find someone by name, username or POWR ID.'],
                        ['filter', 'Show everyone, or just Members, Guests or Removed.'],
                        ['export', 'Export: the list as a spreadsheet.'],
                        ['guest', 'A guest: worth a word at the front desk.'],
                        ['remove', 'Remove takes someone out of the event. You say why.'],
                        ['back', 'Put back undoes it.'],
                    ]}
                />
                <P>
                    <b>Details.</b> Every date in UK time, what counts, who it’s shown to, the prizes, the partner code
                    and the rules, with <b>Edit</b> (or <b>Edit words and pictures</b> once it’s live).
                </P>
                <Shot
                    id="gym-events-details"
                    alt="The Details tab of a live event: dates, what counts, prizes, the partner code and the rules"
                    caption="Details"
                    notes={[
                        ['counts', 'What counts, and how many places the board shows.'],
                        ['shown', 'Who sees it in the app.'],
                        ['prizes', 'The prizes, 1st place first.'],
                        ['partner', 'The partner code, which lands in Wallets when you reveal the winners.'],
                        ['rules', 'The rules members read first.'],
                        ['edit', 'Once it’s live, only the words and pictures can change.'],
                    ]}
                />
                <P>
                    <b>Promote.</b> The notifications, the <a href="#content" className={A}>content kit</a>,{' '}
                    <b>Screen and sharing</b> and a preview of the event in the app. <b>Event board for your TV</b> is a
                    private link that counts down, shows the live standings, holds a sealed screen and plays the podium
                    the moment you reveal (setting up a TV:{' '}
                    <Link to="/docs/gyms/screens" className={A}>Screens</Link>). <b>Page to share with members</b> and the
                    QR open the event in the POWR app, or the app store for someone new. <b>Print it for the front desk</b>{' '}
                    makes an A4 sheet with the QR big; allow pop-ups to print.
                </P>
                <Shot
                    id="gym-events-sharing"
                    alt="Screen and sharing under Promote: the TV board link, the share page link and the join QR"
                    caption="Promote · Screen and sharing"
                    notes={[
                        ['tv', 'Event board for your TV: a private link, for your own screens.'],
                        ['share', 'Page to share with members.'],
                        ['qr', 'The QR opens the event in the POWR app.'],
                        ['print', 'Print it for the front desk: an A4 sheet with the QR big.'],
                    ]}
                />
            </Section>

            <Section id="door" title="The finale night door">
                <P>
                    For a finale night with a bonus, <b>People</b> becomes <b>People · door</b> from the day before. The
                    door shows <b>Registered</b>, <b>Seen by POWR</b>, <b>Paid</b> and <b>By hand</b>, then everyone who
                    joined. POWR pays the bonus itself to most people who come, shortly after the doors close. Anyone it
                    missed, check in by hand: find them by name or POWR ID and press <b>Check in</b>, and they get the
                    bonus straight away.
                </P>
                <Shot
                    id="gym-events-door"
                    alt="The door on the finale night of The Riverton Rumble, searching for a name"
                    caption="People · door"
                    notes={[
                        ['bonus', 'The finale night bonus for coming.'],
                        ['counts', 'Registered, Seen by POWR and Paid, as the night goes on.'],
                        ['hand', 'By hand: check-ins your team has made, out of tonight’s limit.'],
                        ['find', 'Find someone by name or POWR ID.'],
                        ['checkin', 'Check in anyone POWR missed. Their bonus is paid straight away.'],
                    ]}
                />
                <Callout tone="warn" title="Check people in before you reveal">
                    Check-ins by hand work from two hours before the finale until six hours after it, and only until the
                    winners are out. There’s a limit each night (at least ten, and more the busier the night). Past it you
                    see <b>That’s the limit for check-ins by hand tonight</b>; ask POWR if more people are here.
                </Callout>
            </Section>

            <Section id="content" title="Event content">
                <P>
                    Under <b>Promote</b>, <b>Content</b> turns your photos and clips into every post you need, at every
                    size, in one download. It comes with <b>Clash Pro</b> and <b>Founding Pro</b>.
                </P>
                <Steps>
                    <Step n="1" title="Pick the kit">
                        <b>Before</b> announces it: a ticket with the join QR, three looks over your lead photo, a teaser over
                        every other photo and an A4 poster for the front desk. <b>After</b> wraps it up: the results once the
                        winners are out, a thank-you over your lead photo and a recap of every photo from the night.
                    </Step>
                    <Step n="2" title="Add photos and clips">
                        Press <b>Add photos and clips</b> or drop them in. The starred photo leads; tap another to swap.
                        Until you add your own, the event’s picture stands in. Up to three clips use their first 12 seconds.
                    </Step>
                    <Step n="3" title="Choose the look and make it">
                        Pick a <b>Look</b> and an <b>Accent</b>, tick <b>A4 poster</b>, <b>Landscape for the TV</b> or{' '}
                        <b>Clips as video</b>, tap any preview to see it large, then press <b>Make the kit</b>. You get one ZIP
                        with a folder per size and the captions to paste.
                    </Step>
                </Steps>
                <Shot
                    id="gym-events-content"
                    alt="Content under Promote: the Before kit for The Northpoint Grind, with its post previews"
                    caption="Promote · Content"
                    notes={[
                        ['phase', 'Before announces it; After wraps it up.'],
                        ['add', 'Your photos and clips go here. Until then, the event’s picture stands in.'],
                        ['look', 'The Look and the Accent.'],
                        ['posts', 'Every post in the kit. Tap one to see it large.'],
                        ['options', 'A4 poster and Landscape for the TV.'],
                        ['kit', 'Make the kit: one ZIP with a folder per size.'],
                    ]}
                />
                <P>
                    Your photos and clips stay on your device; the ZIP is the only thing that leaves it. Make the Before kit after
                    you publish: in a draft, the QR and links don’t work yet. One post by hand? Use{' '}
                    <Link to="/docs/gyms/studio" className={A}>Studio</Link>.
                </P>
            </Section>

            <Section id="reveal" title="Revealing the winners">
                <P>
                    The board seals at midnight after the last day. About 12 hours later POWR sets the results, which
                    gives late workouts from watches and phones time to arrive, and emails your team that they’re in.
                </P>
                <Steps>
                    <Step n="1" title="Press Reveal the winners">
                        On the event page, or from your phone at the finale night, where the button sits at the bottom of
                        the screen. Confirm, and everyone in the event gets a notification while your TV flips to the podium
                        at the same moment.
                    </Step>
                    <Step n="2" title="Or let it reveal itself">
                        Under <b>Or reveal it automatically at</b>, pick a time after the board seals and within a week of
                        it, then press <b>Schedule</b> (or <b>Clear</b>). You can also set this in step 2 of the builder.
                    </Step>
                </Steps>
                <Shot
                    id="gym-events-sealed"
                    alt="The Riverton Rumble on its finale night: the board sealed, with Reveal the winners"
                    caption="A sealed board"
                    notes={[
                        ['status', 'Board sealed: members can’t see the standings yet.'],
                        ['reveal', 'Reveal the winners. The app and your screen flip together.'],
                        ['auto', 'Or pick a time for it to reveal itself, then press Schedule.'],
                        ['only', 'The real standings, for your team only until you reveal.'],
                    ]}
                />
                <Callout tone="note" title="If nobody presses it">
                    POWR reveals the winners itself a few days after the board seals. The event page shows exactly when.
                    If you reveal straight after the board seals, the results are taken at that moment and anything that
                    syncs later doesn’t make it in.
                </Callout>
            </Section>

            <Section id="after" title="After the reveal">
                <P>
                    <b>Board</b> shows the <b>Final results</b>. Winners show their POWR ID at the front desk; match it on{' '}
                    <b>People</b>, then tick each prize under <b>Details</b> as it’s handed over. The partner code, if you
                    chose one, shows how many Wallets it reached. Switch <b>Content</b> to <b>After</b> for the results
                    posts. Three days after the reveal the event moves to <b>Finished</b>. From then on the results are
                    final: you can’t remove anyone or change anything.
                </P>
                <Shot
                    id="gym-events-final"
                    alt="The Canal Street Showdown after the reveal, with its final results"
                    caption="Winners out"
                    notes={[
                        ['facts', 'How many prizes have been handed over.'],
                        ['again', 'Run it again: the builder, with everything copied except the dates.'],
                        ['final', 'Final results, as members see them now.'],
                    ]}
                />
                <Shot
                    id="gym-events-prizes"
                    alt="The Details tab after the reveal, with two of three prizes ticked as handed over"
                    caption="Details · prizes"
                    notes={[
                        ['tick', 'Tick each prize as it’s handed over.'],
                        ['handed', 'The day it was handed over.'],
                        ['open', 'Not collected yet.'],
                        ['wallets', 'How many Wallets the partner code reached.'],
                    ]}
                />
            </Section>

            <Section id="change" title="Editing, cancelling, running it again">
                <P>What you can change narrows as the event runs:</P>
                <Table
                    head={['', 'Before scoring starts', 'While live', 'Once sealed']}
                    rows={[
                        ['Name, headline, logo, picture, booking link', 'Yes', 'Yes', 'No'],
                        ['Partner code', 'Yes', 'Yes', 'No'],
                        ['Notifications, reveal time', 'Yes', 'Yes', 'Yes, until the reveal'],
                        ['Dates, length, finale night', 'Yes (published: 2 hours’ notice)', 'No', 'No'],
                        ['What counts, board size, bonus, rules, prizes, who sees it', 'Yes', 'No', 'No'],
                        ['Remove or put back members', 'Yes, once published', 'Yes', 'Yes, until the reveal'],
                    ]}
                />
                <P>
                    <b>Delete draft</b> removes a draft for good. <b>Cancel event</b> is there only until scoring starts:
                    it disappears from the app for everyone, including those who joined. After that, contact POWR.{' '}
                    <b>Run it again</b> (on the event page once the winners are out, or <b>Run again</b> on its card) opens the builder with
                    everything copied except the dates, with every choice checked against what the format offers now.
                </P>
            </Section>

            <Section id="faq" title="Common questions">
                <P>
                    <b>POWR hasn’t checked it yet and the first day is close.</b> POWR can’t approve an event whose
                    start has passed; it will ask you to move the date. Send it at least a day or two ahead.
                </P>
                <P>
                    <b>Can I change a prize once it’s live?</b> No, prizes are fixed once scoring starts. You can still
                    change the headline.
                </P>
                <P>
                    <b>A member says their workout didn’t count.</b> Check <b>What counts</b> under Details. Workouts typed
                    in by hand never count, walking only counts when you picked it, and with <b>Only sessions at</b> your
                    gym, training elsewhere doesn’t.
                </P>
                <P>
                    <b>I lost the event I was building.</b> The builder keeps an unfinished new event in the same browser
                    tab, even after a reload. <b>Start over</b> clears it.
                </P>
                <P>
                    <b>It says “That brand has no codes to give right now”.</b> Pick another brand, or switch the partner
                    code off. A brand already saved on the event stays, even if its codes run low.
                </P>
                <P>
                    <b>Why can’t I edit a sealed event?</b> Once the board seals nothing about the event changes, apart
                    from the notifications and when the winners are revealed.
                </P>
                <P>
                    <b>It says “This kind of event is no longer offered”.</b> POWR has retired that format. Contact POWR to
                    change the event, or run a new one.
                </P>
                <P>
                    <b>Our trial ended mid-event.</b> It runs to the end and you can still reveal it. New events and
                    publishing need <b>Clash+</b>.
                </P>
            </Section>
        </DocsLayout>
    );
}
