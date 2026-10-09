import React from 'react';
import { Link } from 'react-router-dom';
import { Callout, DocsLayout, P, PLACEMENTS_LIVE, Section, Shot, Step, Steps, Table } from './docsShared';

// /docs/rewards: the My Rewards page, from first submission to taking a reward
// down. Code delivery lives on /docs, /docs/promo-codes, /docs/shopify and
// /docs/api, so this page only points at them.

const TOC = [
    ['page', 'What My Rewards is for'],
    ['submit', 'Submit a reward'],
    ['offer', 'Step 1 · The Offer'],
    ['details', 'Step 2 · Details'],
    ['delivery', 'Step 3 · Delivery'],
    ['imagery', 'Step 4 · Imagery'],
    ['send', 'Step 5 · Review and send'],
    ['review', 'What POWR reviews'],
    ['live', 'From approved to live'],
    ['edit', 'Change a live reward'],
    ['pause', 'Pause or end a reward'],
    ['preview', 'How members see it'],
    ['limit', 'Your reward limit'],
    ['invite', 'Submitting from a private link'],
    ['faq', 'Common questions'],
];

const A = 'font-bold text-[#8a7600] hover:underline';

export default function DocsRewards() {
    return (
        <DocsLayout
            eyebrow="Partner guide · Rewards"
            title="Put a reward in front of members"
            intro="Everything about your rewards in one place: building one in the portal, what POWR checks before it goes live, changing it later and taking it down. You do all of it from My Rewards."
            toc={TOC}
            nextNote={{ label: 'How codes flow', detail: 'Your reward is approved. Next, decide how each member gets a code.' }}
        >
            <Section id="page" title="What My Rewards is for">
                <P>
                    <b>My Rewards</b> has two tabs. <b>Live Rewards</b> lists every reward POWR has approved, with its
                    points <b>Cost</b> and a <b>Status</b> of <b>Live</b> (members can claim it now) or <b>Inactive</b>{' '}
                    (switched off). <b>Submissions</b> holds everything you’ve sent POWR or are still writing: new
                    rewards, and changes to rewards that are already approved.
                </P>
                <Shot
                    id="partner-rewards-page"
                    alt="My Rewards on the Live Rewards tab, with the phone preview beside the list"
                    caption="My Rewards"
                    notes={[
                        ['tabs', 'Live Rewards and Submissions, with how many each holds.'],
                        ['submit', 'Submit Reward starts a new one. Beside it, how many of your reward slots are in use.'],
                        ['cost', 'Cost is the points price POWR set. Status is Live (members can claim it now) or Inactive.'],
                        ['actions', 'Make a post opens Studio. Update in review means a change is with POWR; otherwise this reads Edit Listing.'],
                        ['phone', 'The reward you clicked, as members see it in the app.'],
                    ]}
                />
                <P>
                    On a wide screen a phone sits beside the list. Click any row and it shows that reward the way
                    members see it in the app. While you fill in the form, it updates as you type.
                </P>
                <Callout tone="note" title="Two things this page doesn’t do">
                    You never set the points price: POWR sets it when it approves your reward. And this page decides
                    what members get, not where the codes come from. That’s your delivery method, covered in{' '}
                    <Link to="/docs" className={A}>How codes flow</Link>.
                </Callout>
            </Section>

            <Section id="submit" title="Submit a reward">
                <Steps>
                    <Step n="1" title="Start a new reward">
                        Open <b>My Rewards</b> and hit <b>Submit Reward</b>. If the button reads <b>Request More</b>,
                        you’ve reached your limit: see <a href="#limit" className={A}>Your reward limit</a>.
                    </Step>
                    <Step n="2" title="Work through the five steps">
                        The form opens on <b>Submit a Reward</b> with a rail across the top: <b>The Offer</b>,{' '}
                        <b>Details</b>, <b>Delivery</b>, <b>Imagery</b> and <b>Review</b>. Each is explained below.
                    </Step>
                    <Step n="3" title="Move on with Save & continue">
                        <b>Save &amp; continue →</b> checks the step you’re on and saves a draft. If something’s missing,
                        the field turns red and says what it needs. <b>Save draft</b> saves without checking. A green
                        “Saved” time appears under the title each time.
                    </Step>
                    <Step n="4" title="Send it to POWR">
                        On <b>Review</b>, hit <b>Submit for Review</b>. Once a draft is saved (every <b>Save &amp;
                        continue</b> saves one), the button reads <b>Update Submission</b> instead and the message says
                        “Submission updated”: it sends it to POWR all the same. The submission moves to <b>Review</b> on
                        the <b>Submissions</b> tab.
                    </Step>
                </Steps>
                <Callout tone="good" title="Nothing is lost if you stop halfway">
                    The first save creates a <b>Draft</b> on the <b>Submissions</b> tab. Come back any time and hit{' '}
                    <b>Continue</b>. Steps in the rail stay clickable, so you can fill them in any order. A green tick
                    marks a step that’s complete.
                </Callout>
            </Section>

            <Section id="offer" title="Step 1 · The Offer">
                <Table
                    head={['Field', 'What to enter']}
                    rows={[
                        ['Reward Title', 'The headline on the card. Up to 60 characters, for example “30% off your first order”.'],
                        ['Short Description', 'The line under the title. Up to 80 characters, for example “Your Brand · Any product”.'],
                        ['Value type', '% off, £ off or Custom text. % off and £ off ask for a number above 0 (Percent off or Amount off £). Custom text asks for a Value label such as “£20 value”.'],
                        ['Sector', 'Eat, Move, Mind or Sleep: the sector members find it under.'],
                        ['Reward type', 'Digital code or Physical item. Physical item changes what the Delivery step asks for.'],
                    ]}
                />
                <P>All five are required.</P>
                <Shot
                    id="partner-rewards-step-offer"
                    alt="Step 1 of Submit a Reward, The Offer, filled in"
                    caption="Step 1 · The Offer"
                    notes={[
                        ['rail', 'The rail: one step at a time. Click any step to jump to it.'],
                        ['title', 'Reward Title and Short Description: the card’s headline and the line under it.'],
                        ['value', 'Value type, then the number, or a Value label for Custom text.'],
                        ['sector', 'Sector: where members find it in the app.'],
                        ['kind', 'Reward type: Physical item changes what Delivery asks for.'],
                        ['next', 'Save & continue checks this step and saves a draft.'],
                    ]}
                />
            </Section>

            <Section id="details" title="Step 2 · Details">
                <Table
                    head={['Field', 'What to enter']}
                    rows={[
                        ['Offer detail', 'Required. Shown when a member opens the card. Spell out the deal, for example “Get 30% off any single order. New customers only.”'],
                        ['About your brand', 'Required. A short line about who you are. It starts filled in with your brand name.'],
                        ['Terms & conditions', 'Required. For example “One use per member. Cannot be combined with other offers.” Members also get them in their receipt email.'],
                        ['Website URL', 'Optional. Your shop. On a code reward, it’s where the shop button in the member’s wallet and receipt email takes them.'],
                    ]}
                />
            </Section>

            <Section id="delivery" title="Step 3 · Delivery">
                <P>For a <b>Digital code</b>, choose how members redeem under <b>Member redemption</b>:</P>
                <Table
                    head={['Option', 'What members get', 'What it asks for']}
                    rows={[
                        ['Unique code', 'Their own code, one per claim, shaped POWR-YOURNAME-A1B2C3.', 'Code name: your brand segment in the middle of every code. Letters and numbers only, 2 to 8 characters.'],
                        ['Shared link', 'No code. They tap through to your destination.', 'Affiliate destination URL.'],
                    ]}
                />
                <P>
                    For a <b>Physical item</b> there’s no code to choose. Fill in <b>Fulfilment plan</b>: what happens
                    after a member claims, delivery timing and anything your team needs to know.
                </P>
                <P>
                    Every reward also has two optional limits. <b>Inventory limit</b> is the total you want to offer,
                    and <b>Claims per member</b> is how many times one member can claim it (at least 1). Leave either
                    blank for <b>Unlimited</b>.
                </P>
                <Shot
                    id="partner-rewards-step-delivery"
                    alt="Step 3 of Submit a Reward, Delivery, with Unique code chosen"
                    caption="Step 3 · Delivery"
                    notes={[
                        ['unique', 'Unique code: each member gets their own code.'],
                        ['link', 'Shared link: no code, members tap through to your link.'],
                        ['name', 'Code name: your brand segment, 2 to 8 letters or numbers.'],
                        ['receive', 'How every member’s code will look.'],
                        ['stock', 'Inventory limit: the total on offer. Blank means Unlimited.'],
                        ['per', 'Claims per member: how many times one member can claim it.'],
                    ]}
                />
                <Callout tone="note" title="Two boxes, one link">
                    <b>Website URL</b> on Details and <b>Affiliate destination URL</b> here are the same field. Type
                    in one and the other changes too.
                </Callout>
                <Callout tone="note" title="Where unique codes come from">
                    Choosing <b>Unique code</b> says what members get. Whether the codes are ones you upload, minted by
                    your Shopify store or minted by your own system is set separately: see{' '}
                    <Link to="/docs/promo-codes" className={A}>Promo Codes</Link>,{' '}
                    <Link to="/docs/shopify" className={A}>Shopify</Link> and{' '}
                    <Link to="/docs/api" className={A}>API</Link>. Whichever you use, the codes on hand are the real
                    ceiling: when none are left, members see the reward as temporarily unavailable.
                </Callout>
            </Section>

            <Section id="imagery" title="Step 4 · Imagery">
                <Table
                    head={['Item', 'Spec']}
                    rows={[
                        ['Logo / brand mark', 'Required. Square, at least 512×512px, under 5 MB.'],
                        ['Hero / banner', 'Required. Landscape 16:9, at least 1200×675px, under 5 MB.'],
                        ['Hero video', 'Optional. Plays instead of the hero image, which stays as the still fallback. Upload an MP4, MOV or WebM up to 50 MB, or paste a direct link to a video file (.mp4, .m3u8 or .webm). Remove video takes it off.'],
                    ]}
                />
                <Shot
                    id="partner-rewards-step-imagery"
                    alt="Step 4 of Submit a Reward, Imagery, with a logo and a hero uploaded"
                    caption="Step 4 · Imagery"
                    notes={[
                        ['logo', 'Logo: square, at least 512×512px. Click the box to upload.'],
                        ['hero', 'Hero: landscape 16:9, at least 1200×675px.'],
                        ['video', 'Hero video: optional, plays instead of the hero.'],
                        ['paste', 'Or paste a direct link to a video file.'],
                    ]}
                />
                <P>
                    A link to a video-sharing page is refused: it’s a web page, not a video file, so it can’t play
                    behind the card. A link that doesn’t end in a video file type is saved with a warning. If it turns
                    out not to be a file, members just see the hero image.
                </P>
                <P>The save and submit buttons are greyed out while an image or video is still uploading.</P>
            </Section>

            <Section id="send" title="Step 5 · Review and send">
                <P>
                    <b>Review</b> lists everything on one screen: title, description, value, sector, reward type, offer
                    detail, about your brand, terms, website, delivery and imagery. Click any step in the rail to fix
                    something, then hit <b>Submit for Review</b> (<b>Update Submission</b> once a draft is saved).
                </P>
                <Shot
                    id="partner-rewards-step-review"
                    alt="Step 5 of Submit a Reward, Review, listing every answer"
                    caption="Step 5 · Review"
                    notes={[
                        ['rail', 'A green tick on every finished step. Click one to fix it.'],
                        ['list', 'Everything you entered, on one screen.'],
                        ['draft', 'Save draft keeps it on Submissions without sending it.'],
                        ['send', 'Submit for Review sends it to POWR. After a save it reads Update Submission and does the same.'],
                    ]}
                />
                <P>
                    If anything required is still missing, the portal says “A few fields still need attention”, jumps
                    to the first step with a gap and highlights it.
                </P>
            </Section>

            <Section id="review" title="What POWR reviews">
                <P>
                    Every new reward, and every change to an approved one, is checked by the POWR team before members
                    see it. They review the listing and set the points price. Review usually takes about a day.
                </P>
                <Table
                    head={['Status on Submissions', 'What it means', 'What you can do']}
                    rows={[
                        ['Draft', 'Saved, not sent yet.', 'Continue, finish it and send it.'],
                        ['Review', 'With POWR.', 'Edit. Your changes save into the same submission and it stays in review.'],
                        ['Approved', 'Accepted. A new reward now appears on Live Rewards.', 'Manage it from Live Rewards.'],
                        ['Needs changes', 'Sent back. POWR’s note shows under the status as Feedback.', 'Revise, fix what the note asks, then Resubmit for Review.'],
                    ]}
                />
                <Shot
                    id="partner-rewards-submissions"
                    alt="The Submissions tab with a draft, a listing update in review, a reward sent back and an approved reward"
                    caption="The Submissions tab"
                    notes={[
                        ['draft', 'Draft: saved, not sent. Continue picks up where you stopped.'],
                        ['review', 'Review: with POWR. Edit saves into the same submission.'],
                        ['update', 'Listing update: a change to a reward that’s already approved.'],
                        ['changes', 'Needs changes: POWR’s note shows underneath as Feedback.'],
                        ['revise', 'Revise, fix what the note asks, then resubmit.'],
                        ['approved', 'Approved: the reward is on Live Rewards.'],
                    ]}
                />
                <P>
                    <b>How you’ll know.</b> The status changes on the <b>Submissions</b> tab, and while nothing is
                    live, <b>Overview</b> leads with it. POWR never sends a reward back without a note saying why.
                </P>
            </Section>

            <Section id="live" title="From approved to live">
                <P>
                    Approval doesn’t switch a reward on. It appears on <b>Live Rewards</b> with its points cost and the
                    status <b>Inactive</b>. POWR switches it to <b>Live</b> once codes can reach members, so the next
                    move is yours: choose a delivery method under <b>Integration</b> and finish setting it up. Start
                    with <Link to="/docs" className={A}>How codes flow</Link>.
                </P>
                <P>
                    Each approved reward has a <b>Make a post</b> button, which opens{' '}
                    <Link to="/docs/studio" className={A}>Studio</Link> on that reward.
                </P>
            </Section>

            <Section id="edit" title="Change a live reward">
                <Steps>
                    <Step n="1" title="Open the listing">
                        On <b>Live Rewards</b>, hit <b>Edit Listing</b>. The form opens as <b>Edit Listing</b>, filled
                        in with what members see today.
                    </Step>
                    <Step n="2" title="Make your changes">
                        Every step works the same as for a new reward.
                    </Step>
                    <Step n="3" title="Submit them">
                        On <b>Review</b>, hit <b>Submit Changes</b>. You’ll see “Changes submitted”, and they go live
                        once POWR approves them.
                    </Step>
                </Steps>
                <P>
                    Your live listing stays exactly as it is until then, so members keep seeing and claiming the
                    current version. The reward shows <b>Update in review</b> in place of <b>Edit Listing</b>, and the
                    change sits on <b>Submissions</b> tagged <b>Listing update</b>. One change per reward can be in
                    review at a time; you can still <b>Edit</b> it from the Submissions tab.
                </P>
                <P>
                    On approval, POWR applies your new copy, value, sector, reward type, website or link, delivery
                    choice, limits and imagery. POWR may adjust the points price at the same time; otherwise it stays
                    as it is. A listing update never counts towards your reward limit.
                </P>
                <Callout tone="warn" title="What an edit doesn’t change">
                    Codes members already hold stay as they are. Your code name isn’t changed by an edit either: if you
                    need a new one, ask from <b>Support</b>.
                </Callout>
            </Section>

            <Section id="pause" title="Pause or end a reward">
                <P>
                    There’s no on/off switch for brands. POWR switches rewards on and off. To pause or end one, open{' '}
                    <b>Support</b>, choose <b>Rewards &amp; Codes</b>, and say which reward and from when. The team
                    replies within one business day.
                </P>
                <P>
                    Once it’s off, its status reads <b>Inactive</b> and members who try to claim it are told it’s no
                    longer available. Members who already claimed keep their code in their wallet until it expires.
                </P>
                <Callout tone="note" title="Need new claims to stop right now?">
                    On a unique-code reward using Promo Codes, you can switch unclaimed codes to expired yourself: see
                    “Managing the pool” in the <Link to="/docs/promo-codes" className={A}>Promo Codes guide</Link>.
                    With none left to hand out, members can’t claim it.
                </Callout>
                <P>An <b>Inactive</b> reward still counts towards your reward limit. If you need the slot back, say so in the same request.</P>
            </Section>

            <Section id="preview" title="How members see it">
                <P>
                    The phone beside the list is a true-to-scale render of the POWR app. Two buttons above it switch
                    views. <b>Rewards screen</b> shows your card in the rewards list: tap it to open the hero, value,
                    about line, offer detail and redeem button. <b>Redeem screen</b> shows what a member sees after
                    claiming: your logo and hero, a sample code with your code name, and a <b>Use code at</b> button.
                </P>
                <P>
                    The points figure is a placeholder until POWR sets the price, and the other cards and the balance
                    are samples. The preview only shows on wider screens.
                </P>
                <Shot
                    id="partner-rewards-preview-redeem"
                    alt="The phone preview on the Redeem screen"
                    caption="The Redeem screen"
                    notes={[
                        ['toggle', 'Switch between the Rewards screen and the Redeem screen.'],
                        ['code', 'A sample code with your code name in the middle.'],
                        ['shop', 'Use code at your brand: the button to your shop.'],
                    ]}
                />
            </Section>

            <Section id="limit" title="Your reward limit">
                <P>
                    Each brand can have a set number of rewards live or in review at once. Unless POWR has changed it
                    for you, that’s two. The counter by the button reads, for example, <b>2/2 rewards · limit reached</b>.
                    It counts every reward on Live Rewards (Inactive ones too) plus new rewards in Review. Drafts,
                    listing updates and rewards sent back for changes don’t count.
                </P>
                <P>
                    At the limit, the button becomes <b>Request More</b>. It opens <b>Reward limit reached</b>: add a
                    note under <b>Anything we should know?</b> if you like and hit <b>Get in touch</b>. The request
                    shows on your <b>Support</b> page, where the reply arrives.
                </P>
                <Shot
                    id="partner-rewards-limit"
                    alt="The Reward limit reached window with a note filled in"
                    caption="Reward limit reached"
                    notes={[
                        ['cap', 'Opens from Request More, with your limit.'],
                        ['note', 'Anything we should know? is optional.'],
                        ['send', 'Get in touch sends the request to POWR.'],
                    ]}
                />
            </Section>

            <Section id="invite" title="Submitting from a private link">
                <P>
                    Before a brand has a portal login, POWR may send a private link to submit a reward. It opens one
                    page, <b>Add your reward to POWR</b>, with a live preview beside the form. The sections are{' '}
                    <b>Your Brand</b> (brand name, website, contact name and email), <b>The Offer</b> (the same fields as
                    above), <b>Promo Code</b> (your code name) and <b>Imagery</b>. Everything is required except the
                    hero video. Hit <b>Submit Reward</b> when you’re done.
                </P>
                <Shot
                    id="partner-rewards-invite"
                    alt="The Add your reward to POWR page opened from a private link"
                    caption="Add your reward to POWR"
                    notes={[
                        ['brand', 'A brand name POWR already knows is filled in and locked.'],
                        ['email', 'This address gets your portal login link once the reward is approved.'],
                        ['offer', 'The Offer, then Promo Code and Imagery further down.'],
                        ['preview', 'The live preview updates as you type.'],
                    ]}
                />
                <P>
                    Nothing is saved until you submit, so finish in one sitting. If POWR already knows your brand name
                    or code name, they’re filled in and locked. The link works once: opened again it says{' '}
                    <b>Already submitted</b>. An old or mistyped link says <b>Invalid link</b>; ask POWR for a new one.
                </P>
                <P>
                    The link doesn’t ask how members redeem, so it sets up a unique-code reward. When POWR approves
                    your first reward, the contact email you gave receives a link to set up your portal login. From
                    then on, use <b>My Rewards</b>.
                </P>
            </Section>

            <Section id="faq" title="Common questions">
                <P>
                    <b>Where do I set the points price?</b> You don’t. POWR sets it on approval, and the Cost column
                    on Live Rewards shows it.
                </P>
                <P>
                    <b>The form won’t let me move on.</b> <b>Save &amp; continue</b> only checks the step you’re on.
                    Look for the red field and its message, or hit <b>Save draft</b> and come back later.
                </P>
                <P>
                    <b>My reward is approved but says Inactive.</b> POWR switches it on once codes can reach members.
                    Check your delivery method is set up: <Link to="/docs" className={A}>How codes flow</Link>.
                </P>
                <P>
                    <b>“Image must be under 5 MB” or “Video must be under 50 MB”.</b> Export a smaller file. For video,
                    a short, compressed loop works best.
                </P>
                <P>
                    <b>Can I target a region or an audience?</b> The reward itself has no such setting.
                    {PLACEMENTS_LIVE && <> To boost a reward for members in a place, at chosen times, see{' '}
                        <Link to="/docs/placements" className={A}>Placements</Link>.</>}
                </P>
                <P>
                    <b>Can I delete a submission?</b> There’s no delete button. A draft you don’t need can stay where
                    it is: drafts don’t count towards your limit.
                </P>
                <P>
                    <b>I submitted the wrong thing.</b> While it’s in <b>Review</b>, hit <b>Edit</b> on the Submissions
                    tab and save your fix. It stays in review with your changes.
                </P>
            </Section>
        </DocsLayout>
    );
}
