import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Film, Lock, Palette, Star, Upload, X } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { Card, Micro, BTN_GOLD, BTN_GHOST } from '../../components/portal/ui';
import { eventFacts, fetchImage } from '../../studio/data';
import { gymStudioData } from '../../studio/gymData';
import { planKit, buildKit, assetFrom, postsOf, renderThumb, mediaFor, releaseMedia, LOOKS, ACCENTS, CLIP_SECONDS, MAX_CLIPS } from '../../studio/kit';
import { statusKey } from './eventUi';
import PostLightbox from './PostLightbox';
import { serverErrorText } from '../../lib/serverErrors';

// The Studio, attached to an event: a "before" kit (announce it) and an
// "after" kit (the results and a thank-you), made from the photos and clips
// the gym drops here. Every post at every size, in one ZIP with a folder per
// size and the captions to paste. Nothing leaves the browser but the ZIP.

const PHASES = [
    { key: 'before', label: 'venueEvents:content.phases.before', blurb: 'venueEvents:content.phases.beforeBlurb' },
    { key: 'after',  label: 'venueEvents:content.phases.after',  blurb: 'venueEvents:content.phases.afterBlurb' },
];

// The Studio's looks and colourways (studio/kit.js), by id. A post's own
// label (Ticket, Results…) comes from the kit and stays as the kit names it.
const LOOK_WORDS = {
    mixed:  ['venueEvents:content.looks.mixed',  'venueEvents:content.looks.mixedBlurb'],
    film:   ['venueEvents:content.looks.film',   'venueEvents:content.looks.filmBlurb'],
    colour: ['venueEvents:content.looks.colour', 'venueEvents:content.looks.colourBlurb'],
};
const ACCENT_WORDS = {
    powr:   ['venueEvents:content.accents.powr',   'venueEvents:content.accents.powrBlurb'],
    gold:   ['venueEvents:content.accents.gold',   'venueEvents:content.accents.goldBlurb'],
    signal: ['venueEvents:content.accents.signal', 'venueEvents:content.accents.signalBlurb'],
    mono:   ['venueEvents:content.accents.mono',   'venueEvents:content.accents.monoBlurb'],
    vary:   ['venueEvents:content.accents.vary',   'venueEvents:content.accents.varyBlurb'],
};
/** The kit's options in the reader's language (one the kit adds later shows as the kit words it). */
const inWords = (t, items, words) => items.map((it) => (words[it.id] ? { ...it, label: t(words[it.id][0]), blurb: t(words[it.id][1]) } : it));

