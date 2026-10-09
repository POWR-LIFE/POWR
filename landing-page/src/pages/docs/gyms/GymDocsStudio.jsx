import React from 'react';
import { Link } from 'react-router-dom';
import { Callout, DocsLayout, P, Section, Shot, Step, Steps, Table } from '../docsShared';

// /docs/gyms/studio: the week's ready-made posts on the Overview (every
// package sees them) and the Studio itself (Clash Pro): one post, a pack from
// a shoot, drafts. Sources: pages/venue/WeekPosts.jsx, PostLightbox.jsx,
// VenueStudio.jsx and studio/*.

const L = 'font-bold text-[#8a7600] hover:underline';

const TOC = [
    ['what', 'What the Studio is for'],
    ['week', 'This week’s posts'],
    ['open', 'Open, copy and download a post'],
    ['one', 'Make one post'],
    ['video', 'Photos and video'],
    ['sizes', 'Sizes'],
    ['pack', 'A pack from a shoot'],
    ['drafts', 'Drafts'],
    ['brand', 'Your photo, your name, the POWR mark'],
    ['faq', 'Common questions'],
];

export default function GymDocsStudio() {
    return (
        <DocsLayout
            eyebrow="Gym guide · Studio"
            title="Posts for your gym, made from your week"
            intro="POWR turns your gym’s own numbers, events and photos into posts ready for Instagram, Facebook, WhatsApp, your screens and the noticeboard. Seven come ready every Monday. The Studio lets you make your own, one at a time or a whole shoot at once."
            toc={TOC}
            nextNote={{ label: 'Members & Retention', detail: 'Who trains with you, what they do, and who has started to drift from their usual visits.' }}
        >
            <Section id="what" title="What the Studio is for">
                <P>
                    There are two places to make posts. Both draw every post in your browser, from what POWR already
                    knows about your gym, so you don’t need a designer or a separate app.
                </P>
                <Table
                    head={['Where', 'What you get', 'Package']}
                    rows={[
                        ['Posts for this week, on the Overview', 'Seven ready-made posts, one for each day, new every Monday', 'Every package can see them. Downloading is Clash Pro, except the join poster'],
                        ['Studio, in the sidebar', 'Your own posts from a template, a whole pack from a shoot, and your drafts', 'Clash Pro'],
                    ]}
                />
                <P>
                    If your package doesn’t include the Studio, its page shows <b>Studio comes with Clash Pro</b> and
                    a <b>See packages</b> button. Open <b>Package</b> to see what each package includes.
                </P>
            </Section>

            <Section id="week" title="This week’s posts">
                <P>
                    The <b>Posts for this week</b> card on your <b>Overview</b> holds seven posts, Monday to Sunday.
                    Today’s is outlined in gold and marked <b>Today</b>. A new set arrives every Monday, with new words
                    and looks, so your feed doesn’t repeat itself week to week.
                </P>
                <Shot
                    id="gym-studio-week"
                    alt="The Posts for this week card on the gym portal Overview"
                    caption="Posts for this week, on the Overview"
                    notes={[
                        ['today', 'Today’s post, outlined in gold.'],
                        ['look', 'Mixed, Colour or Film: the look of the whole week.'],
                        ['all', 'Download all: the seven posts at three sizes, with the captions, in one ZIP.'],
                        ['one', 'Download one post at its Post size.'],
                    ]}
                />
                <Table
                    head={['Day', 'The post', 'When the week is quiet']}
                    rows={[
                        ['Monday', 'Last week in numbers: sessions, people and first-timers', 'A “New week” post that needs no numbers'],
                        ['Tuesday', 'The join poster: gets people onto POWR and onto your board', 'Always the join poster'],
                        ['Wednesday', 'The board, midweek: the top three to five', 'With fewer than three on the board, it asks for names instead'],
                        ['Thursday', 'Who leads the board this week', 'A “Show up” post'],
                        ['Friday', 'Where you stand in Gym Clash against the gyms near you', 'A weekend post'],
                        ['Saturday', 'Your event: results from the last fortnight, or the next event’s ticket', 'A weekend post'],
                        ['Sunday', 'A brand post', 'Always a brand post'],
                    ]}
                />
                <P>
                    The numbers are live. The board post shows the board as it stands when you open or download it,
                    so download on the day you post. Names appear as first name and initial, as on your gym’s screen,
                    and members who hide from leaderboards are never on them.
                </P>
                <P>
                    Use the <b>Mixed</b>, <b>Colour</b> and <b>Film</b> switch to choose the look. Mixed puts your photo
                    in colour most days, with one black-and-white day and one gold day. Colour keeps every day in
                    colour. Film is the house black and white. Your choice is remembered on that device.
                </P>
                <Callout tone="note" title="Add your gym’s photo first">
                    The posts go over your gym’s photo. Without one they’re type on black. Add it under{' '}
                    <b>Settings</b> → <b>Photo</b>, or as the cover photo on your Overview’s app page, and every post
                    picks it up.
                </Callout>
            </Section>

            <Section id="open" title="Open, copy and download a post">
                <Steps>
                    <Step n="1" title="Open it large">
                        Click any post. It opens full size, with arrows (or your keyboard’s arrow keys) to move through
                        the week. Press Esc, the X or the dark background to close it. The <b>Post it</b> button in{' '}
                        <b>Worth doing</b> on the Overview opens today’s post straight away.
                    </Step>
                    <Step n="2" title="Pick a size">
                        The chips under the post switch between <b>Post</b> (4:5, for the feed), <b>Story</b> (9:16,
                        for Stories and Reels covers) and <b>Square</b> (1:1, for profile grids and WhatsApp). The post
                        is redrawn to fit, not cropped.
                    </Step>
                    <Step n="3" title="Copy the caption">
                        <b>Copy caption</b> puts the words to paste with it on your clipboard, with your hashtags.
                    </Step>
                    <Step n="4" title="Download it">
                        <b>Download Post</b> (or Story, or Square) saves that size as a JPEG. The small download button
                        under each post in the row saves its Post size.
                    </Step>
                </Steps>
                <Shot
                    id="gym-studio-lightbox"
                    alt="A week’s post opened full size, with its size chips and buttons"
                    caption="A post, opened large"
                    notes={[
                        ['arrows', 'The arrows move through the week. Your arrow keys do too.'],
                        ['sizes', 'Post, Story or Square: the post is redrawn to fit.'],
                        ['caption', 'Copy caption: the words to paste with it, with your hashtags.'],
                        ['download', 'Download this size as a JPEG.'],
                    ]}
                />
                <P>
                    <b>Download all</b> makes one ZIP of the whole week: seven posts at all three sizes, a folder per
                    size (<b>01 Post 4x5</b>, <b>02 Story 9x16</b>, <b>03 Square 1x1</b>), files numbered by day
                    (1 is Monday) and a captions file with the words for each day. A progress bar shows while it’s
                    made, with <b>Cancel</b> beside it.
                </P>
                <Callout tone="good" title="The join poster is free on every package">
                    On packages without the Studio you still see all seven posts, with a lock where the download
                    would be. Tuesday’s join poster downloads on every package, because it gets members onto your
                    board.
                </Callout>
            </Section>

            <Section id="one" title="Make one post">
                <P>
                    Open <b>Studio</b> and choose <b>One post</b>. The controls sit on the left and the preview on the
                    right. What you see in the preview is exactly what downloads.
                </P>
                <Shot
                    id="gym-studio-editor"
                    alt="The Studio’s One post editor, with Results filled from this week’s board over the gym’s photo"
                    caption="One post"
                    notes={[
                        ['modes', 'One post, A pack from a shoot and Drafts.'],
                        ['library', 'The template libraries: Core, Move, Eat, Mind and Sleep.'],
                        ['draft', 'The draft bar: its name, whether it’s saved, and Save draft.'],
                        ['sizes', 'Social, Banners or Print, then the size under them.'],
                        ['download', 'Download the size you’re on.'],
                    ]}
                />
                <Steps>
                    <Step n="1" title="Pick a template">
                        Under <b>Template</b>, the <b>Core</b> library holds POWR’s own designs, grouped as{' '}
                        <b>Trending</b> (fresh templates each week), <b>Brand</b>, <b>Partners</b>, <b>Events</b> and{' '}
                        <b>Challenges</b>. <b>Move</b>, <b>Eat</b>, <b>Mind</b> and <b>Sleep</b> are libraries of their
                        own. The sample words already use your gym’s name and town.
                    </Step>
                    <Step n="2" title="Add a photo or video">
                        Drop it on <b>Photo or video</b>, or click to upload. Use <b>Zoom</b> to tighten the crop, then
                        click your subject in the preview to centre on them.
                    </Step>
                    <Step n="3" title="Fill it from your gym (optional)">
                        Templates that can take your data show <b>Fill from an event</b> or{' '}
                        <b>Fill from your gym board</b>. Pick one and the name, date, join QR or the top five drop in.
                        The refresh button fills it again with the latest standings. Edit anything after.
                    </Step>
                    <Step n="4" title="Change the words and the look">
                        <b>Words</b> holds every line on the post, with <b>Reset</b> to go back to the template’s own.
                        Click any text on the preview to jump to its field. <b>Style</b> sets the colours, the
                        headline font and the photo tint. <b>Look</b> has sliders for brightness, contrast, grain,
                        motion blur, vignette and headline size.
                    </Step>
                    <Step n="5" title="Download">
                        Pick a size above the preview and press <b>Download</b>. <b>All social</b> (or{' '}
                        <b>All banners</b>, <b>All print</b>) downloads every size in that group at once. Tick{' '}
                        <b>Safe zones</b> to see where Instagram’s own buttons and captions will sit.
                    </Step>
                </Steps>
                <Shot
                    id="gym-studio-templates"
                    alt="The template picker, on the Core library"
                    caption="Templates"
                    notes={[
                        ['libraries', 'Core, then a library each for Move, Eat, Mind and Sleep.'],
                        ['trending', 'Trending: fresh templates each week.'],
                        ['flood', 'Every template shows your photo, so you see it before you pick it.'],
                        ['brand', 'Then Brand, Partners, Events and Challenges.'],
                    ]}
                />
                <Shot
                    id="gym-studio-fill"
                    alt="The Photo or video card and the two Fill cards, filled from this week’s board"
                    caption="Your photo, and a fill from your gym"
                    notes={[
                        ['photo', 'Your photo or clip. Click to replace it.'],
                        ['zoom', 'Zoom tightens the crop. Click your subject in the preview to centre on them.'],
                        ['event', 'Fill from an event: name, dates, the join QR and the standings.'],
                        ['fill', 'Fill from your gym board: this week’s top five. The button beside it fills it again.'],
                        ['note', 'What was filled, and when.'],
                    ]}
                />
                <P>
                    <b>Add slide</b> turns the post into a carousel. Each new slide starts as a copy of the one you’re
                    on. Download <b>This slide</b>, all of them as numbered files, or one <b>PDF</b> (LinkedIn posts
                    carousels as PDF documents).
                </P>
                <P>
                    Two shortcuts open the Studio ready-filled: <b>Make one post by hand in the Studio</b>, under an
                    event’s <b>Content</b> kit, opens the ticket template filled from that event, and <b>Make the post</b> in <b>Worth doing</b> opens the results
                    template filled from this week’s board.
                </P>
            </Section>

            <Section id="video" title="Photos and video">
                <P>
                    A video plays under the same templates. Set <b>Starts at</b> and <b>Ends at</b> to choose the
                    part you want: up to 60 seconds. <b>Download MP4</b> renders it in your browser at 30 frames a
                    second, with a percentage while it works and a <b>Cancel</b> button. <b>Cover</b> saves the frame
                    on screen as a still, for your Reel’s cover.
                </P>
                <P>
                    <b>Keep the clip’s own sound</b> is off by default. Adding trending audio in Instagram or TikTok
                    reaches further and avoids music claims.
                </P>
                <Callout tone="note" title="Where your photos go">
                    Photos and clips are read in your browser. They’re only kept by POWR when you save a draft or
                    make a pack, and then in your gym’s own private space, which everyone on your team can open.
                </Callout>
            </Section>

            <Section id="sizes" title="Sizes">
                <P>Every size downloads at the exact pixels each platform stores, so nothing is rescaled on upload.</P>
                <Table
                    head={['Group', 'Size', 'Pixels', 'Use it for']}
                    rows={[
                        ['Social', 'Post 4:5', '1080 × 1350', 'Instagram and Facebook feed'],
                        ['Social', 'Portrait 3:4', '1080 × 1440', 'Taller feed posts'],
                        ['Social', 'Square 1:1', '1080 × 1080', 'Profile grids, WhatsApp'],
                        ['Social', 'Story 9:16', '1080 × 1920', 'Stories'],
                        ['Social', 'Reel 9:16', '1080 × 1920', 'Reels, with words kept clear of the Reels buttons and caption'],
                        ['Banners', 'Landscape 16:9', '1920 × 1080', 'YouTube, web, gym screens'],
                        ['Banners', 'Link 1.91:1', '1200 × 628', 'LinkedIn and Facebook link posts'],
                        ['Banners', 'Header 3:1', '1500 × 500', 'X header, email'],
                        ['Banners', 'Cover 4:1', '1584 × 396', 'LinkedIn cover'],
                        ['Print', 'A5, A4, A3', '300 dpi', 'Flyers and posters: a print-ready PDF with 3 mm bleed, or a PNG'],
                    ]}
                />
                <P>Stills download as PNG, videos as MP4 and print sizes as PDF. The week’s posts on the Overview are JPEGs.</P>
            </Section>

            <Section id="pack" title="A pack from a shoot">
                <P>
                    <b>A pack from a shoot</b> turns a whole folder of photos and clips into every post an event needs,
                    in one go.
                </P>
                <Steps>
                    <Step n="1" title="Pick the event and its stage">
                        Choose the event under <b>Event</b>, or <b>No event</b> for a brand pack. Then pick the stage:{' '}
                        <b>Before</b> (dates, venue, join QR, a poster), <b>Live</b> (the standings and a nudge to
                        join), <b>After</b> (results, a thank-you and a recap carousel) or <b>No event</b>.
                    </Step>
                    <Step n="2" title="Add the shoot">
                        Drop a folder, photos, clips or a ZIP, or use <b>Files or a ZIP</b> or <b>A folder</b>. Near
                        duplicates are set aside and weak shots are marked. Hover a photo to make it the lead (★, it
                        goes on the headline post) or to leave it out.
                    </Step>
                    <Step n="3" title="Shape the pack">
                        Under <b>Pack</b>, choose the sizes (Post, Story, Square, Landscape; at least one), the look
                        and the colour, and tick the extras: an A4 poster, a recap carousel, a Story reel from each
                        clip (up to 3, the first 12 seconds) or a post for every other good photo.
                    </Step>
                    <Step n="4" title="Check every post">
                        On each post you can swap the photo, swap the template, or leave it out. Click a post to change
                        its words.
                    </Step>
                    <Step n="5" title="Make it">
                        <b>Make pack</b> downloads one ZIP and saves the pack, its photos and its plan under{' '}
                        <b>Saved packs</b>. From there you can download the <b>ZIP</b> again,{' '}
                        <b>Open</b> it to rework it, or <b>Delete</b> it.
                    </Step>
                </Steps>
                <Shot
                    id="gym-studio-pack"
                    alt="A pack from a shoot: an After pack for a finished event, planned from eleven photos"
                    caption="A pack from a shoot"
                    notes={[
                        ['event', 'The event and its stage: Before, Live or After.'],
                        ['shoot', 'The shoot. The starred photo is the lead.'],
                        ['pack', 'Sizes, look, colour and the extras.'],
                        ['make', 'Make pack: one ZIP, and a copy kept here.'],
                        ['swap', 'On each post: another photo, another template, or leave it out.'],
                        ['saved', 'Packs saved for this event: download the ZIP again, open or delete.'],
                    ]}
                />
                <Table
                    head={['Limit', 'Per pack']}
                    rows={[
                        ['Photos', 'Up to 100, each up to 40 MB'],
                        ['Clips', 'Up to 10, each up to 500 MB'],
                        ['ZIP files', 'Up to 2 GB each'],
                        ['Kept with a saved pack', 'Clips over 50 MB aren’t kept, but the posts made from them are'],
                    ]}
                />
                <P>
                    Anything over a limit is left out, and the page says how many and why. Each event’s page also has
                    its own <b>Content</b> kit for before and after the event: see the{' '}
                    <Link to="/docs/gyms/events" className={L}>Events guide</Link>.
                </P>
            </Section>

            <Section id="drafts" title="Drafts">
                <P>
                    In <b>One post</b>, press <b>Save draft</b> (or ⌘S / Ctrl+S) to keep the template, the words, the
                    look and the photo or clip for later. Name it in the bar above the preview, or let POWR name it from
                    its first words. The bar tells you whether it’s saved or has <b>Unsaved changes</b>. Once saved, you
                    can also save a copy or start a new post from the same bar.
                </P>
                <P>
                    <b>Drafts</b> lists every draft your gym has saved, newest first, with <b>Find a draft</b> to
                    search them. <b>Open</b> puts the editor back where the draft was left. You can rename a draft, or
                    delete it (you’re asked <b>Delete for good?</b> first). A long clip is trimmed to the part the
                    slides use when it’s saved.
                </P>
                <Shot
                    id="gym-studio-drafts"
                    alt="The Drafts tab with nine saved drafts"
                    caption="Drafts"
                    notes={[
                        ['tab', 'Drafts, with how many your gym has.'],
                        ['search', 'Find a draft by its name.'],
                        ['slides', 'A carousel shows its number of slides. A clip shows Video.'],
                        ['open', 'Open puts the editor back where the draft was left.'],
                        ['rename', 'Rename it or delete it.'],
                        ['confirm', 'Delete asks first. It can’t be undone.'],
                    ]}
                />
            </Section>

            <Section id="brand" title="Your photo, your name, the POWR mark">
                <P>
                    The posts carry the POWR mark, with your gym’s name in the words. The week’s posts go over your
                    gym’s photo from <b>Settings</b>. In the Studio you choose the photo yourself. Event posts use the
                    event’s own picture when it has one.
                </P>
                <P>
                    Your logo from <b>Settings</b> shows on your screens and on your gym’s page in the app. To learn
                    how members find your page, see{' '}
                    <Link to="/docs/gyms/settings" className={L}>Settings &amp; team</Link>.
                </P>
            </Section>

            <Section id="faq" title="Common questions">
                <P>
                    <b>Why does a day show a different post from last week?</b> When the week can’t carry a day’s
                    post (a quiet week, a board of two, no Gym Clash standing), that day gets one that needs no
                    numbers. There are always seven.
                </P>
                <P>
                    <b>The results post isn’t in my pack.</b> Results stay out until the winners are revealed, so a
                    post never gives the result away early.
                </P>
                <P>
                    <b>A post says “Couldn’t draw this one”.</b> Reload the page. If your gym’s photo won’t load, the
                    posts fall back to type on black.
                </P>
                <P>
                    <b>My video won’t download.</b> Video is made in your browser. If it says the browser can’t encode
                    or decode the video, use Chrome, or Safari on a Mac, and export the clip from your phone as an MP4.
                </P>
                <P>
                    <b>I started a new post and lost my changes.</b> Starting a new post or opening another draft
                    asks first when there are unsaved changes. Save a draft before you switch.
                </P>
                <P>
                    <b>Can I get a deleted pack or draft back?</b> No. Deleting removes it and everything saved with
                    it, for your whole team.
                </P>
                <P>
                    <b>Who on my team can use the Studio?</b> Everyone with a login to your gym’s portal. Drafts and
                    saved packs belong to the gym, not to one person.
                </P>
            </Section>
        </DocsLayout>
    );
}
