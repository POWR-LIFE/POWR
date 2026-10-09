import React from 'react';
import { Link } from 'react-router-dom';
import { Callout, DocsLayout, P, Section, Shot, Step, Steps, Table } from '../docsShared';

// /docs/gyms/screens: the gym portal's Screens page: the weekly leaderboard
// and the Gym Clash board, made for a TV on the gym floor. Switching them on,
// the settings, getting them onto a TV, pausing, and the private link.

const TOC = [
    ['what', 'What this page is for'],
    ['boards', 'The two screens'],
    ['switch', 'Switch on your screens'],
    ['tv', 'Put a board on the TV'],
    ['settings', 'Fit it to your room'],
    ['pause', 'Pause and resume'],
    ['link', 'Your private link'],
    ['faq', 'Common questions'],
];

const A = 'font-bold text-[#8a7600] hover:underline';

export default function GymDocsScreens() {
    return (
        <DocsLayout
            eyebrow="Gym guide · Screens"
            title="Your gym on the big screen"
            intro="Two boards made for a TV on the gym floor: your weekly leaderboard, and Gym Clash, your gym racing the POWR gyms around you. Both run by themselves once they’re on. This page covers switching them on, getting them onto a TV, fitting them to your room and keeping the link private."
            toc={TOC}
            nextNote={{ label: 'Studio', detail: 'Turn your photos, clips and your board into posts.' }}
        >
            <Section id="what" title="What this page is for">
                <P>
                    <b>Screens</b> in the portal sidebar is where you switch the boards on, change how they look,
                    pause them, and copy the links you open on your TVs. Each board plays live inside a TV picture
                    on the page, exactly as your TV will show it.
                </P>
                <Shot
                    id="gym-screens-page"
                    alt="The Screens page in the gym portal, with both boards playing"
                    caption="Screens"
                    notes={[
                        ['tv1', 'Screen 1, the weekly leaderboard, playing live as your TV shows it.'],
                        ['settings1', 'Its buttons and settings.'],
                        ['tv2', 'Screen 2, Gym Clash.'],
                        ['settings2', 'Its buttons and settings.'],
                    ]}
                />
                <P>
                    Screens come with every package, including the free <b>Clash</b> package. On a phone,{' '}
                    <b>Screens</b> isn’t in the bottom tabs: tap your gym’s logo at the top right to open the menu,
                    and it’s listed there. Setting a TV up is easiest from a laptop.
                </P>
            </Section>

            <Section id="boards" title="The two screens">
                <Table
                    head={['Screen', 'What it shows']}
                    rows={[
                        ['Weekly leaderboard', 'Points earned at your gym, Monday to Sunday, with last week’s champion and a QR code so members can join POWR. It changes scene by itself (the leaderboard, your gym’s week, what members do beyond the gym, and the chasing pack below the top places) and updates every few seconds. It starts a new week every Monday.'],
                        ['Gym Clash', 'Your gym against the gyms nearby this week, then the whole POWR network, an effort table of points per athlete that a small gym can win, and a head-to-head against the gym just above you. A map and a live feed of sessions run alongside.'],
                    ]}
                />
                <Shot
                    id="gym-tv-board"
                    alt="The weekly leaderboard on a TV"
                    caption="The weekly leaderboard"
                    notes={[
                        ['week', 'This week, Monday to Sunday, and the countdown to Monday’s new week.'],
                        ['scene', 'The scene playing now. The board changes scene by itself.'],
                        ['champion', 'Last week’s champion.'],
                        ['qr', 'A QR code so members can join POWR.'],
                        ['feed', 'The latest sessions, running along the bottom.'],
                    ]}
                />
                <Shot
                    id="gym-tv-week"
                    alt="The leaderboard’s scene about your gym’s week"
                    caption="The leaderboard changes scene: your gym’s week"
                    notes={[
                        ['days', 'Points by day, this week against last.'],
                        ['rank', 'Where your gym stands across POWR this week.'],
                    ]}
                />
                <Shot
                    id="gym-tv-clash"
                    alt="Gym Clash on a TV: your gym against the gyms nearby"
                    caption="Gym Clash: the gyms nearby"
                    notes={[
                        ['lens', 'The gyms nearby, then the whole POWR network.'],
                        ['host', 'Your gym’s lane.'],
                        ['map', 'The map of the gyms in view, with the live feed under it.'],
                    ]}
                />
                <Shot
                    id="gym-tv-clash-duel"
                    alt="Gym Clash’s head-to-head against the gym just above"
                    caption="Gym Clash: head-to-head"
                    notes={[
                        ['gap', 'The gap to the gym just above you.'],
                        ['share', 'How the week is split between you so far.'],
                    ]}
                />
                <P>
                    Members who switch off <b>Show me on gym boards</b> in the app’s settings never appear by name on
                    either screen. They still earn POWR as normal.
                </P>
            </Section>

            <Section id="switch" title="Switch on your screens">
                <P>
                    Until they’re switched on, the page shows a dark TV and a <b>Switch on your screens</b> card.
                    Only your gym’s owner can switch them on. Everyone else on the team sees{' '}
                    <b>Your gym’s owner can switch the screens on from here.</b>
                </P>
                <Steps>
                    <Step n="1" title="Choose your screen link">
                        Under <b>Your screen link</b>, check the name after <b>powr.life/gym/</b>. It starts as your
                        gym’s name. Use lower-case letters, numbers and single dashes, 2 to 40 characters.
                    </Step>
                    <Step n="2" title="Pick it once">
                        The name is part of the link you open on the TV, and it can’t be changed later from the
                        portal. Choose something short that reads as your gym.
                    </Step>
                    <Step n="3" title="Switch them on">
                        Press <b>Switch on the screens</b>. You’ll see <b>Screens switched on</b>, and both boards
                        appear on the page: <b>Screen 1</b>, the weekly leaderboard, and <b>Screen 2</b>, Gym Clash.
                    </Step>
                </Steps>
                <Shot
                    id="gym-screens-off"
                    alt="Screens before they’re switched on"
                    caption="Before the screens are on"
                    notes={[
                        ['tv', 'A dark TV until the screens are on.'],
                        ['link', 'Your screen link: the name after powr.life/gym/.'],
                        ['on', 'Switch on the screens. Only your gym’s owner sees it.'],
                    ]}
                />
                <P>
                    One switch turns on both. If the name is already used by another gym, you’re told it’s taken:
                    try another.
                </P>
            </Section>

            <Section id="tv" title="Put a board on the TV">
                <Steps>
                    <Step n="1" title="Open the link">
                        Open it in the TV’s own browser, or cast a laptop tab to the TV. Use <b>Copy link</b> on the
                        screen you want, or <b>Open</b> to open it in a new tab on the computer you’re on.
                    </Step>
                    <Step n="2" title="Go full screen">
                        Press F11, or the browser’s full-screen button. The board fits any size of screen.
                    </Step>
                    <Step n="3" title="Leave it running">
                        It refreshes itself, changes scene, and starts a new week every Monday. Nothing to touch.
                    </Step>
                </Steps>
                <Shot
                    id="gym-screens-tv-steps"
                    alt="Putting it on the TV, at the bottom of Screens"
                    caption="Putting it on the TV"
                    notes={[
                        ['open', 'Open the link in the TV’s own browser, or cast a laptop tab to it.'],
                        ['full', 'Go full screen.'],
                        ['running', 'Leave it running. Nothing to touch.'],
                        ['rotate', 'Make a new link, for an owner, if a link has got out.'],
                    ]}
                />
                <Callout tone="note" title="Use the whole link">
                    The short address under each TV on the page (<b>powr.life/gym/</b> or <b>powr.life/league/</b>{' '}
                    and your name) is there so you can tell the screens apart. The link that works on a TV is longer:
                    it carries a private key. Always use <b>Copy link</b> or <b>Open</b>. Typed without its key, the
                    TV shows <b>This link is missing its key</b>.
                </Callout>
                <P>
                    If your gym’s internet drops for a moment, the board keeps the last scores on screen and says
                    it’s reconnecting. It picks up again by itself.
                </P>
            </Section>

            <Section id="settings" title="Fit it to your room">
                <P>
                    The settings sit beside each TV on the page. Anyone on your team can change them, and the TV
                    picks up the change on its own.
                </P>
                <Table
                    head={['Setting', 'Choices', 'Use it when']}
                    rows={[
                        ['Viewing distance (leaderboard)', 'Near · Standard · Far', 'Near: a monitor, or a screen behind reception, with everything on. Standard: a 50" TV in a room, a third bigger with a little less on screen. Far: across a gym floor, one idea per scene, big enough from the far wall.'],
                        ['Board size (leaderboard)', 'Top 10 · Top 25 · Top 50', 'How many members the leaderboard ranks.'],
                        ['Nearby means within (Gym Clash)', '5 · 10 · 15 · 25 · 50 · 100 km', 'Which gyms count as your neighbours. A city needs 10 to 15 km to catch real neighbours, a town 25 to 50.'],
                    ]}
                />
                <Shot
                    id="gym-screens-leaderboard"
                    alt="The weekly leaderboard’s TV and settings"
                    caption="Screen 1: the weekly leaderboard"
                    notes={[
                        ['live', 'Live or Paused, and the short address of this screen.'],
                        ['preview', 'What the TV on this page plays: your gym, or sample members. Your real TV always shows your gym.'],
                        ['actions', 'Open, Copy link and Pause.'],
                        ['viewing', 'Viewing distance: Near, Standard or Far.'],
                        ['size', 'Board size: the top 10, 25 or 50.'],
                    ]}
                />
                <Shot
                    id="gym-screens-league"
                    alt="Gym Clash’s TV and settings"
                    caption="Screen 2: Gym Clash"
                    notes={[
                        ['tv', 'Gym Clash, live.'],
                        ['pause', 'Its own Pause, so the leaderboard can keep running.'],
                        ['radius', 'Nearby means within: which gyms count as your neighbours.'],
                    ]}
                />
            </Section>

            <Section id="pause" title="Pause and resume">
                <P>
                    Each screen has its own <b>Pause</b> button, so you can take one off the wall and leave the
                    other running. The pill under the TV on the page reads <b>Live</b> or <b>Paused</b>, and the
                    top of your <b>Overview</b> shows <b>Leaderboard live</b> or <b>paused</b>, and{' '}
                    <b>League live</b> or <b>paused</b>.
                </P>
                <P>
                    A paused board stops showing on the TV at its next refresh, within about 15 seconds. The TV shows a
                    message instead of the board, saying the link isn’t valid. Nothing is wrong with the link: press{' '}
                    <b>Resume</b> and the board comes back on the TV by itself, without touching the TV.
                </P>
                <Shot
                    id="gym-screens-paused"
                    alt="The weekly leaderboard, paused"
                    caption="A paused screen"
                    notes={[
                        ['tv', 'The TV on this page goes dark. Your real TV stops showing the board at its next refresh.'],
                        ['pill', 'The pill reads Paused.'],
                        ['resume', 'Resume brings the board back on the TV by itself.'],
                    ]}
                />
            </Section>

            <Section id="link" title="Your private link">
                <P>
                    Both links share one key, and a link can only show its own board. Nobody can use it to reach
                    your portal or change anything. Still, keep the links to your screens: anyone with a link can
                    open the board.
                </P>
                <P>If a link has got out, an owner can make a new one:</P>
                <Steps>
                    <Step n="1" title="Make a new link">
                        At the bottom of <b>Screens</b>, under <b>Putting it on the TV</b>, press{' '}
                        <b>Make a new link</b> and confirm.
                    </Step>
                    <Step n="2" title="Open the new links on every TV">
                        Every TV on the old links goes blank and shows <b>This screen link isn’t valid</b>. Copy the
                        new link from each screen and open it on each TV again. Both screens change, because they
                        share the key.
                    </Step>
                </Steps>
                <Callout tone="warn" title="The old link stops for good">
                    A new link can’t be undone, and the old one never works again. Do it when you’re able to get to
                    every TV. The name in the link stays the same: only the private key changes.
                </Callout>
            </Section>

            <Section id="faq" title="Common questions">
                <P>
                    <b>I can’t see the Switch on the screens button.</b> Only an owner can switch the screens on.
                    Ask your gym’s owner, or see <Link to="/docs/gyms/settings" className={A}>Settings &amp; team</Link>{' '}
                    for roles.
                </P>
                <P>
                    <b>I can’t see Make a new link.</b> Only an owner can change the link.
                </P>
                <P>
                    <b>The TV says “This screen link isn’t valid”.</b> Either that screen is paused (check for{' '}
                    <b>Paused</b> on <b>Screens</b> and press <b>Resume</b>), or someone made a new link. If it’s
                    live, copy the link again and open it on the TV.
                </P>
                <P>
                    <b>The TV says “This link is missing its key”.</b> The address was typed or copied without its
                    private key. Use <b>Copy link</b> on <b>Screens</b>.
                </P>
                <P>
                    <b>The TV says “The board is open.”</b> Nobody has scored at your gym yet this week. The first
                    session takes the top spot, and the board starts again every Monday. Get more members onto it
                    with the join poster and the QR code on the board.
                </P>
                <P>
                    <b>Gym Clash says “No gyms scoring yet”.</b> Nobody in view has scored this week so far. Lanes
                    fill as members train. A wider <b>Nearby means within</b> brings in more gyms.
                </P>
                <P>
                    <b>A member doesn’t want to be on the TV.</b> They can switch off <b>Show me on gym boards</b> in
                    the app’s settings. Their name leaves every gym screen, and they still earn.
                </P>
                <P>
                    <b>Can I change the name in the link?</b> Not from the portal, so choose it with care when you
                    switch the screens on.
                </P>
            </Section>
        </DocsLayout>
    );
}
