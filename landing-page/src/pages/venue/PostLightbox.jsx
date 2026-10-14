import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, ChevronLeft, ChevronRight, Copy, Download, Lock, X } from 'lucide-react';
import { FORMATS } from '../../studio/formats';
import { mediaFor, renderThumb, isStill, ACCENTS } from '../../studio/kit';

// One post from a kit, large: the size chips re-render it at that size;
// arrows step through the posts; Esc, the X or the backdrop close it. The
// event page's content kit and the Overview's posts for the week share it.

// The week kit's post names (studio/weekKit.js), in the reader's language.
// Anything else (an event's own name, Gym Clash) shows as it is. The words ON
// the posts, and their captions, stay English: they're published as they are.
const POST_NAME = {
    'Last week': 'venueHome:posts.names.lastWeek',
    'New week': 'venueHome:posts.names.newWeek',
    'Join us': 'venueHome:posts.names.joinUs',
    'The board': 'venueHome:posts.names.board',
    'Top of the board': 'venueHome:posts.names.leader',
    'Show up': 'venueHome:posts.names.showUp',
    'Every session': 'venueHome:posts.names.everySession',
    'The weekend': 'venueHome:posts.names.theWeekend',
    Results: 'venueHome:posts.names.results',
    Weekend: 'venueHome:posts.names.weekend',
    'Every move': 'venueHome:posts.names.everyMove',
    'The streak': 'venueHome:posts.names.streak',
    Earned: 'venueHome:posts.names.earned',
};
// studio/formats.js and studio/kit.js name these in English; by id here.
const FORMAT_NAME = {
    post: 'venueHome:lightbox.formats.post',
    portrait: 'venueHome:lightbox.formats.portrait',
    square: 'venueHome:lightbox.formats.square',
    story: 'venueHome:lightbox.formats.story',
    reel: 'venueHome:lightbox.formats.reel',
    landscape: 'venueHome:lightbox.formats.landscape',
    link: 'venueHome:lightbox.formats.link',
    header: 'venueHome:lightbox.formats.header',
    cover: 'venueHome:lightbox.formats.cover',
    a5: 'venueHome:lightbox.formats.a5',
    a4: 'venueHome:lightbox.formats.a4',
    a3: 'venueHome:lightbox.formats.a3',
};
const ACCENT_NAME = {
    powr: 'venueHome:lightbox.accents.powr',
    gold: 'venueHome:lightbox.accents.gold',
    signal: 'venueHome:lightbox.accents.signal',
    mono: 'venueHome:lightbox.accents.mono',
    vary: 'venueHome:lightbox.accents.vary',
};

/** A post's name for the portal: the week kit's own in the reader's language, any other as it is. */
export function postName(t, label) {
    return POST_NAME[label] ? t(POST_NAME[label]) : label;
}

/** A size's name ("Post", "Story"), in the reader's language. */
export function formatName(t, id) {
    return FORMAT_NAME[id] ? t(FORMAT_NAME[id]) : FORMATS[id]?.label;
}

function lookName(t, look = {}) {
    if (look.tint === 'gold') return t('venueHome:lightbox.looks.gold');
    if (look.mono !== 0) return t('venueHome:lightbox.looks.film');
    if (look.tint === 'warm') return t('venueHome:lightbox.looks.colourWarm');
    return look.tint === 'cool' ? t('venueHome:lightbox.looks.colourCool') : t('venueHome:lightbox.looks.colour');
}

function accentName(t, style = {}) {
    const accent = ACCENTS.find((a) => a.id === style.colourway);
    if (!accent) return t('venueHome:lightbox.accents.powr');
    return ACCENT_NAME[accent.id] ? t(ACCENT_NAME[accent.id]) : accent.label;
}

/**
 * `posts`: one job per post (its Post size); `jobs`: every size of every post.
 * `onDownload(job)`, when given, adds a button that saves the post at the size
 * on show; `locked(job)` swaps it for `lockLabel` (the package that unlocks it).
 */
