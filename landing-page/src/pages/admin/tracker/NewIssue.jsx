import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useToast } from '../../../lib/toast';
import { TYPES, PRIORITIES, PLATFORMS, TEMPLATES, suggestShipSteps, sprintLabel } from './model';
import { createIssue } from './api';
import PlacePicker from './PlacePicker';
import { TypeIcon, Label, inputClass, selectClass } from './ui';

const BLANK = {
    type: 'bug',
    title: '',
    surface: 'app',
    area: null,
    feature: null,
    priority: 2,
    platforms: [],
    app_version: '',
    assignee_id: '',
    sprint_id: '',
    description: TEMPLATES.bug,
};

/**
 * Filing an issue: what kind, where in POWR, how urgent. Everything else
 * (ship plan, links, checklist) is added in the drawer it opens into.
 */
export default function NewIssue({ prefill, admins, sprints = null, onClose, onCreated }) {
    const toast = useToast();
    const [draft, setDraft] = useState(() => ({ ...BLANK, ...(prefill ?? {}) }));
    const [saving, setSaving] = useState(false);
    const titleRef = useRef(null);
    // The template follows the type until someone types in the description.
    const templateDirty = useRef(!!prefill?.description);

    useEffect(() => { titleRef.current?.focus(); }, []);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const set = (patch) => setDraft(d => ({ ...d, ...patch }));

    const setType = (type) => {
        set(templateDirty.current ? { type } : { type, description: TEMPLATES[type] ?? '' });
    };

    const togglePlatform = (key) => set({
        platforms: draft.platforms.includes(key) ? draft.platforms.filter(p => p !== key) : [...draft.platforms, key],
    });

    const submit = async () => {
        if (!draft.title.trim()) { toast.error('Give it a title'); titleRef.current?.focus(); return; }
        setSaving(true);
        const description = Object.values(TEMPLATES).includes(draft.description) ? '' : draft.description;
        const row = {
            type: draft.type,
            title: draft.title.trim(),
            surface: draft.surface,
            area: draft.area,
            feature: draft.feature,
            priority: draft.priority,
            platforms: draft.platforms,
            app_version: draft.app_version?.trim() || null,
            assignee_id: draft.assignee_id || null,
            description,
            ship_steps: suggestShipSteps(draft),
            user_ids: draft.user_ids ?? [],
            partner_id: draft.partner_id ?? null,
            event_id: draft.event_id ?? null,
            support_ticket_id: draft.support_ticket_id ?? null,
            ...(sprints ? { sprint_id: draft.sprint_id || null } : {}),
            risks: draft.risks ?? [],
            source: draft.source ?? 'admin',
        };
        try {
            const issue = await createIssue(row);
            toast.success(`POWR-${issue.number} filed`);
            onCreated(issue);
        } catch (e) {
            toast.error(e.message || 'Could not file the issue');
            setSaving(false);
        }
    };

    const onKeyDown = (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
    };

    return (
        <div className="fixed inset-0 z-[300] flex items-start justify-center bg-[#1A1A1A]/40 backdrop-blur-sm px-4 py-8 overflow-y-auto" onMouseDown={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                aria-label="New issue"
                className="w-full max-w-3xl bg-[#F4F4F1] border border-[#E6E6E1] rounded-3xl animate-in fade-in slide-in-from-bottom-4 duration-200"
                onMouseDown={e => e.stopPropagation()}
                onKeyDown={onKeyDown}
            >
                <div className="flex items-center justify-between gap-4 px-6 sm:px-8 pt-6">
                    <div className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">New issue</div>
                    <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-xl border border-[#E6E6E1] bg-white flex items-center justify-center text-[#888888] hover:text-[#1A1A1A]">
                        <X size={15} />
                    </button>
                </div>

                <div className="px-6 sm:px-8 py-6 space-y-7">
                    <div className="flex flex-wrap gap-2">
                        {TYPES.map(t => (
                            <button
                                key={t.key}
                                type="button"
                                onClick={() => setType(t.key)}
                                aria-pressed={draft.type === t.key}
                                className={`inline-flex items-center gap-2 h-9 px-3.5 rounded-full border text-[11px] font-bold transition-all ${draft.type === t.key ? 'bg-white border-[#1A1A1A] text-[#1A1A1A]' : 'bg-white/60 border-[#E6E6E1] text-[#666666] hover:border-[#BBBBBB]'}`}
                            >
                                <TypeIcon type={t.key} size={13} />
                                {t.label}
                            </button>
                        ))}
                    </div>

                    <input
                        ref={titleRef}
                        value={draft.title}
                        onChange={e => set({ title: e.target.value })}
                        maxLength={200}
                        placeholder={draft.type === 'bug' ? 'What goes wrong, in one line' : 'What this is, in one line'}
                        className="w-full bg-transparent border-0 border-b border-[#DDDDD8] focus:border-[#E8D200] outline-none text-2xl font-light tracking-tight text-[#1A1A1A] placeholder-[#BBBBBB] pb-3"
                    />

                    <PlacePicker value={draft} onChange={place => set(place)} />

                    <div className="grid sm:grid-cols-2 gap-6">
                        <div>
                            <Label className="mb-2">Priority</Label>
                            <div className="flex flex-wrap gap-2">
                                {PRIORITIES.map(p => (
                                    <button
                                        key={p.value}
                                        type="button"
                                        title={p.hint}
                                        onClick={() => set({ priority: p.value })}
                                        aria-pressed={draft.priority === p.value}
                                        className="h-8 px-3 rounded-full border text-[10px] font-black tracking-[0.1em] transition-all"
                                        style={draft.priority === p.value
                                            ? { background: p.color, borderColor: p.color, color: '#FFFFFF' }
                                            : { background: '#FFFFFF', borderColor: '#E6E6E1', color: p.color }}
                                    >
                                        {p.label} · {p.name}
                                    </button>
                                ))}
                            </div>
                            <div className="text-[11px] text-[#888888] mt-2 leading-snug">{PRIORITIES.find(p => p.value === draft.priority)?.hint}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                                <Label className="mb-2">Platforms</Label>
                                <div className="flex gap-2">
                                    {PLATFORMS.map(p => (
                                        <button
                                            key={p.key}
                                            type="button"
                                            onClick={() => togglePlatform(p.key)}
                                            aria-pressed={draft.platforms.includes(p.key)}
                                            className={`h-8 px-3 rounded-full border text-[10px] font-black uppercase tracking-[0.15em] ${draft.platforms.includes(p.key) ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-white border-[#E6E6E1] text-[#666666]'}`}
                                        >
                                            {p.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <Label className="mb-2">App version</Label>
                                <input value={draft.app_version} onChange={e => set({ app_version: e.target.value })} placeholder="1.6.0 (20)" className={inputClass} />
                            </div>
                            {sprints ? (
                                <div className="col-span-2">
                                    <Label className="mb-2">Sprint</Label>
                                    <select value={draft.sprint_id ?? ''} onChange={e => set({ sprint_id: e.target.value })} className={`${selectClass} w-full`}>
                                        <option value="">Backlog (no sprint)</option>
                                        {sprints.filter(sp => sp.status !== 'completed').map(sp => (
                                            <option key={sp.id} value={sp.id}>{sprintLabel(sp)}{sp.status === 'active' ? ' · running' : ''}</option>
                                        ))}
                                    </select>
                                </div>
                            ) : null}
                            <div>
                                <Label className="mb-2">Assignee</Label>
                                <select value={draft.assignee_id} onChange={e => set({ assignee_id: e.target.value })} className={`${selectClass} w-full`}>
                                    <option value="">Nobody yet</option>
                                    {admins.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>

                    <div>
                        <Label className="mb-2">Details</Label>
                        <textarea
                            value={draft.description}
                            onChange={e => { templateDirty.current = true; set({ description: e.target.value }); }}
                            rows={9}
                            className="w-full bg-white border border-[#E6E6E1] rounded-2xl p-4 text-[13px] leading-relaxed text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200] outline-none resize-y font-mono"
                        />
                        {draft.support_ticket_id || draft.user_ids?.length || draft.partner_id || draft.event_id ? (
                            <div className="text-[11px] text-[#888888] mt-2">
                                Linked to {[
                                    draft.support_ticket_id && 'a support ticket',
                                    draft.user_ids?.length && `${draft.user_ids.length} member${draft.user_ids.length > 1 ? 's' : ''}`,
                                    draft.partner_id && 'a gym / partner',
                                    draft.event_id && 'a live event',
                                ].filter(Boolean).join(', ')}.
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="flex items-center justify-between gap-4 px-6 sm:px-8 py-5 border-t border-[#E6E6E1]">
                    <span className="hidden sm:inline text-[10px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black">⌘ Enter to file</span>
                    <button
                        onClick={submit}
                        disabled={saving}
                        className="h-11 px-7 rounded-full bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.25em] disabled:opacity-50"
                    >
                        {saving ? 'Filing…' : 'File issue'}
                    </button>
                </div>
            </div>
        </div>
    );
}
