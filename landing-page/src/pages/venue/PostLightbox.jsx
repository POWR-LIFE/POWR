import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, Lock, X } from 'lucide-react';
import { FORMATS } from '../../studio/formats';
import { mediaFor, renderThumb, isStill, ACCENTS } from '../../studio/kit';

// One post from a kit, large: the size chips re-render it at that size;
// arrows step through the posts; Esc, the X or the backdrop close it. The
// event page's content kit and the Overview's posts for the week share it.

const lookName = (look = {}) => (look.tint === 'gold' ? 'Gold duotone' : look.mono === 0 ? `Colour${look.tint === 'warm' ? ', warm' : look.tint === 'cool' ? ', cool' : ''}` : 'Film');
const accentName = (style = {}) => ACCENTS.find((a) => a.id === style.colourway)?.label ?? 'POWR gold';

/**
 * `posts`: one job per post (its Post size); `jobs`: every size of every post.
 * `onDownload(job)`, when given, adds a button that saves the post at the size
 * on show; `locked(job)` swaps it for `lockLabel` (the package that unlocks it).
 */
export default function PostLightbox({ posts, jobs, index, setIndex, format, setFormat, onClose, cache, onDownload, locked, lockLabel }) {
    const post = posts[index];
    const sizes = useMemo(() => [...new Set(jobs.filter((j) => j.stem === post.stem && isStill(j)).map((j) => j.format))], [jobs, post.stem]);
    const job = jobs.find((j) => j.stem === post.stem && isStill(j) && j.format === format) ?? jobs.find((j) => j.stem === post.stem && isStill(j));
    const [src, setSrc] = useState(null);
    const [saving, setSaving] = useState(false);
    // Redrawn when what's on the post changes, not when a refresh hands over an equal job.
    const jobKey = JSON.stringify([job.template, job.format, job.fields, job.look, job.style, job.asset?.id ?? null]);
    useEffect(() => {
        let alive = true;
        setSrc(null);
        (async () => {
            try {
                const media = await mediaFor(job.asset, cache);
                const url = await renderThumb(job, media, 0.6);
                if (alive) setSrc(url);
            } catch { if (alive) setSrc(''); }
        })();
        return () => { alive = false; };
    }, [jobKey, cache]); // eslint-disable-line react-hooks/exhaustive-deps
    const prev = useCallback(() => setIndex((i) => (i - 1 + posts.length) % posts.length), [setIndex, posts.length]);
    const next = useCallback(() => setIndex((i) => (i + 1) % posts.length), [setIndex, posts.length]);
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowLeft') prev(); else if (e.key === 'ArrowRight') next(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, prev, next]);
    const F = FORMATS[job.format];
    const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
    useEffect(() => {
        const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    // The largest box of the post's shape that fits, leaving room for the caption.
    const k = Math.min(Math.min(vp.w * 0.92, 900) / F.w, (vp.h - (onDownload ? 190 : 150)) / F.h);
    const box = { width: Math.round(F.w * k), height: Math.round(F.h * k) };
    const isLocked = !!locked?.(job);
    const save = async () => {
        setSaving(true);
        try { await onDownload(job); } finally { setSaving(false); }
    };
    return createPortal(
        <div className="fixed inset-0 z-[1000] bg-black/85 flex flex-col items-center justify-center p-4 sm:p-8" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${post.label}, large`}>
            <button type="button" onClick={onClose} aria-label="Close" className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20"><X size={16} /></button>
            {posts.length > 1 && (
                <>
                    <button type="button" onClick={(e) => { e.stopPropagation(); prev(); }} aria-label="Previous post" className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20"><ChevronLeft size={18} /></button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); next(); }} aria-label="Next post" className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20"><ChevronRight size={18} /></button>
                </>
            )}
            <div className="flex flex-col items-center gap-4 max-w-full" onClick={(e) => e.stopPropagation()}>
                <div className="rounded-xl overflow-hidden bg-[#111] shadow-2xl" style={box}>
                    {src ? <img src={src} alt="" data-big className="w-full h-full object-contain" /> : src === '' ? <div className="w-full h-full flex items-center justify-center text-white/60 text-xs">Couldn’t render this one.</div> : <div className="w-full h-full animate-pulse bg-[#1A1A1A]" />}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-white">
                    <div className="text-center sm:text-left">
                        <div className="text-[10px] font-black uppercase tracking-[0.25em]">{post.label} <span className="text-white/40">· {index + 1} of {posts.length}</span></div>
                        <div className="text-[11px] text-white/60 mt-0.5">{lookName(job.look)} · {accentName(job.style)}</div>
                    </div>
                    <div className="inline-flex rounded-full bg-white/10 p-0.5" role="radiogroup" aria-label="Size">
                        {sizes.map((f) => (
                            <button key={f} type="button" role="radio" aria-checked={format === f} aria-label={`Size: ${FORMATS[f].label}`} onClick={() => setFormat(f)}
                                className={`h-8 px-3.5 rounded-full text-[10px] font-black uppercase tracking-[0.15em] transition-all ${format === f ? 'bg-white text-[#080808]' : 'text-white/70 hover:text-white'}`}>
                                {FORMATS[f].label}
                            </button>
                        ))}
                    </div>
                    {onDownload && (isLocked ? (
                        <span className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-white/10 text-[10px] font-black uppercase tracking-[0.15em] text-[#E8D200]"><Lock size={11} />{lockLabel}</span>
                    ) : (
                        <button type="button" onClick={save} disabled={saving}
                            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.15em] disabled:opacity-60">
                            <Download size={12} />{saving ? 'Saving…' : `Download ${FORMATS[job.format].label}`}
                        </button>
                    ))}
                </div>
            </div>
        </div>,
        document.body,
    );
}
