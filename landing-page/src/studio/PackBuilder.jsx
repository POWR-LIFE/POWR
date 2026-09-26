import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Check, Download, FolderOpen, Images, Loader2, Pencil, RefreshCw, RotateCcw, Shuffle, Star, Trash2, TriangleAlert, Upload, X } from 'lucide-react';
import { prepareStudio, COLOURWAYS } from './render';
import { templateById } from './templates';
import { listEvents, eventStandings } from './data';
import { zipFiles } from './zip';
import { LIMITS, collect, droppedItems, pickedItems, leftOutNote } from './pack/ingest';
import { analyseAll, markDuplicates, quality, weakness } from './pack/analyse';
import { PHASES, phaseFor, planPack, wordsFor, rankPhotos, fit, lookFor, nextTemplate, FORMAT_CHOICES, LOOK_CHOICES, DEFAULT_OPTIONS } from './pack/plan';
import { buildPack, renderPreview, describePlan } from './pack/build';
import { savePack, listPacks, packZip, reopenPack, deletePack } from './pack/store';

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
const mb = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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

function Preview({ plan, post, item, ready, className = '' }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ready || !ref.current) return undefined;
        let live = true;
        queuePreview(() => { if (live && ref.current) renderPreview(ref.current, plan, post, item, 'post', 0.25); });
        return () => { live = false; };
    }, [ready, plan.options.colourway, post, item]); // eslint-disable-line react-hooks/exhaustive-deps
    return <canvas ref={ref} className={`block w-full rounded-lg bg-[#1d1d1b] ${className}`} style={{ aspectRatio: '4 / 5' }} />;
}

