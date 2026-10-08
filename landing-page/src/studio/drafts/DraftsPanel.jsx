import React, { useCallback, useEffect, useState } from 'react';
import { Check, FilePlus2, Layers, Loader2, Pencil, Play, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { FORMATS } from '../formats';
import { templateById } from '../templates';
import { listDrafts, openDraft, renameDraft, deleteDraft, mb } from './store';

/**
 * Drafts: posts saved from the editor to finish later, last edited first.
 * Open puts the editor back where the draft was left (every slide, photo or
 * clip, words and look); rename and delete happen here too.
 *
 * partnerId     a gym's drafts
 * brand         a reward brand's drafts (rewards.brand_name); with neither, POWR's own
 * editing       the editor's draft status: { id, title, dirty }
 * onOpened      a draft has been fetched and loaded: openDraft()'s result
 * onShowEditor  back to the editor, as it is
 * onRenamed     a draft was renamed ({ id, title })
 * onDeleted     a draft was deleted (id)
 * onCount       how many drafts there are now
 */
export default function DraftsPanel({ partnerId = null, brand = null, editing = null, onOpened, onShowEditor, onRenamed, onDeleted, onCount }) {
    const [drafts, setDrafts] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null); // { id, label }
    const [renaming, setRenaming] = useState(null); // { id, value }
    const [confirming, setConfirming] = useState(null); // id
    const [query, setQuery] = useState('');

    const refresh = useCallback(() => {
        setError(null);
        listDrafts({ partnerId, brand })
            .then((list) => { setDrafts(list); onCount?.(list.length); })
            .catch((e) => { setDrafts((d) => d ?? []); setError(e.message); });
    }, [partnerId, brand]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { refresh(); }, [refresh]);

    const open = async (d) => {
        // The one already in the editor: go back to it as it is, edits and all.
        if (editing?.id === d.id) { onShowEditor?.(); return; }
        if (editing?.dirty && !window.confirm(editing.id
            ? `Open “${d.title}”? Changes to “${editing.title}” since it was saved will be lost.`
            : `Open “${d.title}”? The post in the editor isn’t saved — it will be lost.`)) return;
        setBusy({ id: d.id, label: 'Opening…' });
        setError(null);
        try {
            const result = await openDraft(d.id, {
                onProgress: ({ done, total }) => setBusy({ id: d.id, label: total ? `Fetching ${Math.min(done + 1, total)} of ${total}…` : 'Opening…' }),
            });
            onOpened?.(result);
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(null);
        }
    };

    const commitRename = async () => {
        const r = renaming;
        setRenaming(null);
        const value = r?.value.trim();
        const d = drafts.find((x) => x.id === r?.id);
        if (!d || !value || value === d.title) return;
        setDrafts((list) => list.map((x) => (x.id === d.id ? { ...x, title: value } : x)));
        try {
            const saved = await renameDraft(d.id, value.slice(0, 120));
            setDrafts((list) => list.map((x) => (x.id === d.id ? { ...x, ...saved } : x)));
            onRenamed?.(saved);
        } catch (e) {
            setDrafts((list) => list.map((x) => (x.id === d.id ? { ...x, title: d.title } : x)));
            setError(e.message);
        }
    };

    const remove = async (d) => {
        setConfirming(null);
        setBusy({ id: d.id, label: 'Deleting…' });
        setError(null);
        try {
            await deleteDraft(d.id, { partnerId, brand });
            const next = drafts.filter((x) => x.id !== d.id);
            setDrafts(next);
            onCount?.(next.length);
            onDeleted?.(d.id);
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(null);
        }
    };

    if (drafts === null) {
        return <div className="flex items-center gap-2 text-sm text-[#777]"><Loader2 size={16} className="animate-spin" /> Loading drafts…</div>;
    }

    const q = query.trim().toLowerCase();
    const shown = q ? drafts.filter((d) => d.title.toLowerCase().includes(q)) : drafts;

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center gap-3">
                <span className="text-sm text-[#555]">{drafts.length === 1 ? '1 draft' : `${drafts.length} drafts`}</span>
                {drafts.length > 8 && (
                    <label className="relative flex min-w-[180px] max-w-xs flex-1 items-center">
                        <Search size={14} className="pointer-events-none absolute left-3 text-[#999]" />
                        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a draft" aria-label="Find a draft"
                            className="w-full rounded-xl border border-[#E6E6E1] bg-white py-1.5 pl-8 pr-3 text-sm text-[#111] focus:border-[#E8D200] focus:outline-none" />
                    </label>
                )}
                <button type="button" onClick={refresh} aria-label="Refresh" title="Refresh"
                    className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-[#888] hover:bg-[#EAEAE5] hover:text-[#111]">
                    <RefreshCw size={14} />
                </button>
            </div>

            {error && <p className="mb-4 rounded-xl bg-[#FEE2E2] px-4 py-2.5 text-sm text-[#991B1B]">{error}</p>}

            {drafts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#D6D6D0] bg-white px-6 py-14 text-center">
                    <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#FFFBE0]">
                        <FilePlus2 size={20} className="text-[#B8A600]" />
                    </div>
                    <div className="text-base font-semibold text-[#111]">No drafts yet</div>
                    <p className="mx-auto mt-1.5 max-w-sm text-sm text-[#777]">
                        In One post, press <span className="font-semibold text-[#333]">Save draft</span> — the template, words, look and photo or clip are kept here to finish later.
                    </p>
                    <button type="button" onClick={onShowEditor}
                        className="mt-5 rounded-lg bg-[#111] px-4 py-2 text-sm font-semibold text-white hover:bg-[#333]">
                        Make a post
                    </button>
                </div>
            ) : shown.length === 0 ? (
                <p className="text-sm text-[#888]">No drafts called “{query.trim()}”.</p>
            ) : (
                <ul aria-label="Drafts" className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                    {shown.map((d) => {
                        const F = FORMATS[d.format];
                        const isOpen = editing?.id === d.id;
                        const isBusy = busy?.id === d.id;
                        const tpl = d.template_id ? templateById(d.template_id) : null;
                        return (
                            <li key={d.id} className={`flex min-w-0 flex-col rounded-2xl border bg-white p-2 ${isOpen ? 'border-[#E8D200]' : 'border-[#E6E6E1]'}`}>
                                <button type="button" onClick={() => open(d)} disabled={Boolean(busy)}
                                    aria-label={`Open ${d.title}`}
                                    className="group relative block aspect-[4/5] w-full overflow-hidden rounded-xl bg-[#141413] disabled:cursor-wait">
                                    {d.thumbUrl
                                        ? <img src={d.thumbUrl} alt="" loading="lazy" className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.02]" />
                                        : <span className="flex h-full items-center justify-center text-xs text-white/40">No preview</span>}
                                    <span className="absolute left-2 top-2 flex gap-1">
                                        {d.slide_count > 1 && (
                                            <span className="flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                                <Layers size={10} /> {d.slide_count}
                                            </span>
                                        )}
                                        {d.has_video && (
                                            <span className="flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                                <Play size={9} className="fill-current" /> Video
                                            </span>
                                        )}
                                    </span>
                                    {isOpen && (
                                        <span className="absolute right-2 top-2 rounded-md bg-[#E8D200] px-1.5 py-0.5 text-[10px] font-semibold text-[#111]">
                                            {editing.dirty ? 'Open · unsaved' : 'Open'}
                                        </span>
                                    )}
                                    {isBusy && (
                                        <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-xs text-white">
                                            <Loader2 size={18} className="animate-spin" />{busy.label}
                                        </span>
                                    )}
                                </button>

                                <div className="min-w-0 px-1 pt-2">
                                    {renaming?.id === d.id ? (
                                        <input autoFocus value={renaming.value} maxLength={120} aria-label="Draft name"
                                            onChange={(e) => setRenaming({ id: d.id, value: e.target.value })}
                                            onBlur={commitRename}
                                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null); }}
                                            className="w-full rounded-lg border border-[#E8D200] bg-white px-2 py-0.5 text-sm font-semibold text-[#111] focus:outline-none" />
                                    ) : (
                                        <div className="line-clamp-2 break-words text-sm font-semibold leading-snug text-[#111]" title={d.title}>{d.title}</div>
                                    )}
                                    <div className="mt-0.5 truncate text-[11px] text-[#888]">
                                        {F ? `${F.label} ${F.print ? '' : F.ratio}`.trim() : d.format}
                                        {tpl?.id === d.template_id ? ` · ${tpl.name}` : ''}
                                    </div>
                                    <div className="truncate text-[11px] text-[#AAA]" title={`${new Date(d.updated_at).toLocaleString('en-GB')} · ${mb(d.bytes)}`}>
                                        Edited {ago(d.updated_at)}{d.by ? ` · ${d.by}` : ''}
                                    </div>
                                </div>

                                <div className="mt-auto flex items-center gap-1 px-1 pt-2.5">
                                    {confirming === d.id ? (
                                        <>
                                            <span className="mr-auto text-xs text-[#991B1B]">Delete for good?</span>
                                            <button type="button" onClick={() => remove(d)}
                                                className="rounded-lg bg-[#991B1B] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#7F1D1D]">Delete</button>
                                            <button type="button" onClick={() => setConfirming(null)} aria-label="Keep it"
                                                className="flex h-7 w-7 items-center justify-center rounded-lg text-[#888] hover:bg-[#F4F4F1] hover:text-[#111]"><X size={14} /></button>
                                        </>
                                    ) : (
                                        <>
                                            <button type="button" onClick={() => open(d)} disabled={Boolean(busy)}
                                                className="mr-auto flex items-center gap-1 rounded-lg border border-[#E6E6E1] px-2.5 py-1 text-xs font-semibold text-[#111] hover:border-[#E8D200] disabled:opacity-40">
                                                {isOpen ? <><Check size={12} /> Back to it</> : 'Open'}
                                            </button>
                                            <button type="button" onClick={() => setRenaming({ id: d.id, value: d.title })} disabled={Boolean(busy)}
                                                title="Rename" aria-label={`Rename ${d.title}`}
                                                className="flex h-7 w-7 items-center justify-center rounded-lg text-[#888] hover:bg-[#F4F4F1] hover:text-[#111] disabled:opacity-40"><Pencil size={13} /></button>
                                            <button type="button" onClick={() => setConfirming(d.id)} disabled={Boolean(busy)}
                                                title="Delete" aria-label={`Delete ${d.title}`}
                                                className="flex h-7 w-7 items-center justify-center rounded-lg text-[#888] hover:bg-[#FEE2E2] hover:text-[#991B1B] disabled:opacity-40"><Trash2 size={13} /></button>
                                        </>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

function ago(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 2 * 86400) return 'yesterday';
    if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
