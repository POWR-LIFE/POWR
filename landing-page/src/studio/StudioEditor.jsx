import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Images, Loader2, Pause, Play, Plus, RefreshCw, RotateCcw, Trash2, TriangleAlert, Upload, X } from 'lucide-react';
import { prepareStudio, renderPost, compositeLayers, fieldDefaults, COLOURWAYS } from './render';
import { TEMPLATES, CATEGORIES, templateById } from './templates';
import { FORMATS, FORMAT_LIST, FORMAT_GROUPS, BLEED_MM } from './formats';
import { pdfFromCanvas, pdfFromPages, jpegPage, mmToPt } from './pdf';
import { HEADLINE_FONTS } from './fonts';
import { TINTS } from './grade';
import { loadMedia } from './media';
import { loadAsset } from './assets';
import { exportVideo, EXPORT_FPS, MAX_CLIP_SECONDS } from './video';
import { listEvents, listRewards, eventStandings, fetchImage } from './data';

/**
 * The Studio editor: pick a template, drop in a photo, change the words.
 * The grade, crop, type sizes and legibility are the templates' job — the
 * controls here are nudges, not a blank canvas.
 *
 * Preview and export share one renderer, so what's on screen is what
 * downloads. While something is being dragged or typed the preview renders
 * at half size; the full-size pass lands a beat after it settles.
 *
 * Every template reports where each field's text landed (info.boxes), so the
 * field being edited is outlined on the preview, and clicking text on the
 * preview jumps to its field. The preview column is sticky — it stays in view
 * while the controls scroll.
 *
 * Video: the same templates play over the clip. Playback builds the design
 * ONCE as two layers (what sits under the footage, and the fades/shading/type
 * over it) and each new frame only re-grades the footage between them — a
 * full re-render per frame couldn't keep up (≈19 of 30 fps, 100 ms+ stalls on
 * an Intel MacBook). React doesn't re-render during playback either: the time
 * readout and scrubber are written directly. Export is frame-by-frame in the
 * browser (video.js) and shares the render cache so the file matches.
 */

const LOOK_SLIDERS = [
    { key: 'exposure', label: 'Brightness',    min: -1,  max: 1,    step: 0.05 },
    { key: 'contrast', label: 'Contrast',      min: 0,   max: 1,    step: 0.05 },
    { key: 'grain',    label: 'Grain',         min: 0,   max: 1,    step: 0.05 },
    { key: 'motion',   label: 'Motion blur',   min: 0,   max: 1,    step: 0.05 },
    { key: 'vignette', label: 'Vignette',      min: 0,   max: 1,    step: 0.05 },
    { key: 'size',     label: 'Headline size', min: 0.6, max: 1.15, step: 0.01 },
];

const LABEL = 'block text-xs font-semibold text-[#888] mb-1.5 uppercase tracking-wide';
const INPUT = 'w-full rounded-xl border border-[#E6E6E1] bg-[#FAFAF8] px-3 py-2 text-[#111] text-sm focus:outline-none focus:border-[#E8D200]';
const CARD = 'rounded-2xl border border-[#E6E6E1] bg-white p-5';

// One shared empty look, so a template with no tweaks doesn't read as a new design every render.
const NO_LOOK = {};

const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

// An uploaded (or fetched) image, cleaned for the post, plus a small preview for the field.
async function assetWithPreview(file) {
    const a = await loadAsset(file);
    const pv = document.createElement('canvas');
    const k = Math.min(1, 160 / Math.max(a.image.width, a.image.height));
    pv.width = Math.max(1, Math.round(a.image.width * k));
    pv.height = Math.max(1, Math.round(a.image.height * k));
    pv.getContext('2d').drawImage(a.image, 0, 0, pv.width, pv.height);
    a.preview = pv.toDataURL();
    return a;
}

