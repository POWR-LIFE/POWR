import React from 'react';
import { Link } from 'react-router-dom';
import { Callout, DocsLayout, P, Section, Shot, Step, Steps, Table } from '../docsShared';

// /docs/gyms/members: the Members dashboard (Clash+), the named list of
// members who share with the gym (Clash Pro), and Retention (counts on
// Clash+, names on Clash Pro). Sources: pages/venue/VenueMembers.jsx,
// MemberPeople.jsx, VenueRetention.jsx, and the gym retention / member
// insights rules. Visits are only ever "counted": never how.

const L = 'font-bold text-[#8a7600] hover:underline';

const TOC = [
    ['what', 'What these pages are for'],
    ['privacy', 'What you can and can’t see'],
    ['dashboard', 'The Members dashboard'],
    ['charts', 'What they do, where and when'],
    ['named', 'Members who share with you'],
    ['retention', 'Retention: slipping and drifting'],
    ['list', 'Work the list'],
    ['nudge', 'Send a nudge'],
    ['email', 'The morning email'],
    ['wonback', 'Who came back'],
    ['faq', 'Common questions'],
];

export default function GymDocsMembers() {
    return (
        <DocsLayout
            eyebrow="Gym guide · Members & Retention"
            title="Know your members, and notice who’s drifting"
            intro="Members shows who trains with you, what they do and when they come in. Retention shows who has started coming in less than their own usual, so the team can reach out before anyone cancels. Members always choose what they share."
            toc={TOC}
        >
            <Section id="what" title="What these pages are for">
                <Table
                    head={['Page', 'What it answers', 'Package']}
                    rows={[
                        ['Members', 'How many people chose your gym, who trained here, what they do and when they come in. Numbers in the round, no names.', 'Clash+'],
                        ['Members who share with you (on Members)', 'By name: what each member who shares all their training with you has been doing.', 'Clash Pro'],
                        ['Retention', 'How many are on track, slipping, drifting or lapsed, week by week, and who came back after you reached out.', 'Clash+'],
                        ['Retention by name', 'Who exactly is slipping or drifting, their usual pattern, a log of who the team contacted, a one-tap nudge and an export.', 'Clash Pro'],
                    ]}
                />
                <P>
                    Founding Pro includes everything in Clash Pro. On a package without a page, it shows what the page
                    does and a <b>See packages</b> button. Open <b>Package</b> in the portal to compare.
                </P>
            </Section>

            <Section id="privacy" title="What you can and can’t see">
                <P>
                    Members decide what reaches your gym, with three switches in the POWR app under{' '}
                    <b>Settings</b> → <b>Privacy</b>. They can change any of them at any time, and the portal follows
                    straight away.
                </P>
                <Table
                    head={['Switch in the app', 'Starts', 'What it means for your gym']}
                    rows={[
                        ['Show me on gym boards', 'On', 'Their name and points appear on your board, your screens and Gym Clash. Off, they still earn and still count in your totals, but are never named on the board.'],
                        ['Let gyms see my visits', 'On', 'You see the days and times POWR counted them in at your gym, in Retention. Off, they disappear from Retention completely.'],
                        ['Share with [your gym]', 'Off', 'Only for the gym they picked. You also see the rest of their training by name: runs, rides, home workouts, how often and when. They have to switch it on, and it stops if they pick another gym.'],
                    ]}
                />
                <Callout tone="good" title="Never shown to a gym">
                    Sleep, heart rate, steps and where a member is are never shown, on any package. Other gyms a member
                    visits are never named.
                </Callout>
                <P>
                    The numbers about what your members do anywhere are totals for everyone who chose your gym. They
                    appear only once at least five people chose you, and an activity fewer than three members did is left out, so nobody can be
                    picked out from them.
                </P>
            </Section>

            <Section id="dashboard" title="The Members dashboard">
                <P>
                    The big number is how many people <b>chose</b> your gym as their gym in the POWR app. Members pick
                    their gym in the app, and your join poster and join link take them straight there. Under it:
                </P>
                <Table
                    head={['Number', 'What it counts', 'Period']}
                    rows={[
                        ['Active', 'Members who chose your gym and trained anywhere, with the number for the four weeks before beside it', 'The last four full weeks'],
                        ['Trained here', 'Everyone who trained at your gym, members or not', 'The last 28 days'],
                        ['Drifting', 'People well past their own usual gap between visits, with how many more are slipping. Click it to open Retention', 'Today'],
                        ['New here', 'People whose first ever session at your gym was this week', 'Since Monday, in your gym’s time'],
                    ]}
                />
                <Shot
                    id="gym-members-page"
                    alt="The Members page in the gym portal"
                    caption="Members"
                    notes={[
                        ['total', 'How many people chose your gym in the POWR app.'],
                        ['facts', 'Active, Trained here and New here, each with its period.'],
                        ['drifting', 'Drifting, with how many more are slipping. Click it to open Retention.'],
                        ['chart', 'People who trained here each week. Now is lighter: the week is still running.'],
                        ['board', 'On the board this week: your top ten by points earned here.'],
                    ]}
                />
                <P>
                    With fewer than five members, only <b>Trained here</b> and <b>New here</b> show, and the page
                    tells you what appears at five.
                </P>
                <P>
                    <b>People who trained here each week</b> is a column per week for the last 12 weeks. The newest,{' '}
                    <b>Now</b>, is lighter because the week is still running. Hover or tap a column for its number.
                </P>
                <P>
                    <b>On the board this week</b> is your top ten by points earned at your gym, exactly as your big
                    screen shows them, with each person’s sessions. Members who hide from leaderboards are counted,
                    never named.
                </P>
                <P>
                    <b>What the numbers say</b> picks up to three things worth acting on, each with a suggestion: an
                    activity rising or falling among your members, a share of their gym sessions happening at other
                    gyms, a quiet weekday or month, or a core who train five or more days a week.
                </P>
            </Section>

            <Section id="charts" title="What they do, where and when">
                <Table
                    head={['Card', 'What it shows', 'Period']}
                    rows={[
                        ['What they do', 'The top activities among your members anywhere, with how many members did each and the sessions. The change is per active member against the four weeks before, so new members joining doesn’t read as a rise.', 'Last four weeks'],
                        ['Where their gym sessions happen', 'At this gym, At other gyms, or Not checked in (a watch or home workout).', 'Last eight weeks'],
                        ['Days a week they train', '5 or more days, 3 to 4, 1 to 2, or Not at all.', 'Last four weeks'],
                        ['When they come here', 'Sessions at your gym by hour and by weekday, with your busiest day and hour.', 'Last 28 days'],
                    ]}
                />
                <Shot
                    id="gym-members-charts"
                    alt="The What they do, Where and how often, and When they come here cards"
                    caption="What they do, where and when"
                    notes={[
                        ['what', 'What they do: members and sessions per activity, with the change.'],
                        ['where', 'Where their gym sessions happen: here, at other gyms, or not checked in.'],
                        ['days', 'How many days a week they train.'],
                        ['when', 'When they come here, by hour and by day, with your busiest.'],
                    ]}
                />
                <P>
                    The first three cards need at least five members. <b>When they come here</b> shows as soon as
                    anyone trains with you.
                </P>
            </Section>

            <Section id="named" title="Members who share with you">
                <P>
                    On Clash Pro, the foot of <b>Members</b> lists, by name, the members who switched on{' '}
                    <b>Share with</b> your gym in the app. The heading shows how many of your members share. Each row
                    has their POWR ID, when they were last active, their active days in the last two weeks against
                    their usual, their sessions in four weeks, their streak and their top activities.
                </P>
                <Shot
                    id="gym-members-sharing"
                    alt="Members who share with you, the top of the list"
                    caption="Members who share with you"
                    notes={[
                        ['count', 'How many of your members share with you.'],
                        ['filters', 'Everyone, Quiet everywhere or Slowing everywhere.'],
                        ['label', 'Each member’s label. The table below says what each means.'],
                        ['id', 'Their POWR ID, and when they were last active anywhere.'],
                        ['days', 'Active days in two weeks against their usual, sessions in four weeks, their streak.'],
                        ['top', 'Their top activities in the last four weeks.'],
                    ]}
                />
                <Table
                    head={['Label', 'Meaning']}
                    rows={[
                        ['Quiet everywhere', 'Nothing at all in the last two weeks, after being active on six or more days in the six weeks before'],
                        ['Slowing everywhere', 'Active days in the last two weeks down to under half their usual'],
                        ['Active', 'Training about as usual'],
                        ['Not active yet', 'Nothing recorded in the last eight weeks'],
                    ]}
                />
                <P>
                    Use the <b>Everyone</b>, <b>Quiet everywhere</b> and <b>Slowing everywhere</b> filters to narrow
                    the list. This is about training anywhere. Visits to your gym are in Retention, for everyone.
                </P>
            </Section>

            <Section id="retention" title="Retention: slipping and drifting">
                <P>
                    Retention looks only at visits to your gym. It covers members who picked your gym and anyone who
                    has trained there in the last six months. Each person is measured against their own normal, not a
                    fixed rule: their usual gap between visits, worked out from the twelve weeks up to their last
                    visit.
                </P>
                <Table
                    head={['Status', 'When']}
                    rows={[
                        ['On track', 'Coming in about as usual'],
                        ['Slipping', 'Their gap reaches one and a half times their usual (four days at least), or their visits in the last four weeks have dropped to under half their earlier pace'],
                        ['Drifting', 'Their gap reaches two and a half times their usual: never sooner than a week, never later than four weeks'],
                        ['Lapsed', 'Not in for more than 60 days'],
                        ['New', 'Fewer than four visits so far, the first in the last four weeks'],
                        ['Occasional', 'Fewer than four visits, now and then. Too few to have a pattern'],
                    ]}
                />
                <P>
                    So someone who trains every day is drifting after a week, and someone who comes once a week after
                    about two and a half. The big number is how many are drifting, with <b>On track</b>,{' '}
                    <b>Slipping</b>, <b>Lapsed</b> and <b>New</b> beside it. <b>Drifting each week</b> shows the last 12
                    weeks as each Sunday stood: the dark column is drifting, the light one behind it is slipping or
                    drifting.
                </P>
                <Shot
                    id="gym-retention-top"
                    alt="The top of the Retention page: drifting, the status counts, the weekly chart and Won back"
                    caption="Retention"
                    notes={[
                        ['big', 'How many are drifting from their usual visits.'],
                        ['counts', 'On track, Slipping, Lapsed and New.'],
                        ['chart', 'Drifting each week: dark is drifting, light is slipping or drifting.'],
                        ['wonback', 'Won back: who came back after you reached out.'],
                        ['nudge', 'Nudge everyone who’s drifting, once a day.'],
                    ]}
                />
                <Callout tone="note" title="Can’t see">
                    If POWR hasn’t heard from someone’s phone for a week, or their phone is set so POWR can’t count
                    their visits, they may still be training. They’re shown apart under <b>Can’t see</b>, never counted
                    as drifting, never nudged and never in the morning email.
                </Callout>
                <P>
                    On Clash+, Retention needs at least five people before it shows anything, so nobody can be picked
                    out. Until then you’ll see <b>Not enough people yet</b>.
                </P>
            </Section>

            <Section id="list" title="Work the list">
                <P>
                    On Clash Pro, the list under the numbers names everyone, with tabs for <b>Drifting</b>,{' '}
                    <b>Slipping</b>, <b>Lapsed</b>, <b>New</b>, <b>On track</b>, <b>Can’t see</b> and{' '}
                    <b>Everyone</b>. It opens on whoever needs a word first. Each row says when they were last in and
                    what’s normal for them, for example “Last visit 16 days ago · Usually 2× a week, mornings · Mon
                    &amp; Thu”. With more than ten people, <b>Find someone</b> searches by name, username or POWR ID.
                </P>
                <Shot
                    id="gym-retention-list"
                    alt="The named list on Retention, open on the Drifting tab"
                    caption="The list, on Drifting"
                    notes={[
                        ['tabs', 'A tab for each status, with how many are in it.'],
                        ['find', 'Find someone by name, username or POWR ID.'],
                        ['line', 'When they were last in, and what’s normal for them.'],
                        ['chip', 'How long they’ve been quiet.'],
                        ['reached', 'The team’s last reach-out.'],
                    ]}
                />
                <Steps>
                    <Step n="1" title="Open their row">
                        You see their visits over the last 12 weeks, a week to a column, plus their <b>Last visit</b>,
                        visits in the <b>Last 4 weeks</b>, their <b>Usual gap</b> and when they count as{' '}
                        <b>Drifting after</b>. It also says whether they picked your gym in POWR, when they started
                        drifting, and whether they share all their training with you.
                    </Step>
                    <Step n="2" title="Reach out your way">
                        Call, text, email or catch them at the desk. POWR doesn’t contact them unless you send a nudge.
                    </Step>
                    <Step n="3" title="Log it">
                        Under <b>Log a reach-out</b>, pick <b>Called</b>, <b>Texted</b>, <b>Emailed</b>,{' '}
                        <b>In person</b> or <b>Other</b>, add a note for the team if you like (up to 280 characters)
                        and press <b>Log it</b>. It appears under <b>What the team did</b>, with who logged it.
                    </Step>
                </Steps>
                <Shot
                    id="gym-retention-person"
                    alt="One person’s row opened on Retention, with a call being logged"
                    caption="One person, opened"
                    notes={[
                        ['visits', 'Their visits over the last 12 weeks, a week to a column.'],
                        ['usual', 'Last visit, the last four weeks, their usual gap and when they count as drifting.'],
                        ['log', 'Log a reach-out: pick how, add a note, then Log it.'],
                        ['nudge', 'The nudge they’d get, word for word, and Send nudge.'],
                        ['team', 'What the team did, with who logged it.'],
                    ]}
                />
                <P>
                    Anyone on the team can remove their own notes. The owner can remove anyone’s. A POWR nudge stays
                    on the record. <b>Export</b> downloads the whole list as a CSV with each person’s status, last
                    visit, usual pattern, whether they picked your gym and the last reach-out.
                </P>
            </Section>

            <Section id="nudge" title="Send a nudge">
                <P>
                    A nudge is one push notification from POWR, in POWR’s words: your gym’s name with “your spot’s
                    still here”, then “It’s been 3 weeks. One check-in and you’re back on the board.” You see it on the
                    row before you send it. You can’t change the wording.
                </P>
                <Table
                    head={['From', 'Who gets it', 'How often']}
                    rows={[
                        ['Send nudge, on a person’s row', 'That person, if they’re slipping, drifting or lapsed', 'Once a fortnight per member. The row shows when they were last nudged'],
                        ['Nudge, in the Won back card', 'Everyone drifting who hasn’t had one in the last fortnight', 'Once a day for your gym'],
                    ]}
                />
                <P>
                    You’re asked to confirm before anything is sent. Nobody under <b>Can’t see</b> is nudged. Every
                    nudge is logged as a reach-out, so it counts in <b>Won back</b>.
                </P>
                <Shot
                    id="gym-retention-nudged"
                    alt="A person’s row after Send nudge"
                    caption="After a nudge"
                    notes={[
                        ['nudged', 'The row says when they were nudged. The next can go in a fortnight.'],
                        ['push', 'The nudge is on the record, as a reach-out.'],
                    ]}
                />
            </Section>

            <Section id="email" title="The morning email">
                <P>
                    On mornings when someone at your gym starts drifting, POWR emails your team. Clash Pro names them,
                    with when they usually come in. Clash+ gets the count, and nothing until at least five people count.
                    It’s never more than one email a day, and none on days when nobody new started drifting.
                </P>
                <P>
                    Each person on the team chooses for themselves. It’s on unless you switch it off: <b>Settings</b>{' '}
                    → <b>Email</b> → <b>When someone starts drifting</b>. See{' '}
                    <Link to="/docs/gyms/settings" className={L}>Settings &amp; team</Link>.
                </P>
            </Section>

            <Section id="wonback" title="Who came back">
                <P>
                    <b>Won back</b> counts the people you reached out to in the last 90 days, by any logged reach-out or a
                    nudge, and how many came back within two weeks. Once their two weeks are up it
                    shows the share who came back, and how many are still inside their two weeks. It fills up from
                    reach-outs and nudges, which are Clash Pro.
                </P>
            </Section>

            <Section id="faq" title="Common questions">
                <P>
                    <b>Why is someone I see every week not on the list?</b> They may have switched off{' '}
                    <b>Let gyms see my visits</b>. Anyone who does disappears from Retention.
                </P>
                <P>
                    <b>Why does Members say “What your members do anywhere appears at 5 members”?</b> Fewer than five
                    people chose your gym in the app. Share your join link or put the poster by the door.
                </P>
                <P>
                    <b>Someone trains here but isn’t in Members.</b> Members counts people who picked your gym in the
                    app. Anyone who trains here still counts in <b>Trained here</b> and in Retention, marked as not
                    having picked you.
                </P>
                <P>
                    <b>Nobody shares with us yet.</b> Sharing all their training is the member’s choice and starts
                    off. Their visits to your gym are still in Retention.
                </P>
                <P>
                    <b>The nudge button says they had one in the last fortnight.</b> Each member gets at most one
                    nudge every two weeks, from any part of the portal.
                </P>
                <P>
                    <b>“Already sent today”.</b> The nudge to everyone drifting goes once a day. It can go again
                    tomorrow, and you can still nudge one person from their row.
                </P>
                <P>
                    <b>Someone’s status looks wrong.</b> Retention only counts visits POWR recorded at your gym. Training
                    elsewhere doesn’t change it. If their phone hasn’t been heard from, they move to <b>Can’t see</b>{' '}
                    rather than drifting.
                </P>
            </Section>
        </DocsLayout>
    );
}
