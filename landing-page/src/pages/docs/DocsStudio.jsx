import React from 'react';
import { Link } from 'react-router-dom';
import { Callout, DocsLayout, P, PLACEMENTS_LIVE, Section, Shot, Step, Steps, Table } from './docsShared';

// /docs/studio: the partner portal's Studio (PartnerStudio.jsx →
// studio/StudioEditor.jsx with the brand's own rewards as its data). Only
// what a brand can reach from /partner/studio.

const TOC = [
    ['what', 'What the Studio makes'],
    ['first', 'Make your first post'],
    ['templates', 'Choosing a template'],
    ['fill', 'Filling from your reward'],
    ['media', 'Photos and video'],
    ['words', 'Words, style and look'],
    ['sizes', 'Sizes and downloads'],
    ['carousel', 'Carousels and extra pages'],
    ['drafts', 'Drafts'],
    ['posting', 'Posting it'],
    ['faq', 'Common questions'],
];

const link = 'font-bold text-[#8a7600] hover:underline';
const code = 'font-mono text-[12px]';

export default function DocsStudio() {
    return (
        <DocsLayout
            eyebrow="Partner guide · Studio"
            title="Make posts for your reward"
            intro="Studio turns your POWR reward into finished social posts, stories, reels, banners and print. Pick a template, add a photo or clip, and it fills in your offer, points, logo and colour. Then download it and post it wherever you like."
            toc={TOC}
            nextNote={{ label: 'Codes going out?', detail: 'Redemptions shows every code members have claimed and used.' }}
        >
            <Section id="what" title="What the Studio makes">
                <P>
                    Every template is co-branded: your logo or name sits beside the POWR mark, and the design is built
                    to read well on a phone. The templates handle the hard parts (crop, grade, type sizes, keeping
                    words legible over a photo), so the controls are adjustments, not a blank canvas.
                </P>
                <P>
                    What you see in the preview is exactly what downloads. Everything is made in your browser: the
                    photos and clips you add stay on your computer until you download a post or save it as a draft.
                </P>
            </Section>

            <Section id="first" title="Make your first post">
                <Steps>
                    <Step n="1" title="Open the Studio">
                        Choose <b>Studio</b> in the portal sidebar, or press <b>Make a post</b> beside a reward under{' '}
                        <b>My Rewards</b>. Studio opens on <b>One post</b>, on the <b>Reward</b> voucher template,
                        already filled from that reward (or your newest live one).
                    </Step>
                    <Step n="2" title="Pick a template">
                        Browse the <b>Template</b> panel. Each thumbnail shows your own photo in that design, so you
                        can compare before you choose.
                    </Step>
                    <Step n="3" title="Add a photo or video">
                        Drop a file onto <b>Photo or video</b> or the preview, or click to upload. If your reward has a
                        hero image, <b>Use [your brand]’s own photo</b> under <b>Fill from a reward</b> puts it in.
                    </Step>
                    <Step n="4" title="Check the words">
                        Edit anything under <b>Words</b>. Click text on the preview to jump straight to its field.
                    </Step>
                    <Step n="5" title="Choose a size and download">
                        Pick <b>Social</b>, <b>Banners</b> or <b>Print</b> above the preview, choose a size, and press{' '}
                        <b>Download</b>.
                    </Step>
                </Steps>
                <Shot
                    id="partner-studio-page"
                    alt="The Studio, open on the Reward voucher filled from the brand’s reward"
                    caption="The Studio"
                    notes={[
                        ['modes', 'One post and Drafts. The number is how many drafts you have.'],
                        ['templates', 'Template: your photo in every design.'],
                        ['draft', 'The draft bar: name the post and save it to finish later.'],
                        ['groups', 'Social, Banners or Print, then a size.'],
                        ['download', 'Download the size you’re looking at.'],
                    ]}
                />
            </Section>

            <Section id="templates" title="Choosing a template">
                <P>The <b>Template</b> panel has five tabs. The number on each is how many templates it holds.</P>
                <Table
                    head={['Tab', 'What’s in it']}
                    rows={[
                        ['Core', 'POWR’s own designs, grouped as Trending (the newest templates POWR has added), Brand, Partners (the Reward voucher and the Partner drop), Events and Challenges.'],
                        ['Move · Eat · Mind · Sleep', 'One library per reward category. Each splits into Lifestyle (the person training, eating, resting) and Products (built around a shot of the thing you sell).'],
                    ]}
                />
                <Shot
                    id="partner-studio-templates"
                    alt="The Template panel open on the Eat library"
                    caption="The Template panel"
                    notes={[
                        ['tabs', 'Core: POWR’s own designs. Each tab shows how many it holds.'],
                        ['pillar', 'Your reward’s category: Eat, for a food brand.'],
                        ['lifestyle', 'Lifestyle first, then Products further down.'],
                        ['chosen', 'The template you’re using is outlined in gold.'],
                        ['photo', 'Each thumbnail shows your own photo in that design.'],
                    ]}
                />
                <P>
                    The line under the thumbnails says what the selected template is for. Every template works with
                    your reward, but <b>Reward</b>, <b>Partner</b> and the four category libraries are the ones that
                    fill themselves from it.
                </P>
            </Section>

            <Section id="fill" title="Filling from your reward">
                <P>
                    <b>Fill from a reward</b> lists your rewards. Choose one and every template that takes a reward is
                    filled in one go: the offer, the points cost, your logo and your brand colour (lightened if it’s
                    too dark to read on the templates’ near-black). The refresh button beside the list fills it
                    again, putting the reward’s own words back over any you’ve changed.
                </P>
                <Shot
                    id="partner-studio-fill"
                    alt="Fill from a reward, filled from the brand’s reward"
                    caption="Fill from a reward"
                    notes={[
                        ['picker', 'Pick one of your rewards.'],
                        ['refill', 'Fill again, putting the reward’s own words back.'],
                        ['filled', 'Your category’s templates are filled too.'],
                        ['photo', 'Put your reward’s own hero photo in.'],
                    ]}
                />
                <P>
                    Your reward’s category matters. Fill a reward in the Eat category, for example, and Studio opens
                    the <b>Eat</b> tab, filled with your brand too. Anything filled is only a starting point: edit it
                    freely afterwards.
                </P>
                <Callout tone="warn" title="Watch for the warnings under the list">
                    <b>This reward is switched off</b> means members can’t find it in the app right now, so hold the
                    post until it’s live. <b>Their logo wouldn’t load</b> means you should upload your logo yourself
                    under <b>Words</b>.
                </Callout>
                <P>
                    No reward yet? Studio still opens. Upload your logo under <b>Words</b>; once your reward is live,
                    its offer, points and colour fill in too. See the{' '}
                    <Link to="/docs/rewards" className={link}>Rewards guide</Link>.
                </P>
            </Section>

            <Section id="media" title="Photos and video">
                <P>
                    <b>Photos.</b> JPG, PNG and WebP open in any browser. HEIC photos from an iPhone only open in
                    Safari: export as JPEG, or use Safari. Use <b>Zoom</b> to tighten the crop, and click the subject in
                    the preview to centre the crop on them. Some templates also keep their words clear of the spot you
                    clicked.
                </P>
                <P>
                    <b>Video.</b> The same templates play over a clip. Set <b>Starts at</b> and <b>Ends at</b> to pick
                    the part you want, up to 60 seconds. The clip’s own sound is off unless you tick{' '}
                    <b>Keep the clip’s own sound</b>; adding trending audio in Instagram or TikTok usually reaches
                    further and avoids music claims. MP4 (H.264) works everywhere. Making a video takes a little while;
                    you’ll see <b>Rendering MP4</b> with a progress bar and a <b>Cancel</b> button.
                </P>
                <Callout tone="note" title="Best browser for video">
                    Exporting video needs a browser that can encode H.264. Use Chrome, or Safari on a Mac. iPhone HEVC
                    clips also need Chrome or Safari on a Mac to open.
                </Callout>
                <P>
                    <b>Logos and product shots.</b> Templates with a <b>Partner logo</b> field take any image; PNG with
                    a transparent background is best, and a logo on plain white or black is cleaned up automatically.
                    Upload it once and every template that uses it gets it.
                </P>
            </Section>

            <Section id="words" title="Words, style and look">
                <P>
                    <b>Words.</b> Each template lists its own fields. <b>Starting points</b> swap in ready-made wording
                    where a template has them, and <b>Reset</b> puts the template back as it started. Where a field’s
                    hint mentions braces, wrapping a word in them, like <code className={code}>{'{20%} off'}</code>, puts it in
                    your accent colour, and a new line stacks the words. On the Reward voucher, the <b>QR link</b>{' '}
                    opens the rewards in the POWR app; empty it to drop the QR.
                </P>
                <P>
                    <b>Style.</b> Pick a colourway (<b>POWR</b>, <b>Gold</b>, <b>Mono</b>, <b>Signal</b>), set your
                    own <b>Accent colour</b> (<b>Use colourway</b> undoes it), choose a <b>Headline font</b> and a{' '}
                    <b>Photo tint</b>, or tick <b>Black &amp; white</b>. Some templates add their own options, such as{' '}
                    <b>Logo colour</b>.
                </P>
                <P>
                    <b>Look.</b> Sliders for <b>Brightness</b>, <b>Contrast</b>, <b>Grain</b>, <b>Motion blur</b>,{' '}
                    <b>Vignette</b> and <b>Headline size</b>. Each template remembers its own look.
                </P>
            </Section>

            <Section id="sizes" title="Sizes and downloads">
                <Table
                    head={['Group', 'Sizes', 'Downloads as']}
                    rows={[
                        ['Social', 'Post 4:5 · Portrait 3:4 · Square 1:1 · Story 9:16 · Reel 9:16', 'PNG at the platform’s own pixel size, or MP4 for video'],
                        ['Banners', 'Landscape 16:9 · Link 1.91:1 (LinkedIn and Facebook) · Header 3:1 (X header, email) · Cover 4:1 (LinkedIn cover)', 'PNG, or MP4 for video'],
                        ['Print', 'A5 flyer · A4 sheet · A3 poster, at 300 dpi', 'Print-ready PDF with a 3 mm bleed, or PNG without bleed'],
                    ]}
                />
                <Shot
                    id="partner-studio-sizes"
                    alt="The preview with the size picker and download buttons"
                    caption="Sizes and downloads"
                    notes={[
                        ['groups', 'Social, Banners or Print.'],
                        ['sizes', 'The sizes in that group, and the pixel size you’ll get.'],
                        ['safe', 'Safe zones: where an app’s buttons will cover the design.'],
                        ['download', 'Download this size. All social saves every size.'],
                        ['slide', 'Add slide to make a carousel.'],
                    ]}
                />
                <P>
                    Tick <b>Safe zones</b> to see where an app’s own buttons, captions or a printer’s trim will cover
                    the design. Stories and reels lose the most at the top and bottom.
                </P>
                <P>
                    <b>Download</b> saves the size you’re looking at. <b>All social</b>, <b>All banners</b> or{' '}
                    <b>All print</b> saves every size in that group in one go. With a video, <b>Cover</b> saves the
                    current frame as a PNG to use as the reel cover.
                </P>
            </Section>

            <Section id="carousel" title="Carousels and extra pages">
                <P>
                    Press <b>Add slide</b> under the preview to make a carousel. The new slide starts as a copy of the
                    one you’re on; change its template, photo and words as you like. Size, colours and fonts are
                    shared, so the slides belong together. Use the arrows to reorder slides and the bin to delete one.
                </P>
                <P>
                    With more than one slide, <b>Download</b> becomes <b>Download [n] slides</b> (numbered PNGs, or MP4s
                    for video slides). <b>PDF</b> saves the whole carousel as one PDF, which is how LinkedIn posts
                    carousels, and <b>This slide</b> saves just the one you’re on. In Print the button reads{' '}
                    <b>Add page</b>, for a flyer back for instance, and the download is one PDF with every page.
                </P>
            </Section>

            <Section id="drafts" title="Drafts">
                <P>
                    The bar above the preview keeps your work. Give the post a name (or keep the one Studio suggests)
                    and press <b>Save draft</b>, or ⌘S on a Mac and Ctrl+S elsewhere. A draft keeps every slide: the
                    template, photo or clip, words and look.
                </P>
                <Table
                    head={['In the bar', 'Meaning']}
                    rows={[
                        ['Not saved', 'This post isn’t in Drafts yet.'],
                        ['Saved in Drafts', 'Everything is saved, with the time.'],
                        ['Unsaved changes', 'You’ve changed it since the last save. Press Save.'],
                        ['Copy icon', 'Save as a copy: a new draft, leaving the original as it was.'],
                        ['New page icon', 'Start a new post. Studio asks first if there’s anything unsaved.'],
                    ]}
                />
                <P>
                    Open the <b>Drafts</b> tab at the top of the Studio to see them all, search with{' '}
                    <b>Find a draft</b>, rename or delete one, or click it to carry on where you left off. Drafts
                    belong to your brand, so anyone on your team who signs in to the portal can open them.
                </P>
                <Shot
                    id="partner-studio-drafts"
                    alt="The Drafts tab with five saved posts"
                    caption="Drafts"
                    notes={[
                        ['tab', 'The Drafts tab, with how many there are.'],
                        ['slides', 'A carousel shows how many slides it has.'],
                        ['team', 'When it was last saved, and who by.'],
                        ['open', 'Open carries on where it was left.'],
                        ['rename', 'Rename it, or delete it with the bin.'],
                    ]}
                />
                <Callout tone="note" title="Big clips are trimmed to fit">
                    A draft keeps files up to 50 MB each. A longer clip keeps only the part your slides use, and Studio
                    tells you when it has done that. Deleting a draft (<b>Delete for good?</b>) can’t be undone.
                </Callout>
            </Section>

            <Section id="posting" title="Posting it">
                <P>
                    Studio doesn’t post for you. Download the files and upload them to your own accounts as you
                    normally would, adding your caption and any audio in the app you post from. For a reel, download
                    the MP4 and the <b>Cover</b>.
                </P>
                <P>
                    A good post points people to POWR, where the reward lives. The Reward voucher’s QR does that for
                    you; elsewhere, keep a line such as “link in bio” and link to the POWR app.
                </P>
            </Section>

            <Section id="faq" title="Common questions">
                <P>
                    <b>“Some fonts didn’t load.”</b> Part of Studio’s type didn’t arrive. Check your connection and
                    reload the page before you download.
                </P>
                <P>
                    <b>“That file could not be read as an image.”</b> Use a PNG, JPG, WebP or, for logos, SVG. For an
                    iPhone HEIC photo, see <a href="#media" className={link}>Photos and video</a>.
                </P>
                <P>
                    <b>“This browser can’t encode H.264 video.”</b> Switch to Chrome, or Safari on a Mac, to download
                    MP4s.
                </P>
                <P>
                    <b>My clip is longer than 60 seconds.</b> Set <b>Starts at</b> and <b>Ends at</b> around the part
                    you want. The selection can’t be longer than 60 seconds.
                </P>
                <P>
                    <b>Some templates mention an event or a venue.</b> The Events and Challenges templates were made for
                    event nights and challenge launches, and start with sample words, including a sample venue.
                    Replace every sample line before you download.
                </P>
                <P>
                    <b>A draft opened on a different template.</b> Trending templates come and go. If one a draft used
                    has gone, the draft opens on another template with your words and photos kept.
                </P>
                <P>
                    <b>I changed my reward but the post still shows the old offer.</b> Studio reads your rewards when the
                    page opens. Save a draft if you need to, reload the page, then pick the reward again under{' '}
                    <b>Fill from a reward</b>. Changes to a live reward only show once POWR has approved them.
                </P>
                <P>
                    <b>Can I add a post to the POWR app itself?</b> No. Studio makes files for your own channels. To
                    be seen inside the app, use <Link to="/docs/whats-on" className={link}>What’s On</Link>
                    {PLACEMENTS_LIVE && <> or <Link to="/docs/placements" className={link}>Placements</Link></>}.
                </P>
            </Section>
        </DocsLayout>
    );
}