function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export default function StudioEditor({ intro = null }) {
    const [ready, setReady] = useState(false);
    const [error, setError] = useState(null);
    const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
    const [format, setFormat] = useState('post');
    const [media, setMedia] = useState(null);
    const [focal, setFocal] = useState({ x: 0.5, y: 0.42 });
    const [zoom, setZoom] = useState(1);
    const [fields, setFields] = useState(() => Object.fromEntries(TEMPLATES.map((t) => [t.id, fieldDefaults(t)])));
    const [looks, setLooks] = useState({});
    const [assets, setAssets] = useState({}); // { [templateId]: { [fieldKey]: { image, name, preview } } }
    const [style, setStyle] = useState({ colourway: 'powr', headlineFont: '' });
    const [showSafe, setShowSafe] = useState(false);
    const [loadingPhoto, setLoadingPhoto] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [samples, setSamples] = useState([]);
    const [layout, setLayout] = useState(null);
    const [playing, setPlaying] = useState(false);
    const [clip, setClip] = useState({ start: 0, end: 0 });
    const [time, setTime] = useState(0);
    const [frameKey, setFrameKey] = useState(0);
    const [keepSound, setKeepSound] = useState(false);
    const [progress, setProgress] = useState(null);
    // Carousel: one entry per slide. The slide being edited lives in the state
    // above; its entry here is a stale snapshot until you move off it.
    const [slides, setSlides] = useState([{ id: 1 }]);
    const [current, setCurrent] = useState(0);
    // Data fills: the admin's events and rewards (loaded when a template
    // that uses them is first picked), and which one this slide was filled from.
    const [dataLists, setDataLists] = useState({});
    const [picks, setPicks] = useState({});
    const [filling, setFilling] = useState(false);
    const [fillNote, setFillNote] = useState(null);
    const [activeField, setActiveField] = useState(null);
    const [hoverField, setHoverField] = useState(null);

    const canvasRef = useRef(null);
    const infoRef = useRef(null);
    const thumbRefs = useRef({});
    const fieldRefs = useRef({});
    const fileRef = useRef(null);
    const cacheRef = useRef({});
    const cacheFor = useRef(null);
    const optsRef = useRef(null);
    const clipRef = useRef(clip);
    const abortRef = useRef(null);
    const scrubRef = useRef(null);
    const pendingClip = useRef(null);
    const slideThumbs = useRef({});
    const thumbSigs = useRef({});
    const slideSeq = useRef(1);
    const clockRef = useRef(null);

    const isVideo = media?.kind === 'video';
    const template = templateById(templateId);
    const look = looks[templateId] ?? NO_LOOK;
    const eff = { ...template.look, ...look };
    const F = FORMATS[format];
    const group = F.group;
    const groupFormats = FORMAT_LIST.filter((f) => f.group === group);
    // Preview resolution tracks the size: a 4961 px A3 would crawl at full size,
    // and ~1440 px on the long edge is already sharper than the panel shows.
    const fullScale = Math.min(1, 1440 / Math.max(F.w, F.h));

    useEffect(() => {
        prepareStudio()
            .then(({ missing }) => {
                if (missing.length) setError(`Some fonts didn't load (${missing.length}) — check the connection and reload.`);
                setReady(true);
            })
            .catch((e) => setError(e.message));
    }, []);

    // Local test photos (public/studio-samples, gitignored) — dev machines only.
    useEffect(() => {
        fetch('/studio-samples/credits.json')
            .then((r) => (r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : []))
            .then((list) => setSamples(Array.isArray(list) ? list : []))
            .catch(() => {});
    }, []);

    const opts = useMemo(() => ({
        template, format, media, focal, zoom, style,
        fields: fields[templateId],
        look,
        assets: assets[templateId],
    }), [template, format, media, focal, zoom, style, fields, templateId, look, assets]);

    // Keep the latest render's geometry; the outline overlay reads it as state.
    const publish = useCallback((info) => {
        infoRef.current = info;
        const next = { W: info.W, H: info.H, boxes: info.boxes };
        setLayout((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    }, []);

    // Any change to the design starts a fresh render cache (shading is
    // re-measured once, then reused by playback and export).
    if (cacheFor.current !== opts) {
        cacheFor.current = opts;
        cacheRef.current = {};
    }
    optsRef.current = opts;
    clipRef.current = clip;

    // Preview: half size now, full size once input settles. While a video is
    // playing the frame loop below renders instead.
    useEffect(() => {
        if (!ready || !canvasRef.current || playing) return undefined;
        const raf = requestAnimationFrame(() => {
            publish(renderPost(canvasRef.current, { ...opts, scale: fullScale * 0.5, cache: cacheRef.current }));
        });
        const full = setTimeout(() => {
            publish(renderPost(canvasRef.current, { ...opts, scale: fullScale, cache: cacheRef.current }));
        }, 240);
        return () => {
            cancelAnimationFrame(raf);
            clearTimeout(full);
        };
    }, [ready, opts, publish, playing, frameKey, fullScale]);

    // Video playback: render every new frame, loop inside the clip range.
    useEffect(() => {
        const v = isVideo ? media.source : null;
        if (!v || !playing || !ready) return undefined;
        let stopped = false;
        let handle = 0;
        let lastUi = 0;
        const layers = {};
        let builtFor = null;
        const hasRvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
        const next = () => { handle = hasRvfc ? v.requestVideoFrameCallback(step) : requestAnimationFrame(step); };
        function step() {
            if (stopped) return;
            const { start, end } = clipRef.current;
            if (v.currentTime >= end - 0.03 || v.currentTime < start - 0.05) v.currentTime = start;
            const seed = Math.round(v.currentTime * EXPORT_FPS) + 1;
            // (Re)build the layers when the design changes — once at start,
            // then only if something is edited mid-play.
            if (builtFor !== optsRef.current) {
                builtFor = optsRef.current;
                publish(renderPost(null, { ...builtFor, scale: Math.min(0.5, 960 / Math.max(FORMATS[builtFor.format].w, FORMATS[builtFor.format].h)), cache: cacheRef.current, seed, layers }));
            }
            compositeLayers(canvasRef.current, layers, v, { seed });
            const now = performance.now();
            if (now - lastUi > 100) {
                lastUi = now;
                if (scrubRef.current) scrubRef.current.value = String(v.currentTime);
                if (clockRef.current) clockRef.current.textContent = `${v.currentTime.toFixed(1)} / ${v.duration.toFixed(1)} s`;
            }
            next();
        }
        if (v.currentTime < clipRef.current.start || v.currentTime >= clipRef.current.end - 0.03) v.currentTime = clipRef.current.start;
        v.play().catch(() => setPlaying(false));
        next();
        return () => {
            stopped = true;
            if (hasRvfc) v.cancelVideoFrameCallback?.(handle); else cancelAnimationFrame(handle);
            v.pause();
            setTime(v.currentTime);
            setFrameKey((k) => k + 1); // full-size render of the frame we stopped on
        };
    }, [isVideo, media, playing, ready, publish]);

    // A new clip: stop the old one, select the whole thing (up to the cap) —
    // or, moving between carousel slides, the range that slide had.
    useEffect(() => {
        const pending = pendingClip.current;
        pendingClip.current = null;
        setPlaying(false);
        setTime(pending?.time ?? 0);
        if (media?.kind === 'video') setClip(pending?.clip ?? { start: 0, end: Math.min(media.duration, MAX_CLIP_SECONDS) });
        return () => { if (media?.kind === 'video') media.source.pause(); };
    }, [media]);

    useEffect(() => {
        if (!isVideo) return;
        if (scrubRef.current) scrubRef.current.value = String(Math.min(time, media.duration));
        if (clockRef.current) clockRef.current.textContent = `${time.toFixed(1)} / ${media.duration.toFixed(1)} s`;
    }, [time, isVideo, media]);

    const seek = (t) => {
        if (!isVideo) return;
        const v = media.source;
        v.currentTime = t;
        setTime(t);
        v.addEventListener('seeked', () => setFrameKey((k) => k + 1), { once: true });
    };

    // Switching template leaves no field focused on the new one.
    useEffect(() => {
        setActiveField(null);
        setHoverField(null);
    }, [templateId]);

    // Template thumbnails show the current photo in every template — drawn
    // one per frame so ten of them never land as one long stall.
    useEffect(() => {
        if (!ready) return undefined;
        let raf = 0;
        let i = 0;
        const next = () => {
            const tpl = TEMPLATES[i++];
            if (!tpl) return;
            const c = thumbRefs.current[tpl.id];
            if (c) {
                renderPost(c, {
                    template: tpl, format: 'post', media, focal, zoom, style,
                    fields: fields[tpl.id], look: looks[tpl.id] ?? {}, assets: assets[tpl.id], scale: 0.25,
                });
            }
            raf = requestAnimationFrame(next);
        };
        const t = setTimeout(() => { raf = requestAnimationFrame(next); }, 450);
        return () => { clearTimeout(t); cancelAnimationFrame(raf); };
    }, [ready, media, focal, zoom, style, fields, looks, assets, frameKey]);

    const takeFile = useCallback(async (file) => {
        if (!file) return;
        setLoadingPhoto(true);
        setError(null);
        try {
            const m = await loadMedia(file);
            releaseIfUnused(media);
            setMedia(m);
            setFocal({ x: 0.5, y: 0.42 });
            setZoom(1);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoadingPhoto(false);
        }
    }, [media, slides, current]); // eslint-disable-line react-hooks/exhaustive-deps

    // A photo or clip from a URL: the test samples, or a partner's own hero shot.
    const takeUrl = useCallback(async (url, at) => {
        setLoadingPhoto(true);
        setError(null);
        try {
            const m = await loadMedia(url);
            releaseIfUnused(media);
            setMedia(m);
            setFocal(at ?? { x: 0.5, y: 0.42 });
            setZoom(1);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoadingPhoto(false);
        }
    }, [media, slides, current]); // eslint-disable-line react-hooks/exhaustive-deps
    const takeSample = (s) => takeUrl(`/studio-samples/${s.file}`, s.focal);

    // An uploaded clip is held as a blob URL; let it go once nothing uses it.
    function releaseIfUnused(m) {
        if (m?.kind !== 'video' || !m.blob) return;
        if (slides.some((sl, i) => i !== current && sl.media === m)) return;
        m.source.pause();
        m.source.removeAttribute('src');
        m.source.load();
        URL.revokeObjectURL(m.url);
    }

    // ── Carousel ───────────────────────────────────────────────────────
    // Each slide keeps its own template, photo or clip, words and look; the
    // size and style are shared so the slides belong together. Entries hold
    // a snapshot of a slide's state — except the current one, which is
    // edited live in the state above and snapshotted when you move off it.
    const snapshot = () => ({
        id: slides[current].id, templateId, media, focal, zoom, fields, looks, assets, clip, keepSound, picks,
        time: media?.kind === 'video' ? media.source.currentTime : 0,
    });
    const load = (sl) => {
        setPlaying(false);
        setTemplateId(sl.templateId);
        if (sl.media?.kind === 'video') {
            // The same clip can sit on two slides with different trims.
            if (sl.media === media) setClip(sl.clip);
            else pendingClip.current = { clip: sl.clip, time: sl.time };
            sl.media.source.currentTime = sl.time;
            setTime(sl.time);
            sl.media.source.addEventListener('seeked', () => setFrameKey((k) => k + 1), { once: true });
        }
        setMedia(sl.media);
        setFocal(sl.focal);
        setZoom(sl.zoom);
        setFields(sl.fields);
        setLooks(sl.looks);
        setAssets(sl.assets);
        setKeepSound(sl.keepSound);
        setPicks(sl.picks);
        setFillNote(null);
        setActiveField(null);
    };
    const goTo = (i) => {
        if (i === current || i < 0 || i >= slides.length || exporting) return;
        const next = [...slides];
        next[current] = snapshot();
        setSlides(next);
        load(next[i]);
        setCurrent(i);
    };
    // A new slide starts as a copy of this one, so the carousel stays of a piece.
    const addSlide = () => {
        const snap = snapshot();
        const next = [...slides];
        next[current] = snap;
        next.splice(current + 1, 0, { ...snap, id: ++slideSeq.current });
        setSlides(next);
        setCurrent(current + 1);
    };
    const removeSlide = () => {
        if (slides.length < 2 || exporting) return;
        const next = slides.filter((_, i) => i !== current);
        const to = Math.max(0, current - 1);
        if (media?.kind === 'video' && media.blob && !next.some((sl) => sl.media === media)) {
            media.source.pause();
            media.source.removeAttribute('src');
            media.source.load();
            URL.revokeObjectURL(media.url);
        }
        setSlides(next);
        load(next[to]);
        setCurrent(to);
    };
    const moveSlide = (dir) => {
        const j = current + dir;
        if (j < 0 || j >= slides.length) return;
        const next = [...slides];
        next[current] = slides[j];
        next[j] = snapshot();
        setSlides(next);
        setCurrent(j);
    };
    const optsFor = (sl) => ({
        template: templateById(sl.templateId), format, media: sl.media, focal: sl.focal, zoom: sl.zoom, style,
        fields: sl.fields[sl.templateId], look: sl.looks[sl.templateId] ?? {}, assets: sl.assets[sl.templateId],
    });
    const carousel = slides.length > 1;
    const pageWord = F.print ? 'page' : 'slide';

    // Show a video slide at its own paused frame before drawing it as a still.
    const seekTo = (v, t) => new Promise((res) => {
        if (Math.abs(v.currentTime - t) < 0.001) { res(); return; }
        v.addEventListener('seeked', () => res(), { once: true });
        v.currentTime = t;
    });

    // 'files': numbered PNGs (MP4s for video slides) · 'pdf': one PDF, a page
    // per slide — print sizes with bleed, social sizes for LinkedIn.
    const exportCarousel = async (kind) => {
        setPlaying(false);
        const list = slides.map((sl, i) => (i === current ? snapshot() : sl));
        const ac = new AbortController();
        abortRef.current = ac;
        setExporting(true);
        setError(null);
        const n = String(list.length).padStart(2, '0');
        const pages = [];
        try {
            for (const [i, sl] of list.entries()) {
                if (ac.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
                const name = `powr-carousel-${String(i + 1).padStart(2, '0')}-of-${n}-${format}-${stamp()}`;
                const o = optsFor(sl);
                if (kind === 'files' && sl.media?.kind === 'video') {
                    setProgress(i / list.length);
                    const blob = await exportVideo({
                        ...o, start: sl.clip.start, end: sl.clip.end, keepAudio: sl.keepSound, signal: ac.signal,
                        onProgress: (p) => setProgress((i + p) / list.length),
                    });
                    downloadBlob(blob, `${name}.mp4`);
                    await new Promise((res) => setTimeout(res, 400));
                    continue;
                }
                if (sl.media?.kind === 'video') await seekTo(sl.media.source, sl.time);
                const c = document.createElement('canvas');
                const bleed = kind === 'pdf' && F.print ? Math.round((BLEED_MM / 25.4) * 300) : 0;
                renderPost(c, { ...o, scale: 1, bleed });
                if (kind === 'pdf') {
                    pages.push(await jpegPage(c));
                } else {
                    downloadBlob(await new Promise((res) => c.toBlob(res, 'image/png')), `${name}.png`);
                    await new Promise((res) => setTimeout(res, 400));
                }
                c.width = 0; // let the pixels go before the next slide
            }
            if (kind === 'pdf') {
                const size = F.print
                    ? { w: mmToPt(F.print.wMm), h: mmToPt(F.print.hMm), bleed: mmToPt(BLEED_MM) }
                    : { w: F.w, h: F.h };
                downloadBlob(pdfFromPages(pages, size), `powr-${F.print ? 'print' : 'carousel'}-${format}-${list.length}-pages-${stamp()}.pdf`);
            }
        } catch (e) {
            if (e.name !== 'AbortError') setError(e.message || 'The carousel export failed.');
        } finally {
            if (media?.kind === 'video') await seekTo(media.source, list[current].time);
            setExporting(false);
            setProgress(null);
            setFrameKey((k) => k + 1);
            abortRef.current = null;
        }
    };

    // Slide thumbnails: one per frame, and only the ones that changed.
    const thumbH = Math.min(64, (132 * F.h) / F.w);
    const thumbW = (thumbH * F.w) / F.h;
    useEffect(() => {
        if (!ready || !carousel || playing) return undefined;
        const list = slides.map((sl, i) => (i === current ? snapshot() : sl));
        const scale = Math.min(0.3, (thumbH * 2) / F.h);
        let raf = 0;
        let i = 0;
        const next = () => {
            while (i < list.length) {
                const sl = list[i++];
                const c = slideThumbs.current[sl.id];
                if (!c) continue;
                const sig = [c, sl.templateId, sl.media, sl.focal, sl.zoom, sl.fields, sl.looks, sl.assets, style, format, sl.media?.kind === 'video' ? frameKey : 0];
                const prev = thumbSigs.current[sl.id];
                if (prev && prev.every((v, k) => v === sig[k])) continue;
                thumbSigs.current[sl.id] = sig;
                renderPost(c, { ...optsFor(sl), scale });
                raf = requestAnimationFrame(next);
                return;
            }
        };
        const t = setTimeout(() => { raf = requestAnimationFrame(next); }, 400);
        return () => { clearTimeout(t); cancelAnimationFrame(raf); };
    }, [ready, carousel, playing, slides, current, templateId, media, focal, zoom, fields, looks, assets, style, format, frameKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const toCanvas = (ev) => {
        const c = canvasRef.current;
        const r = c.getBoundingClientRect();
        return { cx: ((ev.clientX - r.left) * c.width) / r.width, cy: ((ev.clientY - r.top) * c.height) / r.height };
    };

    // The field whose text is under a canvas point — the smallest box wins,
    // so a note tucked under a label still gets its own hit.
    const fieldAt = (cx, cy) => {
        const info = infoRef.current;
        if (!info?.boxes) return null;
        const pad = 12 * (info.W / 1080);
        let best = null;
        for (const [key, b] of Object.entries(info.boxes)) {
            if (cx < b.x - pad || cx > b.x + b.w + pad || cy < b.y - pad || cy > b.y + b.h + pad) continue;
            if (!template.fields.some((f) => f.key === key)) continue;
            if (!best || b.w * b.h < best.area) best = { key, area: b.w * b.h };
        }
        return best?.key ?? null;
    };

    const editField = (key) => {
        const el = fieldRefs.current[key];
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.focus({ preventScroll: true });
        el.setSelectionRange?.(el.value.length, el.value.length);
    };

    // Click text on the preview to edit it; click anywhere else to put the
    // subject there — the crop re-centres on it, and the templates use it to
    // keep type off faces and to aim the Spec callout.
    const onPreviewClick = (ev) => {
        const info = infoRef.current;
        const c = canvasRef.current;
        if (!info || !c) return;
        const { cx, cy } = toCanvas(ev);
        const hit = fieldAt(cx, cy);
        if (hit) {
            editField(hit);
            return;
        }
        if (!media || !info.photo?.crop) return;
        const { rect, crop, size } = info.photo;
        if (cx < rect.x || cy < rect.y || cx > rect.x + rect.w || cy > rect.y + rect.h) return;
        setFocal({
            x: (crop.sx + ((cx - rect.x) / rect.w) * crop.sw) / size.w,
            y: (crop.sy + ((cy - rect.y) / rect.h) * crop.sh) / size.h,
        });
    };

    // PNG at the size's native pixels; print sizes can also go out as a PDF
    // with a 3 mm bleed (rendered on the bigger canvas, trim marked in the file).
    const exportFormats = async (ids, { pdf = false } = {}) => {
        setExporting(true);
        try {
            for (const id of ids) {
                const Fx = FORMATS[id];
                const c = document.createElement('canvas');
                const asPdf = pdf && Fx.print;
                const bleed = asPdf ? Math.round((BLEED_MM / 25.4) * 300) : 0;
                renderPost(c, { ...opts, format: id, scale: 1, bleed, cache: id === format ? cacheRef.current : {} });
                const blob = asPdf
                    ? await pdfFromCanvas(c, { wMm: Fx.print.wMm, hMm: Fx.print.hMm, bleedMm: BLEED_MM })
                    : await new Promise((res) => c.toBlob(res, 'image/png'));
                downloadBlob(blob, `powr-${templateId}-${id}-${stamp()}.${asPdf ? 'pdf' : 'png'}`);
                if (ids.length > 1) await new Promise((res) => setTimeout(res, 400));
            }
        } finally {
            setExporting(false);
        }
    };

    const exportVideoFormats = async (ids) => {
        setPlaying(false);
        const ac = new AbortController();
        abortRef.current = ac;
        setExporting(true);
        setProgress(0);
        setError(null);
        try {
            for (const [k, id] of ids.entries()) {
                const blob = await exportVideo({
                    ...opts, format: id, start: clip.start, end: clip.end, keepAudio: keepSound,
                    cache: id === format ? cacheRef.current : {},
                    signal: ac.signal,
                    onProgress: (p) => setProgress((k + p) / ids.length),
                });
                downloadBlob(blob, `powr-${templateId}-${id}-${stamp()}.mp4`);
            }
        } catch (e) {
            if (e.name !== 'AbortError') setError(e.message || 'The video export failed.');
        } finally {
            setExporting(false);
            setProgress(null);
            abortRef.current = null;
        }
    };

    // Video downloads as MP4 — except print, where a video's current frame goes to paper.
    const download = (ids) => {
        const print = ids.every((id) => FORMATS[id].print);
        if (print) return exportFormats(ids, { pdf: true });
        return isVideo ? exportVideoFormats(ids) : exportFormats(ids);
    };

    const takeAsset = async (key, file) => {
        if (!file) return;
        setError(null);
        try {
            const a = await assetWithPreview(file);
            setAssets((prev) => ({ ...prev, [templateId]: { ...(prev[templateId] ?? {}), [key]: a } }));
        } catch (e) {
            setError(e.message);
        }
    };

    // ── Fill from data ─────────────────────────────────────────────────
    const fillKinds = Object.keys(template.fill ?? {});
    useEffect(() => {
        for (const kind of fillKinds) {
            if (dataLists[kind] !== undefined) continue;
            setDataLists((d) => ({ ...d, [kind]: 'loading' }));
            (kind === 'event' ? listEvents() : listRewards())
                .then((list) => setDataLists((d) => ({ ...d, [kind]: list })))
                .catch((e) => setDataLists((d) => ({ ...d, [kind]: { error: e.message } })));
        }
    }, [templateId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Picking an event (or reward) fills every template that takes one, on
    // this slide — so switching template shows the same event throughout.
    const fillFrom = async (kind, id) => {
        setPicks((p) => ({ ...p, [kind]: id }));
        const item = Array.isArray(dataLists[kind]) ? dataLists[kind].find((x) => x.id === id) : null;
        if (!item) { setFillNote(null); return; }
        setFilling(true);
        const notes = [];
        try {
            let facts = item;
            if (kind === 'event' && item.board !== 'none') {
                try {
                    facts = { ...item, standings: await eventStandings(item.id) };
                } catch (e) {
                    notes.push({ warn: true, text: e.message });
                }
            }
            const filled = TEMPLATES.filter((t) => t.fill?.[kind]);
            setFields((f) => {
                const next = { ...f };
                for (const t of filled) next[t.id] = { ...f[t.id], ...t.fill[kind](facts) };
                return next;
            });
            if (kind === 'event') {
                const n = facts.standings?.length ?? 0;
                if (item.board === 'none') notes.push({ text: 'No standings yet — Results keeps its own rows until the board opens.' });
                else if (item.board === 'sealed') notes.push({ warn: true, text: `The board is sealed until the reveal — hold a Results post until then. (Top ${n} filled in.)` });
                else if (n) notes.push({ text: `${item.board === 'live' ? 'Live' : 'Final'} top ${n} filled into Results, as of ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.` });
                if (item.hidden) notes.push({ warn: true, text: 'This event is hidden in the app — its QR leads to a page people can’t see yet.' });
                if (item.status === 'draft') notes.push({ warn: true, text: 'Still a draft — the dates and venue may change.' });
            } else {
                if (item.accent) setStyle((st) => ({ ...st, accent: item.accent }));
                if (!item.active) notes.push({ warn: true, text: 'This reward is switched off — it isn’t in the app right now.' });
                if (item.logoUrl) {
                    try {
                        const a = await assetWithPreview(await fetchImage(item.logoUrl, `${item.brand} logo`));
                        setAssets((prev) => {
                            const next = { ...prev };
                            for (const t of filled) {
                                if (t.fields.some((f) => f.key === 'logo')) next[t.id] = { ...(prev[t.id] ?? {}), logo: a };
                            }
                            return next;
                        });
                    } catch {
                        notes.push({ warn: true, text: 'Their logo wouldn’t load — upload it under Words.' });
                    }
                }
            }
            setFillNote({ kind, filled: filled.map((t) => t.name), name: kind === 'event' ? item.name : item.label.split(' · ')[0], notes });
        } finally {
            setFilling(false);
        }
    };
    const dropAsset = (key) => setAssets((prev) => {
        const next = { ...(prev[templateId] ?? {}) };
        delete next[key];
        return { ...prev, [templateId]: next };
    });

    // A starting point swaps in a template's words (and, for partners, their colour).
    const applyPreset = (p) => {
        setFields((f) => ({ ...f, [templateId]: { ...f[templateId], ...p.fields } }));
        if (p.look) setLooks((l) => ({ ...l, [templateId]: { ...(l[templateId] ?? {}), ...p.look } }));
        if (p.style) setStyle((st) => ({ ...st, ...p.style }));
    };

    const setField = (key, value) => setFields((f) => ({ ...f, [templateId]: { ...f[templateId], [key]: value } }));
    const setLook = (key, value) => setLooks((l) => ({ ...l, [templateId]: { ...(l[templateId] ?? {}), [key]: value } }));
    const resetTemplate = () => {
        setFields((f) => ({ ...f, [templateId]: fieldDefaults(template) }));
        setLooks((l) => ({ ...l, [templateId]: {} }));
    };

    const fieldProps = (key) => ({
        ref: (el) => { fieldRefs.current[key] = el; },
        onChange: (e) => setField(key, e.target.value),
        onFocus: () => setActiveField(key),
        onBlur: () => setActiveField((k) => (k === key ? null : k)),
    });

    const onPreviewMove = (ev) => {
        if (!infoRef.current) return;
        const { cx, cy } = toCanvas(ev);
        const hit = fieldAt(cx, cy);
        setHoverField((k) => (k === hit ? k : hit));
    };

    // Outline a field's text on the preview. Boxes are canvas px of the last
    // render, placed as percentages so half- and full-size renders line up.
    const outline = (key, kind) => {
        const b = key && layout?.boxes?.[key];
        if (!b) return null;
        const pad = kind === 'active' ? 7 : 5;
        const pct = (v, of) => `${(v / of) * 100}%`;
        const label = template.fields.find((f) => f.key === key)?.label;
        const nearTop = b.y / layout.H < 0.07;
        return (
            <div
                className={`pointer-events-none absolute rounded-[5px] transition-all duration-150 ${kind === 'active'
                    ? 'border-2 border-[#E8D200] shadow-[0_0_0_3px_rgba(232,210,0,0.22),0_0_24px_rgba(0,0,0,0.35)]'
                    : 'border border-dashed border-white/60'}`}
                style={{
                    left: `calc(${pct(b.x, layout.W)} - ${pad}px)`,
                    top: `calc(${pct(b.y, layout.H)} - ${pad}px)`,
                    width: `calc(${pct(b.w, layout.W)} + ${pad * 2}px)`,
                    height: `calc(${pct(b.h, layout.H)} + ${pad * 2}px)`,
                }}
            >
                {kind === 'active' && label && (
                    <span className={`absolute left-[-2px] whitespace-nowrap rounded-[4px] bg-[#E8D200] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#111] ${nearTop ? 'top-[calc(100%+4px)]' : 'bottom-[calc(100%+4px)]'}`}>
                        {label}
                    </span>
                )}
            </div>
        );
    };

    const onDrop = (ev) => {
        ev.preventDefault();
        setDragOver(false);
        takeFile(ev.dataTransfer.files?.[0]);
    };

    return (
        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[400px_minmax(0,1fr)] items-start">
            {/* ── Controls ─────────────────────────────────────────────── */}
            <div className="space-y-4 min-w-0">
                {intro}
                <div className={CARD}>
                    <span className={LABEL}>Template</span>
                    {CATEGORIES.map((cat) => (
                    <div key={cat} className="mb-3 last:mb-0">
                    <div className="mb-1.5 text-[11px] font-medium text-[#999]">{cat}</div>
                    <div className="grid grid-cols-3 gap-2.5">
                        {TEMPLATES.filter((t) => t.category === cat).map((t) => (
                            <button
                                key={t.id}
                                type="button"
                                onClick={() => setTemplateId(t.id)}
                                className={`flex flex-col justify-start text-left rounded-xl border p-1.5 transition-colors ${t.id === templateId ? 'border-[#E8D200] bg-[#FFFBE0]' : 'border-[#E6E6E1] hover:border-[#CFCFC8]'}`}
                            >
                                <canvas
                                    ref={(el) => { thumbRefs.current[t.id] = el; }}
                                    className="block w-full rounded-lg bg-[#111]"
                                    style={{ aspectRatio: '4 / 5' }}
                                />
                                <div className="px-1 pt-1.5 pb-0.5">
                                    <div className="text-[13px] font-semibold text-[#111]">{t.name}</div>
                                    <div className="text-[11px] leading-tight text-[#888]">After {t.refs}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                    </div>
                    ))}
                    <p className="mt-3 text-xs text-[#888]">{template.blurb}</p>
                </div>

                <div
                    className={`${CARD} ${dragOver ? 'ring-2 ring-[#E8D200]' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                >
                    <span className={LABEL}>Photo or video</span>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/*,video/*"
                        className="hidden"
                        onChange={(e) => { takeFile(e.target.files?.[0]); e.target.value = ''; }}
                    />
                    <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-[#CFCFC8] bg-[#FAFAF8] px-4 py-5 text-sm text-[#555] hover:border-[#E8D200] hover:text-[#111] transition-colors"
                    >
                        {loadingPhoto ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                        {media ? `Replace — ${media.name}` : 'Drop a photo or video here, or click to upload'}
                    </button>
                    {media && (
                        <div className="mt-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-[#888]">Zoom</span>
                                <span className="text-xs tabular-nums text-[#888]">{zoom.toFixed(2)}×</span>
                            </div>
                            <input type="range" min={1} max={2} step={0.01} value={zoom}
                                onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-[#E8D200]" />
                            <p className="text-xs text-[#888] mt-1">Click the subject in the preview to centre the crop on them.</p>
                        </div>
                    )}
                    {isVideo && (
                        <div className="mt-4 space-y-2.5 border-t border-[#F0F0EE] pt-3">
                            <div className="flex items-center justify-between text-xs text-[#888]">
                                <span>Clip</span>
                                <span className="tabular-nums">
                                    {(clip.end - clip.start).toFixed(1)} s{media.duration > MAX_CLIP_SECONDS ? ` · max ${MAX_CLIP_SECONDS} s` : ''}
                                </span>
                            </div>
                            {[['start', 'Starts at'], ['end', 'Ends at']].map(([k, l]) => (
                                <div key={k}>
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-[#555]">{l}</span>
                                        <span className="text-xs tabular-nums text-[#999]">{clip[k].toFixed(1)} s</span>
                                    </div>
                                    <input type="range" min={0} max={media.duration} step={0.1} value={clip[k]}
                                        onChange={(e) => {
                                            const v = Number(e.target.value);
                                            setClip((c) => {
                                                const n = k === 'start'
                                                    ? { start: Math.min(v, c.end - 0.5), end: Math.min(c.end, Math.min(v, c.end - 0.5) + MAX_CLIP_SECONDS) }
                                                    : { start: Math.max(c.start, v - MAX_CLIP_SECONDS), end: Math.max(v, c.start + 0.5) };
                                                return n;
                                            });
                                            seek(k === 'start' ? Math.min(v, clip.end - 0.5) : Math.max(v, clip.start + 0.5) - 0.05);
                                        }}
                                        className="w-full accent-[#E8D200]" />
                                </div>
                            ))}
                            <label className="flex items-center gap-2 text-sm text-[#333]">
                                <input type="checkbox" checked={keepSound} onChange={(e) => setKeepSound(e.target.checked)} className="accent-[#E8D200]" />
                                Keep the clip’s own sound
                            </label>
                            <p className="text-[11px] text-[#999]">Off by default — add trending audio in Instagram or TikTok instead; it reaches further and avoids music claims.</p>
                        </div>
                    )}
                    {samples.length > 0 && (
                        <div className="mt-4">
                            <div className="flex items-center gap-1.5 text-xs text-[#888] mb-2">
                                <Images size={13} /> Test photos &amp; clips (this machine only)
                            </div>
                            <div className="grid grid-cols-6 gap-1.5">
                                {samples.map((s) => (
                                    <button key={s.file} type="button" onClick={() => takeSample(s)} title={`${s.file} — ${s.photographer}`}
                                        className="relative aspect-[4/5] overflow-hidden rounded-md border border-[#E6E6E1] hover:border-[#E8D200]">
                                        {/\.(mp4|mov|webm)$/i.test(s.file) ? (
                                            <>
                                                <video src={`/studio-samples/${s.file}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                                                <Play size={12} className="absolute bottom-1 right-1 fill-white text-white drop-shadow" />
                                            </>
                                        ) : (
                                            <img src={`/studio-samples/${s.file}`} alt="" loading="lazy" className="h-full w-full object-cover" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {fillKinds.map((kind) => {
                    const list = dataLists[kind];
                    const items = Array.isArray(list) ? list : [];
                    const item = items.find((x) => x.id === picks[kind]);
                    const note = fillNote?.kind === kind ? fillNote : null;
                    const users = TEMPLATES.filter((t) => t.fill?.[kind]).map((t) => t.name);
                    return (
                        <div key={kind} className={CARD}>
                            <span className={LABEL}>{kind === 'event' ? 'Fill from an event' : 'Fill from a reward'}</span>
                            <div className="flex items-center gap-2">
                                <select value={picks[kind] ?? ''} disabled={!Array.isArray(list) || filling}
                                    onChange={(e) => fillFrom(kind, e.target.value)} className={INPUT}>
                                    <option value="">
                                        {list === 'loading' || list === undefined ? 'Loading…'
                                            : list?.error ? 'Couldn’t load — see below'
                                            : items.length ? (kind === 'event' ? 'Pick an event…' : 'Pick a reward…') : 'None yet'}
                                    </option>
                                    {items.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                                </select>
                                {item && (
                                    <button type="button" onClick={() => fillFrom(kind, item.id)} disabled={filling}
                                        title="Fill again — picks up edits to the event and the latest standings"
                                        className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-[#E6E6E1] text-[#888] hover:border-[#E8D200] hover:text-[#111] disabled:opacity-50">
                                        {filling ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                    </button>
                                )}
                            </div>
                            {list?.error && <p className="mt-2 text-xs text-[#991B1B]">{list.error}</p>}
                            {note ? (
                                <div className="mt-2.5 space-y-1.5">
                                    <p className="text-xs text-[#555]">Filled {note.filled.join(', ').replace(/, ([^,]*)$/, ' and $1')} from {note.name}. Edit anything after.</p>
                                    {note.notes.map((n) => (
                                        <p key={n.text} className={`flex gap-1.5 text-xs ${n.warn ? 'text-[#92400E]' : 'text-[#888]'}`}>
                                            {n.warn && <TriangleAlert size={13} className="mt-px flex-none" />}{n.text}
                                        </p>
                                    ))}
                                </div>
                            ) : (
                                <p className="mt-2 text-[11px] text-[#999]">
                                    Fills {users.join(', ').replace(/, ([^,]*)$/, ' and $1')} in one go — {kind === 'event' ? 'name, date, venue, the join QR and the standings' : 'the offer, points, logo and brand colour'}.
                                </p>
                            )}
                            {kind === 'reward' && item?.heroUrl && (
                                <button type="button" onClick={() => takeUrl(item.heroUrl)} disabled={loadingPhoto}
                                    className="mt-3 flex items-center gap-1.5 rounded-lg border border-[#E6E6E1] px-3 py-1.5 text-xs text-[#333] hover:border-[#E8D200] disabled:opacity-50">
                                    <Images size={13} /> Use {item.brand}’s own photo
                                </button>
                            )}
                        </div>
                    );
                })}

                <div className={CARD}>
                    <div className="flex items-center justify-between mb-3">
                        <span className={`${LABEL} mb-0`}>Words</span>
                        <button type="button" onClick={resetTemplate} className="flex items-center gap-1 text-xs text-[#888] hover:text-[#111]">
                            <RotateCcw size={12} /> Reset
                        </button>
                    </div>
                    {template.presets?.length > 0 && (
                        <div className="mb-4">
                            <div className="mb-1.5 text-[11px] text-[#999]">Starting points</div>
                            <div className="flex flex-wrap gap-1.5">
                                {template.presets.map((p) => (
                                    <button key={p.name} type="button" onClick={() => applyPreset(p)}
                                        className="rounded-full border border-[#E6E6E1] bg-[#FAFAF8] px-3 py-1 text-xs text-[#333] hover:border-[#E8D200] hover:bg-[#FFFBE0]">
                                        {p.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    <div className="space-y-3">
                        {template.fields.map((f) => (
                            <div key={f.key}>
                                <label className="block text-xs text-[#555] mb-1">{f.label}</label>
                                {f.type === 'image' ? (
                                    <div className="flex items-center gap-2">
                                        <input id={`asset-${templateId}-${f.key}`} type="file" accept="image/*" className="hidden"
                                            onChange={(e) => { takeAsset(f.key, e.target.files?.[0]); e.target.value = ''; }} />
                                        <button type="button"
                                            ref={(el) => { fieldRefs.current[f.key] = el; }}
                                            onFocus={() => setActiveField(f.key)}
                                            onBlur={() => setActiveField((k) => (k === f.key ? null : k))}
                                            onClick={() => document.getElementById(`asset-${templateId}-${f.key}`)?.click()}
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); takeAsset(f.key, e.dataTransfer.files?.[0]); }}
                                            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-dashed border-[#CFCFC8] bg-[#FAFAF8] px-3 py-2 text-left text-sm text-[#555] hover:border-[#E8D200] focus:outline-none focus:border-[#E8D200]">
                                            {assets[templateId]?.[f.key] ? (
                                                <>
                                                    <span className="flex h-9 w-14 flex-none items-center justify-center rounded bg-[#8A8A85] p-1">
                                                        <img src={assets[templateId][f.key].preview} alt="" className="max-h-full max-w-full" />
                                                    </span>
                                                    <span className="truncate">{assets[templateId][f.key].name}</span>
                                                </>
                                            ) : (
                                                <><Upload size={15} className="flex-none" /> Upload or drop an image</>
                                            )}
                                        </button>
                                        {assets[templateId]?.[f.key] && (
                                            <button type="button" onClick={() => dropAsset(f.key)} className="flex-none text-xs text-[#888] hover:text-[#111]">Remove</button>
                                        )}
                                    </div>
                                ) : f.rows > 1 ? (
                                    <textarea rows={f.rows} value={fields[templateId][f.key]} {...fieldProps(f.key)} className={`${INPUT} resize-none leading-snug`} />
                                ) : (
                                    <input value={fields[templateId][f.key]} {...fieldProps(f.key)} className={INPUT} />
                                )}
                                {f.hint && <p className="text-[11px] text-[#999] mt-1">{f.hint}</p>}
                            </div>
                        ))}
                    </div>
                </div>

                <div className={CARD}>
                    <span className={LABEL}>Style</span>
                    {carousel && <p className="-mt-0.5 mb-3 text-[11px] text-[#999]">Colours and fonts apply to every {pageWord}, so they belong together.</p>}
                    <div className="grid grid-cols-4 gap-2 mb-4">
                        {COLOURWAYS.map((c) => (
                            <button key={c.id} type="button" onClick={() => setStyle((s) => ({ ...s, colourway: c.id, accent: '' }))}
                                className={`flex flex-col items-center gap-1.5 rounded-xl border py-2 text-xs transition-colors ${style.colourway === c.id ? 'border-[#E8D200] bg-[#FFFBE0] text-[#111]' : 'border-[#E6E6E1] text-[#555] hover:border-[#CFCFC8]'}`}>
                                <span className="flex">
                                    <span className="h-4 w-4 rounded-full border border-black/10" style={{ background: '#111' }} />
                                    <span className="-ml-1.5 h-4 w-4 rounded-full border border-black/10" style={{ background: c.accent }} />
                                </span>
                                {c.label}
                            </button>
                        ))}
                    </div>
                    <div className="mb-4 flex items-center gap-3">
                        <label className="text-xs text-[#555]">Accent colour</label>
                        <input type="color"
                            value={style.accent || (COLOURWAYS.find((c) => c.id === style.colourway) ?? COLOURWAYS[0]).accent}
                            onChange={(e) => setStyle((st) => ({ ...st, accent: e.target.value }))}
                            className="h-8 w-10 cursor-pointer rounded-lg border border-[#E6E6E1] bg-white p-0.5" />
                        <span className="text-xs tabular-nums text-[#999]">
                            {(style.accent || (COLOURWAYS.find((c) => c.id === style.colourway) ?? COLOURWAYS[0]).accent).toUpperCase()}
                        </span>
                        {style.accent && (
                            <button type="button" onClick={() => setStyle((st) => ({ ...st, accent: '' }))} className="text-xs text-[#888] hover:text-[#111]">
                                Use colourway
                            </button>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs text-[#555] mb-1">Headline font</label>
                            <select value={style.headlineFont} onChange={(e) => setStyle((s) => ({ ...s, headlineFont: e.target.value }))} className={INPUT}>
                                <option value="">Template default</option>
                                {HEADLINE_FONTS.map((f) => <option key={f.id} value={f.id}>{f.label} — {f.note}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-[#555] mb-1">Photo tint</label>
                            <select value={eff.tint} onChange={(e) => setLook('tint', e.target.value)} className={INPUT}>
                                {Object.entries(TINTS).map(([id, t]) => <option key={id} value={id}>{t.label}</option>)}
                            </select>
                        </div>
                        {(template.controls ?? []).map((ctl) => (
                            <div key={ctl.key}>
                                <label className="block text-xs text-[#555] mb-1">{ctl.label}</label>
                                <select value={eff[ctl.key]} onChange={(e) => setLook(ctl.key, e.target.value)} className={INPUT}>
                                    {ctl.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                </select>
                            </div>
                        ))}
                        <label className="flex items-center gap-2 text-sm text-[#333] self-end pb-2">
                            <input type="checkbox" checked={eff.mono >= 0.5} onChange={(e) => setLook('mono', e.target.checked ? 1 : 0)} className="accent-[#E8D200]" />
                            Black &amp; white
                        </label>
                    </div>
                </div>

                <div className={CARD}>
                    <span className={LABEL}>Look</span>
                    <div className="space-y-2.5">
                        {LOOK_SLIDERS.map((s) => (
                            <div key={s.key}>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-[#555]">{s.label}</span>
                                    <span className="text-xs tabular-nums text-[#999]">{Number(eff[s.key] ?? 0).toFixed(2)}</span>
                                </div>
                                <input type="range" min={s.min} max={s.max} step={s.step} value={eff[s.key] ?? 0}
                                    onChange={(e) => setLook(s.key, Number(e.target.value))} className="w-full accent-[#E8D200]" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Preview ──────────────────────────────────────────────── */}
            {/* Sticky: top-20 clears the admin header (h-14). The canvas height
                below keeps the whole panel on screen, including at the very
                bottom of the page, where the layout's bottom spacer would
                otherwise push a taller panel up under the header. */}
            <div className="lg:sticky lg:top-20 min-w-0">
                <div className="rounded-2xl bg-[#141413] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div className="inline-flex rounded-xl bg-white/5 p-1">
                            {FORMAT_GROUPS.map((g) => (
                                <button key={g} type="button"
                                    onClick={() => { if (g !== group) setFormat(FORMAT_LIST.find((f) => f.group === g).id); }}
                                    className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${group === g ? 'bg-white/15 text-white font-semibold' : 'text-white/60 hover:text-white'}`}>
                                    {g}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1.5 text-xs text-white/60 mr-1">
                                <input type="checkbox" checked={showSafe} onChange={(e) => setShowSafe(e.target.checked)} className="accent-[#E8D200]" />
                                Safe zones
                            </label>
                            {carousel ? (
                                <>
                                    <button type="button" disabled={!ready || exporting} onClick={() => download([format])}
                                        title={`Just the ${pageWord} you're on`}
                                        className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/85 hover:bg-white/5 disabled:opacity-50">
                                        This {pageWord}
                                    </button>
                                    {!F.print && (
                                        <button type="button" disabled={!ready || exporting} onClick={() => exportCarousel('pdf')}
                                            title="One PDF, a page per slide — LinkedIn posts carousels as PDF documents"
                                            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/85 hover:bg-white/5 disabled:opacity-50">
                                            PDF
                                        </button>
                                    )}
                                    <button type="button" disabled={!ready || exporting} onClick={() => exportCarousel(F.print ? 'pdf' : 'files')}
                                        title={F.print ? `One print-ready PDF, ${slides.length} pages, ${F.print.wMm}×${F.print.hMm} mm + ${BLEED_MM} mm bleed`
                                            : `${slides.length} numbered files at ${F.w}×${F.h} — PNG, or MP4 for video slides`}
                                        className="flex items-center gap-1.5 rounded-lg bg-[#E8D200] px-3 py-1.5 text-sm font-semibold text-[#111] hover:brightness-95 disabled:opacity-50">
                                        {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                        {F.print ? `Download PDF · ${slides.length} pages` : `Download ${slides.length} slides`}
                                    </button>
                                </>
                            ) : (
                            <>
                            {F.print && (
                                <button type="button" disabled={!ready || exporting} onClick={() => exportFormats([format])}
                                    title={`${F.w}×${F.h} PNG at 300 dpi, no bleed`}
                                    className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/85 hover:bg-white/5 disabled:opacity-50">
                                    PNG
                                </button>
                            )}
                            {isVideo && !F.print && (
                                <button type="button" disabled={!ready || exporting} onClick={() => exportFormats([format])}
                                    title="This frame as a PNG — use it as the Reel cover"
                                    className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/85 hover:bg-white/5 disabled:opacity-50">
                                    Cover
                                </button>
                            )}
                            <button type="button" disabled={!ready || exporting} onClick={() => download([format])}
                                title={F.print ? `Print-ready PDF, ${F.print.wMm}×${F.print.hMm} mm + ${BLEED_MM} mm bleed, 300 dpi`
                                    : isVideo ? `${F.w}×${F.h} MP4, ${EXPORT_FPS} fps` : `${F.w}×${F.h} PNG — exactly what's in the preview`}
                                className="flex items-center gap-1.5 rounded-lg bg-[#E8D200] px-3 py-1.5 text-sm font-semibold text-[#111] hover:brightness-95 disabled:opacity-50">
                                {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                {F.print ? 'Download PDF' : isVideo ? 'Download MP4' : 'Download'}
                            </button>
                            <button type="button" disabled={!ready || exporting} onClick={() => download(groupFormats.map((f) => f.id))}
                                title={`Every ${group.toLowerCase()} size: ${groupFormats.map((f) => f.label).join(', ')}`}
                                className="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/85 hover:bg-white/5 disabled:opacity-50">
                                All {group.toLowerCase()}
                            </button>
                            </>
                            )}
                        </div>
                    </div>
                    <div className="mb-3 flex flex-wrap items-center gap-1.5">
                        {groupFormats.map((f) => (
                            <button key={f.id} type="button" onClick={() => setFormat(f.id)}
                                className={`rounded-lg px-2.5 py-1 text-[13px] transition-colors ${format === f.id ? 'bg-[#E8D200] text-[#111] font-semibold' : 'bg-white/5 text-white/70 hover:text-white'}`}>
                                {f.label} <span className="opacity-60">{f.ratio}</span>
                            </button>
                        ))}
                        <span className="ml-1 text-[11px] text-white/40">
                            {F.note ?? (F.print ? `${F.print.wMm}×${F.print.hMm} mm · 300 dpi` : `${F.w}×${F.h}`)}
                        </span>
                        {!carousel && (
                            <button type="button" onClick={addSlide} disabled={!ready || exporting}
                                title={F.print ? 'Add a page — a flyer back, say. It starts as a copy of this one.' : 'Make a carousel — the new slide starts as a copy of this one'}
                                className="ml-auto flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1 text-[13px] text-white/70 hover:text-white disabled:opacity-50">
                                <Plus size={13} /> Add {pageWord}
                            </button>
                        )}
                    </div>

                    <div
                        className="relative mx-auto max-w-full"
                        style={{
                            aspectRatio: `${F.w} / ${F.h}`,
                            // As tall as the panel allows, but never wider than it — so a
                            // 4:1 cover fits the width and a 9:16 story fits the height.
                            // The carousel strip takes another ~84 px.
                            width: `min(100%, calc(clamp(${isVideo ? 300 : 320}px, calc(100vh - ${(isVideo ? 370 : 325) + (carousel ? 84 : 0)}px), 900px) * ${F.w / F.h}))`,
                        }}
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={onDrop}
                    >
                        <canvas
                            ref={canvasRef}
                            onClick={onPreviewClick}
                            onMouseMove={onPreviewMove}
                            onMouseLeave={() => setHoverField(null)}
                            className={`block h-full w-full rounded-lg shadow-[0_0_0_1px_rgba(255,255,255,0.06)] ${hoverField ? 'cursor-pointer' : media ? 'cursor-crosshair' : ''}`}
                        />
                        {outline(hoverField && hoverField !== activeField ? hoverField : null, 'hover')}
                        {outline(activeField, 'active')}
                        {showSafe && (
                            <div className="pointer-events-none absolute inset-0">
                                <div className="absolute inset-x-0 top-0 bg-[#E8D200]/15 border-b border-dashed border-[#E8D200]/70" style={{ height: `${(F.safe.t / F.h) * 100}%` }} />
                                <div className="absolute inset-x-0 bottom-0 bg-[#E8D200]/15 border-t border-dashed border-[#E8D200]/70" style={{ height: `${(F.safe.b / F.h) * 100}%` }} />
                            </div>
                        )}
                        {!ready && (
                            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/60">
                                <Loader2 size={16} className="animate-spin" /> Loading type…
                            </div>
                        )}
                        {ready && !media && template.photo !== 'optional' && (
                            <button type="button" onClick={() => fileRef.current?.click()}
                                className="absolute inset-x-0 bottom-[42%] mx-auto flex w-max items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm text-white/80 backdrop-blur hover:bg-white/15">
                                <Upload size={15} /> Add a photo or video
                            </button>
                        )}
                        {progress !== null && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-black/70 backdrop-blur-[2px]">
                                <div className="text-sm font-semibold text-white">Rendering MP4… {Math.round(progress * 100)}%</div>
                                <div className="h-1.5 w-1/2 overflow-hidden rounded-full bg-white/15">
                                    <div className="h-full bg-[#E8D200] transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />
                                </div>
                                <button type="button" onClick={() => abortRef.current?.abort()}
                                    className="mt-1 flex items-center gap-1 rounded-lg border border-white/20 px-3 py-1 text-xs text-white/80 hover:bg-white/10">
                                    <X size={12} /> Cancel
                                </button>
                            </div>
                        )}
                    </div>
                    {isVideo && (
                        <div className="mt-3 flex items-center gap-3">
                            <button type="button" onClick={() => setPlaying((p) => !p)} disabled={exporting}
                                className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#E8D200] text-[#111] hover:brightness-95 disabled:opacity-50"
                                aria-label={playing ? 'Pause' : 'Play'}>
                                {playing ? <Pause size={14} className="fill-current" /> : <Play size={14} className="fill-current translate-x-[1px]" />}
                            </button>
                            {/* Uncontrolled: playback writes these directly (no React
                                re-render per frame); `time` syncs them when paused. */}
                            <input ref={scrubRef} type="range" min={0} max={media.duration} step={0.01} defaultValue={0}
                                onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }}
                                className="min-w-0 flex-1 accent-[#E8D200]" />
                            <span ref={clockRef} className="flex-none text-xs tabular-nums text-white/60" />
                        </div>
                    )}
                    {carousel && (
                        <div className="mt-3 flex items-center gap-3">
                            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1 pl-1">
                                {slides.map((sl, i) => (
                                    <button key={sl.id} type="button" onClick={() => goTo(i)}
                                        aria-label={`${pageWord} ${i + 1}`}
                                        className={`relative flex-none rounded-md transition ${i === current ? 'ring-2 ring-[#E8D200]' : 'opacity-60 hover:opacity-100'}`}
                                        style={{ width: thumbW, height: thumbH }}>
                                        <canvas ref={(el) => { slideThumbs.current[sl.id] = el; }} className="block h-full w-full rounded-md bg-[#262624]" />
                                        <span className="absolute left-1 top-1 rounded bg-black/65 px-1 text-[10px] font-semibold leading-4 text-white">{i + 1}</span>
                                    </button>
                                ))}
                                <button type="button" onClick={addSlide} disabled={exporting}
                                    title={`Add a ${pageWord} — it starts as a copy of this one`}
                                    className="flex flex-none items-center justify-center rounded-md border border-dashed border-white/20 text-white/50 hover:border-white/40 hover:text-white disabled:opacity-50"
                                    style={{ width: thumbW, height: thumbH }}>
                                    <Plus size={16} />
                                </button>
                            </div>
                            <div className="flex flex-none items-center gap-1">
                                {[
                                    { label: `Move this ${pageWord} earlier`, icon: <ChevronLeft size={15} />, on: () => moveSlide(-1), off: current === 0 },
                                    { label: `Move this ${pageWord} later`, icon: <ChevronRight size={15} />, on: () => moveSlide(1), off: current === slides.length - 1 },
                                    { label: `Delete this ${pageWord}`, icon: <Trash2 size={14} />, on: removeSlide, off: false },
                                ].map((b) => (
                                    <button key={b.label} type="button" onClick={b.on} disabled={b.off || exporting} title={b.label} aria-label={b.label}
                                        className="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent">
                                        {b.icon}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                </div>
                {error && <p className="mt-3 rounded-xl bg-[#FEE2E2] px-4 py-2.5 text-sm text-[#991B1B]">{error}</p>}
            </div>
        </div>
    );
}
