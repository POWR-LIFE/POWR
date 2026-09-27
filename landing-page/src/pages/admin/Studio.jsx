import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Palette } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { registerTemplates } from '../../studio/templates';
import { compileBlueprint } from '../../studio/blueprint/compile';
import StudioEditor from '../../studio/StudioEditor';
import PackBuilder from '../../studio/PackBuilder';
import TrendsPanel from '../../studio/TrendsPanel';

/**
 * Studio — social posts from a single photo, or a whole pack from a shoot.
 * The templates, grade and type live in src/studio/; this page is the admin
 * shell around the editor, the pack builder and the week's trend drop. Each
 * stays mounted once opened, so switching between them keeps the work in all.
 */
const MODES = [
    { id: 'post', label: 'One post', blurb: 'Pick a template, drop the photo in, change the words — the grade, crop and type are handled.' },
    { id: 'pack', label: 'A pack from a shoot', blurb: 'Drop a folder, photos or a ZIP, pick the event — every post it needs, made in one go, downloaded and saved.' },
    { id: 'trends', label: "This week's trends", blurb: 'What the big fitness brands’ campaigns look like right now, and what we can make of it. New every Monday.' },
];
const MODE_IDS = MODES.map((m) => m.id);

export default function Studio() {
    const [mode, setMode] = useState(() => {
        const m = new URLSearchParams(window.location.search).get('mode');
        return MODE_IDS.includes(m) ? m : 'post';
    });
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
        if (id === 'post') url.searchParams.delete('mode'); else url.searchParams.set('mode', id);
        window.history.replaceState(null, '', url);
    };

    // The intro sits at the top of the controls column, not above the whole
    // grid, so the sticky preview starts level with it.
    const intro = (
        <div className="px-1">
            <div className="flex items-center gap-3 mb-1">
                <Palette size={22} className="text-[#E8D200]" />
                <h1 className="text-xl font-bold text-[#111]">Studio</h1>
            </div>
            <div className="mt-2 mb-2 inline-flex rounded-xl bg-[#EAEAE5] p-1">
                {MODES.map((m) => (
                    <button key={m.id} type="button" onClick={() => choose(m.id)}
                        className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${mode === m.id ? 'bg-white font-semibold text-[#111] shadow-sm' : 'text-[#666] hover:text-[#111]'}`}>
                        {m.label}
                    </button>
                ))}
            </div>
            <p className="text-sm text-[#777]">{MODES.find((m) => m.id === mode).blurb}</p>
        </div>
    );

    return (
        <>
            {opened.has('post') && published === null && mode === 'post' && (
                <div className="flex items-center gap-2 text-sm text-[#777]"><Loader2 size={16} className="animate-spin" /> Loading the Studio…</div>
            )}
            {opened.has('post') && published !== null && <div className={mode === 'post' ? '' : 'hidden'}><StudioEditor intro={intro} apply={apply} /></div>}
            {opened.has('pack') && <div className={mode === 'pack' ? '' : 'hidden'}><PackBuilder intro={intro} /></div>}
            {opened.has('trends') && (
                <div className={mode === 'trends' ? '' : 'hidden'}>
                    <TrendsPanel intro={intro} published={published} onStatus={setStatus}
                        onTry={(a) => { setApply({ ...a }); choose('post'); window.scrollTo(0, 0); }} />
                </div>
            )}
        </>
    );
}