export default function PackBuilder({ intro = null }) {
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
        prepareStudio().then(() => setReady(true)).catch((e) => setError(e.message));
        listEvents().then(setEvents).catch((e) => { setEvents([]); setError(e.message); });
    }, []);

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
        if (edited) setResult({ ok: true, note: 'The pack was replanned — earlier swaps and word changes were reset.' });
        setEdited(false);
    }, [phase, facts, media, leadId, options, edited]);

    const updatePlan = (fn) => {
        setPlan((p) => (p ? fn(p) : p));
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
            rows = await eventStandings(ev.id).catch(() => []);
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
        if (event.hidden) notes.push('This event is hidden in the app — its QR leads to a page people can’t see yet.');
        if (event.status === 'draft') notes.push('Still a draft — the dates and venue may change.');
        if (event.board === 'sealed' && phase === 'after') notes.push('The board is sealed until the reveal — the pack leaves out Results until then.');
        return notes;
    }, [event, phase]);

    // ── The shoot ──────────────────────────────────────────────────────
    const counts = useMemo(() => ({ photos: media.filter((m) => m.kind === 'photo').length, clips: media.filter((m) => m.kind === 'clip').length }), [media]);

    const takeItems = async (itemsPromise) => {
        setError(null);
        setImporting({ label: 'Reading…', done: 0, total: 1 });
        try {
            const items = await itemsPromise;
            const { photos, clips, left } = await collect(items, {
                have: counts,
                onProgress: ({ done, total }) => setImporting({ label: 'Reading files', done, total }),
            });
            const fresh = [...photos.map((p) => ({ ...p, kind: 'photo' })), ...clips.map((c) => ({ ...c, kind: 'clip' }))];
            const analyses = await analyseAll(fresh, { onProgress: (done, total) => setImporting({ label: 'Looking at the photos', done, total }) });
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
            const notes = [leftOutNote(left)];
            if (heic) notes.push(`${plural(heic, 'HEIC photo')} skipped — Chrome can’t open iPhone HEIC files. Export them as JPEG (Photos → File → Export), or open the Studio in Safari.`);
            if (unreadable) notes.push(`${plural(unreadable, 'file')} couldn’t be read.`);
            setShootNote(notes.filter(Boolean).join(' ') || null);
            replan({ media: all });
        } catch (e) {
            setError(e.message || 'Those files couldn’t be read.');
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
                const relook = (list, tid) => list.map((x, i) => ({ ...x, look: lookFor(o, i, tid ?? x.templateId) }));
                return {
                    ...p,
                    options: o,
                    posts: key === 'look' ? relook(p.posts) : p.posts,
                    carousel: p.carousel && key === 'look' ? { ...p.carousel, look: lookFor(o, 0, 'frame') } : p.carousel,
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
    }));

    const selectedPost = plan && selected
        ? plan.posts.find((p) => p.id === selected) ?? plan.carousel?.slides.map((s) => ({ ...s, look: plan.carousel.look })).find((s) => s.id === selected) ?? null
        : null;

    // ── Saved packs ────────────────────────────────────────────────────
    const refreshSaved = useCallback(() => {
        setSavedError(null);
        listPacks({ eventId: eventId || null }).then(setSaved).catch((e) => { setSaved([]); setSavedError(e.message); });
    }, [eventId]);
    useEffect(() => { refreshSaved(); }, [refreshSaved]);

    const downloadSaved = async (pack) => {
        setPackBusy({ id: pack.id, label: 'Fetching…' });
        try {
            const zip = await packZip(pack.id, { onProgress: ({ done, total }) => setPackBusy({ id: pack.id, label: `Fetching ${done}/${total}` }) });
            downloadBlob(zip, `powr-${slug(pack.title)}.zip`);
        } catch (e) {
            setSavedError(e.message);
        } finally {
            setPackBusy(null);
        }
    };

    const reopen = async (pack) => {
        setPackBusy({ id: pack.id, label: 'Opening…' });
        try {
            const { pack: full, sources } = await reopenPack(pack.id, { onProgress: ({ done, total }) => setPackBusy({ id: pack.id, label: `Fetching photos ${done}/${total}` }) });
            const analyses = await analyseAll(sources, { onProgress: (done, total) => setPackBusy({ id: pack.id, label: `Reading ${done}/${total}` }) });
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
            if (ev && ev.board !== 'none') eventStandings(ev.id).then(setStandings).catch(() => {});
            setPhase(full.phase);
            setOptions({ ...DEFAULT_OPTIONS, ...full.plan.options });
            setLeadId(full.plan.leadId ?? null);
            setPlan(full.plan);
            setSelected(null);
            setEdited(false);
            setResult({ ok: true, note: `Opened “${full.title}”. Change anything and make it again — it saves as a new pack; this one stays as it was.` });
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (e) {
            setSavedError(e.message);
        } finally {
            setPackBusy(null);
        }
    };

    const remove = async (pack) => {
        if (!window.confirm(`Delete “${pack.title}” and everything saved with it? This can’t be undone.`)) return;
        setPackBusy({ id: pack.id, label: 'Deleting…' });
        try {
            await deletePack(pack.id);
            refreshSaved();
        } catch (e) {
            setSavedError(e.message);
        } finally {
            setPackBusy(null);
        }
    };

    // ── Making it ──────────────────────────────────────────────────────
    const title = event ? `${event.name} — ${PHASES.find((p) => p.id === phase)?.label ?? phase}` : `Brand pack — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;

    const make = async () => {
        if (!plan) return;
        const ac = new AbortController();
        abortRef.current = ac;
        setResult(null);
        setError(null);
        let files = null;
        try {
            setBuilding({ stage: 'Rendering', done: 0, total: 1 });
            files = await buildPack({ plan, media, signal: ac.signal, onProgress: (p) => setBuilding({ stage: 'Rendering', ...p }) });
            setBuilding({ stage: 'Packing the ZIP', done: 0, total: 1 });
            const zip = await zipFiles(files.filter((f) => f.role === 'output').map((f) => ({ name: f.name, data: f.blob })));
            downloadBlob(zip, `powr-${slug(title)}.zip`);
            setBuilding({ stage: 'Saving to the event', done: 0, total: 1 });
            const { id, skipped } = await savePack({ plan, title, media, files, signal: ac.signal, onProgress: (p) => setBuilding({ stage: event ? 'Saving to the event' : 'Saving', ...p }) });
            setResult({
                ok: true,
                id,
                note: `Downloaded and saved — ${plural(files.filter((f) => f.role === 'output').length, 'file')}, ${plural(media.filter((m) => m.analysis?.ok && !m.excluded).length - skipped.length, 'photo or clip', 'photos and clips')} kept with it.${skipped.length ? ` ${plural(skipped.length, 'clip')} over 50 MB weren’t kept (their posts were).` : ''}`,
            });
            refreshSaved();
        } catch (e) {
            if (e.name === 'AbortError') setResult({ ok: false, note: files ? 'Saving was cancelled — the ZIP was downloaded; the saved copy is marked as unfinished.' : 'Cancelled.' });
            else setResult({ ok: false, note: files ? `The ZIP was downloaded, but saving failed: ${e.message}` : e.message });
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
                    <span className={LABEL}>Event</span>
                    <select value={eventId} onChange={(e) => chooseEvent(e.target.value)} disabled={events === null || Boolean(building)} className={INPUT}>
                        <option value="">{events === null ? 'Loading events…' : 'No event — a brand pack'}</option>
                        {(events ?? []).map((ev) => <option key={ev.id} value={ev.id}>{ev.label}</option>)}
                    </select>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {PHASES.filter((p) => (event ? p.id !== 'brand' : p.id === 'brand')).map((p) => (
                            <button key={p.id} type="button" onClick={() => choosePhase(p.id)} disabled={Boolean(building)} className={CHIP(phase === p.id)}>{p.label}</button>
                        ))}
                    </div>
                    <p className="mt-2 text-[11px] text-[#999]">{PHASES.find((p) => p.id === phase)?.blurb}</p>
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
                        <span className={`${LABEL} mb-0`}>Photos &amp; clips</span>
                        {media.length > 0 && (
                            <button type="button" onClick={clearShoot} disabled={Boolean(building || importing)} className="flex items-center gap-1 text-xs text-[#888] hover:text-[#111]">
                                <RotateCcw size={12} /> Clear
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
                                {importing.label}{importing.total > 1 ? ` ${Math.min(importing.done + 1, importing.total)}/${importing.total}` : ''}
                            </div>
                        ) : (
                            <>
                                <p className="text-sm text-[#555]">Drop a folder, photos and clips, or a ZIP here</p>
                                <div className="mt-3 flex justify-center gap-2">
                                    <button type="button" onClick={() => fileRef.current?.click()} disabled={Boolean(building)}
                                        className="flex items-center gap-1.5 rounded-lg border border-[#E6E6E1] bg-white px-3 py-1.5 text-xs text-[#333] hover:border-[#E8D200]">
                                        <Upload size={13} /> Files or a ZIP
                                    </button>
                                    <button type="button" onClick={() => folderRef.current?.click()} disabled={Boolean(building)}
                                        className="flex items-center gap-1.5 rounded-lg border border-[#E6E6E1] bg-white px-3 py-1.5 text-xs text-[#333] hover:border-[#E8D200]">
                                        <FolderOpen size={13} /> A folder
                                    </button>
                                </div>
                                <p className="mt-2 text-[11px] text-[#999]">Up to {LIMITS.photos} photos and {LIMITS.clips} clips. Everything is read here in the browser.</p>
                            </>
                        )}
                    </div>
                    {media.length > 0 && (
                        <>
                            <p className="mt-3 text-xs text-[#555]">
                                {plural(counts.photos, 'photo')}{counts.clips ? ` · ${plural(counts.clips, 'clip')}` : ''}
                                {dupCount ? ` · ${dupCount} near-duplicate${dupCount === 1 ? '' : 's'} set aside` : ''}
                                {weakCount ? ` · ${weakCount} weak` : ''}
                            </p>
                            <div className="mt-2 grid grid-cols-6 gap-1.5">
                                {media.map((m) => {
                                    const isLead = plan?.leadId === m.id;
                                    const weak = m.kind === 'photo' ? weakness(m.analysis) : null;
                                    return (
                                        <div key={m.id} className={`group relative aspect-[4/5] overflow-hidden rounded-md border ${isLead ? 'border-[#E8D200] ring-1 ring-[#E8D200]' : 'border-[#E6E6E1]'} ${m.excluded || m.dupOf ? 'opacity-40' : ''}`}
                                            title={`${m.path}${m.dupOf ? ' — a near-duplicate' : ''}${weak ? ` — ${weak}` : ''} · quality ${Math.round(quality(m.analysis) * 100)}`}>
                                            {m.thumbUrl && <img src={m.thumbUrl} alt="" className="h-full w-full object-cover" />}
                                            {m.kind === 'clip' && <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[9px] text-white">{Math.round(m.analysis.duration)}s</span>}
                                            {(weak || m.dupOf) && !m.excluded && <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] text-white">{m.dupOf ? 'dup' : weak}</span>}
                                            <div className="absolute inset-x-0 top-0 flex justify-between p-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                                {m.kind === 'photo' ? (
                                                    <button type="button" onClick={() => chooseLead(m.id)} title="Make this the lead photo" aria-label="Make this the lead photo"
                                                        className="rounded bg-black/60 p-0.5 text-white hover:text-[#E8D200]"><Star size={11} className={isLead ? 'fill-[#E8D200] text-[#E8D200]' : ''} /></button>
                                                ) : <span />}
                                                <button type="button" onClick={() => toggleExclude(m.id)} title={m.excluded ? 'Use it' : 'Leave it out'} aria-label={m.excluded ? 'Use it' : 'Leave it out'}
                                                    className="rounded bg-black/60 p-0.5 text-white hover:text-[#E8D200]">{m.excluded ? <Check size={11} /> : <X size={11} />}</button>
                                            </div>
                                            {isLead && <Star size={11} className="absolute left-1 top-1 fill-[#E8D200] text-[#E8D200] group-hover:hidden" />}
                                        </div>
                                    );
                                })}
                            </div>
                            <p className="mt-2 text-[11px] text-[#999]">★ the lead photo goes on the headline post. Hover a photo to change the lead or leave it out.</p>
                        </>
                    )}
                    {shootNote && <p className="mt-2 text-xs text-[#92400E]">{shootNote}</p>}
                </div>

                <div className={CARD}>
                    <span className={LABEL}>Pack</span>
                    <div className="mb-1 text-[11px] text-[#999]">Sizes</div>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                        {FORMAT_CHOICES.map((f) => {
                            const on = options.formats.includes(f.id);
                            return (
                                <button key={f.id} type="button" disabled={Boolean(building) || (on && options.formats.length === 1)}
                                    onClick={() => setOption('formats', on ? options.formats.filter((x) => x !== f.id) : [...options.formats, f.id])}
                                    className={CHIP(on)}>{f.label}</button>
                            );
                        })}
                    </div>
                    <div className="mb-1 text-[11px] text-[#999]">Look</div>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                        {LOOK_CHOICES.map((l) => <button key={l.id} type="button" title={l.blurb} onClick={() => setOption('look', l.id)} disabled={Boolean(building)} className={CHIP(options.look === l.id)}>{l.label}</button>)}
                    </div>
                    <div className="mb-1 text-[11px] text-[#999]">Colour</div>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                        {COLOURWAYS.map((c) => (
                            <button key={c.id} type="button" onClick={() => setOption('colourway', c.id)} disabled={Boolean(building)} className={`${CHIP(options.colourway === c.id)} flex items-center gap-1.5`}>
                                <span className="h-3 w-3 rounded-full border border-black/10" style={{ background: c.accent }} />{c.label}
                            </button>
                        ))}
                    </div>
                    <div className="space-y-1.5 border-t border-[#F0F0EE] pt-3">
                        {[
                            ['poster', 'An A4 poster of the ticket, for the venue', phase === 'before'],
                            ['carousel', 'A recap carousel of the best photos', phase === 'after' || phase === 'brand'],
                            ['reels', `A Story reel from each clip (up to 3, first 12 s)`, counts.clips > 0],
                            ['extras', 'A post for every other good photo', true],
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
                        <span className={`${LABEL} mb-0`}>{event ? 'Saved for this event' : 'Saved packs'}</span>
                        <button type="button" onClick={refreshSaved} className="text-[#888] hover:text-[#111]" aria-label="Refresh"><RefreshCw size={13} /></button>
                    </div>
                    {savedError && <p className="mt-2 text-xs text-[#991B1B]">{savedError}</p>}
                    {saved === null ? (
                        <p className="mt-2 flex items-center gap-2 text-xs text-[#888]"><Loader2 size={13} className="animate-spin" /> Loading…</p>
                    ) : saved.length === 0 ? (
                        <p className="mt-2 text-xs text-[#999]">Nothing saved yet — every pack you make is kept here.</p>
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
                                        {new Date(p.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                        {!event && p.eventName ? ` · ${p.eventName}` : ''}
                                        {` · ${plural(p.output_count, 'file')} · ${p.source_count} made from · ${mb(p.bytes)}`}
                                    </div>
                                    {p.status !== 'saved' && <div className="mt-1 text-[11px] text-[#92400E]">{p.status === 'saving' ? 'Still saving — or the page closed before it finished' : 'Didn’t finish saving'}</div>}
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {packBusy?.id === p.id ? (
                                            <span className="flex items-center gap-1.5 text-xs text-[#555]"><Loader2 size={12} className="animate-spin" />{packBusy.label}</span>
                                        ) : (
                                            <>
                                                <button type="button" onClick={() => downloadSaved(p)} disabled={Boolean(packBusy || building) || p.status !== 'saved'} className="flex items-center gap-1 rounded-lg border border-[#E6E6E1] px-2 py-1 text-xs text-[#333] hover:border-[#E8D200] disabled:opacity-40"><Download size={12} /> ZIP</button>
                                                <button type="button" onClick={() => reopen(p)} disabled={Boolean(packBusy || building) || p.status !== 'saved'} className="flex items-center gap-1 rounded-lg border border-[#E6E6E1] px-2 py-1 text-xs text-[#333] hover:border-[#E8D200] disabled:opacity-40"><Pencil size={12} /> Open</button>
                                                <button type="button" onClick={() => remove(p)} disabled={Boolean(packBusy || building)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[#888] hover:text-[#991B1B] disabled:opacity-40"><Trash2 size={12} /> Delete</button>
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
            <div className="lg:sticky lg:top-20 min-w-0">
                <div className="relative rounded-2xl bg-[#141413] p-4 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <div className="text-sm font-semibold text-white">{title}</div>
                            <div className="text-xs text-white/50">{plan ? describePlan(plan) : 'Add photos to plan the pack'}</div>
                        </div>
                        <button type="button" onClick={make} disabled={!ready || !plan || Boolean(building) || (!plan.posts.length && !plan.carousel && !plan.reels.length)}
                            className="flex items-center gap-1.5 rounded-lg bg-[#E8D200] px-3 py-1.5 text-sm font-semibold text-[#111] hover:brightness-95 disabled:opacity-50">
                            {building ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
                            Make pack — download &amp; save
                        </button>
                    </div>
                    {result && (
                        <div className={`mb-3 flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-xs ${result.ok ? 'bg-white/10 text-white/85' : 'bg-[#7F1D1D]/60 text-white'}`}>
                            <span>{result.note}</span>
                            <button type="button" onClick={() => setResult(null)} aria-label="Dismiss" className="text-white/60 hover:text-white"><X size={12} /></button>
                        </div>
                    )}
                    {error && <p className="mb-3 rounded-lg bg-[#7F1D1D]/60 px-3 py-2 text-xs text-white">{error}</p>}

                    {!plan && (
                        <div className="flex aspect-[16/9] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 text-sm text-white/50">
                            <Images size={20} />
                            {eventId ? 'Add the photos from the event' : 'Pick an event, or add photos for a brand pack'}
                        </div>
                    )}
                    {plan && (
                        <>
                            {plan.notes.map((n) => <p key={n} className="mb-2 flex gap-1.5 text-xs text-[#FCD34D]"><TriangleAlert size={13} className="mt-px flex-none" />{n}</p>)}
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                                {plan.posts.map((post) => (
                                    <div key={post.id} className={`rounded-xl p-1.5 ${selected === post.id ? 'bg-[#E8D200]/20 ring-1 ring-[#E8D200]' : 'bg-white/5'}`}>
                                        <button type="button" onClick={() => setSelected(selected === post.id ? null : post.id)} className="block w-full" aria-label={`Edit ${templateById(post.templateId).name}`}>
                                            <Preview plan={plan} post={post} item={byId.get(post.mediaId)} ready={ready} />
                                        </button>
                                        <div className="mt-1.5 flex items-center justify-between gap-1 px-0.5">
                                            <span className="truncate text-[11px] text-white/70">
                                                {templateById(post.templateId).name}{post.poster ? ' + A4' : ''}
                                            </span>
                                            <span className="flex flex-none gap-0.5">
                                                <button type="button" onClick={() => swapPhoto(post)} title="Another photo" aria-label="Another photo" className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"><Shuffle size={12} /></button>
                                                <button type="button" onClick={() => swapTemplate(post)} title="Another template" aria-label="Another template" className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"><RefreshCw size={12} /></button>
                                                <button type="button" onClick={() => removePost(post.id)} title="Leave this post out" aria-label="Leave this post out" className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"><X size={12} /></button>
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {plan.carousel && (
                                <div className="mt-4">
                                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">Carousel · {plural(plan.carousel.slides.length, 'slide')}</div>
                                    <div className="flex gap-2 overflow-x-auto pb-1">
                                        {plan.carousel.slides.map((s) => (
                                            <div key={s.id} className={`w-24 flex-none rounded-lg p-1 ${selected === s.id ? 'bg-[#E8D200]/20 ring-1 ring-[#E8D200]' : 'bg-white/5'}`}>
                                                <button type="button" onClick={() => setSelected(selected === s.id ? null : s.id)} className="block w-full" aria-label="Edit slide">
                                                    <Preview plan={plan} post={{ ...s, look: plan.carousel.look }} item={byId.get(s.mediaId)} ready={ready} />
                                                </button>
                                                <button type="button" onClick={() => removeSlide(s.id)} className="mt-1 w-full rounded text-[10px] text-white/50 hover:text-white">Remove</button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {plan.reels.length > 0 && (
                                <div className="mt-4">
                                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">Reels · Story 9:16</div>
                                    <div className="flex flex-wrap gap-2">
                                        {plan.reels.map((r) => (
                                            <div key={r.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5 text-xs text-white/75">
                                                {byId.get(r.mediaId)?.thumbUrl && <img src={byId.get(r.mediaId).thumbUrl} alt="" className="h-8 w-6 rounded object-cover" />}
                                                {templateById(r.templateId).name} over {byId.get(r.mediaId)?.path.split('/').pop()}
                                                <button type="button" onClick={() => removeReel(r.id)} aria-label="Leave this reel out" className="text-white/50 hover:text-white"><X size={12} /></button>
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
                                <span className={`${LABEL} mb-0`}>{templateById(selectedPost.templateId).name} — words</span>
                                <button type="button" onClick={() => setSelected(null)} aria-label="Close" className="text-[#888] hover:text-[#111]"><X size={14} /></button>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
                                <Preview plan={plan} post={selectedPost} item={byId.get(selectedPost.mediaId)} ready={ready} />
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
                                {building.stage}… {building.total > 1 ? `${Math.min(Math.floor(building.done) + 1, building.total)} / ${building.total}` : ''}
                            </div>
                            <div className="h-1.5 w-1/2 overflow-hidden rounded-full bg-white/15">
                                <div className="h-full bg-[#E8D200] transition-[width] duration-200" style={{ width: `${Math.min(100, (building.done / Math.max(1, building.total)) * 100)}%` }} />
                            </div>
                            {building.label && building.label !== 'done' && <div className="max-w-[80%] truncate text-[11px] text-white/50">{building.label}</div>}
                            <button type="button" onClick={() => abortRef.current?.abort()} className="mt-1 flex items-center gap-1 rounded-lg border border-white/20 px-3 py-1 text-xs text-white/80 hover:bg-white/10">
                                <X size={12} /> Cancel
                            </button>
                        </div>
                    )}
                </div>
                {usable.length > 0 && plan && (
                    <p className="mt-2 px-1 text-[11px] text-[#999]">
                        Click a post to change its words · <Shuffle size={10} className="inline" /> another photo · <RefreshCw size={10} className="inline" /> another template
                        {edited ? ' · changing the event, stage or photos replans the pack' : ''}
                    </p>
                )}
            </div>
        </div>
    );
}