function Thumb({ asset, lead, onLead, onRemove }) {
    const { t } = useTranslation();
    const [url, setUrl] = useState(null);
    useEffect(() => {
        const u = URL.createObjectURL(asset.file);
        setUrl(u);
        return () => URL.revokeObjectURL(u);
    }, [asset.file]);
    return (
        <div className="relative shrink-0 w-20">
            <button type="button" onClick={onLead} aria-pressed={lead} aria-label={lead ? t('venueEvents:content.thumbLeadA11y', { name: asset.name }) : t('venueEvents:content.thumbMakeLeadA11y', { name: asset.name })}
                className={`block w-20 h-20 rounded-xl overflow-hidden border-2 transition-all ${lead ? 'border-[#E8D200]' : 'border-transparent hover:border-[#E6E6E1]'}`}>
                {url && (asset.kind === 'video'
                    ? <video src={`${url}#t=0.5`} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                    : <img src={url} alt="" className="w-full h-full object-cover" />)}
            </button>
            {lead && <span className="absolute -top-1.5 -left-1.5 inline-flex items-center gap-1 h-5 px-1.5 rounded-full bg-[#E8D200] text-[8px] font-black uppercase tracking-[0.15em] text-[#080808]"><Star size={8} />{t('venueEvents:content.lead')}</span>}
            {asset.kind === 'video' && <span className="absolute bottom-1.5 left-1.5 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center text-white"><Film size={10} /></span>}
            {onRemove && (
                <button type="button" onClick={onRemove} aria-label={t('venueEvents:content.removeA11y', { name: asset.name })}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-[#E6E6E1] flex items-center justify-center text-[#888] hover:text-[#1A1A1A]">
                    <X size={10} />
                </button>
            )}
        </div>
    );
}

function Chips({ label, items, value, onChange }) {
    const { t } = useTranslation();
    return (
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={label}>
            <span className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black w-14">{label}</span>
            {items.map((it) => (
                <button key={it.id} type="button" role="radio" aria-checked={value === it.id} aria-label={t('venueEvents:content.chipA11y', { group: label, option: it.label })} title={it.blurb} onClick={() => onChange(it.id)}
                    className={`h-8 px-3.5 rounded-full text-[10px] font-black uppercase tracking-[0.15em] border transition-all ${value === it.id ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-white border-[#E6E6E1] text-[#888] hover:border-[#1A1A1A]/30 hover:text-[#1A1A1A]'}`}>
                    {it.label}
                </button>
            ))}
        </div>
    );
}

export default function EventContent({ ev, venue, canPost }) {
    const { t } = useTranslation();
    const k = statusKey(ev);
    // Promotion runs until the board seals; from then on it's the wrap-up.
    const over = ['locked', 'revealed', 'settled'].includes(k);
    const [phase, setPhase] = useState(over ? 'after' : 'before');
    const [assets, setAssets] = useState([]);
    const [leadId, setLeadId] = useState(null);
    const [promo, setPromo] = useState(null);       // the event's own promo picture, as an asset
    const [standings, setStandings] = useState(null);
    const [options, setOptions] = useState({ print: true, clips: true, landscape: true, look: 'mixed', accent: 'vary' });
    const [thumbs, setThumbs] = useState({});          // stem → data URL, the preview strip
    const [open, setOpen] = useState(null);             // index into posts, when one is shown large
    const [bigFormat, setBigFormat] = useState('post');
    const cacheRef = useRef(new Map());                 // loaded assets, by id; shared with the build
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
    const videos = all.filter((a) => a.kind === 'video');

    const take = (files) => {
        const list = [...files].filter((f) => /^(image|video)\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|mp4|mov|m4v|webm)$/i.test(f.name));
        if (!list.length) return;
        setAssets((prev) => [...prev, ...list.map((f) => assetFrom(f, `a${nextId.current++}`))]);
        setMade(null);
        setError(null);
    };
    const remove = (id) => {
        setAssets((prev) => prev.filter((a) => a.id !== id));
        if (leadId === id) setLeadId(null);
        setMade(null);
        releaseMedia(cacheRef.current.get(id)); cacheRef.current.delete(id);
    };
    useEffect(() => { const cache = cacheRef.current; return () => { for (const m of cache.values()) releaseMedia(m); cache.clear(); }; }, []);

    // The preview strip: one small render per post, redone when anything changes.
    const posts = useMemo(() => postsOf(jobs), [jobs]);
    useEffect(() => {
        if (!posts.length) { setThumbs({}); return undefined; }
        let alive = true;
        const timer = setTimeout(async () => {
            const next = {};
            for (const job of posts) {
                if (!alive) return;
                try {
                    const media = await mediaFor(job.asset, cacheRef.current);
                    if (!alive) return;
                    next[job.stem] = await renderThumb(job, media, 0.2);
                } catch { next[job.stem] = null; }
                if (alive) setThumbs({ ...next });
            }
        }, 250);
        return () => { alive = false; clearTimeout(timer); };
    }, [posts]);

    const make = async () => {
        const ac = new AbortController();
        abortRef.current = ac;
        setBusy({ fraction: 0, label: t('venueEvents:content.gettingReady') });
        setError(null);
        setMade(null);
        try {
            const { blob, names } = await buildKit({
                phase, facts: { ...facts, standings: standings ?? [] }, jobs, signal: ac.signal, mediaCache: cacheRef.current,
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
            if (!ac.signal.aborted) setError(serverErrorText(e) || t('venueEvents:content.failed'));
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
                <div className="text-2xl font-light tracking-tight">{t('venueEvents:content.lockedTitle')}</div>
                <p className="text-[13px] text-[#777] leading-relaxed mt-2 max-w-2xl">
                    {t('venueEvents:content.lockedBody')}
                </p>
                <Link to="/venue/package" className={`${BTN_GHOST} mt-5`}>{t('venueEvents:content.seePackages')}</Link>
            </Card>
        );
    }

    const current = PHASES.find((p) => p.key === phase);
    const resultsHeld = phase === 'after' && facts.board !== 'final';
    const clipNote = videos.length ? t('venueEvents:content.clipNote', { count: Math.min(videos.length, MAX_CLIPS), seconds: CLIP_SECONDS }) : null;
    const looks = inWords(t, LOOKS, LOOK_WORDS);
    const accents = inWords(t, ACCENTS, ACCENT_WORDS);
    const look = looks.find((l) => l.id === options.look)?.blurb;
    const accent = accents.find((a) => a.id === options.accent)?.blurb;
    const sizes = new Set(stills.map((j) => j.format)).size;

    return (
        <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-3"><Palette size={15} className="text-[#8a7600]" /><Micro>{t('venueEvents:content.title')}</Micro></div>
                <div className="inline-flex rounded-full bg-[#F4F4F1] border border-[#E6E6E1] p-0.5" role="radiogroup" aria-label={t('venueEvents:content.whichKitA11y')}>
                    {PHASES.map((p) => (
                        <button key={p.key} type="button" role="radio" aria-checked={phase === p.key} onClick={() => { setPhase(p.key); setMade(null); }}
                            className={`h-8 px-4 rounded-full text-[10px] font-black uppercase tracking-[0.15em] transition-all ${phase === p.key ? 'bg-[#1A1A1A] text-white' : 'text-[#888] hover:text-[#1A1A1A]'}`}>
                            {t(p.label)}
                        </button>
                    ))}
                </div>
            </div>
            <p className="text-[12px] text-[#888] leading-relaxed max-w-2xl">{t(current.blurb)}</p>
            {ev.status === 'draft' && (
                <p className="text-[11px] font-bold text-[#B45309] mt-2">{t('venueEvents:content.draftWarning')}</p>
            )}

            {/* Drop zone + what's in it */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); take(e.dataTransfer.files); }}
                className={`mt-6 rounded-2xl border-2 border-dashed p-5 transition-colors ${dragOver ? 'border-[#E8D200] bg-[#E8D200]/[0.06]' : 'border-[#E6E6E1] bg-[#FAFAF8]'}`}
            >
                <div className="flex flex-wrap items-center gap-4">
                    <label className={`${BTN_GHOST} h-10 cursor-pointer`}>
                        <Upload size={13} /> {all.length ? t('venueEvents:content.addMore') : t('venueEvents:content.addFirst')}
                        <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => { take(e.target.files); e.target.value = ''; }} aria-label={t('venueEvents:content.inputA11y')} />
                    </label>
                    <span className="text-[12px] text-[#888]">
                        {all.length === 0
                            ? t('venueEvents:content.dropHint')
                            : assets.length === 0 && promo
                                ? t('venueEvents:content.usingPromo')
                                : t('venueEvents:content.files', { count: assets.length })}
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

            {/* The look */}
            <div className="mt-5 flex flex-col gap-2.5">
                <Chips label={t('venueEvents:content.look')} items={looks} value={options.look} onChange={(id) => { setOptions((o) => ({ ...o, look: id })); setMade(null); }} />
                <Chips label={t('venueEvents:content.accent')} items={accents} value={options.accent} onChange={(id) => { setOptions((o) => ({ ...o, accent: id })); setMade(null); }} />
                <p className="text-[11px] text-[#AAAAAA]">{t(options.look === 'mixed' ? 'venueEvents:content.lookLineMixed' : 'venueEvents:content.lookLine', { look, accent })}</p>
            </div>

            {/* The posts, small */}
            {posts.length > 0 && (
                <div className="mt-5 flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }} aria-label={t('venueEvents:content.previewA11y')}>
                    {posts.map((job) => (
                        <figure key={job.stem} className="shrink-0 w-24 m-0">
                            <button type="button" onClick={() => { setBigFormat('post'); setOpen(posts.indexOf(job)); }} aria-label={t('venueEvents:content.previewPostA11y', { label: job.label })}
                                className="block w-24 rounded-lg overflow-hidden bg-[#111] border-2 border-transparent hover:border-[#E8D200] focus:border-[#E8D200] outline-none transition-colors" style={{ height: 120 }}>
                                {thumbs[job.stem] ? <img src={thumbs[job.stem]} alt="" data-thumb className="w-full h-full object-cover" /> : <div className="w-full h-full animate-pulse bg-[#1A1A1A]" />}
                            </button>
                            <figcaption className="mt-1.5 text-[9px] uppercase tracking-[0.15em] font-black text-[#888] truncate">{job.label}</figcaption>
                        </figure>
                    ))}
                </div>
            )}

            {/* What the kit makes */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-6 items-start">
                <div>
                    <Micro className="mb-2">{t('venueEvents:content.makes')}</Micro>
                    <div className="text-[13px] text-[#1A1A1A] leading-relaxed">
                        <Trans i18nKey="venueEvents:content.makesPosts" count={posts.length} values={{ sizes: t('venueEvents:content.sizes', { count: sizes }) }} components={{ b: <b /> }} />
                        {pdfs.length ? `, ${t('venueEvents:content.printPdf', { count: pdfs.length })}` : ''}
                        {clips.length ? `, ${t('venueEvents:content.videos', { count: clips.length })}` : ''}
                        <span className="text-[#888]"> · {t('venueEvents:content.zip', { count: stills.length + pdfs.length + clips.length })}</span>
                    </div>
                    {resultsHeld && <p className="text-[11px] text-[#B45309] font-bold mt-2">{t('venueEvents:content.resultsHeld')}</p>}
                    {!all.length && <p className="text-[11px] text-[#AAAAAA] mt-2">{t('venueEvents:content.noPhoto')}</p>}
                    <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4">
                        {phase === 'before' && (
                            <label className="inline-flex items-center gap-2 text-[12px] text-[#666]"><input type="checkbox" checked={options.print} onChange={(e) => setOptions((o) => ({ ...o, print: e.target.checked }))} className="accent-[#E8D200]" />{t('venueEvents:content.poster')}</label>
                        )}
                        <label className="inline-flex items-center gap-2 text-[12px] text-[#666]"><input type="checkbox" checked={options.landscape} onChange={(e) => setOptions((o) => ({ ...o, landscape: e.target.checked }))} className="accent-[#E8D200]" />{t('venueEvents:content.landscape')}</label>
                        {videos.length > 0 && (
                            <label className="inline-flex items-center gap-2 text-[12px] text-[#666]"><input type="checkbox" checked={options.clips} onChange={(e) => setOptions((o) => ({ ...o, clips: e.target.checked }))} className="accent-[#E8D200]" />{clipNote ? t('venueEvents:content.clipsNote', { note: clipNote }) : t('venueEvents:content.clips')}</label>
                        )}
                    </div>
                </div>
                <div className="flex flex-col items-start md:items-end gap-2">
                    {busy ? (
                        <>
                            <div className="w-full md:w-64">
                                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.15em] text-[#888] mb-1.5"><span className="truncate">{busy.label || t('venueEvents:content.working')}</span><span>{Math.round(busy.fraction * 100)}%</span></div>
                                <div className="h-2 rounded-full bg-[#F4F4F1] overflow-hidden"><div className="h-full rounded-full bg-[#E8D200] transition-[width] duration-300" style={{ width: `${Math.round(busy.fraction * 100)}%` }} /></div>
                            </div>
                            <button type="button" onClick={() => abortRef.current?.abort()} className="text-[10px] uppercase tracking-[0.25em] font-black text-[#AAAAAA] hover:text-[#1A1A1A]">{t('common:actions.cancel')}</button>
                        </>
                    ) : (
                        <>
                            <button type="button" onClick={make} disabled={!jobs.length} className={BTN_GOLD}>
                                <Download size={14} /> {t('venueEvents:content.make')}
                            </button>
                            {made && (
                                <button type="button" onClick={again} className="text-[10px] uppercase tracking-[0.25em] font-black text-[#8a7600]">
                                    {t('venueEvents:content.downloadAgain', { count: made.names.length })}
                                </button>
                            )}
                        </>
                    )}
                    {clips.length > 0 && !busy && <span className="text-[10px] text-[#AAAAAA]">{t('venueEvents:content.videoTime')}</span>}
                </div>
            </div>

            {open !== null && posts[open] && (
                <PostLightbox posts={posts} jobs={jobs} index={open} setIndex={setOpen} format={bigFormat} setFormat={setBigFormat} onClose={() => setOpen(null)} cache={cacheRef.current} />
            )}

            {error && <div className="mt-4 text-red-600 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-xl">{error}</div>}
            {made && !busy && <p className="mt-4 text-[12px] font-bold text-[#0B7A57]">{t('venueEvents:content.downloaded', { name: made.name, count: made.names.length })}</p>}

            <div className="mt-5 pt-4 border-t border-[#F0F0EC] flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] text-[#AAAAAA] leading-relaxed">{t('venueEvents:content.privacy')}</p>
                <Link to={`/venue/studio?event=${ev.id}`} className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-black">
                    <span className="text-[#8a7600]">{t('venueEvents:content.studioLink')}</span>
                </Link>
            </div>
        </Card>
    );
}
