import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Palette } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { registerTemplates } from '../../studio/templates';
import { compileBlueprint } from '../../studio/blueprint/compile';
import StudioEditor from '../../studio/StudioEditor';
import PackBuilder from '../../studio/PackBuilder';
import TrendsPanel from '../../studio/TrendsPanel';
import InstagramPanel from '../../studio/social/InstagramPanel';
import InstagramPosts from '../../studio/social/InstagramPosts';

/**
 * Studio — social posts from a single photo, or a whole pack from a shoot.
 * The templates, grade and type live in src/studio/; this page is the admin
 * shell around the editor, the pack builder and the week's trend drop. Each
 * stays mounted once opened, so switching between them keeps the work in all.
 */
// Posting to Instagram stays hidden until it is live end to end: the Meta app
// connected, and the studio_social_posts migration + publish-instagram
// function applied. Switch this on then; the tab and the "Post to Instagram"
// button both follow it.
const INSTAGRAM_ON = false;

const MODES = [
    { id: 'post', label: 'One post', blurb: 'Pick a template, drop the photo in, change the words — the grade, crop and type are handled.' },
    { id: 'pack', label: 'A pack from a shoot', blurb: 'Drop a folder, photos or a ZIP, pick the event — every post it needs, made in one go, downloaded and saved.' },
    { id: 'trends', label: "This week's trends", blurb: 'What the big fitness brands’ campaigns look like right now, and what we can make of it. New every Monday.' },
    ...(INSTAGRAM_ON ? [{ id: 'instagram', label: 'Instagram', blurb: 'Posts sent to POWR’s Instagram from the Studio — scheduled, published and failed — and the account they go to.' }] : []),
];
const MODE_IDS = MODES.map((m) => m.id);

export default function Studio() {
    const [mode, setMode] = useState(() => {
        const m = new URLSearchParams(window.location.search).get('mode');
        return MODE_IDS.includes(m) ? m : 'post';
    });
    const [publishJob, setPublishJob] = useState(null);
    const [postsKey, setPostsKey] = useState(0);
    const [opened, setOpened] = useState(() => new Set([mode]));
    const [apply, setApply] = useState(null);
    // Blueprint templates the weekly trend routine published: loaded before
    // the editor mounts, so they sit in its "Trending" group from the start.
    const [published, setPublished] = useState(null);

    const loadPublished = useCallback(async () => {
        const { data, error } = await supabase
            .from('studio_templates')
            .select('id, name, trend, week_start, blueprint, status, created_at')
            .order('week_start', { ascending: false })
            .limit(60);
        const rows = error ? [] : data ?? [];
        registerTemplates(rows.filter((r) => r.status === 'live').map((r) => compileBlueprint(r.blueprint, { week: r.week_start })));
        setPublished(rows);
    }, []);
    useEffect(() => { loadPublished(); }, [loadPublished]);

    const setStatus = async (id, status) => {
        await supabase.from('studio_templates').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
        setPublished((rows) => rows.map((r) => (r.id === id ? { ...r, status } : r)));
    };

    const choose = (id) => {
        setMode(id);
        setOpened((s) => new Set(s).add(id));
        const url = new URL(window.location.href);
        if (id !== 'post') url.searchParams.set('mode', id); else url.searchParams.delete('mode');
        window.history.replaceState(null, '', url);
    };

    // The title and the mode tabs head the page at full width; each mode's
    // own layout (controls | sticky preview, the trend drop, the posts) sits
    // underneath, so the tabs never squeeze into the controls column.
    const header = (
        <div className="mb-6">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="flex items-center gap-3">
                    <Palette size={22} className="text-[#E8D200]" />
                    <h1 className="text-xl font-bold text-[#111]">Studio</h1>
                </div>
                <div className="max-w-full overflow-x-auto">
                    <div className="inline-flex rounded-xl bg-[#EAEAE5] p-1" role="tablist" aria-label="Studio mode">
                        {MODES.map((m) => (
                            <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} onClick={() => choose(m.id)}
                                className={`whitespace-nowrap rounded-lg px-4 py-1.5 text-sm transition-colors ${mode === m.id ? 'bg-white font-semibold text-[#111] shadow-sm' : 'text-[#666] hover:text-[#111]'}`}>
                                {m.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            <p className="mt-3 text-sm text-[#777]">{MODES.find((m) => m.id === mode).blurb}</p>
        </div>
    );

    return (
        <>
            {header}
            {opened.has('post') && published === null && mode === 'post' && (
                <div className="flex items-center gap-2 text-sm text-[#777]"><Loader2 size={16} className="animate-spin" /> Loading the Studio…</div>
            )}
            {opened.has('post') && published !== null && <div className={mode === 'post' ? '' : 'hidden'}><StudioEditor apply={apply} onPublish={INSTAGRAM_ON ? setPublishJob : null} /></div>}
            {opened.has('pack') && <div className={mode === 'pack' ? '' : 'hidden'}><PackBuilder /></div>}
            {opened.has('trends') && (
                <div className={mode === 'trends' ? '' : 'hidden'}>
                    <TrendsPanel published={published} onStatus={setStatus}
                        onTry={(a) => { setApply({ ...a }); choose('post'); window.scrollTo(0, 0); }} />
                </div>
            )}
            {INSTAGRAM_ON && mode === 'instagram' && <InstagramPosts refreshKey={postsKey} />}
            {INSTAGRAM_ON && publishJob && <InstagramPanel job={publishJob} onClose={() => setPublishJob(null)} onDone={() => setPostsKey((k) => k + 1)} />}
        </>
    );
}
