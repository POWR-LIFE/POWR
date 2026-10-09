import React from 'react';
import { Link } from 'react-router-dom';
import { Callout, DocsLayout, P, Section, Shot, Step, Steps, Table } from '../docsShared';

// /docs/gyms/discounts: the gym portal's Discounts page (Partner discounts,
// Clash+ and up): buying prizes and kit at the POWR members' price, one code
// per brand when it's needed, and the event builder's optional partner code
// for everyone who takes part.

const TOC = [
    ['what', 'What this page is for'],
    ['unlock', 'Who gets it'],
    ['cards', 'Reading a discount'],
    ['get', 'Get a code and shop'],
    ['week', 'One code a week'],
    ['event', 'A partner code for your event'],
    ['faq', 'Common questions'],
];

const A = 'font-bold text-[#8a7600] hover:underline';

export default function GymDocsDiscounts() {
    return (
        <DocsLayout
            eyebrow="Gym guide · Discounts"
            title="Partner discounts"
            intro="Buy prizes and kit at the price POWR members pay. Every POWR partner brand is on one page with the discount our members get, and you take a code when you need one. This page covers what each card means, how codes work, and how to send everyone in an event a partner code of their own."
            toc={TOC}
            nextNote={{ label: 'Clash Nights', detail: 'Four POWR-run nights a year at your gym, booked from the portal.' }}
        >
            <Section id="what" title="What this page is for">
                <P>
                    <b>Discounts</b> in the portal sidebar opens <b>Partner discounts</b>. It lists the brands that
                    reward POWR members, each with the discount members get in the app. Your gym can use the same
                    discount for its own buying: prizes for your events, kit for the floor, anything the brand sells.
                </P>
                <Shot
                    id="gym-discounts-page"
                    alt="The Partner discounts page in the gym portal"
                    caption="Partner discounts"
                    notes={[
                        ['how', 'How it works: pick a brand, get your code, shop.'],
                        ['value', 'Each brand’s card, with the discount POWR members get.'],
                        ['badge', 'The badge says what you’ll get: a one-use code, a shared code or a link.'],
                        ['get', 'Get a code, or Get the link for a Link brand.'],
                        ['code', 'A code your gym has already taken this week.'],
                    ]}
                />
                <P>
                    A discount is for buying things. It is never a prize on its own. The prizes in your events are
                    yours to choose and hand out, and these codes simply make them cheaper to buy. If you want
                    members to get something from a brand too, see{' '}
                    <a href="#event" className={A}>A partner code for your event</a>.
                </P>
                <P>
                    On a phone, <b>Discounts</b> isn’t in the bottom tabs. Tap your gym’s logo at the top right to
                    open the menu, and it’s listed there.
                </P>
            </Section>

            <Section id="unlock" title="Who gets it">
                <P>
                    Partner discounts come with <b>Clash+</b> and every package above it: <b>Clash Pro</b> and{' '}
                    <b>Founding Pro</b>. It is open during your free trial too. On the free <b>Clash</b> package the
                    page shows <b>Partner discounts come with Clash+</b> and a <b>See packages</b> button, and the
                    sidebar item carries a small lock.
                </P>
                <P>
                    Anyone on your team can take a code, owner or not. To change package, open <b>Package</b> in the
                    portal; only an owner can ask to switch. See{' '}
                    <Link to="/docs/gyms/settings" className={A}>Settings &amp; team</Link> for roles.
                </P>
            </Section>

            <Section id="cards" title="Reading a discount">
                <P>
                    Each brand has a card: its picture and logo, the brand’s name, the discount in big type (for
                    example a percentage off), a line about the offer, and <b>Terms</b>, which you can open for the
                    small print. Brands with something to give right now come first.
                </P>
                <P>The badge on the picture tells you what you’ll get:</P>
                <Table
                    head={['Badge', 'What you get', 'Under the button']}
                    rows={[
                        ['One-use code', 'A code of your own from the brand’s pool, held for your gym. Use it once.', '“One use, held for your gym”, or “Only 12 left” when the brand is running low'],
                        ['Shared code', 'The same code POWR members use at that brand.', '“The code POWR members use”'],
                        ['Link', 'The brand’s POWR link. There’s no code: you shop through the link.', '“The brand’s POWR link”'],
                    ]}
                />
                <P>
                    A card that says <b>No codes left right now. Check back soon.</b> belongs to a brand whose pool
                    of one-use codes is empty. The brand tops it up, so look again later.
                </P>
                <Shot
                    id="gym-discounts-cards"
                    alt="Discount cards showing each badge and state"
                    caption="What a card can say"
                    notes={[
                        ['pool', 'One-use code: a code of your own from the brand’s pool.'],
                        ['link', 'Link: the brand’s POWR link. There’s no code.'],
                        ['shared', 'Shared code: the code POWR members use.'],
                        ['low', 'Only 12 left: the brand is running low.'],
                        ['none', 'No codes left right now: the brand tops its pool up, so look again later.'],
                    ]}
                />
            </Section>

            <Section id="get" title="Get a code and shop">
                <Steps>
                    <Step n="1" title="Pick a brand">
                        Open <b>Discounts</b> and find the brand you want to buy from. Open <b>Terms</b> first if
                        you need to know what the discount covers.
                    </Step>
                    <Step n="2" title="Get your code">
                        Press <b>Get a code</b> (or <b>Get the link</b> for a Link brand). It takes a moment and
                        shows <b>Getting it…</b> while it works. The card then shows a dark box headed{' '}
                        <b>Your code</b> or <b>Your link</b>.
                    </Step>
                    <Step n="3" title="Copy it">
                        Press the copy button beside the code. You’ll see <b>Copied</b>. If your browser won’t
                        copy, select the code and copy it by hand.
                    </Step>
                    <Step n="4" title="Shop">
                        Where the brand has a shop link, a <b>Shop at</b> button opens their shop in a new tab. Enter
                        the code at the brand’s checkout like any discount code. For a Link brand, shop through
                        the link whenever you buy from them.
                    </Step>
                </Steps>
                <Shot
                    id="gym-discounts-code"
                    alt="A discount card with the gym’s code showing"
                    caption="Your code"
                    notes={[
                        ['terms', 'Terms: the small print. Open it before you buy.'],
                        ['label', 'Your code, once you’ve pressed Get a code.'],
                        ['copy', 'The copy button. You’ll see Copied.'],
                        ['week', 'For a one-use code: held for your gym, and the date you can get a new one.'],
                        ['shop', 'Shop at opens the brand’s shop in a new tab.'],
                    ]}
                />
                <Callout tone="warn" title="Codes are for your gym’s own buying">
                    Members get their own codes in the POWR app, so please don’t pass these on, post them or hand
                    them to members. One-use codes in particular are held for your gym alone.
                </Callout>
            </Section>

            <Section id="week" title="One code a week">
                <P>
                    Your gym gets one code per brand, and the same code comes back for a week. Press the button again
                    during that week and you see the code you already have, not a new one. This keeps any one gym
                    from emptying a brand’s pool.
                </P>
                <P>
                    The code belongs to the gym, not to the person who took it. Anyone on your team who opens{' '}
                    <b>Discounts</b> that week sees the same code.
                </P>
                <Table
                    head={['Kind', 'What the box says', 'When you can get another']}
                    rows={[
                        ['One-use code', '“Held for your gym. A new one from” a date', 'From the date shown: a week after you took it, or sooner if the code expires first'],
                        ['Shared code', '“The same code POWR members use.”', 'A week after you took it'],
                        ['Link', '“Shop through it whenever you buy from them.”', 'A week after you took it'],
                    ]}
                />
                <P>
                    Once the week is up, the button comes back. If your last one-use code hasn’t expired, the card
                    reminds you of it: <b>Your last code … works until</b> a date <b>if it’s unused</b>. So an
                    unspent code is still worth using before you take a new one.
                </P>
                <Shot
                    id="gym-discounts-lastcode"
                    alt="A discount card a week after the gym took its code"
                    caption="A week later"
                    notes={[
                        ['get', 'The week is up, so the button is back.'],
                        ['last', 'Your last code still works until the date shown, if it’s unused.'],
                    ]}
                />
            </Section>

            <Section id="event" title="A partner code for your event">
                <P>
                    Separately from your own buying, an event can send everyone who takes part a partner brand’s
                    code. It is optional and off unless you switch it on. You set it in the event builder, on the{' '}
                    <b>Prizes</b> step, under <b>A partner code for everyone who takes part</b>.
                </P>
                <Steps>
                    <Step n="1" title="Switch it on">
                        On the <b>Prizes</b> step, turn on <b>A partner code for everyone who takes part</b>.
                    </Step>
                    <Step n="2" title="Pick the brand">
                        Choose one brand from the list. Only brands with codes to give appear: each shows{' '}
                        <b>One code for everyone</b> (a shared code) or how many codes it has left. Link brands
                        can’t be picked, as there’s no code to send.
                    </Step>
                    <Step n="3" title="Tell members it’s coming">
                        Say so in your event’s headline, so members know a code is part of taking part.
                    </Step>
                </Steps>
                <P>
                    When you reveal the winners, everyone still in the event with points gets one code from that
                    brand in their <b>Wallet</b> in the app, and the results notification names the brand. It is
                    one code each, and it costs them no POWR. If the brand’s codes run short, the top of the board
                    get theirs first. A brand’s own limit per person still applies, so someone who has already had
                    as many as the brand allows won’t get another.
                </P>
                <Callout tone="note" title="You can change it while the event runs">
                    The partner code is one of the few things you can still change once an event has started,
                    because it only goes out at the reveal. Once the board has sealed, it can’t change. The full
                    event flow is in the <Link to="/docs/gyms/events" className="underline font-bold">Events guide</Link>.
                </Callout>
            </Section>

            <Section id="faq" title="Common questions">
                <P>
                    <b>The page says “Partner discounts come with Clash+”.</b> Your gym is on the free Clash
                    package. Open <b>Package</b> to see what each package includes. An owner can ask to switch from
                    there.
                </P>
                <P>
                    <b>It says “No partner discounts right now”.</b> No brand has a live discount at the moment. New
                    brands join POWR all the time, so check back soon.
                </P>
                <P>
                    <b>I pressed Get a code and got “No codes left for that brand right now”.</b> The brand’s pool
                    ran out between the page loading and your tap. Try again later, or pick another brand.
                </P>
                <P>
                    <b>I got “That discount isn’t available right now”.</b> The brand has taken that discount down.
                    Reload the page to see the current list.
                </P>
                <P>
                    <b>I got “That brand’s link isn’t set up yet”.</b> A Link brand hasn’t finished setting up its
                    link. Try again another day.
                </P>
                <P>
                    <b>I pressed the button again and got the same code.</b> That’s expected. Your gym gets one code
                    per brand per week. See <a href="#week" className={A}>One code a week</a>.
                </P>
                <P>
                    <b>I need another code before the week is up.</b> Email{' '}
                    <a href="mailto:support@powr.life" className={A}>support@powr.life</a> and tell us which brand.
                </P>
                <P>
                    <b>Can I give a discount code as an event prize?</b> No. A discount is for buying the prize, not
                    the prize itself. To give every participant something from a brand, use{' '}
                    <a href="#event" className={A}>a partner code for your event</a>.
                </P>
                <P>
                    <b>The page says “Couldn’t load the discounts”.</b> Press <b>Try again</b>. If it keeps failing,
                    ask us from <b>Settings</b> → <b>Help</b>.
                </P>
            </Section>
        </DocsLayout>
    );
}