export default function PostLightbox({ posts, jobs, index, setIndex, format, setFormat, onClose, cache, onDownload, locked, lockLabel }) {
    const { t } = useTranslation();
    const post = posts[index];
    const sizes = useMemo(() => [...new Set(jobs.filter((j) => j.stem === post.stem && isStill(j)).map((j) => j.format))], [jobs, post.stem]);
    const job = jobs.find((j) => j.stem === post.stem && isStill(j) && j.format === format) ?? jobs.find((j) => j.stem === post.stem && isStill(j));
    const [src, setSrc] = useState(null);
    const [saving, setSaving] = useState(false);
    const [copied, setCopied] = useState(false);
    useEffect(() => { setCopied(false); }, [post.stem]);
    const copy = async () => {
        // The caption is published as it is: English, like the post.
        try { await navigator.clipboard.writeText(post.share); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* the browser said no */ }
    };
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
        <div className="fixed inset-0 z-[1000] bg-black/85 flex flex-col items-center justify-center p-4 sm:p-8" onClick={onClose} role="dialog" aria-modal="true" aria-label={t('venueHome:lightbox.large', { label: postName(t, post.label) })}>
            <button type="button" onClick={onClose} aria-label={t('common:actions.close')} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20"><X size={16} /></button>
            {posts.length > 1 && (
                <>
                    <button type="button" onClick={(e) => { e.stopPropagation(); prev(); }} aria-label={t('venueHome:lightbox.previous')} className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20"><ChevronLeft size={18} /></button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); next(); }} aria-label={t('venueHome:lightbox.next')} className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20"><ChevronRight size={18} /></button>
                </>
            )}
            <div className="flex flex-col items-center gap-4 max-w-full" onClick={(e) => e.stopPropagation()}>
                <div className="rounded-xl overflow-hidden bg-[#111] shadow-2xl" style={box}>
                    {src ? <img src={src} alt="" data-big className="w-full h-full object-contain" /> : src === '' ? <div className="w-full h-full flex items-center justify-center text-white/60 text-xs">{t('venueHome:lightbox.renderFailed')}</div> : <div className="w-full h-full animate-pulse bg-[#1A1A1A]" />}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-white">
                    <div className="text-center sm:text-left">
                        <div className="text-[10px] font-black uppercase tracking-[0.25em]">{post.dayLabel ? `${post.dayLabel} · ` : ''}{postName(t, post.label)} <span className="text-white/40">· {t('venueHome:lightbox.position', { index: index + 1, total: posts.length })}</span></div>
                        <div className="text-[11px] text-white/60 mt-0.5">{lookName(t, job.look)} · {accentName(t, job.style)}</div>
                    </div>
                    <div className="inline-flex rounded-full bg-white/10 p-0.5" role="radiogroup" aria-label={t('venueHome:lightbox.size')}>
                        {sizes.map((f) => (
                            <button key={f} type="button" role="radio" aria-checked={format === f} aria-label={t('venueHome:lightbox.sizeOption', { size: formatName(t, f) })} onClick={() => setFormat(f)}
                                className={`h-8 px-3.5 rounded-full text-[10px] font-black uppercase tracking-[0.15em] transition-all ${format === f ? 'bg-white text-[#080808]' : 'text-white/70 hover:text-white'}`}>
                                {formatName(t, f)}
                            </button>
                        ))}
                    </div>
                    {post.share && (
                        <button type="button" onClick={copy}
                            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-white/10 text-white text-[10px] font-black uppercase tracking-[0.15em] hover:bg-white/20">
                            {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? t('venueHome:lightbox.copied') : t('venueHome:lightbox.copyCaption')}
                        </button>
                    )}
                    {onDownload && (isLocked ? (
                        <span className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-white/10 text-[10px] font-black uppercase tracking-[0.15em] text-[#E8D200]"><Lock size={11} />{lockLabel}</span>
                    ) : (
                        <button type="button" onClick={save} disabled={saving}
                            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.15em] disabled:opacity-60">
                            <Download size={12} />{saving ? t('common:actions.saving') : t('venueHome:lightbox.download', { size: formatName(t, job.format) })}
                        </button>
                    ))}
                </div>
            </div>
        </div>,
        document.body,
    );
}
