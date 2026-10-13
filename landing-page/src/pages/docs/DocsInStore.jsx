import React from 'react';
import { Link } from 'react-router-dom';
import { Callout, DocsLayout, P, Section, Shot, Step, Steps, Table } from './docsShared';

// /docs/in-store: taking POWR rewards at a physical till. Public like the
// other partner guides; the portal's In Store page only appears once POWR
// switches it on for a brand (system_config partner_in_store_enabled), which
// the rollout callout says.

const TOC = [
    ['how', 'How it works for members'],
    ['methods', 'Choose how your shop checks it'],
    ['setup', 'Set a reward up for in store'],
    ['shops', 'Add your shops'],
    ['stands', 'Print your counter stand'],
    ['staff', 'Give your staff a scan link'],
    ['scan', 'Scanning at the till'],
    ['kiosk', 'A tablet at the till'],
    ['barcodes', 'Till barcodes for chains'],
    ['report', 'Your in-store figures'],
    ['api', 'For developers'],
    ['faq', 'Common questions'],
];

const A = 'font-bold text-[#8a7600] hover:underline';
const C = ({ children }) => <code className="font-mono">{children}</code>;

export default function DocsInStore() {
    return (
        <DocsLayout
            eyebrow="Partner guide · In store"
            title="Take POWR rewards at your till"
            intro="Members claim your reward with the points they earned, then show a live voucher at your counter. It changes every few seconds, so a screenshot won’t pass, and your staff confirm it with a scan. This guide covers setting up your shops and staff, what happens at the till, and how to read the results."
            toc={TOC}
            nextNote={{ label: 'Redemptions', detail: 'Every claim of your rewards, online and in store, in one place.' }}
        >
            <Callout tone="note" title="Rolling out">
                In store is opening to brands shop by shop. If you don’t see <b>In Store</b> in your portal’s
                menu yet, ask the POWR team to switch it on for you.
            </Callout>

            <Section id="how" title="How it works for members">
                <Steps>
                    <Step n="1" title="They claim the reward">
                        Exactly as today: they spend their points in the POWR app and the reward lands in their wallet.
                    </Step>
                    <Step n="2" title="They open it at your till">
                        At the counter they tap <b>Use in store</b>. A live voucher opens with their name, a QR code and a
                        6-character code, both changing every 10 seconds, plus a countdown and a ticking clock.
                    </Step>
                    <Step n="3" title="Your staff confirm it">
                        Staff scan the QR (or type the code) on <b>powr.life/scan</b>, apply your discount, and the
                        member’s phone switches to <b>Confirmed</b> on its own.
                    </Step>
                </Steps>
                <P>
                    Opening a voucher never uses the reward up. It stays open for a few minutes (5 by default); if time
                    runs out, the member simply opens it again. Only a staff scan, a staff swipe or your till scanning
                    your own barcode counts as using it.
                </P>
            </Section>

            <Section id="methods" title="Choose how your shop checks it">
                <Table
                    head={['Method', 'At the till', 'Your figures show']}
                    rows={[
                        ['Staff scan (recommended)', 'Staff scan the voucher on powr.life/scan, from any phone or a tablet at the till.', 'Confirmed, with who scanned it, the shop and the spend if staff add it.'],
                        ['Look at the screen', 'Staff check the live voucher is moving and swipe it on the member’s phone. Nothing to set up.', 'Swiped, not confirmed. You can see it was shown, but not that the discount was given.'],
                        ['Till barcode', 'The member shows one of your own barcodes and your till scans it like any coupon. Made for chains.', 'Confirmed once you send us the used codes from your till report.'],
                    ]}
                />
            </Section>

            <Section id="setup" title="Set a reward up for in store">
                <P>
                    In the portal go to <b>In Store → Rewards</b> and open a reward. Choose where members can use it
                    (online, in store or both) and how your shop checks it. Changes apply straight away; they don’t go
                    through review. A brand-new reward can also be sent in with <b>In store</b> as its delivery from{' '}
                    <Link to="/docs/rewards" className={A}>My Rewards</Link>.
                </P>
                <Shot
                    id="partner-instore-reward"
                    alt="A reward's in-store settings in the partner portal"
                    caption="In Store › Rewards"
                    notes={[
                        ['where', 'Online, In store, or Both: one reward, used either way.'],
                        ['how', 'How your shop checks the voucher. The footer says what your figures will show.'],
                        ['stand', 'Optionally make members scan your counter stand before the voucher opens.'],
                        ['spend', 'Let staff type what the member spent, so you can see what the offer brings in.'],
                        ['shops', 'Every shop, or only some.'],
                        ['member', 'What the member and your staff will do, updated as you choose.'],
                    ]}
                />
                <Callout tone="warn" title="Switching a live reward to in store only">
                    Members stop receiving a code for it and show a live voucher instead. Codes already claimed keep
                    working.
                </Callout>
            </Section>

            <Section id="shops" title="Add your shops">
                <P>
                    <b>In Store → Sites → Add a shop</b>. Give it a name and address and put the pin on the map: search
                    for it, click the map, paste a Google Maps link, or press <b>I’m in the shop now</b> on a phone at the
                    counter. Members see your shops in their wallet, nearest first, with “you’re here” when they’re inside.
                </P>
                <Shot
                    id="partner-instore-sites"
                    alt="The Sites tab with three shops"
                    caption="In Store › Sites"
                    notes={[
                        ['nav', 'In Store appears in your menu once it’s switched on for you.'],
                        ['add', 'Add a shop.'],
                        ['scanned', 'When staff last scanned a voucher here.'],
                        ['pin', 'How close counts as “in the shop” for this site.'],
                        ['stand', 'Print this shop’s counter stand.'],
                        ['swipes', 'Vouchers are being swiped here but nobody is scanning: check the scan page is open at the till.'],
                    ]}
                />
            </Section>

            <Section id="stands" title="Print your counter stand">
                <P>
                    Every shop gets its own A5 stand with a QR code. <b>Print stand</b> opens it ready to print; thick
                    card works best. If a reward asks members to scan your stand first, the voucher only opens after
                    they scan it, which shows they’re in the shop.
                </P>
                <P>
                    Lost a stand, or think it’s been copied? <b>New stand</b> makes a fresh code and the old printout
                    stops working, so print the new one straight away.
                </P>
            </Section>

            <Section id="staff" title="Give your staff a scan link">
                <P>
                    Staff don’t need a POWR account. In <b>In Store → Staff</b>, add someone’s name and usual shop and
                    press <b>Make scan link</b>. Send them the link; they open it once on their phone and it remembers
                    them. A scan link can only check and confirm vouchers: no figures, no settings.
                </P>
                <Shot
                    id="partner-instore-staff"
                    alt="Making a scan link for a member of staff"
                    caption="In Store › Staff"
                    notes={[
                        ['make', 'Name and usual shop, then make the link.'],
                        ['link', 'The link is shown once. Copy it and send it to them.'],
                        ['list', 'Everyone with a link, their shop and their last scan.'],
                        ['notOpened', 'They haven’t opened their link yet.'],
                    ]}
                />
                <Callout tone="note" title="Lost phone, or someone leaves">
                    <b>New link</b> replaces their link and the old one stops working. <b>Remove</b> ends it for good.
                    Anyone signed in to your partner portal can always scan too.
                </Callout>
            </Section>

            <Section id="scan" title="Scanning at the till">
                <P>
                    On <b>powr.life/scan</b>, point the camera at the member’s voucher. If the camera won’t read it, type
                    the 6-character code under the QR. Then apply your discount and press <b>Confirm</b>.
                </P>
                <Shot
                    id="instore-scan-valid"
                    alt="The scan page showing a valid voucher"
                    caption="powr.life/scan"
                    notes={[
                        ['who', 'Your brand, and whose link this is.'],
                        ['valid', 'Valid: apply the discount.'],
                        ['closes', 'Who the member is and how long their voucher stays open.'],
                        ['spend', 'Optional: what they spent.'],
                        ['confirm', 'Confirm. Nothing is used up until you press it.'],
                    ]}
                />
                <Table
                    head={['The page says', 'What to do']}
                    rows={[
                        ['Valid', 'Apply the discount, add the spend if you like, and confirm.'],
                        ['Already used', 'Don’t apply the discount. It shows where and when it was used.'],
                        ['Old code', 'That code is over a minute old, usually a screenshot. Ask for the live voucher in the POWR app.'],
                        ['Voucher closed', 'Its time ran out. The member taps Use in store again for a fresh one.'],
                        ['Not one of your rewards', 'It’s for another shop. Don’t apply a discount.'],
                        ['No match', 'Check the 6-character code on their phone, or scan the QR instead.'],
                    ]}
                />
            </Section>

            <Section id="kiosk" title="A tablet at the till">
                <P>
                    Open the scan page on a tablet and tap the screen icon for <b>kiosk mode</b>. It does two jobs: it
                    shows your stand’s QR (changing every 30 seconds) for members to scan, and it scans vouchers with the
                    front camera. It keeps the screen on and shows today’s tally.
                </P>
                <Shot
                    id="instore-kiosk"
                    alt="The scan page in kiosk mode on a tablet"
                    caption="Kiosk mode"
                    notes={[
                        ['tabs', 'Switch between showing your stand and scanning a member.'],
                        ['qr', 'Your stand, on screen. It can’t be photographed and reused.'],
                        ['timer', 'When the code changes next.'],
                        ['today', 'Today at this shop: confirmed visits, spend and the latest activity.'],
                    ]}
                />
            </Section>

            <Section id="barcodes" title="Till barcodes for chains">
                <P>
                    If your tills already take coupon barcodes, members can show one of yours instead of a POWR voucher.
                    The codes must be ones <b>your till already recognises</b>: POWR draws the barcode on the member’s
                    phone from the code, in the format you pick (EAN-13, Code 128 or QR), but your till decides whether
                    it’s valid.
                </P>
                <Steps>
                    <Step n="1" title="Create the codes in your till or promotions system">
                        A batch of single-use coupon codes, as you would for any campaign.
                    </Step>
                    <Step n="2" title="Give them to POWR">
                        Upload them in <Link to="/docs/promo-codes" className={A}>Promo Codes</Link>, push them with the{' '}
                        <Link to="/docs/api" className={A}>API</Link> (<C>POST /v1/codes</C>), or have your system create
                        one for each claim. POWR hands one to each member who claims.
                    </Step>
                    <Step n="3" title="Tell us which were used">
                        Upload the used codes from your till report in <b>Promo Codes → Reconcile</b>, or send them to{' '}
                        <C>POST /v1/reconcile</C>. Your figures then show them as confirmed.
                    </Step>
                </Steps>
                <Callout tone="warn" title="Codes POWR generates">
                    Promo Codes can generate a batch for you, but a till only accepts it if you load the same list into
                    your till system. For EAN-13, use your own codes.
                </Callout>
            </Section>

            <Section id="report" title="Your in-store figures">
                <P>
                    <Link to="/docs/redemptions" className={A}>Redemptions</Link> gets an <b>In store</b> section as soon
                    as members start using your rewards at the till. It counts each claimed reward once, however many
                    times the voucher was opened.
                </P>
                <Shot
                    id="partner-redemptions-instore"
                    alt="The in-store section of the Redemptions page"
                    caption="Redemptions › In store"
                    notes={[
                        ['opened', 'Rewards members opened at one of your tills.'],
                        ['confirmed', 'Scanned by your staff (or confirmed from your till report).'],
                        ['swiped', 'Swiped on the member’s phone: shown, but not confirmed by your till.'],
                        ['spend', 'What members spent, where staff added it.'],
                        ['bar', 'What happened to every opened voucher. Hover for the numbers.'],
                        ['shops', 'The same, shop by shop.'],
                        ['latest', 'The newest visits: member, reward, shop, who confirmed it and the spend.'],
                    ]}
                />
                <P>
                    <b>Confirmed</b> and <b>swiped</b> are kept apart on purpose: a swipe means the member showed the
                    voucher and staff swiped it on their phone, but nothing on your side recorded it. If one shop has
                    lots of swipes and few scans, the scan page probably isn’t open at that till.
                </P>
            </Section>

            <Section id="api" title="For developers">
                <P>
                    In-store vouchers have no code, so your system hears about them through two webhook events:{' '}
                    <C>voucher.confirmed</C> when your staff scan one, and <C>voucher.swiped</C> when it’s swiped
                    instead. Each carries the reward, the shop, the time, who confirmed it and the spend. Subscribe
                    to them when you add a webhook endpoint. For rewards that also have a code (online and in store), a
                    staff scan marks the code used too, so <C>code.used</C> fires as well. Field lists are in the{' '}
                    <Link to="/docs/api#webhooks" className={A}>API guide</Link>.
                </P>
            </Section>

            <Section id="faq" title="Common questions">
                <Table
                    head={['Question', 'Answer']}
                    rows={[
                        ['Can a member use a screenshot?', 'No. The QR and the 6-character code change every 10 seconds, and the scan page rejects codes over a minute old.'],
                        ['What if their phone dies at the till?', 'Nothing is used up until staff confirm. They can open it again once their phone is back on.'],
                        ['Can I limit a reward to some shops?', 'Yes, in the reward’s Which shops. Members only see those shops, and stands from other shops won’t open it.'],
                        ['Does the scan page work offline?', 'No, it needs an internet connection to check each voucher.'],
                        ['Do my staff see members’ details?', 'Only a first name and initial, like “Grace L.”, so they can tell it’s the right person.'],
                    ]}
                />
            </Section>
        </DocsLayout>
    );
}
