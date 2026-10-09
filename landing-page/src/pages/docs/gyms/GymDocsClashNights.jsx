import React from 'react';
import { Link } from 'react-router-dom';
import { Callout, DocsLayout, P, Section, Shot, Step, Steps, Table } from '../docsShared';

// /docs/gyms/clash-nights: the gym portal's Clash Nights page (Clash Pro and
// Founding Pro): four POWR-run nights a year, one a quarter. The gym asks for
// a date, POWR confirms or declines it, and either side can call it off.

const TOC = [
    ['what', 'What a Clash Night is'],
    ['who', 'Who gets them'],
    ['rules', 'The booking rules'],
    ['book', 'Ask for a night'],
    ['after', 'After you ask'],
    ['change', 'Changing or calling off a date'],
    ['before', 'Before the night'],
    ['faq', 'Common questions'],
];

const A = 'font-bold text-[#8a7600] hover:underline';

export default function GymDocsClashNights() {
    return (
        <DocsLayout
            eyebrow="Gym guide · Clash Nights"
            title="Clash Nights"
            intro="Four POWR Clash Nights a year, one a quarter, at your gym. POWR brings the DJ, the photographer and partner prizes. You pick the dates in the portal and POWR confirms them with you. This page covers the booking rules, what happens after you ask, and how to change or call off a night."
            toc={TOC}
            nextNote={{ label: 'Screens', detail: 'Put your leaderboard and Gym Clash on the gym TV.' }}
        >
            <Section id="what" title="What a Clash Night is">
                <P>
                    A Clash Night is a night at your gym that POWR runs with you. POWR brings the DJ, the
                    photographer and partner prizes. You bring the members and the space.
                </P>
                <P>
                    You book them from <b>Clash Nights</b> in the portal sidebar. On a phone it isn’t in the bottom
                    tabs: tap your gym’s logo at the top right to open the menu, and it’s listed there.
                </P>
                <Shot
                    id="gym-clash-nights-page"
                    alt="The Clash Nights page in the gym portal"
                    caption="Clash Nights"
                    notes={[
                        ['quarters', 'Each quarter from now to a year out, with its night or Free to book.'],
                        ['calendar', 'Pick a night: the calendar.'],
                        ['form', 'Your night: the details for the date you pick.'],
                        ['nights', 'Your nights: every night you’ve asked for, and POWR’s answer.'],
                    ]}
                />
            </Section>

            <Section id="who" title="Who gets them">
                <P>
                    Clash Nights come with <b>Clash Pro</b> and <b>Founding Pro</b>: four a year, one in each
                    quarter. They are not part of <b>Clash</b> or <b>Clash+</b>, and they are not part of the free
                    trial, because each night needs a POWR crew. On any other package the page shows{' '}
                    <b>Clash Nights come with Clash Pro</b> and a <b>See packages</b> button. Open <b>Package</b> in
                    the portal to see what each package includes.
                </P>
                <Shot
                    id="gym-clash-nights-locked"
                    alt="Clash Nights on a package that doesn’t include them"
                    caption="Without Clash Pro"
                />
                <P>
                    <b>Founding Pro</b> gyms pick all four dates at the start, one in each quarter. While you still
                    have dates to pick, the page reminds you: <b>Founding Pro: pick all four dates now, one in each
                    quarter.</b>
                </P>
                <P>
                    Anyone on your team can ask for a night or call one off, owner or not.
                </P>
            </Section>

            <Section id="rules" title="The booking rules">
                <Table
                    head={['Rule', 'What it means']}
                    rows={[
                        ['4 weeks’ notice', 'Pick a night at least 28 days ahead. The page tells you the first date you can pick.'],
                        ['Up to a year ahead', 'Dates more than a year away can’t be picked yet.'],
                        ['One per quarter', 'One night in each of January to March, April to June, July to September and October to December. A night that was turned down or called off frees its quarter again.'],
                        ['Not on a taken night', 'If POWR has already confirmed a night at another gym on a date, that date is taken. You never see which gym.'],
                        ['Start time', 'Between 6am and 9pm, in 15-minute steps. It starts at 7pm unless you change it.'],
                    ]}
                />
                <P>
                    The top of the page shows each quarter from now to a year out, with <b>Free to book</b> or the
                    night you have in it and its status.
                </P>
                <Shot
                    id="gym-clash-nights-quarters"
                    alt="The quarters at the top of the Clash Nights page"
                    caption="Your quarters"
                    notes={[
                        ['notice', 'The notice you need, and the first date you can pick.'],
                        ['free', 'A quarter with no night yet: Free to book.'],
                        ['confirmed', 'A night POWR has confirmed.'],
                        ['asked', 'A night you’ve asked for, waiting for POWR.'],
                    ]}
                />
            </Section>

            <Section id="book" title="Ask for a night">
                <Steps>
                    <Step n="1" title="Pick a date on the calendar">
                        Under <b>Pick a night</b>, move between months with the arrows and tap a free day. Days you
                        can’t book are greyed out. On a computer, hover over one to see why: <b>Needs 28 days’ notice</b>,{' '}
                        <b>More than a year ahead</b>, <b>POWR is at another gym that night</b> (marked{' '}
                        <b>Taken</b>) or <b>You have a night this quarter</b>.
                        <Shot
                            id="gym-clash-nights-calendar"
                            alt="The Clash Nights calendar"
                            caption="Pick a night"
                            notes={[
                                ['month', 'Move between months.'],
                                ['soon', 'Greyed out: too soon, more than a year ahead, or in a quarter you’ve booked.'],
                                ['taken', 'Taken: POWR is at another gym that night.'],
                                ['free', 'A free day. Tap it to pick it.'],
                                ['legend', 'The key: Free, Asked, Confirmed and Can’t book.'],
                            ]}
                        />
                    </Step>
                    <Step n="2" title="Set the start time">
                        In <b>Your night</b>, check <b>Starts at</b>. Any time from 6am to 9pm.
                    </Step>
                    <Step n="3" title="Add a backup date (optional)">
                        <b>Backup date</b> is a second choice: if POWR can’t do your first date, we’ll try this one.
                        It needs the same notice and must be a different day.
                    </Step>
                    <Step n="4" title="Tell us anything useful">
                        <b>Anything we should know</b> takes up to 600 characters: how many you expect, a theme,
                        where the DJ can set up.
                    </Step>
                    <Step n="5" title="Send it">
                        Press <b>Ask POWR for this night</b>. You’ll see that you’ve asked for the date and that
                        POWR will confirm it with you. Changed your mind before sending? Press <b>Clear</b>.
                    </Step>
                </Steps>
                <Shot
                    id="gym-clash-nights-form"
                    alt="A Clash Night request filled in, ready to send"
                    caption="Your night, ready to send"
                    notes={[
                        ['date', 'The night you picked, and the quarter it’s for.'],
                        ['time', 'Starts at: any time from 6am to 9pm.'],
                        ['backup', 'Backup date: a second choice, with the same notice.'],
                        ['notes', 'Anything we should know: up to 600 characters.'],
                        ['send', 'Ask POWR for this night sends it. Clear starts again.'],
                    ]}
                />
                <Callout tone="note" title="Asking isn’t booking">
                    Sending the request holds nothing yet. The night is yours once POWR confirms it. Until then it
                    shows as <b>Asked</b>, and another gym’s confirmed night can still take the date.
                </Callout>
            </Section>

            <Section id="after" title="After you ask">
                <P>
                    POWR gets your request straight away and checks the DJ, photographer and partner prizes for
                    that night. Your night appears under <b>Your nights</b>, and the request is also listed in{' '}
                    <b>Settings</b> → <b>Help</b> under <b>Your requests</b>, marked <b>With POWR</b> until we
                    answer.
                </P>
                <Table
                    head={['Status', 'What it means']}
                    rows={[
                        ['Asked', 'POWR has your request and hasn’t answered yet.'],
                        ['Confirmed', 'It’s on. POWR will be in touch about the plan for the night.'],
                        ['Not possible', 'POWR can’t do that date (or your backup). The quarter is still yours: pick another date.'],
                        ['Called off', 'The night was called off. That quarter is free to book again.'],
                    ]}
                />
                <Shot
                    id="gym-clash-nights-yours"
                    alt="Your nights, with POWR’s answers"
                    caption="Your nights"
                    notes={[
                        ['confirmed', 'Confirmed: it’s on.'],
                        ['note', 'POWR’s note, which is in the email too.'],
                        ['asked', 'Asked: with POWR, with your backup date and notes.'],
                        ['declined', 'Not possible: POWR can’t do that date. The quarter is still yours.'],
                        ['calloff', 'Call off, for a night that’s asked for or confirmed.'],
                    ]}
                />
                <P>
                    When POWR confirms or declines, your gym’s owners and whoever asked get an email. If POWR adds a
                    note, it shows under the night as <b>POWR:</b> and in the email. In the rare case that POWR has
                    to call off a night it already confirmed, you get an email saying so, and the quarter is free
                    to book again.
                </P>
            </Section>

            <Section id="change" title="Changing or calling off a date">
                <P>
                    A night can’t be edited once it’s asked for. To move it, call it off and ask for the new date.
                </P>
                <Steps>
                    <Step n="1" title="Call off the old night">
                        Under <b>Your nights</b>, press <b>Call off</b> beside it and confirm. POWR is told straight
                        away, and the quarter is free to book again.
                    </Step>
                    <Step n="2" title="Ask for the new one">
                        Pick the new date on the calendar and send it as before. The same rules apply, including
                        28 days’ notice.
                    </Step>
                </Steps>
                <Callout tone="warn" title="Calling off a confirmed night can’t be undone">
                    Once you call off a confirmed night, POWR stands the crew down and the date is released. There
                    is no undo: if you want it back, ask again and wait for POWR to confirm it. Talk to us first
                    if you’re only unsure, from <b>Settings</b> → <b>Help</b>.
                </Callout>
                <P>
                    You can call off a night that is asked for or confirmed, up to the day itself. Nights that have
                    already happened stay in the list as history.
                </P>
            </Section>

            <Section id="before" title="Before the night">
                <P>
                    Tell your members early: it’s the night of the quarter. The join poster and{' '}
                    <Link to="/docs/gyms/studio" className={A}>Studio</Link> are in your portal for exactly this.
                    If you want a scored build-up to the night, run one of your own challenges in{' '}
                    <Link to="/docs/gyms/events" className={A}>Events</Link>.
                </P>
            </Section>

            <Section id="faq" title="Common questions">
                <P>
                    <b>Clash Nights has a lock in the sidebar.</b> Your package doesn’t include them, or you’re on
                    the free trial. Clash Nights come with Clash Pro and Founding Pro only. See <b>Package</b>.
                </P>
                <P>
                    <b>I got “You already have a Clash Night in that quarter”.</b> It’s one per quarter. Pick a date
                    in another quarter, or call off the night you have in this one first.
                </P>
                <P>
                    <b>I got “That night is already taken”.</b> POWR confirmed another gym for that date after your
                    page loaded. Pick another date.
                </P>
                <P>
                    <b>I got “Clash Nights need 28 days’ notice”.</b> The date is too soon. The message tells you
                    the first date you can pick.
                </P>
                <P>
                    <b>I got “The backup date needs the same notice, and must be a different day”.</b> Your backup
                    is too soon, more than a year away, or the same as your first choice.
                </P>
                <P>
                    <b>Can I have two nights in one quarter?</b> No. Your package includes one a quarter, four a
                    year, and the calendar greys out the rest of a quarter once you have a night in it.
                </P>
                <P>
                    <b>POWR said “Not possible”. Have I lost the night?</b> No. The quarter is still yours. Pick
                    another date and POWR will confirm it.
                </P>
                <P>
                    <b>The page says “Couldn’t load your Clash Nights”.</b> Press <b>Try again</b>. If it keeps
                    failing, email <a href="mailto:support@powr.life" className={A}>support@powr.life</a>.
                </P>
            </Section>
        </DocsLayout>
    );
}
