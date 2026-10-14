import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Archive, Check, Download, FolderOpen, Images, Loader2, Pause, Pencil, Play, RefreshCw, RotateCcw, Shuffle, Star, Trash2, TriangleAlert, Upload, X } from 'lucide-react';
import { prepareStudio, COLOURWAYS } from './render';
import { templateById } from './templates';
import { adminStudioData } from './data';
import { zipFiles } from './zip';
import { LIMITS, collect, droppedItems, pickedItems } from './pack/ingest';
import { analyseAll, markDuplicates, quality, weakness } from './pack/analyse';
import { PHASES, phaseFor, planPack, wordsFor, rankPhotos, fit, withLooks, nextTemplate, FORMAT_CHOICES, LOOK_CHOICES, DEFAULT_OPTIONS, REEL_SECONDS } from './pack/plan';
import { buildPack, renderPreview, jobsOf, playReel } from './pack/build';
import { savePack, listPacks, packZip, reopenPack, deletePack } from './pack/store';
import { FORMATS } from './formats';
import { COLOURWAY, decimal, formatLabel, pick } from './labels';
import { formatLocale } from '../lib/i18n';
import { serverErrorText } from '../lib/serverErrors';

/**
 * The pack builder: a whole shoot in, a set of posts out. Drop a folder,
 * files or a ZIP; pick the event (or none) and its stage; the photos are
 * read, ranked and matched to the posts that stage needs. Every post can be
 * swapped, reworded or dropped before it's made. Making it downloads one ZIP
 * and saves the same pack to the event — photos, files and plan — so it can
 * be downloaded again or reopened and reworked later.
 */

const LABEL = 'block text-xs font-semibold text-[#888] mb-1.5 uppercase tracking-wide';
const INPUT = 'w-full rounded-xl border border-[#E6E6E1] bg-[#FAFAF8] px-3 py-2 text-[#111] text-sm focus:outline-none focus:border-[#E8D200]';
const CARD = 'rounded-2xl border border-[#E6E6E1] bg-white p-5';
const CHIP = (on) => `rounded-lg px-2.5 py-1 text-[13px] transition-colors ${on ? 'bg-[#E8D200] text-[#111] font-semibold' : 'bg-[#F4F4F1] text-[#555] hover:text-[#111]'}`;

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function mb(bytes, t) {
    if (bytes >= 1e9) return t('studio:units.gb', { n: decimal(bytes / 1e9, 1) });
    return t('studio:units.mb', { n: Math.max(1, Math.round(bytes / 1e6)) });
}

// The words for pack/plan.js's fixed choices (its own labels stay English:
// the stored pack title uses the stage's).
const PHASE = {
    before: { label: 'studio:pack.phases.before.label', blurb: 'studio:pack.phases.before.blurb' },
    during: { label: 'studio:pack.phases.during.label', blurb: 'studio:pack.phases.during.blurb' },
    after: { label: 'studio:pack.phases.after.label', blurb: 'studio:pack.phases.after.blurb' },
    brand: { label: 'studio:pack.phases.brand.label', blurb: 'studio:pack.phases.brand.blurb' },
};
const LOOK = {
    film: { label: 'studio:pack.looks.film.label', blurb: 'studio:pack.looks.film.blurb' },
    mixed: { label: 'studio:pack.looks.mixed.label', blurb: 'studio:pack.looks.mixed.blurb' },
    colour: { label: 'studio:pack.looks.colour.label', blurb: 'studio:pack.looks.colour.blurb' },
};
// pack/analyse.js weakness() → its word on the grid.
const WEAK = {
    dark: 'studio:pack.weakness.dark',
    soft: 'studio:pack.weakness.soft',
    bright: 'studio:pack.weakness.bright',
    small: 'studio:pack.weakness.small',
};
// The notes planPack() can return, by their exact English (anything else shows as written).
const PLAN_NOTE = {
    'No standings to show yet': 'studio:pack.planNotes.noStandings',
    'The board is sealed until the reveal — Results waits for it': 'studio:pack.planNotes.sealed',
    'No final standings yet': 'studio:pack.planNotes.noFinal',
    'Not enough different photos for a carousel — it needs three that don’t repeat each other.': 'studio:pack.planNotes.noCarousel',
};

/** "14 posts at 2 sizes, an A4 poster, an 8-slide carousel and 2 reels — 38 files" (as build.js describePlan). */
function planSummary(plan, t) {
    const n = plan.posts.length;
    const sizes = plan.options.formats.length;
    const parts = [t('studio:pack.summary.posts', { posts: t('studio:pack.summary.post', { count: n }), sizes: t('studio:pack.summary.size', { count: sizes }) })];
    const posters = plan.posts.filter((p) => p.poster).length;
    if (posters) parts.push(t('studio:pack.summary.poster', { count: posters }));
    if (plan.carousel) {
        const slides = plan.carousel.slides.length;
        parts.push(t([8, 11, 18].includes(slides) ? 'studio:pack.summary.carouselAn' : 'studio:pack.summary.carousel', { n: slides }));
    }
    if (plan.reels.length) parts.push(t('studio:pack.summary.reel', { count: plan.reels.length }));
    const files = jobsOf(plan).filter((j) => j.kind !== 'thumb').length + 1;
    const list = new Intl.ListFormat(formatLocale(), { style: 'long', type: 'conjunction' }).format(parts);
    return t('studio:pack.summary.total', { list, count: files });
}

/** What collect() left out and why (as ingest.js leftOutNote), or null. */
function leftOutText(left, t) {
    const MB = 1024 * 1024;
    const limits = { photos: LIMITS.photos, clips: LIMITS.clips, photoMb: LIMITS.photoBytes / MB, clipMb: LIMITS.clipBytes / MB };
    const parts = [
        [left.overLimit, 'studio:pack.leftOut.overLimit'],
        [left.tooBig, 'studio:pack.leftOut.tooBig'],
        [left.unsupported, 'studio:pack.leftOut.unsupported'],
        [left.badZip, 'studio:pack.leftOut.badZip'],
        [left.duplicate, 'studio:pack.leftOut.duplicate'],
    ].filter(([n]) => n > 0);
    if (!parts.length) return null;
    const total = parts.reduce((sum, [n]) => sum + n, 0);
    return t('studio:pack.leftOut.total', { count: total, reasons: parts.map(([n, key]) => t(key, { count: n, ...limits })).join(', ') });
}

