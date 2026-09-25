import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Film, Lock, Palette, Star, Upload, X } from 'lucide-react';
import { Card, Micro, BTN_GOLD, BTN_GHOST } from '../../components/portal/ui';
import { eventFacts, fetchImage } from '../../studio/data';
import { gymStudioData } from '../../studio/gymData';
import { planKit, buildKit, assetFrom, CLIP_SECONDS, MAX_CLIPS } from '../../studio/kit';
import { statusKey } from './eventUi';

// The Studio, attached to an event: a "before" kit (announce it) and an
// "after" kit (the results and a thank-you), made from the photos and clips
// the gym drops here. Every post at every size, in one ZIP with a folder per
// size and the captions to paste. Nothing leaves the browser but the ZIP.

const PHASES = [
    { key: 'before', label: 'Before', blurb: 'Announce it: a ticket with the join QR, three looks over your lead photo, a teaser over every other photo, and an A4 poster for the front desk.' },
    { key: 'after',  label: 'After',  blurb: 'Wrap it up: the results once the winners are out, a thank-you over your lead photo, and a branded recap of every photo from the night.' },
];

function Thumb({ asset, lead, onLead, onRemove }) {
    const [url, setUrl] = useState(null);
    useEffect(() => {
        const u = URL.createObjectURL(asset.file);
        setUrl(u);
        return () => URL.revokeObjectURL(u);
    }, [asset.file]);
    return (
        <div className="relative shrink-0 w-20">
            <button type="button" onClick={onLead} aria-pressed={lead} aria-label={`${asset.name}${lead ? ', the lead' : ', make this the lead'}`}
                className={`block w-20 h-20 rounded-xl overflow-hidden border-2 transition-all ${lead ? 'border-[#E8D200]' : 'border-transparent hover:border-[#E6E6E1]'}`}>
                {url && (asset.kind === 'video'
                    ? <video src={`${url}#t=0.5`} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                    : <img src={url} alt="" className="w-full h-full object-cover" />)}
            </button>
            {lead && <span className="absolute -top-1.5 -left-1.5 inline-flex items-center gap-1 h-5 px-1.5 rounded-full bg-[#E8D200] text-[8px] font-black uppercase tracking-[0.15em] text-[#080808]"><Star size={8} />Lead</span>}
            {asset.kind === 'video' && <span className="absolute bottom-1.5 left-1.5 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center text-white"><Film size={10} /></span>}
            {onRemove && (
                <button type="button" onClick={onRemove} aria-label={`Remove ${asset.name}`}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-[#E6E6E1] flex items-center justify-center text-[#888] hover:text-[#1A1A1A]">
                    <X size={10} />
                </button>
            )}
        </div>
    );
}

export default function EventContent({ ev, venue, canPost }) {
    const k = statusKey(ev);
    // Promotion runs until the board seals; from then on it's the wrap-up.
    const over = ['locked', 'revealed', 'settled'].includes(k);
    const [phase, setPhase] = useState(over ? 'after' : 'before');
    const [assets, setAssets] = useState([]);
    const [leadId, setLeadId] = useState(null);
    const [promo, setPromo] = useState(null);       // the event's own promo picture, as an asset
    const [standings, setStandings] = useState(null);
    const [options, setOptions] = useState({ print: true, clips: true, landscape: true });
    const [busy, setBusy] = useState(null);         // { fraction, label }
    const [made, setMade] = useState(null);         // { blob, names, name }
    const [error, setError] = useState(null);
    const [dragOver, setDragOver] = useState(false);
    const abortRef = useRef(null);
    const nextId = useRef(1);

    // The event's promo picture stands in until the gym drops its own.
    useEffect(() => {
        let alive = true;
        setPromo(null);
        if (!ev.promo_media_url) return undefined;
        fetchImage(ev.promo_media_url, ev.promo_media_url.split('/').pop().split('?')[0] || 'promo')
            .then((file) => { if (alive) setPromo(assetFrom(file, 'promo')); })
            .catch(() => {});
        return () => { alive = false; };
    }, [ev.promo_media_url]);

    // Final standings, only once the winners are out (a post must not beat the reveal).
    const facts = useMemo(() => eventFacts({ ...ev, partners: { name: venue.name, address: venue.address } }), [ev, venue.name, venue.address]);
    useEffect(() => {
        let alive = true;
        if (facts.board !== 'final') { setStandings([]); return undefined; }
        gymStudioData({ partner_id: ev.venue_partner_id, name: venue.name, address: venue.address }).eventStandings(ev.id, 5)
            .then((rows) => { if (alive) setStandings(rows); })
            .catch(() => { if (alive) setStandings([]); });
        return () => { alive = false; };
    }, [ev.id, ev.venue_partner_id, facts.board, venue.name, venue.address]);

    const all = useMemo(() => (assets.length ? assets : promo ? [promo] : []), [assets, promo]);
    const jobs = useMemo(() => planKit({ phase, facts: { ...facts, standings: standings ?? [] }, assets: all, leadId, options }), [phase, facts, standings, all, leadId, options]);
    const stills = jobs.filter((j) => j.kind === 'png');
    const clips = jobs.filter((j) => j.kind === 'mp4');
    const pdfs = jobs.filter((j) => j.kind === 'pdf');
    const posts = new Set(stills.map((j) => j.file)).size;
    const videos = all.filter((a) => a.kind === 'video');

    const take = (files) => {
        const list = [...files].filter((f) => /^(image|video)\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|mp4|mov|m4v|webm)$/i.test(f.name));
        if (!list.length) return;
        setAssets((prev) => [...prev, ...list.map((f) => assetFrom(f, `a${nextId.current++}`))]);
        setMade(null);
        setError(null);
    };
    const remove = (id) => { setAssets((prev) => prev.filter((a) => a.id !== id)); if (leadId === id) setLeadId(null); setMade(null); };

    const make = async () => {
        const ac = new AbortController();
        abortRef.current = ac;
        setBusy({ fraction: 0, label: 'Getting ready' });
        setError(null);
        setMade(null);
        try {
            const { blob, names } = await buildKit({
                phase, facts: { ...facts, standings: standings ?? [] }, jobs, signal: ac.signal,
                onProgress: (fraction, job) => setBusy({ fraction, label: job?.label ?? '' }),
            });
            const name = `POWR - ${ev.name} - ${phase}.zip`;
            setMade({ blob, names, name });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
        } catch (e) {
            // Only the gym's own Cancel is silent; anything else says why.
            if (!ac.signal.aborted) setError(e.message || 'The kit couldn’t be made.');
        } finally {
            setBusy(null);
            abortRef.current = null;
        }
    };
    const again = () => {
        if (!made) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(made.blob);
        a.download = made.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    };

    if (!canPost) {
        return (
            <Card className="p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-3"><Lock size={13} className="text-[#8a7600]" /><Micro gold>Clash Pro</Micro></div>
                <div className="text-2xl font-light tracking-tight">Posts, made for you</div>
                <p className="text-[13px] text-[#777] leading-relaxed mt-2 max-w-2xl">
                    Clash Pro turns your photos and clips into every post you need before and after an event, at every size, in one download.
                </p>
                <Link to="/venue/package" className={`${BTN_GHOST} mt-5`}>See packages</Link>
            </Card>
        );
    }

    const current = PHASES.find((p) => p.key === phase);
    const resultsHeld = phase === 'after' && facts.board !== 'final';
    const clipNote = videos.length ? `${Math.min(videos.length, MAX_CLIPS)} clip${Math.min(videos.length, MAX_CLIPS) === 1 ? '' : 's'}, first ${CLIP_SECONDS} s, Story and Post` : null;

    return (
        <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-3"><Palette size={15} className="text-[#8a7600]" /><Micro>Content</Micro></div>
                <div className="inline-flex rounded-full bg-[#F4F4F1] border border-[#E6E6E1] p-0.5" role="radiogroup" aria-label="Which kit">
                    {PHASES.map((p) => (
                        <button key={p.key} type="button" role="radio" aria-checked={phase === p.key} onClick={() => { setPhase(p.key); setMade(null); }}
                            className={`h-8 px-4 rounded-full text-[10px] font-black uppercase tracking-[0.15em] transition-all ${phase === p.key ? 'bg-[#1A1A1A] text-white' : 'text-[#888] hover:text-[#1A1A1A]'}`}>
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>
            <p className="text-[12px] text-[#888] leading-relaxed max-w-2xl">{current.blurb}</p>

            {/* Drop zone + what's in it */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); take(e.dataTransfer.files); }}
                className={`mt-6 rounded-2xl border-2 border-dashed p-5 transition-colors ${dragOver ? 'border-[#E8D200] bg-[#E8D200]/[0.06]' : 'border-[#E6E6E1] bg-[#FAFAF8]'}`}
            >
                <div className="flex flex-wrap items-center gap-4">
                    <label className={`${BTN_GHOST} h-10 cursor-pointer`}>
                        <Upload size={13} /> {all.length ? 'Add more' : 'Add photos and clips'}
                        <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => { take(e.target.files); e.target.value = ''; }} aria-label="Photos and clips for the kit" />
                    </label>
                    <span className="text-[12px] text-[#888]">
                        {all.length === 0
                            ? 'Or drop them here. The first photo leads; tap another to make it the lead.'
                            : assets.length === 0 && promo
                                ? 'Using the event’s promo picture until you add your own.'
                                : `${assets.length} file${assets.length === 1 ? '' : 's'}. The starred one leads; tap another to swap.`}
                    </span>
                </div>
                {all.length > 0 && (
                    <div className="flex gap-4 mt-4 overflow-x-auto pb-1 pt-2 pl-2" style={{ scrollbarWidth: 'none' }}>
                        {all.map((a) => (
                            <Thumb key={a.id} asset={a} lead={(leadId ?? all.find((x) => x.kind === 'image')?.id ?? all[0]?.id) === a.id}
                                onLead={() => setLeadId(a.id)} onRemove={assets.length ? () => remove(a.id) : null} />
                        ))}
                    </div>
                )}
            </div>

            {/* What the kit makes */}
            <div className="mt-6 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-6 items-start">
                <div>
                    <Micro className="mb-2">This kit makes</Micro>
                    <div className="text-[13px] text-[#1A1A1A] leading-relaxed">
                        <b>{posts}</b> post{posts === 1 ? '' : 's'} at {new Set(stills.map((j) => j.format)).size} size{new Set(stills.map((j) => j.format)).size === 1 ? '' : 's'}
                        {pdfs.length ? `, ${pdfs.length} print PDF` : ''}
                        {clips.length ? `, ${clips.length} video${clips.length === 1 ? '' : 's'}` : ''}
                        <span className="text-[#888]"> · {stills.length + pdfs.length + clips.length} files in one ZIP, a folder per size, captions included.</span>
                    </div>
                    {resultsHeld && <p className="text-[11px] text-[#B45309] font-bold mt-2">The Results posts join the kit once the winners are revealed.</p>}
                    {!all.length && <p className="text-[11px] text-[#AAAAAA] mt-2">Without a photo the posts are type on black. Add one and every post gets it.</p>}
                    <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4">
                        {phase === 'before' && (
                            <label className="inline-flex items-center gap-2 text-[12px] text-[#666]"><input type="checkbox" checked={options.print} onChange={(e) => setOptions((o) => ({ ...o, print: e.target.checked }))} className="accent-[#E8D200]" />A4 poster</label>
                        )}
                        <label className="inline-flex items-center gap-2 text-[12px] text-[#666]"><input type="checkbox" checked={options.landscape} onChange={(e) => setOptions((o) => ({ ...o, landscape: e.target.checked }))} className="accent-[#E8D200]" />Landscape for the TV</label>
                        {videos.length > 0 && (
                            <label className="inline-flex items-center gap-2 text-[12px] text-[#666]"><input type="checkbox" checked={options.clips} onChange={(e) => setOptions((o) => ({ ...o, clips: e.target.checked }))} className="accent-[#E8D200]" />Clips as video{clipNote ? ` (${clipNote})` : ''}</label>
                        )}
                    </div>
                </div>
                <div className="flex flex-col items-start md:items-end gap-2">
                    {busy ? (
                        <>
                            <div className="w-full md:w-64">
                                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.15em] text-[#888] mb-1.5"><span className="truncate">{busy.label || 'Working'}</span><span>{Math.round(busy.fraction * 100)}%</span></div>
                                <div className="h-2 rounded-full bg-[#F4F4F1] overflow-hidden"><div className="h-full rounded-full bg-[#E8D200] transition-[width] duration-300" style={{ width: `${Math.round(busy.fraction * 100)}%` }} /></div>
                            </div>
                            <button type="button" onClick={() => abortRef.current?.abort()} className="text-[10px] uppercase tracking-[0.25em] font-black text-[#AAAAAA] hover:text-[#1A1A1A]">Cancel</button>
                        </>
                    ) : (
                        <>
                            <button type="button" onClick={make} disabled={!jobs.length} className={BTN_GOLD}>
                                <Download size={14} /> Make the kit
                            </button>
                            {made && (
                                <button type="button" onClick={again} className="text-[10px] uppercase tracking-[0.25em] font-black text-[#8a7600]">
                                    Download again · {made.names.length} files
                                </button>
                            )}
                        </>
                    )}
                    {clips.length > 0 && !busy && <span className="text-[10px] text-[#AAAAAA]">Each video takes up to a minute.</span>}
                </div>
            </div>

            {error && <div className="mt-4 text-red-600 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-xl">{error}</div>}
            {made && !busy && <p className="mt-4 text-[12px] font-bold text-[#0B7A57]">Downloaded {made.name} · {made.names.length} files.</p>}

            <div className="mt-5 pt-4 border-t border-[#F0F0EC] flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] text-[#AAAAAA] leading-relaxed">Photos and clips stay on this device. The ZIP is the only thing that leaves it.</p>
                <Link to={`/venue/studio?event=${ev.id}`} className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-black">
                    <span className="text-[#8a7600]">Make one post by hand in the Studio</span>
                </Link>
            </div>
        </Card>
    );
}
