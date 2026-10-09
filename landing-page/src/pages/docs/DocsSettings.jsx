import React from 'react';
import { Link } from 'react-router-dom';
import { Callout, DocsLayout, P, Section, Shot, Step, Steps, Table } from './docsShared';

// /docs/settings: the partner portal's Settings page (brand info, delivery
// method, team, password) and its Support page (tickets and replies).

const TOC = [
    ['brand', 'Brand info'],
    ['delivery', 'Delivery method'],
    ['listing', 'Your logo and imagery'],
    ['team', 'Add a teammate'],
    ['links', 'Managing setup links'],
    ['remove', 'Removing someone'],
    ['password', 'Changing your password'],
    ['ticket', 'Raise a ticket'],
    ['replies', 'What happens next'],
    ['faq', 'Common questions'],
];

const A = 'font-bold text-[#8a7600] hover:underline';

export default function DocsSettings() {
    return (
        <DocsLayout
            eyebrow="Partner guide · Settings & support"
            title="Settings and support"
            intro="Settings holds your brand’s details, your team’s logins and your password. Support is where you ask the POWR team for help and read their answers. Settings is in the main sidebar list; Support sits at the foot of the sidebar."
            toc={TOC}
        >
            <Section id="brand" title="Brand info">
                <Shot
                    id="partner-settings"
                    alt="The partner portal Settings page"
                    caption="The Settings page"
                    notes={[
                        ['nav', 'Settings, in the main sidebar list.'],
                        ['brand', 'Brand Info: your brand name and the login you’re using.'],
                        ['delivery', 'Delivery Method: click it to see the status or switch.'],
                        ['team', 'Team: invite colleagues and remove access.'],
                        ['help', 'Help with anything this page can’t change.'],
                    ]}
                />
                <P>
                    The first panel on <b>Settings</b> shows two things you can read but not edit:
                </P>
                <P>
                    <b>Brand name.</b> How your brand appears across POWR. It’s managed by POWR, so to change it,
                    raise a ticket under <b>Account &amp; Team</b> (see <a href="#ticket" className={A}>Raise a ticket</a>).
                </P>
                <P>
                    <b>Signed in as.</b> The email address of the login you’re using now.
                </P>
            </Section>

            <Section id="delivery" title="Delivery method">
                <P>
                    The <b>Delivery Method</b> panel shows how codes reach members when they redeem: <b>Promo
                    Codes</b>, <b>Shopify</b> or <b>API</b>, or <b>Not chosen yet</b>. Click it to open{' '}
                    <b>Integration</b>, where you can see each method’s status and switch.
                </P>
                <P>
                    Switching asks you to confirm and deletes nothing. Your existing setup keeps working and you
                    can switch back at any time. <Link to="/docs" className={A}>How codes flow</Link> explains
                    the three methods.
                </P>
            </Section>

            <Section id="listing" title="Your logo and imagery">
                <P>
                    Settings doesn’t hold your logo. Your logo, imagery and descriptions live on each reward
                    listing, because that’s exactly what members see in the app. Edit them from{' '}
                    <b>My Rewards</b>, or press <b>Edit Your Listings</b> in the <b>Your Brand on POWR</b> panel
                    on Settings.
                </P>
                <P>
                    The logo beside your brand name in the portal sidebar is taken from your newest reward
                    listing. Changes to a live listing go to POWR for review before members see them. See{' '}
                    <Link to="/docs/rewards" className={A}>Rewards</Link>.
                </P>
            </Section>

            <Section id="team" title="Add a teammate">
                <P>
                    The <b>Team</b> panel is where you give colleagues their own login to your brand’s portal.
                    Everyone on the team has the same access, and each person signs in with their own email and
                    password. There are two ways to invite someone:
                </P>
                <Steps>
                    <Step n="1" title="Invite by email, or copy a link">
                        Type their address under <b>Invite by email</b> and press <b>Send</b>. POWR emails them a
                        setup link, and you’ll see that the invite was emailed. Or press{' '}
                        <b>Copy a setup link instead</b>: a new link is made and copied to your clipboard, ready
                        to paste into a message of your own.
                    </Step>
                    <Step n="2" title="They create their login">
                        Your teammate opens the link and fills in their name, the email address they want to sign
                        in with and a password of at least 8 characters. The address they choose doesn’t have to be
                        the one you invited.
                    </Step>
                    <Step n="3" title="They appear on the team">
                        Once they’ve set up, they show under <b>Team Members</b> and the link drops off the list of
                        open links. They can sign in from then on.
                    </Step>
                </Steps>
                <Shot
                    id="partner-settings-team"
                    alt="The Team panel on Settings, with two open setup links and three team members"
                    caption="The Team panel"
                    notes={[
                        ['invite', 'Type an address and press Send to email a setup link.'],
                        ['link', 'Or copy a setup link to send yourself.'],
                        ['open', 'Links nobody has used yet, each with Copy and Revoke.'],
                        ['you', 'Your own login, tagged You. It has no Revoke.'],
                        ['revoke', 'Hover over a teammate’s row and Revoke appears.'],
                    ]}
                />
                <Callout tone="note" title="If the invite email doesn’t go">
                    The link is still made. The portal copies it to your clipboard and tells you the email
                    couldn’t be sent, so you can paste it to your teammate yourself.
                </Callout>
                <Callout tone="warn" title="A setup link is a key">
                    Anyone holding an unused link can create a login for your brand. Send each link only to the
                    person it’s for, and revoke any you no longer need. Links don’t expire by themselves.
                </Callout>
            </Section>

            <Section id="links" title="Managing setup links">
                <P>
                    <b>Open Setup Links</b> lists every link that hasn’t been used yet. Each one shows who it was
                    emailed to, or the day it was created, followed by <b>unused</b>.
                </P>
                <P>
                    <b>Copy</b> copies the link again, handy if your teammate lost the email.{' '}
                    <b>Revoke</b> cancels it straight away: anyone who opens it afterwards sees{' '}
                    <b>Invalid link</b>. Revoking can’t be undone, but you can always make a new link.
                </P>
            </Section>

            <Section id="remove" title="Removing someone">
                <P>
                    <b>Team Members</b> lists every login for your brand: their email address, a <b>You</b> tag on
                    your own, and when they last signed in (<b>Today</b>, <b>Yesterday</b>, a number of days ago,
                    or <b>Never</b>).
                </P>
                <Steps>
                    <Step n="1" title="Hover over their row">
                        <b>Revoke</b> appears on the right of the row when you hover over it.
                    </Step>
                    <Step n="2" title="Press Revoke">
                        Their access to the portal ends at once and they drop off the list. There’s no
                        confirmation step, so check you’ve picked the right row.
                    </Step>
                </Steps>
                <P>
                    You can’t remove yourself. Your own row has no <b>Revoke</b>, so your brand always keeps at
                    least one login. To leave, ask a teammate to remove you, or raise a ticket.
                </P>
                <Callout tone="warn" title="Inviting someone back">
                    A removed teammate keeps their underlying login, so a new setup link with the same email
                    address will say an account with this email already exists. Have them use a different
                    address, or raise a ticket under <b>Account &amp; Team</b> and POWR will link them again.
                </Callout>
            </Section>

            <Section id="password" title="Changing your password">
                <P>
                    In <b>Change Password</b>, enter your <b>Current password</b>, then a <b>New password</b> of at
                    least 8 characters, type it again in <b>Confirm new password</b>, and press{' '}
                    <b>Update Password</b>. You’ll see <b>Password updated</b> when it’s done.
                </P>
                <Shot
                    id="partner-settings-password"
                    alt="The Change Password panel on Settings, filled in"
                    caption="Change Password"
                    notes={[
                        ['current', 'The password you sign in with now.'],
                        ['next', 'Your new password: at least 8 characters.'],
                        ['confirm', 'The new password again, exactly the same.'],
                        ['update', 'Update Password saves it.'],
                    ]}
                />
                <Table
                    head={['If you see', 'What to do']}
                    rows={[
                        ['Current password is incorrect', 'Check your current password and try again. Nothing has changed.'],
                        ['Passwords do not match', 'The two new password boxes differ. Type them again.'],
                        ['Password must be at least 8 characters', 'Choose a longer new password.'],
                    ]}
                />
                <P>
                    This only changes your own password. If you’ve forgotten yours and can’t sign in, there’s no
                    reset link on the sign-in page: email{' '}
                    <a href="mailto:support@powr.life" className={A}>support@powr.life</a> from the address you
                    sign in with.
                </P>
            </Section>

            <Section id="ticket" title="Raise a ticket">
                <P>
                    Open <b>Support</b> at the foot of the sidebar, or press <b>Contact Support</b> in the{' '}
                    <b>Need a Hand?</b> panel on Settings. The ticket goes to the POWR team.
                </P>
                <Steps>
                    <Step n="1" title="Say what it’s about">
                        Under <b>What’s it about?</b>, pick one: <b>Setup &amp; Integration</b> (getting started,
                        Shopify, API keys, webhooks), <b>Rewards &amp; Codes</b> (rewards, promo codes,
                        redemptions), <b>Account &amp; Team</b> (logins, team members, brand details) or{' '}
                        <b>Something Else</b>.
                    </Step>
                    <Step n="2" title="Add a subject">
                        A short summary of the issue, up to 120 characters.
                    </Step>
                    <Step n="3" title="Write your message">
                        Say what happened, what you expected and any error messages you saw. Name the reward,
                        member or exact error text involved: detail is what lets POWR dig in straight away.
                    </Step>
                    <Step n="4" title="Press Send Ticket">
                        The button stays greyed out until there’s a subject and a message. Once sent, a
                        confirmation appears, the form clears and the ticket shows at the top of{' '}
                        <b>Your Tickets</b> as <b>Open</b>.
                    </Step>
                </Steps>
                <Shot
                    id="partner-support-form"
                    alt="A new support ticket filled in on the Support page"
                    caption="A new ticket, ready to send"
                    notes={[
                        ['topic', 'Pick the topic closest to your question.'],
                        ['subject', 'A short summary, up to 120 characters.'],
                        ['message', 'What happened, what you expected, and any error text.'],
                        ['send', 'Send Ticket works once there’s a subject and a message.'],
                    ]}
                />
                <P>
                    POWR’s answer appears on the ticket itself, under <b>Your Tickets</b>, so check back there.
                    If a ticket fails to send, the page asks you to try again and your words stay in the form.
                </P>
            </Section>

            <Section id="replies" title="What happens next">
                <P>
                    The POWR team replies to every ticket within one business day, usually much sooner during UK
                    hours. <b>Your Tickets</b> lists the tickets you’ve sent, newest first, with the subject, the
                    topic, how long ago you sent it and its status:
                </P>
                <Table
                    head={['Status', 'What it means']}
                    rows={[
                        ['Open', 'With the POWR team, not picked up yet.'],
                        ['In Progress', 'Someone at POWR is working on it.'],
                        ['Resolved', 'POWR has answered. Open the ticket to read the reply.'],
                        ['Closed', 'Finished with.'],
                    ]}
                />
                <P>
                    Click a ticket to open it. You’ll see <b>Your Message</b>, then the answer under{' '}
                    <b>POWR Support</b>, or <b>Waiting on the POWR team</b> if there isn’t one yet. The top of the
                    list counts how many tickets are <b>awaiting reply</b> (Open or In Progress), or says{' '}
                    <b>All caught up</b> when none are.
                </P>
                <Shot
                    id="partner-support-tickets"
                    alt="Your Tickets on the Support page, with an answered ticket opened"
                    caption="Your Tickets, with an answered ticket open"
                    notes={[
                        ['awaiting', 'How many of your tickets are waiting on POWR.'],
                        ['status', 'Each ticket’s status. Open means not picked up yet.'],
                        ['message', 'Click a ticket to see what you sent.'],
                        ['reply', 'POWR’s answer, under POWR Support.'],
                    ]}
                />
                <Callout tone="note" title="Following up">
                    Tickets have no reply box. To add something, send a new ticket and mention the subject of the
                    first one.
                </Callout>
            </Section>

            <Section id="faq" title="Common questions">
                <P>
                    <b>Can my teammates see my tickets?</b> No. <b>Your Tickets</b> shows the tickets sent from
                    your own login. Each teammate sees theirs.
                </P>
                <P>
                    <b>Can I give a teammate less access?</b> No. Everyone on <b>Team Members</b> can use every
                    page of your brand’s portal, including inviting and removing others.
                </P>
                <P>
                    <b>I can’t see the Revoke button.</b> It appears when you hover over a teammate’s row, and
                    never on your own.
                </P>
                <P>
                    <b>The Team panel says it couldn’t load your team.</b> The portal couldn’t reach the server for
                    a moment. Nothing has changed. Press <b>Try again</b>.
                </P>
                <P>
                    <b>Where are notification settings?</b> Settings has none. If emails from POWR are reaching
                    the wrong people, raise a ticket under <b>Account &amp; Team</b>.
                </P>
                <P>
                    <b>I can’t sign in, so I can’t raise a ticket.</b> Email{' '}
                    <a href="mailto:support@powr.life" className={A}>support@powr.life</a> instead.
                </P>
                <P>
                    <b>Is there a quicker fix than a ticket?</b> Often. The <b>Fix It Faster</b> panel on Support
                    links to these guides, your integration status, your reward listings and your team settings.
                    New to the portal? Start with <Link to="/docs/getting-started" className={A}>Getting started</Link>.
                </P>
            </Section>
        </DocsLayout>
    );
}