// The grid's little picture of a photo or clip.
const thumbUrlOf = (analysis) => new Promise((res) => analysis.thumb.toBlob((b) => res(b ? URL.createObjectURL(b) : null), 'image/jpeg', 0.75));

function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// A post drawn small, one per frame so a big pack never lands as one stall.
const previewQueue = [];
let previewRunning = false;
function queuePreview(task) {
    previewQueue.push(task);
    if (previewRunning) return;
    previewRunning = true;
    const step = () => {
        const next = previewQueue.shift();
        if (!next) { previewRunning = false; return; }
        try { next(); } catch { /* a preview that fails just stays blank */ }
        requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

function Preview({ plan, post, item, ready, className = '', format = 'post', playing = false, scale = 0.25 }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ready || !ref.current) return undefined;
        let live = true;
        queuePreview(() => { if (live && ref.current) renderPreview(ref.current, plan, post, item, format, scale); });
        return () => { live = false; };
    }, [ready, plan.options.colourway, post, item, format]); // eslint-disable-line react-hooks/exhaustive-deps
    // A reel plays in place: the clip under its words, looping.
    useEffect(() => {
        if (!playing || !ready || !ref.current || item?.kind !== 'clip') return undefined;
        let stop = null;
        let live = true;
        playReel(ref.current, plan, post, item, { scale }).then((s) => { if (live) stop = s; else s(); }).catch(() => {});
        return () => { live = false; stop?.(); };
    }, [playing, ready, post, item]); // eslint-disable-line react-hooks/exhaustive-deps
    return <canvas ref={ref} className={`block w-full rounded-lg bg-[#1d1d1b] ${className}`} style={{ aspectRatio: format === 'story' ? '9 / 16' : '4 / 5' }} />;
}

/**
 * data       where events and standings come from (admin by default; the gym
 *            portal passes gymStudioData, only that gym's events)
 * partnerId  saves and lists this gym's packs instead of POWR's
 * stickyClass where the pack column sticks (the gym portal's header differs)
 */
