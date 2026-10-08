import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../App';
import StudioEditor from '../../studio/StudioEditor';
import DraftsPanel from '../../studio/drafts/DraftsPanel';
import { useDrafts } from '../../studio/drafts/useDrafts';
import { brandStudioData } from '../../studio/brandData';
import { loadTrending } from '../../studio/trending';

// The admin Studio, for a reward brand: the same templates (the week's
// Trending ones too), grade and exports, filled from the brand's own rewards
// (studio/brandData.js). Photos and clips stay on the device until a post is
// downloaded, or saved as a draft (kept in the brand's own storage folder).
const MODES = [['post', 'One post'], ['drafts', 'Drafts']];

export default function PartnerStudio() {
    const { partnerData } = useAuth();
    const brand = partnerData.brand_name;
    const [params, setParams] = useSearchParams();
    const data = useMemo(() => brandStudioData(brand), [brand]);
    const [rewards, setRewards] = useState(null);

    // Drafts opens with ?mode=drafts.
    const [mode, setMode] = useState(() => (params.get('mode') === 'drafts' ? 'drafts' : 'post'));
    const [opened, setOpened] = useState(() => new Set([mode]));
    const choose = (id) => {
        setMode(id);
        setOpened((o) => new Set(o).add(id));
        setParams((p) => { const n = new URLSearchParams(p); if (id !== 'post') n.set('mode', id); else n.delete('mode'); return n; }, { replace: true });
    };
    // Drafts: the brand's own. Opening one (or starting a new post) mounts a fresh editor.
    const topRef = useRef(null);
    const dr = useDrafts({ brand }, {
        show: () => { choose('post'); topRef.current?.scrollIntoView({ block: 'start' }); },
    });

    useEffect(() => {
        let alive = true;
        // A failed read still opens the Studio; its "Fill from a reward" box
        // says why. Trending registers before the editor mounts (it can't fail).
        const list = data.listRewards().catch(() => []);
        Promise.all([list, loadTrending()]).then(([l]) => { if (alive) setRewards(l); });
        return () => { alive = false; };
    }, [data]);

    // Opens on the voucher, filled from the reward "Make a post" was pressed
    // on (?reward=<id>), else the newest live one. A new post does the same.
    const start = useMemo(() => {
        if (!rewards) return null;
        const pick = rewards.find((r) => r.id === params.get('reward')) ?? rewards.find((r) => r.active) ?? rewards[0];
        return { templateId: 'reward', ...(pick ? { fill: { kind: 'reward', id: pick.id } } : {}) };
    }, [rewards]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!start) {
        return (
            <div className="flex justify-center py-24">
                <div className="w-7 h-7 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
            </div>
        );
    }

    const blurb = mode === 'drafts'
        ? 'Posts saved to finish later. Open one to carry on where it was left — every slide, photo or clip, the words and the look.'
        : rewards.length
            ? 'Pick a template, add a photo or video, and it’s filled from your reward: the offer, points, logo and colour. Save a draft to finish it later.'
            : 'Pick a template, add a photo or video, and upload your logo under Words. Once your reward is live, its offer, points and colour fill in too.';
    const intro = (
        <div className="px-1 pb-1">
            <div className="flex items-center gap-3 mb-4">
                <div className="h-[1px] w-12 bg-[#E8D200]" />
                <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Studio</span>
            </div>
            <h1 className="text-4xl font-light tracking-tighter text-[#1A1A1A] leading-[1.05]">Posts for {partnerData.name}</h1>
            <div className="mt-4 inline-flex rounded-xl bg-[#EAEAE5] p-1">
                {MODES.map(([id, label]) => (
                    <button key={id} type="button" onClick={() => choose(id)}
                        className={`rounded-lg px-3 py-1.5 text-[13px] transition-colors ${mode === id ? 'bg-white font-semibold text-[#111] shadow-sm' : 'text-[#666] hover:text-[#111]'}`}>
                        {label}
                        {id === 'drafts' && dr.count > 0 && (
                            <span className={`ml-1.5 rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${mode === id ? 'bg-[#FFFBE0] text-[#111]' : 'bg-black/5 text-[#666]'}`}>{dr.count}</span>
                        )}
                    </button>
                ))}
            </div>
            <p className="text-[13px] text-[#888] leading-relaxed mt-3">{blurb}</p>
        </div>
    );

    // The editor stays mounted once opened, so a look at Drafts keeps the
    // work. Drafts reloads each visit, to show what was just saved.
    return (
        <>
            <div ref={topRef} />
            {opened.has('post') && (
                <div className={mode === 'post' ? '' : 'hidden'}>
                    <StudioEditor
                        key={dr.editorKey}
                        {...dr.editor}
                        data={data}
                        start={dr.editor.initial ? null : start}
                        brandName={partnerData.name}
                        showRefs={false}
                        // The portal's header sits outside its scroll area, and its foot
                        // is taller than the admin's, so the preview sticks nearer the top
                        // and gives up the difference in height.
                        stickyClass="lg:top-10"
                        canvasInset={80}
                        intro={intro}
                    />
                </div>
            )}
            {mode === 'drafts' && (
                <>
                    <div className="max-w-2xl mb-6">{intro}</div>
                    <DraftsPanel {...dr.panel} />
                </>
            )}
        </>
    );
}
