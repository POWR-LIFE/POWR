import React from 'react';
import { Link } from 'react-router-dom';
import { Callout, DocsLayout, P, Section, Shot, Step, Steps, Table } from '../docsShared';

// /docs/gyms/settings: everything a gym sets once and touches now and then.
// Settings itself (details, hours, logo, photo, team, emails, package, help),
// the gym's page in the app (which lives on the Overview), the Package page
// and the join poster.

const TOC = [
    ['roles', 'Owners and team'],
    ['details', 'Your gym’s details'],
    ['hours', 'Opening hours'],
    ['images', 'Logo and photo'],
    ['app', 'Your page in the app'],
    ['trainers', 'Put your trainers in the app'],
    ['team', 'Add or remove a teammate'],
    ['email', 'Your emails'],
    ['package', 'Your package'],
    ['poster', 'The join poster'],
    ['help', 'Asking POWR'],
    ['faq', 'Common questions'],
];

const A = 'font-bold text-[#8a7600] hover:underline';

export default function GymDocsSettings() {
    return (
        <DocsLayout
            eyebrow="Gym guide · Settings & team"
            title="Settings, your page and your team"
            intro="The things you set once and come back to now and then: what members see about your gym in the app, your opening hours, who can sign in to the portal, the emails you get, your package, and how to ask POWR for help."
            toc={TOC}
            nextNote={{ label: 'Events', detail: 'Run your own challenges: the board, the pushes and the reveal.' }}
        >
            <Section id="roles" title="Owners and team">
                <P>
                    Everyone who signs in to your portal is either an <b>Owner</b> or <b>Team</b>. You can see your
                    role under your gym’s name in the sidebar.
                </P>
                <Table
                    head={['', 'Owner', 'Team']}
                    rows={[
                        ['See every page your package includes', 'Yes', 'Yes'],
                        ['Run events, use the Studio, Members and Retention', 'Yes', 'Yes'],
                        ['Choose your own emails, ask POWR for help', 'Yes', 'Yes'],
                        ['Change the gym’s details, hours, logo, photo and page in the app', 'Yes', 'No, they can see them'],
                        ['Invite and remove team members', 'Yes', 'No'],
                        ['Switch on the screens', 'Yes', 'No'],
                        ['Ask to change the package', 'Yes', 'No'],
                    ]}
                />
                <P>
                    A team member sees a note on <b>Settings</b> and on the app page saying only an owner can
                    change them. Owners are added and removed by POWR, and a gym always keeps at least one.
                </P>
            </Section>

            <Section id="details" title="Your gym’s details">
                <P>
                    The <b>Details</b> card on <b>Settings</b> is what members see in the app, on your screens and
                    on every post. Change any of these, then press <b>Save details</b>. <b>Undo</b> puts back what
                    was saved.
                </P>
                <Shot
                    id="gym-settings-page"
                    alt="The Settings page for Northpoint Strength, a made-up gym"
                    caption="Settings"
                    notes={[
                        ['details', 'Details: the name, about, address, phone and website members see.'],
                        ['hours', 'Opening hours, day by day.'],
                        ['logo', 'Logo, and the background it’s made for.'],
                        ['photo', 'Photo: the big picture on your page in the app.'],
                        ['package', 'Package: the one you’re on, and See packages.'],
                        ['email', 'Email: your own switches for the emails you get.'],
                    ]}
                />
                <Table
                    head={['Field', 'Rules']}
                    rows={[
                        ['Gym name', '2 to 60 characters.'],
                        ['About', 'A sentence or two, up to 400 characters. Shown on your gym’s page in the app.'],
                        ['Address', 'Up to 200 characters.'],
                        ['Phone', 'Up to 30 characters.'],
                        ['Website', 'Up to 200 characters. Leave off the https:// and we add it.'],
                    ]}
                />
                <Callout tone="note" title="The address doesn’t move your pin">
                    Your pin on the map is where members find you and where <b>Get Directions</b> takes them.
                    Changing the address text doesn’t move it. If the pin is in the wrong place, ask us from{' '}
                    <a href="#help" className={A}>Help</a> and we’ll move it.
                </Callout>
            </Section>

            <Section id="hours" title="Opening hours">
                <P>
                    Tick each day you’re open and set the open and close times. A new day starts at 06:00 to
                    22:00; untick it and it reads <b>Closed</b>. Press <b>Save hours</b>. Members see{' '}
                    <b>Open now</b> or <b>Closed</b> on your page as it happens, with today’s hours under it.
                </P>
                <P>
                    You can also set hours from your page in the app on the Overview, where{' '}
                    <b>Same as Monday, every day</b> copies Monday’s times to the whole week.
                </P>
            </Section>

            <Section id="images" title="Logo and photo">
                <P>
                    <b>Logo</b> appears on your screens, on your pin and page in the app, and on every post the
                    Studio makes. A PNG with a see-through background is best. Under it, pick the background it’s
                    made for, <b>On dark</b>, <b>On black</b> or <b>On white</b>, so it never sits on the wrong one.
                </P>
                <P>
                    <b>Photo</b> is the big picture at the top of your gym’s page in the app, and it goes behind
                    the week’s posts too. Landscape works best: the floor or the front, with people in it if you
                    can.
                </P>
                <P>
                    Press <b>Upload</b> (or <b>Replace</b>) and pick an image. It saves as soon as it’s uploaded,
                    and <b>Remove</b> takes it off straight away. Images have to be uploaded here: a link to an
                    image elsewhere won’t be accepted.
                </P>
            </Section>

            <Section id="app" title="Your page in the app">
                <P>
                    <b>Your gym in the app</b> is a card on the <b>Overview</b>, not on Settings. It draws your
                    gym’s page on a phone, exactly as a member sees it when they tap your pin on Discover.{' '}
                    <b>Tap anything on the phone to change it</b>, or use the checklist beside it.
                </P>
                <Shot
                    id="gym-app-card"
                    alt="Your gym in the app: the gym’s page drawn on a phone, with its checklist and team"
                    caption="Your gym in the app, on the Overview"
                    notes={[
                        ['phone', 'Your page as members see it. Tap anything on it to change it.'],
                        ['count', 'Reads Ready for members until all six are done.'],
                        ['item', 'The checklist. Tap an item to change that part.'],
                        ['order', 'The arrows set the order, the eye hides someone, the bin takes them off.'],
                        ['hidden', 'Hidden people stay in the list but not in the app.'],
                        ['add', 'Add someone puts a new person on your page.'],
                    ]}
                />
                <Table
                    head={['Checklist item', 'What it is']}
                    rows={[
                        ['Cover photo', 'The first thing they see. The same picture as Photo on Settings.'],
                        ['Logo', 'On your pin and your page.'],
                        ['Name & address', 'At the top of your page and under your pin.'],
                        ['Opening hours', 'Open or closed, live.'],
                        ['About', 'A line or two under your name: what it’s like, who it’s for. Up to 400 characters.'],
                        ['Your team', 'Trainers, coaches and staff members can book.'],
                    ]}
                />
                <P>
                    The count above reads <b>Ready for members</b> until all six are done, then{' '}
                    <b>Your page is complete</b>. Text changes show on the phone as you type and reach members
                    when you press <b>Save</b>. A small dot marks anything not saved yet, and the browser warns you
                    before you leave with unsaved changes. Photos and logos save as soon as they’re uploaded;
                    you’ll see <b>Saved. Members see it now.</b>
                </P>
                <P>
                    Two parts of the phone aren’t yours to edit. Tapping the map pin explains how to{' '}
                    <b>Ask POWR to move it</b>. Tapping <b>Set as Home Gym</b> explains the button that makes
                    someone one of your members, and links to your join link.
                </P>
            </Section>

            <Section id="trainers" title="Put your trainers in the app">
                <P>
                    Each person you add gets a card on your page with their photo, what they do, what they’re good
                    at and, with a booking link, a <b>Book Session</b> button. This is separate from the portal
                    team below: trainers here don’t get a login.
                </P>
                <Steps>
                    <Step n="1" title="Open Your team">
                        On the Overview, in <b>Your gym in the app</b>, tap <b>Your team</b>. With nobody on your
                        page yet, press <b>Add your first</b>; after that, <b>Add someone</b>.
                    </Step>
                    <Step n="2" title="Fill in their card">
                        Tap the circle to add a photo. Then <b>Name</b> (2 to 60 characters),{' '}
                        <b>Experience</b> (short, like “8 years”), and <b>What they do</b>, typed or picked from
                        Personal trainer, Coach, Class instructor, Physio, Nutritionist or Manager. Add up to six{' '}
                        <b>Specialties</b>: type one and press Enter, or tap a suggestion. The <b>Bio</b> takes up
                        to 500 characters.
                    </Step>
                    <Step n="3" title="Add their links">
                        <b>Booking link</b> gives them a <b>Book Session</b> button: any booking page, or a
                        WhatsApp link. <b>Profile link</b> gives them a <b>View Profile</b> button, for their
                        Instagram or their page on your site. Both have to be web addresses.
                    </Step>
                    <Step n="4" title="Save">
                        Press <b>Add to your page</b>. Members see them straight away. <b>Add someone else</b>{' '}
                        starts the next card.
                    </Step>
                </Steps>
                <Shot
                    id="gym-app-trainer"
                    alt="A trainer’s card open for editing beside the phone preview"
                    caption="A trainer’s card"
                    notes={[
                        ['card', 'Their card on the phone, changing as you type.'],
                        ['photo', 'Tap the circle to add or change their photo.'],
                        ['role', 'What they do: type it, or pick one.'],
                        ['specialties', 'Up to six specialties.'],
                        ['booking', 'A booking link gives them a Book Session button.'],
                        ['show', 'Untick to hide them without losing their details.'],
                    ]}
                />
                <P>
                    In the list, the arrows set the order members see, the eye hides or shows someone, and the bin
                    takes them off. Unticking <b>Show them in the app</b> hides someone without losing their
                    details. The list flags anyone <b>Hidden</b> or with <b>no booking link</b>. You can have up to
                    40 people.
                </P>
            </Section>

            <Section id="team" title="Add or remove a teammate">
                <P>
                    The <b>Team</b> card on <b>Settings</b> lists everyone who can sign in to your portal. Owners
                    can invite team members. A teammate who already uses the POWR app signs in with that account;
                    anyone else sets up a login from the link.
                </P>
                <Shot
                    id="gym-settings-team"
                    alt="The Team card with a fresh setup link, two invites waiting and four people on the team"
                    caption="Team, on Settings"
                    notes={[
                        ['invite', 'Type their email and press Invite.'],
                        ['copy', 'Or make a setup link and send it yourself.'],
                        ['latest', 'Your latest link stays here until you make another.'],
                        ['waiting', 'Open invites, with their expiry date. Cancel stops a link working.'],
                        ['team', 'Everyone who can sign in. A crown marks an owner.'],
                        ['remove', 'Remove takes a team member’s access away straight away.'],
                    ]}
                />
                <Steps>
                    <Step n="1" title="Invite by email">
                        Type their email and press <b>Invite</b>. They get an email with a{' '}
                        <b>Set up your access</b> button, and a second link after five days if they haven’t used
                        it.
                    </Step>
                    <Step n="2" title="Or send the link yourself">
                        Press <b>Copy a setup link instead</b> and send it however you like. The latest link stays
                        on screen until you make another. It works once, for 14 days. If an email fails to send,
                        the link is copied for you instead.
                    </Step>
                    <Step n="3" title="Watch it land">
                        Open invites sit under <b>Waiting to join</b> with their expiry date. Once accepted, the
                        person moves to <b>On the team</b>, with when they last signed in.
                    </Step>
                </Steps>
                <P>
                    <b>Cancel</b> next to an invite stops the link working. <b>Remove</b> next to a team member
                    takes away their access to the portal straight away; their POWR app account isn’t touched. You
                    can’t remove yourself or an owner from here.
                </P>
                <Callout tone="warn" title="One link, one person">
                    A setup link lets in whoever opens it first, whatever email they use. Send it only to the
                    person it’s for, and cancel it if it went astray.
                </Callout>
            </Section>

            <Section id="email" title="Your emails">
                <P>
                    The <b>Email</b> card holds your own switches. Each person on the team chooses for themselves,
                    so team members can change these too. Both start switched on.
                </P>
                <Table
                    head={['Switch', 'What you get']}
                    rows={[
                        ['Your gym’s week, every Monday', 'Sessions, athletes, new faces, the top of the board and your events, in one email.'],
                        ['When someone starts drifting', 'Clash+ and above. A morning email on days when someone goes well past their usual gap between visits, never more than one a day. On Clash Pro it says who.'],
                    ]}
                />
                <Shot
                    id="gym-settings-email"
                    alt="The Email card with both switches on"
                    caption="Email, on Settings"
                    notes={[
                        ['recap', 'Your gym’s week, every Monday.'],
                        ['drift', 'When someone starts drifting. On Clash Pro it says who.'],
                    ]}
                />
            </Section>

            <Section id="package" title="Your package">
                <P>
                    The <b>Package</b> card on <b>Settings</b> shows where you are, like{' '}
                    <b>Trial · 40 days left</b> or <b>Clash+</b>. <b>See packages</b> opens the <b>Package</b> page.
                    You can also reach it from your package line in the sidebar, or from your gym’s logo on a
                    phone.
                </P>
                <P>
                    During the free trial the page counts down the days and says what your gym runs on afterwards.
                    If that’s Clash, it lists what stays (your leaderboard and Gym Clash screens, the join poster,
                    your team) and what switches off. After the trial it shows your package and how it’s billed.
                    Below are the packages, with <b>Yours</b> on the one you’re on. Founding Pro only shows during
                    the trial, with how many of its ten places are left.
                </P>
                <Shot
                    id="gym-package"
                    alt="The Package page during the free trial, after asking for Clash Pro"
                    caption="Package, during the free trial"
                    notes={[
                        ['line', 'Your package line in the sidebar opens this page too.'],
                        ['days', 'During the trial, the days left.'],
                        ['stays', 'If you’ll run on Clash, what stays and what switches off.'],
                        ['asked', 'Once you’ve asked to change, when you asked. POWR gets in touch.'],
                        ['founding', 'Founding Pro shows only during the trial, with the places left.'],
                        ['choose', 'Choose a package to ask POWR to switch you.'],
                    ]}
                />
                <Steps>
                    <Step n="1" title="Pick one">
                        Owners press <b>Choose [package]</b> during the trial, or <b>Switch to [package]</b>{' '}
                        after it. Team members see <b>Your gym’s owner can ask to switch.</b>
                    </Step>
                    <Step n="2" title="Confirm">
                        We ask you to confirm. Nothing is charged in the portal.
                    </Step>
                    <Step n="3" title="POWR gets in touch">
                        The page says <b>You asked for [package] on [date]</b>, and the request appears under{' '}
                        <a href="#help" className={A}>Help</a> as a <b>Package change</b>. POWR contacts you to set
                        it up and invoice you, then switches the package on. Owners get an email when it’s done,
                        and the pages it unlocks open.
                    </Step>
                </Steps>
                <Callout tone="note" title="Trial reminders">
                    If the package you’ll run on has fewer parts than the trial, owners get an email 14 days and
                    3 days before the trial ends, and once it has. On a package that keeps everything, there’s
                    nothing to warn you about, so no email.
                </Callout>
            </Section>

            <Section id="poster" title="The join poster">
                <P>
                    Everything in the portal counts the members who picked your gym in the app, so this is how you
                    tell them. It’s on every package. Open it from <b>Print it</b> or <b>Get the link</b> on the
                    Overview, or <b>The join poster</b> under <b>Help</b>.
                </P>
                <P>
                    <b>Download the poster kit</b> makes one ZIP: an A4 for the wall and an A5 for the counter,
                    ready for any printer, plus Post, Story and Square sizes for your feed and the caption to
                    paste. No photo needed. <b>Copy the link</b> copies the link behind the QR. It opens the POWR
                    app on your gym, or the app store for someone new. Ask people to pick your gym as their gym:
                    that’s what puts them on your board.
                </P>
                <P>
                    It works best in three places: the A5 by the till and the A4 where people check in, the Post
                    and Story on your feed (once now, again with your first event), and one line with the link in
                    your welcome email.
                </P>
                <Shot
                    id="gym-poster"
                    alt="The join poster page: the poster in three sizes, the download button and the QR"
                    caption="The join poster"
                    notes={[
                        ['sizes', 'The poster in Post, Story and Square.'],
                        ['kit', 'One ZIP: the A4, the A5, the three feed sizes and the caption.'],
                        ['qr', 'The QR opens the POWR app on your gym.'],
                        ['copy', 'Copy the link behind the QR, for your welcome email or WhatsApp.'],
                        ['places', 'Three places it works best.'],
                    ]}
                />
            </Section>

            <Section id="help" title="Asking POWR">
                <P>
                    The <b>Help</b> card is at the foot of <b>Settings</b>. A person at POWR answers, usually the
                    same day.
                </P>
                <Steps>
                    <Step n="1" title="Ask">
                        Press <b>Ask POWR</b>. Under <b>About</b>, pick a topic: Something’s not working, Package
                        and billing, Events, Screens and the board, Studio, or Other.
                    </Step>
                    <Step n="2" title="Say what’s happening">
                        Give it a <b>Subject</b>, then in <b>What’s happening</b> say what you expected, what
                        happened instead, and when (at least 10 characters). Press <b>Send to POWR</b>.
                    </Step>
                    <Step n="3" title="Read the answer">
                        Your question appears under <b>Your requests</b>. Tap it to see your message and, once we’ve
                        replied, our answer. Whoever asked also gets the answer by email.
                    </Step>
                </Steps>
                <Shot
                    id="gym-settings-help"
                    alt="The Help card with three requests, one opened to show POWR’s answer"
                    caption="Help, at the foot of Settings"
                    notes={[
                        ['ask', 'Ask POWR opens the form.'],
                        ['guides', 'These guides, and help with the board and the join poster.'],
                        ['requests', 'Everything your team has asked POWR.'],
                        ['status', 'Where each one is. Answered means we’ve replied.'],
                        ['reply', 'Tap a request to see your message and our answer.'],
                    ]}
                />
                <Table
                    head={['Status', 'Meaning']}
                    rows={[
                        ['With POWR', 'We have it and haven’t started yet.'],
                        ['On it', 'Someone at POWR is working on it.'],
                        ['Answered', 'We’ve replied. Tap it to read.'],
                        ['Closed', 'Nothing more to do.'],
                    ]}
                />
                <P>
                    <b>Your requests</b> lists the whole team’s questions, plus the ones the portal opens for you:
                    a <b>Package change</b>, a <b>Clash Night</b> request or one called off, and your first{' '}
                    <b>Event review</b>. Prefer email? Write to{' '}
                    <a href="mailto:support@powr.life" className={A}>support@powr.life</a>.
                </P>
            </Section>

            <Section id="faq" title="Common questions">
                <P>
                    <b>The fields are greyed out.</b> You’re on the team, not an owner. Ask an owner to make the
                    change.
                </P>
                <P>
                    <b>“The name needs 2 to 60 characters.”</b> The gym name and each trainer’s name need at least
                    two characters. Other messages like this tell you the limit you went over.
                </P>
                <P>
                    <b>“Upload the photo here rather than linking to it.”</b> Images have to be uploaded from your
                    device. On your page in the app, images over 15 MB are turned away: try a smaller one.
                </P>
                <P>
                    <b>“That’s 40 people already.”</b> Your page holds 40. Take someone off, or hide people you
                    want to keep for later.
                </P>
                <P>
                    <b>I need another owner.</b> Owners can only invite team members. Ask us from Help and POWR
                    adds the owner. Removing an owner is the same, and a gym always keeps one.
                </P>
                <P>
                    <b>My teammate’s link says expired or already used.</b> Make a new one with <b>Invite</b> or{' '}
                    <b>Copy a setup link instead</b>. If it says already used and they’re on the team, they just
                    sign in.
                </P>
                <P>
                    <b>“You’re already on that package.”</b> You can’t ask for the package you’re on. During the
                    trial, the package you’ll run on afterwards counts as yours.
                </P>
                <P>
                    <b>“Founding Pro was only available during the free trial.”</b> Founding Pro can only be
                    chosen while the trial runs, and only while places are left.
                </P>
                <P>
                    <b>“You’ve sent a few just now.”</b> Three questions in ten minutes is the limit. We’ll answer
                    those first.
                </P>
                <P>
                    New here? Start with <Link to="/docs/gyms" className={A}>Getting started</Link>. Running your
                    first challenge? See <Link to="/docs/gyms/events" className={A}>Events</Link>.
                </P>
            </Section>
        </DocsLayout>
    );
}