export default function PackBuilder({ intro = null, data = adminStudioData, partnerId = null, stickyClass = 'lg:top-20' }) {
    const { t } = useTranslation();
    const [ready, setReady] = useState(false);
    const [error, setError] = useState(null);
    // The event
    const [events, setEvents] = useState(null);
    const [eventId, setEventId] = useState('');
    const [standings, setStandings] = useState(null);
    const [phase, setPhase] = useState('brand');
    // The shoot
    const [media, setMedia] = useState([]);
    const [importing, setImporting] = useState(null);
    const [shootNote, setShootNote] = useState(null);
    const [dragOver, setDragOver] = useState(false);
    const [leadId, setLeadId] = useState(null);
    // The pack
    const [options, setOptions] = useState(DEFAULT_OPTIONS);
    const [plan, setPlan] = useState(null);
    const [edited, setEdited] = useState(false);
    const [selected, setSelected] = useState(null);
    // One reel plays at a time (a card's id, or `editor-<id>` for the big preview).
    const [playingReel, setPlayingReel] = useState(null);
    const [building, setBuilding] = useState(null);
    const [result, setResult] = useState(null);
    // Saved packs
    const [saved, setSaved] = useState(null);
    const [savedError, setSavedError] = useState(null);
    const [packBusy, setPackBusy] = useState(null);

    const abortRef = useRef(null);
    const seq = useRef(0);
    const fileRef = useRef(null);
    const folderRef = useRef(null);

    useEffect(() => {
        prepareStudio().then(() => setReady(true)).catch((e) => setError(serverErrorText(e)));
        data.listEvents().then(setEvents).catch((e) => { setEvents([]); setError(serverErrorText(e)); });
    }, [data]);

    const event = useMemo(() => (events ?? []).find((ev) => ev.id === eventId) ?? null, [events, eventId]);
    const facts = useMemo(() => (event ? { ...event, standings: standings ?? [] } : null), [event, standings]);
    const byId = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);

    // ── Planning ───────────────────────────────────────────────────────
    // The plan is rebuilt when what it's made from changes (the event, the
    // stage, the shoot, the lead, what the pack includes). Sizes, look and
    // colours are applied to the plan as it stands, so edits survive them.
    const replan = useCallback((over = {}) => {
        const next = {
            phase, facts, media, leadId, options, ...over,
        };
        if (!next.media.some((m) => m.analysis?.ok) && next.phase === 'brand') { setPlan(null); return; }
        setPlan(planPack(next));
        setSelected(null);
        if (edited) setResult({ ok: true, note: t('studio:pack.replanned') });
        setEdited(false);
    }, [phase, facts, media, leadId, options, edited, t]);

    // Mixed looks follow the photos, so any change of photo, template or order re-deals them.
    const updatePlan = (fn) => {
        setPlan((p) => {
            if (!p) return p;
            const n = fn(p);
            const of = (id) => byId.get(id)?.analysis ?? null;
            return {
                ...n,
                posts: withLooks(n.options, n.posts, of),
                carousel: n.carousel ? { ...n.carousel, slides: withLooks(n.options, n.carousel.slides, of) } : n.carousel,
            };
        });
        setEdited(true);
    };

    // ── The event ──────────────────────────────────────────────────────
    const chooseEvent = async (id) => {
        setEventId(id);
        setStandings(null);
        const ev = (events ?? []).find((x) => x.id === id) ?? null;
        const nextPhase = phaseFor(ev);
        setPhase(nextPhase);
        let rows = [];
        if (ev && ev.board !== 'none') {
            rows = await data.eventStandings(ev.id).catch(() => []);
            setStandings(rows);
        }
        replan({ phase: nextPhase, facts: ev ? { ...ev, standings: rows } : null });
    };

    const choosePhase = (p) => {
        setPhase(p);
        replan({ phase: p });
    };

    const eventNotes = useMemo(() => {
        if (!event) return [];
        const notes = [];
        if (event.hidden) notes.push(t('studio:event.hidden'));
        if (event.status === 'draft') notes.push(t('studio:event.draft'));
        if (event.board === 'sealed' && phase === 'after') notes.push(t('studio:pack.sealedAfter'));
        return notes;
    }, [event, phase, t]);

    // ── The shoot ──────────────────────────────────────────────────────
    const counts = useMemo(() => ({ photos: media.filter((m) => m.kind === 'photo').length, clips: media.filter((m) => m.kind === 'clip').length }), [media]);

    const takeItems = async (itemsPromise) => {
        setError(null);
        setImporting({ label: t('studio:pack.reading'), done: 0, total: 1 });
        try {
            const items = await itemsPromise;
            const { photos, clips, left } = await collect(items, {
                have: counts,
                onProgress: ({ done, total }) => setImporting({ label: t('studio:pack.readingFiles'), done, total }),
            });
            const fresh = [...photos.map((p) => ({ ...p, kind: 'photo' })), ...clips.map((c) => ({ ...c, kind: 'clip' }))];
            const analyses = await analyseAll(fresh, { onProgress: (done, total) => setImporting({ label: t('studio:pack.looking'), done, total }) });
            const out = [];
            let heic = 0;
            let unreadable = 0;
            for (const [i, f] of fresh.entries()) {
                const analysis = analyses[i];
                if (!analysis.ok) {
                    if (analysis.reason === 'heic') heic++; else unreadable++;
                    continue;
                }
                const thumbUrl = await thumbUrlOf(analysis);
                seq.current += 1;
                out.push({ id: `m${seq.current}`, kind: f.kind, path: f.path, file: f.file, analysis, thumbUrl, excluded: false });
            }
            const dups = markDuplicates([...media, ...out]);
            const all = [...media, ...out].map((m) => ({ ...m, dupOf: dups.get(m.id) ?? null }));
            setMedia(all);
            const notes = [leftOutText(left, t)];
            if (heic) notes.push(t('studio:pack.heic', { count: heic }));
            if (unreadable) notes.push(t('studio:pack.unreadable', { count: unreadable }));
            setShootNote(notes.filter(Boolean).join(' ') || null);
            replan({ media: all });
        } catch (e) {
            setError(serverErrorText(e, t('studio:pack.readFailed')));
        } finally {
            setImporting(null);
        }
    };

    const onDrop = (ev) => {
        ev.preventDefault();
        setDragOver(false);
        takeItems(droppedItems(ev.dataTransfer)); // must start inside the handler
    };

    const toggleExclude = (id) => {
        const next = media.map((m) => (m.id === id ? { ...m, excluded: !m.excluded } : m));
        setMedia(next);
        replan({ media: next });
    };
    const chooseLead = (id) => {
        setLeadId(id);
        replan({ leadId: id });
    };
    const clearShoot = () => {
        for (const m of media) if (m.thumbUrl) URL.revokeObjectURL(m.thumbUrl);
        setMedia([]);
        setLeadId(null);
        setShootNote(null);
        replan({ media: [], leadId: null });
    };

    // ── Options ────────────────────────────────────────────────────────
    const setOption = (key, value) => {
        const next = { ...options, [key]: value };
        setOptions(next);
        if (['formats', 'look', 'colourway'].includes(key)) {
            // Applied to the plan as it stands.
            setPlan((p) => {
                if (!p) return p;
                const o = { ...p.options, [key]: value };
                const relook = (list) => withLooks(o, list, (id) => byId.get(id)?.analysis ?? null);
                return {
                    ...p,
                    options: o,
                    posts: key === 'look' ? relook(p.posts) : p.posts,
                    carousel: p.carousel && key === 'look' ? { ...p.carousel, slides: relook(p.carousel.slides) } : p.carousel,
                    reels: key === 'look' ? relook(p.reels) : p.reels,
                };
            });
        } else {
            replan({ options: next });
        }
    };

    // ── Editing the plan ───────────────────────────────────────────────
    const ranked = useMemo(() => rankPhotos(media), [media]);
    const swapPhoto = (post) => {
        const candidates = [...ranked].sort((a, b) => fit(b, post.templateId) - fit(a, post.templateId));
        if (!candidates.length) return;
        const i = candidates.findIndex((p) => p.id === post.mediaId);
        const nextPhoto = candidates[(i + 1) % candidates.length];
        updatePlan((p) => ({ ...p, posts: p.posts.map((x) => (x.id === post.id ? { ...x, mediaId: nextPhoto.id } : x)) }));
    };
    const swapTemplate = (post) => {
        const nextT = nextTemplate(post.templateId, plan.phase);
        updatePlan((p) => ({
            ...p,
            posts: p.posts.map((x) => (x.id === post.id ? { ...x, templateId: nextT, fields: wordsFor(nextT, p.facts ? { ...p.facts, standings: standings ?? [] } : null), poster: false } : x)),
        }));
    };
    const removePost = (id) => updatePlan((p) => ({ ...p, posts: p.posts.filter((x) => x.id !== id) }));
    const removeSlide = (id) => updatePlan((p) => {
        const slides = p.carousel.slides.filter((s) => s.id !== id);
        return { ...p, carousel: slides.length ? { ...p.carousel, slides: slides.map((s, i) => (s.templateId === 'frame' ? { ...s, fields: { ...s.fields, index: `${String(i + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}` } } : s)) } : null };
    });
    const removeReel = (id) => updatePlan((p) => ({ ...p, reels: p.reels.filter((r) => r.id !== id) }));
    const setWord = (id, key, value) => updatePlan((p) => ({
        ...p,
        posts: p.posts.map((x) => (x.id === id ? { ...x, fields: { ...x.fields, [key]: value } } : x)),
        carousel: p.carousel ? { ...p.carousel, slides: p.carousel.slides.map((s) => (s.id === id ? { ...s, fields: { ...s.fields, [key]: value } } : s)) } : null,
        reels: p.reels.map((r) => (r.id === id ? { ...r, fields: { ...r.fields, [key]: value } } : r)),
    }));

    const selectedPost = plan && selected
        ? plan.posts.find((p) => p.id === selected)
            ?? plan.carousel?.slides.map((s) => ({ ...s, look: s.look ?? plan.carousel.look })).find((s) => s.id === selected)
            ?? plan.reels.find((r) => r.id === selected) ?? null
        : null;

    // ── Saved packs ────────────────────────────────────────────────────
    const refreshSaved = useCallback(() => {
        setSavedError(null);
        listPacks({ eventId: eventId || null, partnerId }).then(setSaved).catch((e) => { setSaved([]); setSavedError(serverErrorText(e)); });
    }, [eventId, partnerId]);
    useEffect(() => { refreshSaved(); }, [refreshSaved]);

    const downloadSaved = async (pack) => {
        setPackBusy({ id: pack.id, label: t('studio:pack.saved.fetching') });
        try {
            const zip = await packZip(pack.id, { onProgress: ({ done, total }) => setPackBusy({ id: pack.id, label: t('studio:pack.saved.fetchingN', { n: done, total }) }) });
            downloadBlob(zip, `powr-${slug(pack.title)}.zip`);
        } catch (e) {
            setSavedError(serverErrorText(e));
        } finally {
            setPackBusy(null);
        }
    };

    const reopen = async (pack) => {
        setPackBusy({ id: pack.id, label: t('studio:pack.saved.opening') });
        try {
            const { pack: full, sources } = await reopenPack(pack.id, { onProgress: ({ done, total }) => setPackBusy({ id: pack.id, label: t('studio:pack.saved.fetchingPhotos', { n: done, total }) }) });
            const analyses = await analyseAll(sources, { onProgress: (done, total) => setPackBusy({ id: pack.id, label: t('studio:pack.saved.readingN', { n: done, total }) }) });
            const out = [];
            for (const [i, s] of sources.entries()) {
                const analysis = analyses[i];
                if (!analysis.ok) continue;
                const thumbUrl = await thumbUrlOf(analysis);
                out.push({ id: s.id ?? `m${++seq.current}`, kind: s.kind, path: s.path, file: s.file, analysis, thumbUrl, excluded: false });
                const n = Number(String(s.id ?? '').replace(/\D/g, ''));
                if (n > seq.current) seq.current = n;
            }
            const dups = markDuplicates(out);
            for (const m of media) if (m.thumbUrl) URL.revokeObjectURL(m.thumbUrl);
            setMedia(out.map((m) => ({ ...m, dupOf: dups.get(m.id) ?? null })));
            setEventId(full.live_event_id ?? '');
            // Standings, in case the pack is replanned.
            const ev = (events ?? []).find((x) => x.id === full.live_event_id);
            setStandings(null);
            if (ev && ev.board !== 'none') data.eventStandings(ev.id).then(setStandings).catch(() => {});
            setPhase(full.phase);
            setOptions({ ...DEFAULT_OPTIONS, ...full.plan.options });
            setLeadId(full.plan.leadId ?? null);
            // Looks are dealt again from the photos as read now: a pack saved
            // before looks followed the photos gets them right when reopened.
            const of = (id) => out.find((m) => m.id === id)?.analysis ?? null;
            const o = { ...DEFAULT_OPTIONS, ...full.plan.options };
            setPlan({
                ...full.plan,
                posts: withLooks(o, full.plan.posts, of),
                carousel: full.plan.carousel ? { ...full.plan.carousel, slides: withLooks(o, full.plan.carousel.slides, of) } : null,
                reels: withLooks(o, full.plan.reels ?? [], of),
            });
            setSelected(null);
            setEdited(false);
            setResult({ ok: true, note: t('studio:pack.saved.opened', { title: full.title }) });
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (e) {
            setSavedError(serverErrorText(e));
        } finally {
            setPackBusy(null);
        }
    };

    const remove = async (pack) => {
        if (!window.confirm(t('studio:pack.saved.confirmDelete', { title: pack.title }))) return;
        setPackBusy({ id: pack.id, label: t('studio:pack.saved.deleting') });
        try {
            await deletePack(pack.id);
            refreshSaved();
        } catch (e) {
            setSavedError(serverErrorText(e));
        } finally {
            setPackBusy(null);
        }
    };

    // ── Making it ──────────────────────────────────────────────────────
    // Saved with the pack (and its ZIP's name), so it stays English like the rest of what's stored;
    // the page shows shownTitle, in the reader's language.
    const title = event ? `${event.name} — ${PHASES.find((p) => p.id === phase)?.label ?? phase}` : `Brand pack — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const shownTitle = event
        ? t('studio:pack.title.event', { event: event.name, phase: PHASE[phase] ? t(PHASE[phase].label) : phase })
        : t('studio:pack.title.brand', { date: new Date().toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) });

    const make = async () => {
        if (!plan) return;
        setPlayingReel(null);
        const ac = new AbortController();
        abortRef.current = ac;
        setResult(null);
        setError(null);
        let files = null;
        try {
            setBuilding({ stage: t('studio:pack.stages.rendering'), done: 0, total: 1 });
            files = await buildPack({ plan, media, signal: ac.signal, onProgress: (p) => setBuilding({ stage: t('studio:pack.stages.rendering'), ...p }) });
            setBuilding({ stage: t('studio:pack.stages.zipping'), done: 0, total: 1 });
            const zip = await zipFiles(files.filter((f) => f.role === 'output').map((f) => ({ name: f.name, data: f.blob })));
            downloadBlob(zip, `powr-${slug(title)}.zip`);
            setBuilding({ stage: t('studio:pack.stages.savingEvent'), done: 0, total: 1 });
            const { id, skipped } = await savePack({ plan, title, media, files, partnerId, signal: ac.signal, onProgress: (p) => setBuilding({ stage: t(event ? 'studio:pack.stages.savingEvent' : 'studio:pack.stages.saving'), ...p }) });
            const done = t('studio:pack.done', {
                files: t('studio:pack.count.files', { count: files.filter((f) => f.role === 'output').length }),
                media: t('studio:pack.count.photosOrClips', { count: media.filter((m) => m.analysis?.ok && !m.excluded).length - skipped.length }),
            });
            setResult({
                ok: true,
                id,
                note: skipped.length ? `${done} ${t('studio:pack.skipped', { count: skipped.length })}` : done,
            });
            refreshSaved();
        } catch (e) {
            if (e.name === 'AbortError') setResult({ ok: false, note: files ? t('studio:pack.cancelledSaving') : t('studio:pack.cancelled') });
            else setResult({ ok: false, note: files ? t('studio:pack.saveFailed', { message: serverErrorText(e) }) : serverErrorText(e) });
        } finally {
            setBuilding(null);
            abortRef.current = null;
        }
    };

    // ── Page ───────────────────────────────────────────────────────────
    const usable = media.filter((m) => m.analysis?.ok && !m.excluded);
    const dupCount = media.filter((m) => m.dupOf && !m.excluded).length;
    const weakCount = media.filter((m) => m.kind === 'photo' && !m.dupOf && !m.excluded && weakness(m.analysis)).length;

    return (
        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[400px_minmax(0,1fr)] items-start">
            <div className="space-y-4 min-w-0">
                {intro}

                <div className={CARD}>
                    <span className={LABEL}>{t('studio:pack.event')}</span>
                    <select value={eventId} onChange={(e) => chooseEvent(e.target.value)} disabled={events === null || Boolean(building)} className={INPUT}>
                        <option value="">{events === null ? t('studio:pack.loadingEvents') : t('studio:pack.noEvent')}</option>
                        {(events ?? []).map((ev) => <option key={ev.id} value={ev.id}>{ev.label}</option>)}
                    </select>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {PHASES.filter((p) => (event ? p.id !== 'brand' : p.id === 'brand')).map((p) => (
                            <button key={p.id} type="button" onClick={() => choosePhase(p.id)} disabled={Boolean(building)} className={CHIP(phase === p.id)}>{PHASE[p.id] ? t(PHASE[p.id].label) : p.label}</button>
                        ))}
                    </div>
                    <p className="mt-2 text-[11px] text-[#999]">{PHASE[phase] ? t(PHASE[phase].blurb) : PHASES.find((p) => p.id === phase)?.blurb}</p>
                    {eventNotes.map((n) => (
                        <p key={n} className="mt-2 flex gap-1.5 text-xs text-[#92400E]"><TriangleAlert size={13} className="mt-px flex-none" />{n}</p>
                    ))}
                </div>

                <div
                    className={`${CARD} ${dragOver ? 'ring-2 ring-[#E8D200]' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                >
                    <div className="flex items-center justify-between">
                        <span className={`${LABEL} mb-0`}>{t('studio:pack.photosClips')}</span>
                        {media.length > 0 && (
                            <button type="button" onClick={clearShoot} disabled={Boolean(building || importing)} className="flex items-center gap-1 text-xs text-[#888] hover:text-[#111]">
                                <RotateCcw size={12} /> {t('studio:pack.clear')}
                            </button>
                        )}
                    </div>
                    <input ref={fileRef} type="file" multiple accept="image/*,video/*,.zip,application/zip" className="hidden"
                        onChange={(e) => { takeItems(Promise.resolve(pickedItems(e.target.files))); e.target.value = ''; }} />
                    <input ref={(el) => { folderRef.current = el; if (el) el.setAttribute('webkitdirectory', ''); }} type="file" multiple className="hidden"
                        onChange={(e) => { takeItems(Promise.resolve(pickedItems(e.target.files))); e.target.value = ''; }} />
                    <div className="mt-2 rounded-xl border border-dashed border-[#CFCFC8] bg-[#FAFAF8] px-4 py-5 text-center">
                        {importing ? (
                            <div className="flex flex-col items-center gap-2 text-sm text-[#555]">
                                <Loader2 size={16} className="animate-spin" />
                                {importing.total > 1 ? t('studio:pack.progress', { label: importing.label, n: Math.min(importing.done + 1, importing.total), total: importing.total }) : importing.label}
                            </div>
                        ) : (
                            <>
                                <p className="text-sm text-[#555]">{t('studio:pack.drop')}</p>
                                <div className="mt-3 flex justify-center gap-2">
                                    <button type="button" onClick={() => fileRef.current?.click()} disabled={Boolean(building)}
                                        className="flex items-center gap-1.5 rounded-lg border border-[#E6E6E1] bg-white px-3 py-1.5 text-xs text-[#333] hover:border-[#E8D200]">
                                        <Upload size={13} /> {t('studio:pack.filesOrZip')}
                                    </button>
                                    <button type="button" onClick={() => folderRef.current?.click()} disabled={Boolean(building)}
                                        className="flex items-center gap-1.5 rounded-lg border border-[#E6E6E1] bg-white px-3 py-1.5 text-xs text-[#333] hover:border-[#E8D200]">
                                        <FolderOpen size={13} /> {t('studio:pack.folder')}
                                    </button>
                                </div>
                                <p className="mt-2 text-[11px] text-[#999]">{t('studio:pack.limits', { photos: LIMITS.photos, clips: LIMITS.clips })}</p>
                            </>
                        )}
                    </div>
                    {media.length > 0 && (
                        <>
                            <p className="mt-3 text-xs text-[#555]">
                                {t('studio:pack.count.photos', { count: counts.photos })}{counts.clips ? ` · ${t('studio:pack.count.clips', { count: counts.clips })}` : ''}
                                {dupCount ? ` · ${t('studio:pack.count.dups', { count: dupCount })}` : ''}
                                {weakCount ? ` · ${t('studio:pack.count.weak', { count: weakCount })}` : ''}
                            </p>
                            <div className="mt-2 grid grid-cols-6 gap-1.5">
                                {media.map((m) => {
                                    const isLead = plan?.leadId === m.id;
                                    const weakWord = m.kind === 'photo' ? weakness(m.analysis) : null;
                                    const weak = weakWord ? pick(t, WEAK, weakWord, weakWord) : null;
                                    const tileTitle = m.dupOf
                                        ? (weak ? 'studio:pack.tile.titleDupWeak' : 'studio:pack.tile.titleDup')
                                        : (weak ? 'studio:pack.tile.titleWeak' : 'studio:pack.tile.title');
                                    return (
                                        <div key={m.id} className={`group relative aspect-[4/5] overflow-hidden rounded-md border ${isLead ? 'border-[#E8D200] ring-1 ring-[#E8D200]' : 'border-[#E6E6E1]'} ${m.excluded || m.dupOf ? 'opacity-40' : ''}`}
                                            title={t(tileTitle, { path: m.path, weak, quality: Math.round(quality(m.analysis) * 100) })}>
                                            {m.thumbUrl && <img src={m.thumbUrl} alt="" className="h-full w-full object-cover" />}
                                            {m.kind === 'clip' && <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[9px] text-white">{Math.round(m.analysis.duration)}s</span>}
                                            {(weak || m.dupOf) && !m.excluded && <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] text-white">{m.dupOf ? t('studio:pack.tile.dup') : weak}</span>}
                                            <div className="absolute inset-x-0 top-0 flex justify-between p-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                                {m.kind === 'photo' ? (
                                                    <button type="button" onClick={() => chooseLead(m.id)} title={t('studio:pack.tile.makeLead')} aria-label={t('studio:pack.tile.makeLead')}
                                                        className="rounded bg-black/60 p-0.5 text-white hover:text-[#E8D200]"><Star size={11} className={isLead ? 'fill-[#E8D200] text-[#E8D200]' : ''} /></button>
                                                ) : <span />}
                                                <button type="button" onClick={() => toggleExclude(m.id)} title={t(m.excluded ? 'studio:pack.tile.useIt' : 'studio:pack.tile.leaveOut')} aria-label={t(m.excluded ? 'studio:pack.tile.useIt' : 'studio:pack.tile.leaveOut')}
                                                    className="rounded bg-black/60 p-0.5 text-white hover:text-[#E8D200]">{m.excluded ? <Check size={11} /> : <X size={11} />}</button>
                                            </div>
                                            {isLead && <Star size={11} className="absolute left-1 top-1 fill-[#E8D200] text-[#E8D200] group-hover:hidden" />}
                                        </div>
                                    );
                                })}
                            </div>
                            <p className="mt-2 text-[11px] text-[#999]">{t('studio:pack.leadHint')}</p>
                        </>
                    )}
                    {shootNote && <p className="mt-2 text-xs text-[#92400E]">{shootNote}</p>}
                </div>

                <div className={CARD}>
                    <span className={LABEL}>{t('studio:pack.pack')}</span>
                    <div className="mb-1 text-[11px] text-[#999]">{t('studio:pack.sizes')}</div>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                        {FORMAT_CHOICES.map((f) => {
                            const on = options.formats.includes(f.id);
                            return (
                                <button key={f.id} type="button" disabled={Boolean(building) || (on && options.formats.length === 1)}
                                    onClick={() => setOption('formats', on ? options.formats.filter((x) => x !== f.id) : [...options.formats, f.id])}
                                    className={CHIP(on)}>{FORMATS[f.id] ? `${formatLabel(t, FORMATS[f.id])} ${FORMATS[f.id].ratio}` : f.label}</button>
                            );
                        })}
                    </div>
                    <div className="mb-1 text-[11px] text-[#999]">{t('studio:pack.look')}</div>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                        {LOOK_CHOICES.map((l) => (
                            <button key={l.id} type="button" title={LOOK[l.id] ? t(LOOK[l.id].blurb) : l.blurb} onClick={() => setOption('look', l.id)} disabled={Boolean(building)} className={CHIP(options.look === l.id)}>
                                {LOOK[l.id] ? t(LOOK[l.id].label) : l.label}
                            </button>
                        ))}
                    </div>
                    <div className="mb-1 text-[11px] text-[#999]">{t('studio:pack.colour')}</div>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                        {COLOURWAYS.map((c) => (
                            <button key={c.id} type="button" onClick={() => setOption('colourway', c.id)} disabled={Boolean(building)} className={`${CHIP(options.colourway === c.id)} flex items-center gap-1.5`}>
                                <span className="h-3 w-3 rounded-full border border-black/10" style={{ background: c.accent }} />{pick(t, COLOURWAY, c.id, c.label)}
                            </button>
                        ))}
                    </div>
                    <div className="space-y-1.5 border-t border-[#F0F0EE] pt-3">
                        {[
                            ['poster', t('studio:pack.include.poster'), phase === 'before'],
                            ['carousel', t('studio:pack.include.carousel'), phase === 'after' || phase === 'brand'],
                            ['reels', t('studio:pack.include.reels'), counts.clips > 0],
                            ['extras', t('studio:pack.include.extras'), true],
                        ].filter(([, , show]) => show).map(([key, label]) => (
                            <label key={key} className="flex items-center gap-2 text-sm text-[#333]">
                                <input type="checkbox" checked={Boolean(options[key])} onChange={(e) => setOption(key, e.target.checked)} disabled={Boolean(building)} className="accent-[#E8D200]" />
                                {label}
                            </label>
                        ))}
                    </div>
                </div>

                <div className={CARD}>
                    <div className="flex items-center justify-between">
                        <span className={`${LABEL} mb-0`}>{event ? t('studio:pack.saved.forEvent') : t('studio:pack.saved.packs')}</span>
                        <button type="button" onClick={refreshSaved} className="text-[#888] hover:text-[#111]" aria-label={t('studio:pack.saved.refresh')}><RefreshCw size={13} /></button>
                    </div>
                    {savedError && <p className="mt-2 text-xs text-[#991B1B]">{savedError}</p>}
                    {saved === null ? (
                        <p className="mt-2 flex items-center gap-2 text-xs text-[#888]"><Loader2 size={13} className="animate-spin" /> {t('common:states.loading')}</p>
                    ) : saved.length === 0 ? (
                        <p className="mt-2 text-xs text-[#999]">{t('studio:pack.saved.empty')}</p>
                    ) : (
                        <div className="mt-2 space-y-3">
                            {saved.map((p) => (
                                <div key={p.id} className="rounded-xl border border-[#F0F0EE] p-2.5">
                                    <div className="flex gap-1">
                                        {p.thumbs.map((u) => <img key={u} src={u} alt="" className="h-14 w-11 rounded object-cover" />)}
                                        {!p.thumbs.length && <div className="flex h-14 w-11 items-center justify-center rounded bg-[#F4F4F1]"><Images size={14} className="text-[#BBB]" /></div>}
                                    </div>
                                    <div className="mt-2 text-sm font-semibold text-[#111]">{p.title}</div>
                                    <div className="text-[11px] text-[#888]">
                                        {new Date(p.created_at).toLocaleString(formatLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                        {!event && p.eventName ? ` · ${p.eventName}` : ''}
                                        {` · ${t('studio:pack.saved.meta', { files: t('studio:pack.count.files', { count: p.output_count }), sources: p.source_count, size: mb(p.bytes, t) })}`}
                                    </div>
                                    {p.status !== 'saved' && <div className="mt-1 text-[11px] text-[#92400E]">{p.status === 'saving' ? t('studio:pack.saved.stillSaving') : t('studio:pack.saved.unfinished')}</div>}
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {packBusy?.id === p.id ? (
                                            <span className="flex items-center gap-1.5 text-xs text-[#555]"><Loader2 size={12} className="animate-spin" />{packBusy.label}</span>
                                        ) : (
                                            <>
                                                <button type="button" onClick={() => downloadSaved(p)} disabled={Boolean(packBusy || building) || p.status !== 'saved'} className="flex items-center gap-1 rounded-lg border border-[#E6E6E1] px-2 py-1 text-xs text-[#333] hover:border-[#E8D200] disabled:opacity-40"><Download size={12} /> ZIP</button>
                                                <button type="button" onClick={() => reopen(p)} disabled={Boolean(packBusy || building) || p.status !== 'saved'} className="flex items-center gap-1 rounded-lg border border-[#E6E6E1] px-2 py-1 text-xs text-[#333] hover:border-[#E8D200] disabled:opacity-40"><Pencil size={12} /> {t('studio:pack.saved.open')}</button>
                                                <button type="button" onClick={() => remove(p)} disabled={Boolean(packBusy || building)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[#888] hover:text-[#991B1B] disabled:opacity-40"><Trash2 size={12} /> {t('studio:pack.saved.delete')}</button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ── The pack ─────────────────────────────────────────────── */}
            <div className={`lg:sticky ${stickyClass} min-w-0`}>
                <div className="relative rounded-2xl bg-[#141413] p-4 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <div className="text-sm font-semibold text-white">{shownTitle}</div>
                            <div className="text-xs text-white/50">{plan ? planSummary(plan, t) : t('studio:pack.addPhotosToPlan')}</div>
                        </div>
                        <button type="button" onClick={make} disabled={!ready || !plan || Boolean(building) || (!plan.posts.length && !plan.carousel && !plan.reels.length)}
                            className="flex items-center gap-1.5 rounded-lg bg-[#E8D200] px-3 py-1.5 text-sm font-semibold text-[#111] hover:brightness-95 disabled:opacity-50">
                            {building ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
                            {t('studio:pack.make')}
                        </button>
                    </div>
                    {result && (
                        <div className={`mb-3 flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-xs ${result.ok ? 'bg-white/10 text-white/85' : 'bg-[#7F1D1D]/60 text-white'}`}>
                            <span>{result.note}</span>
                            <button type="button" onClick={() => setResult(null)} aria-label={t('studio:actions.dismiss')} className="text-white/60 hover:text-white"><X size={12} /></button>
                        </div>
                    )}
                    {error && <p className="mb-3 rounded-lg bg-[#7F1D1D]/60 px-3 py-2 text-xs text-white">{error}</p>}

                    {!plan && (
                        <div className="flex aspect-[16/9] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 text-sm text-white/50">
                            <Images size={20} />
                            {eventId ? t('studio:pack.addEventPhotos') : t('studio:pack.pickEvent')}
                        </div>
                    )}
                    {plan && (
                        <>
                            {plan.notes.map((n) => <p key={n} className="mb-2 flex gap-1.5 text-xs text-[#FCD34D]"><TriangleAlert size={13} className="mt-px flex-none" />{PLAN_NOTE[n] ? t(PLAN_NOTE[n]) : n}</p>)}
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                                {plan.posts.map((post) => (
                                    <div key={post.id} className={`rounded-xl p-1.5 ${selected === post.id ? 'bg-[#E8D200]/20 ring-1 ring-[#E8D200]' : 'bg-white/5'}`}>
                                        <button type="button" onClick={() => setSelected(selected === post.id ? null : post.id)} className="block w-full" aria-label={t('studio:pack.edit', { template: templateById(post.templateId).name })}>
                                            <Preview plan={plan} post={post} item={byId.get(post.mediaId)} ready={ready} />
                                        </button>
                                        <div className="mt-1.5 flex items-center justify-between gap-1 px-0.5">
                                            <span className="truncate text-[11px] text-white/70">
                                                {templateById(post.templateId).name}{post.poster ? ' + A4' : ''}
                                            </span>
                                            <span className="flex flex-none gap-0.5">
                                                <button type="button" onClick={() => swapPhoto(post)} title={t('studio:pack.anotherPhoto')} aria-label={t('studio:pack.anotherPhoto')} className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"><Shuffle size={12} /></button>
                                                <button type="button" onClick={() => swapTemplate(post)} title={t('studio:pack.anotherTemplate')} aria-label={t('studio:pack.anotherTemplate')} className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"><RefreshCw size={12} /></button>
                                                <button type="button" onClick={() => removePost(post.id)} title={t('studio:pack.leavePostOut')} aria-label={t('studio:pack.leavePostOut')} className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"><X size={12} /></button>
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {plan.carousel && (
                                <div className="mt-4">
                                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">{t('studio:pack.carousel', { count: plan.carousel.slides.length })}</div>
                                    <div className="flex gap-2 overflow-x-auto pb-1">
                                        {plan.carousel.slides.map((s) => (
                                            <div key={s.id} className={`w-24 flex-none rounded-lg p-1 ${selected === s.id ? 'bg-[#E8D200]/20 ring-1 ring-[#E8D200]' : 'bg-white/5'}`}>
                                                <button type="button" onClick={() => setSelected(selected === s.id ? null : s.id)} className="block w-full" aria-label={t('studio:pack.editSlide')}>
                                                    <Preview plan={plan} post={{ ...s, look: s.look ?? plan.carousel.look }} item={byId.get(s.mediaId)} ready={ready} />
                                                </button>
                                                <button type="button" onClick={() => removeSlide(s.id)} className="mt-1 w-full rounded text-[10px] text-white/50 hover:text-white">{t('studio:pack.remove')}</button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {plan.reels.length > 0 && (
                                <div className="mt-4">
                                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">{t('studio:pack.reels')}</div>
                                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                                        {plan.reels.map((r) => (
                                            <div key={r.id} className={`rounded-xl p-1.5 ${selected === r.id ? 'bg-[#E8D200]/20 ring-1 ring-[#E8D200]' : 'bg-white/5'}`}>
                                                <div className="relative">
                                                    <button type="button" onClick={() => setSelected(selected === r.id ? null : r.id)} className="block w-full" aria-label={t('studio:pack.editReel', { template: templateById(r.templateId).name })}>
                                                        <Preview plan={plan} post={r} item={byId.get(r.mediaId)} ready={ready} format="story" playing={playingReel === r.id} />
                                                    </button>
                                                    <button type="button" onClick={() => setPlayingReel(playingReel === r.id ? null : r.id)}
                                                        aria-label={t(playingReel === r.id ? 'studio:pack.pauseReel' : 'studio:pack.playReel')} title={t(playingReel === r.id ? 'studio:preview.pause' : 'studio:preview.play')}
                                                        className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-black/75 px-2 py-1 text-[11px] text-white hover:bg-black">
                                                        {playingReel === r.id ? <Pause size={10} className="fill-white" /> : <Play size={10} className="fill-white" />}
                                                        {Math.round(Math.min(REEL_SECONDS, byId.get(r.mediaId)?.analysis?.duration ?? REEL_SECONDS))} s
                                                    </button>
                                                </div>
                                                <div className="mt-1.5 flex items-center justify-between gap-1 px-0.5">
                                                    <span className="truncate text-[11px] text-white/70" title={byId.get(r.mediaId)?.path}>{t('studio:pack.reel', { template: templateById(r.templateId).name })}</span>
                                                    <button type="button" onClick={() => removeReel(r.id)} title={t('studio:pack.leaveReelOut')} aria-label={t('studio:pack.leaveReelOut')} className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"><X size={12} /></button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {selectedPost && (
                        <div className="mt-4 rounded-xl bg-white p-4">
                            <div className="mb-3 flex items-center justify-between">
                                <span className={`${LABEL} mb-0`}>{t('studio:pack.wordsOf', { template: templateById(selectedPost.templateId).name })}</span>
                                <button type="button" onClick={() => setSelected(null)} aria-label={t('common:actions.close')} className="text-[#888] hover:text-[#111]"><X size={14} /></button>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
                                {plan.reels.some((r) => r.id === selectedPost.id) ? (
                                    <div className="relative">
                                        <Preview plan={plan} post={selectedPost} item={byId.get(selectedPost.mediaId)} ready={ready} format="story" scale={0.35}
                                            playing={playingReel === `editor-${selectedPost.id}`} />
                                        <button type="button" onClick={() => setPlayingReel(playingReel === `editor-${selectedPost.id}` ? null : `editor-${selectedPost.id}`)}
                                            aria-label={t('studio:pack.playReel')} className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/75 px-2 py-1 text-[11px] text-white hover:bg-black">
                                            {playingReel === `editor-${selectedPost.id}` ? <Pause size={10} className="fill-white" /> : <Play size={10} className="fill-white" />}
                                            {t(playingReel === `editor-${selectedPost.id}` ? 'studio:preview.pause' : 'studio:preview.play')}
                                        </button>
                                    </div>
                                ) : (
                                    <Preview plan={plan} post={selectedPost} item={byId.get(selectedPost.mediaId)} ready={ready} />
                                )}
                                <div className="space-y-2.5">
                                    {templateById(selectedPost.templateId).fields.filter((f) => f.type !== 'image').map((f) => (
                                        <div key={f.key}>
                                            <label className="mb-1 block text-xs text-[#555]">{f.label}</label>
                                            {f.rows > 1 ? (
                                                <textarea rows={f.rows} value={selectedPost.fields[f.key] ?? ''} onChange={(e) => setWord(selectedPost.id, f.key, e.target.value)} className={`${INPUT} resize-none leading-snug`} />
                                            ) : (
                                                <input value={selectedPost.fields[f.key] ?? ''} onChange={(e) => setWord(selectedPost.id, f.key, e.target.value)} className={INPUT} />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {building && (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl bg-black/75 backdrop-blur-[2px]">
                            <div className="text-sm font-semibold text-white">
                                {t('studio:pack.stage', { stage: building.stage })} {building.total > 1 ? `${Math.min(Math.floor(building.done) + 1, building.total)} / ${building.total}` : ''}
                            </div>
                            <div className="h-1.5 w-1/2 overflow-hidden rounded-full bg-white/15">
                                <div className="h-full bg-[#E8D200] transition-[width] duration-200" style={{ width: `${Math.min(100, (building.done / Math.max(1, building.total)) * 100)}%` }} />
                            </div>
                            {building.label && building.label !== 'done' && <div className="max-w-[80%] truncate text-[11px] text-white/50">{building.label}</div>}
                            <button type="button" onClick={() => abortRef.current?.abort()} className="mt-1 flex items-center gap-1 rounded-lg border border-white/20 px-3 py-1 text-xs text-white/80 hover:bg-white/10">
                                <X size={12} /> {t('common:actions.cancel')}
                            </button>
                        </div>
                    )}
                </div>
                {usable.length > 0 && plan && (
                    <p className="mt-2 px-1 text-[11px] text-[#999]">
                        <Trans
                            i18nKey={edited ? 'studio:pack.footerEdited' : 'studio:pack.footer'}
                            components={{ shuffle: <Shuffle size={10} className="inline" />, refresh: <RefreshCw size={10} className="inline" /> }}
                        />
                    </p>
                )}
            </div>
        </div>
    );
}
