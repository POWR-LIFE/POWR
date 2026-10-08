import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Copy, Link2, Bot, Trash2, Plus, Check, ExternalLink, GitPullRequest, Pencil, TriangleAlert, Send, Slack } from 'lucide-react';
import { useToast } from '../../../lib/toast';
import {
    STATUSES, CLOSED_STATUS, RESOLUTIONS, TYPES, PRIORITIES, PLATFORMS, RISKS, WAITING_ON, EFFORTS, TARGETS,
    SHIP_KINDS, shipKindOf, suggestShipSteps, shipProgress, issueKey, parseIssueKey, statusOf, typeOf, priorityOf,
    waitingLabel, ago, claudeBrief, linkLabel, newId, GITHUB_PR, sprintLabel, fmtDay,
} from './model';
import { surfaceOf, areaOf } from './taxonomy';
import * as api from './api';
import PlacePicker from './PlacePicker';
import { TypeIcon, Avatar, Label, SectionTitle, Markdown, inputClass, selectClass } from './ui';

// A text field that saves when you leave it (or press Enter on one line).
function BlurField({ value, onSave, multiline = false, rows = 3, className = '', ...rest }) {
    const [local, setLocal] = useState(value ?? '');
    useEffect(() => { setLocal(value ?? ''); }, [value]);
    const commit = () => { if (String(local ?? '') !== String(value ?? '')) onSave(local); };
    const props = {
        value: local,
        onChange: e => setLocal(e.target.value),
        onBlur: commit,
        ...rest,
    };
    return multiline
        ? <textarea rows={rows} {...props} className={`w-full bg-white border border-[#E6E6E1] rounded-2xl p-3 text-[13px] leading-relaxed text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200] outline-none resize-y ${className}`} />
        : <input {...props} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} className={`${inputClass} ${className}`} />;
}

// The title wraps (long ones are common, and phones are narrow) but stays one
// line of text: Enter saves instead of breaking the line.
function TitleField({ value, onSave }) {
    const [local, setLocal] = useState(value ?? '');
    const ref = useRef(null);
    useEffect(() => { setLocal(value ?? ''); }, [value]);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, [local]);
    return (
        <textarea
            ref={ref}
            rows={1}
            value={local}
            maxLength={200}
            aria-label="Title"
            onChange={e => setLocal(e.target.value.replace(/\n/g, ' '))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
            onBlur={() => { if (local !== value) onSave(local); }}
            className="w-full mt-2 bg-transparent border-0 outline-none resize-none overflow-hidden text-[20px] sm:text-[22px] font-light tracking-tight leading-snug text-[#1A1A1A]"
        />
    );
}

const copy = async (text, toast, what) => {
    try {
        await navigator.clipboard.writeText(text);
        toast.success(`${what} copied`);
    } catch {
        toast.error('Clipboard blocked by the browser');
    }
};

function activityText(row, admins, sprints) {
    const name = (id) => admins.find(a => a.id === id)?.name ?? 'someone';
    const sprintName = (id) => sprintLabel((sprints ?? []).find(s => s.id === id) ?? { name: 'a sprint' });
    switch (row.field) {
        case 'created':    return 'filed this';
        case 'status':     return <>moved it <b>{statusOf(row.old_value).label}</b> → <b>{statusOf(row.new_value).label}</b></>;
        case 'priority':   return <>set priority <b>{priorityOf(Number(row.old_value)).label}</b> → <b>{priorityOf(Number(row.new_value)).label}</b></>;
        case 'assignee':   return row.new_value ? <>assigned <b>{name(row.new_value)}</b></> : 'unassigned it';
        case 'type':       return <>made it a <b>{typeOf(row.new_value).label.toLowerCase()}</b></>;
        case 'place': {
            const [s, a] = (row.new_value ?? '').split('/');
            return <>moved it to <b>{[surfaceOf(s)?.label ?? s, areaOf(s, a)?.label].filter(Boolean).join(' › ')}</b></>;
        }
        case 'waiting_on': return row.new_value ? <>is now waiting on <b>{waitingLabel(row.new_value)}</b></> : 'is no longer waiting on anyone';
        case 'title':      return <>renamed it from “{row.old_value}”</>;
        case 'prs':        return row.new_value ? <>linked PR {row.new_value.split(',').map(n => `#${n}`).join(', ')}</> : 'removed the PR links';
        case 'ship':       return <>ship plan <b>{row.old_value}</b> → <b>{row.new_value}</b></>;
        case 'sprint':     return row.new_value ? <>moved it into <b>{sprintName(row.new_value)}</b></> : <>took it out of <b>{sprintName(row.old_value)}</b></>;
        default:           return `changed ${row.field}`;
    }
}

export default function IssueDrawer({ issue, allIssues, admins, sprints = null, onChange, onDelete, onClose, onOpenIssue }) {
    const toast = useToast();
    const [editingDesc, setEditingDesc] = useState(!issue.description);
    const [thread, setThread] = useState({ comments: [], activity: [] });
    const [relations, setRelations] = useState([]);
    const [slackUrl, setSlackUrl] = useState(null);
    const [comment, setComment] = useState('');
    const [sending, setSending] = useState(false);
    const adminById = useMemo(() => Object.fromEntries(admins.map(a => [a.id, a])), [admins]);
    const issueById = useMemo(() => Object.fromEntries(allIssues.map(i => [i.id, i])), [allIssues]);
    const latest = useRef(issue);
    latest.current = issue;

    const loadThread = useCallback(() => {
        api.loadThread(issue.id).then(setThread).catch(() => {});
    }, [issue.id]);

    useEffect(() => {
        loadThread();
        api.loadRelations(issue.id).then(setRelations).catch(() => {});
    }, [issue.id, loadThread]);

    // Posted by tracker-slack a moment after filing; ask again after each save.
    useEffect(() => { api.slackThread(issue.id).then(setSlackUrl); }, [issue.id, issue.updated_at]);

    useEffect(() => {
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { document.activeElement.blur(); return; }
            onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    // Optimistic: the board moves now, the server's row replaces it when it lands.
    const save = useCallback(async (patch) => {
        const before = latest.current;
        onChange({ ...before, ...patch });
        try {
            const saved = await api.updateIssue(before.id, patch);
            onChange(saved);
            loadThread();
        } catch (e) {
            onChange(before);
            toast.error(e.message || 'Could not save');
        }
    }, [onChange, loadThread, toast]);

    const steps = issue.ship_steps ?? [];
    const progress = shipProgress(steps);

    const moveTo = (status) => {
        if (status === issue.status) return;
        const unticked = progress.total - progress.done;
        if ((status === 'live' || status === 'verified') && unticked > 0
            && !window.confirm(`${unticked} ship step${unticked > 1 ? 's are' : ' is'} not ticked. Mark it ${statusOf(status).label.toLowerCase()} anyway?`)) return;
        save({ status });
    };

    // ── Ship plan ──────────────────────────────────────────────────────────
    const [newStep, setNewStep] = useState({ kind: 'ota', target: '' });
    const setSteps = (next) => save({ ship_steps: next });
    const toggleStep = (id) => setSteps(steps.map(s => s.id === id ? { ...s, done: !s.done, done_at: !s.done ? new Date().toISOString() : null } : s));
    const removeStep = (id) => setSteps(steps.filter(s => s.id !== id));
    const addStep = () => {
        setSteps([...steps, { id: newId(), kind: newStep.kind, target: newStep.target.trim(), done: false }]);
        setNewStep(s => ({ ...s, target: '' }));
    };
    const newKind = shipKindOf(newStep.kind);

    // ── Checklist ──────────────────────────────────────────────────────────
    const checklist = issue.checklist ?? [];
    const [newItem, setNewItem] = useState('');
    const addItem = () => {
        const text = newItem.trim();
        if (!text) return;
        save({ checklist: [...checklist, { id: newId(), text, done: false }] });
        setNewItem('');
    };

    // ── Links ──────────────────────────────────────────────────────────────
    const [members, setMembers] = useState([]);
    const [partner, setPartner] = useState(null);
    const [ticket, setTicket] = useState(null);
    const [events, setEvents] = useState(null);
    const [prInput, setPrInput] = useState('');
    const [linkInput, setLinkInput] = useState('');
    const [memberQ, setMemberQ] = useState('');
    const [memberHits, setMemberHits] = useState([]);
    const [partnerQ, setPartnerQ] = useState('');
    const [partnerHits, setPartnerHits] = useState([]);

    useEffect(() => { api.membersByIds(issue.user_ids).then(setMembers).catch(() => {}); }, [issue.user_ids]);
    useEffect(() => { api.partnerById(issue.partner_id).then(setPartner).catch(() => {}); }, [issue.partner_id]);
    useEffect(() => { api.ticketById(issue.support_ticket_id).then(setTicket).catch(() => {}); }, [issue.support_ticket_id]);
    useEffect(() => {
        if (issue.event_id && events == null) api.recentEvents().then(setEvents).catch(() => setEvents([]));
    }, [issue.event_id, events]);

    useEffect(() => {
        if (memberQ.trim().length < 2) { setMemberHits([]); return; }
        const t = setTimeout(() => api.searchMembers(memberQ).then(setMemberHits).catch(() => {}), 250);
        return () => clearTimeout(t);
    }, [memberQ]);
    useEffect(() => {
        if (partnerQ.trim().length < 2) { setPartnerHits([]); return; }
        const t = setTimeout(() => api.searchPartners(partnerQ).then(setPartnerHits).catch(() => {}), 250);
        return () => clearTimeout(t);
    }, [partnerQ]);

    const addPr = () => {
        const n = Number(prInput.replace(/[^\d]/g, ''));
        if (!n) return;
        if (!issue.pr_numbers?.includes(n)) save({ pr_numbers: [...(issue.pr_numbers ?? []), n] });
        setPrInput('');
    };
    const addLink = () => {
        const url = linkInput.trim();
        if (!/^https?:\/\//i.test(url)) { toast.error('Links start with https://'); return; }
        save({ links: [...(issue.links ?? []), { label: linkLabel(url), url }] });
        setLinkInput('');
    };
    const event = events?.find(e => e.id === issue.event_id);

    // ── Relations ──────────────────────────────────────────────────────────
    const [relKind, setRelKind] = useState('relates');
    const [relInput, setRelInput] = useState('');
    const addRelation = async () => {
        const n = parseIssueKey(relInput) ?? parseIssueKey(relInput.split(' ')[0]);
        const target = allIssues.find(i => i.number === n);
        if (!target || target.id === issue.id) { toast.error('Pick another issue by its POWR number'); return; }
        const [from, to, kind] = relKind === 'blocked_by' ? [target.id, issue.id, 'blocks'] : [issue.id, target.id, relKind];
        try {
            await api.addRelation(from, to, kind);
            setRelations(await api.loadRelations(issue.id));
            setRelInput('');
        } catch (e) {
            toast.error(e.message || 'Could not link');
        }
    };
    const relationRows = relations.map(r => {
        const outgoing = r.from_id === issue.id;
        const other = issueById[outgoing ? r.to_id : r.from_id];
        const label = r.kind === 'blocks' ? (outgoing ? 'Blocks' : 'Blocked by')
            : r.kind === 'duplicates' ? (outgoing ? 'Duplicates' : 'Duplicated by') : 'Relates to';
        return { r, other, label };
    }).filter(x => x.other);

    // ── Comments ───────────────────────────────────────────────────────────
    const sendComment = async () => {
        const body = comment.trim();
        if (!body) return;
        setSending(true);
        try {
            await api.addComment(issue.id, body);
            setComment('');
            loadThread();
        } catch (e) {
            toast.error(e.message || 'Could not post');
        }
        setSending(false);
    };
    const timeline = [
        ...thread.comments.map(c => ({ kind: 'comment', at: c.created_at, row: c })),
        ...thread.activity.map(a => ({ kind: 'activity', at: a.created_at, row: a })),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));

    const removeIssue = async () => {
        if (!window.confirm(`Delete ${issueKey(issue)} for good? Closing it keeps the history.`)) return;
        try {
            await api.deleteIssue(issue.id);
            onDelete(issue.id);
        } catch (e) {
            toast.error(e.message || 'Could not delete');
        }
    };

    const reporter = adminById[issue.created_by];
    const area = areaOf(issue.surface, issue.area);
    const blocked = relationRows.some(x => x.label === 'Blocked by' && x.other.status !== 'verified' && x.other.status !== 'closed');

    return (
        <div className="fixed inset-0 z-[200] flex justify-end">
            <div className="absolute inset-0 bg-[#1A1A1A]/30 backdrop-blur-sm" onClick={onClose} />
            <div role="dialog" aria-modal="true" aria-label={`${issueKey(issue)} ${issue.title}`} className="relative w-full max-w-[1120px] h-full bg-[#F4F4F1] border-l border-[#E6E6E1] overflow-y-auto animate-in slide-in-from-right duration-300">
                {/* Header */}
                <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-[#E6E6E1] px-5 sm:px-8 py-4">
                    <div className="flex items-center gap-3">
                        <TypeIcon type={issue.type} size={16} />
                        <span className="text-[11px] font-black tracking-[0.2em] text-[#888888]">{issueKey(issue)}</span>
                        <span className="text-[11px] text-[#BBBBBB] hidden sm:inline">· filed {ago(issue.created_at)}{reporter ? ` by ${reporter.name}` : issue.source === 'claude' ? ' by Claude' : ''}</span>
                        <div className="ml-auto flex items-center gap-2">
                            {slackUrl ? (
                                <a href={slackUrl} target="_blank" rel="noreferrer" title="Its thread in Slack"
                                    className="h-9 px-3 rounded-xl border border-[#E6E6E1] bg-white inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#555555] hover:border-[#E8D200]">
                                    <Slack size={14} /><span className="hidden sm:inline">Slack</span>
                                </a>
                            ) : null}
                            <button onClick={() => copy(claudeBrief(issue, { origin: window.location.origin }), toast, 'Brief for Claude')} title="Copy a brief to paste into a Claude Code session"
                                className="h-9 px-3 rounded-xl border border-[#E6E6E1] bg-white inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#555555] hover:border-[#E8D200]">
                                <Bot size={14} /><span className="hidden sm:inline">Brief for Claude</span>
                            </button>
                            <button onClick={() => copy(`${window.location.origin}/admin/tracker?issue=${issueKey(issue)}`, toast, 'Link')} title="Copy link" aria-label="Copy link"
                                className="w-9 h-9 rounded-xl border border-[#E6E6E1] bg-white flex items-center justify-center text-[#888888] hover:text-[#1A1A1A]">
                                <Link2 size={14} />
                            </button>
                            <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-xl border border-[#E6E6E1] bg-white flex items-center justify-center text-[#888888] hover:text-[#1A1A1A]">
                                <X size={15} />
                            </button>
                        </div>
                    </div>
                    <TitleField value={issue.title} onSave={v => v.trim() && save({ title: v.trim() })} />
                    {/* The flow */}
                    <div className="mt-3 -mx-1 flex items-center gap-1 overflow-x-auto pb-1">
                        {STATUSES.map((s, i) => {
                            const idx = STATUSES.findIndex(x => x.key === issue.status);
                            const current = s.key === issue.status;
                            const past = idx > i;
                            return (
                                <button
                                    key={s.key}
                                    onClick={() => moveTo(s.key)}
                                    title={s.hint}
                                    aria-pressed={current}
                                    className={`shrink-0 h-8 px-3 rounded-full border text-[10px] font-black uppercase tracking-[0.15em] transition-all ${current ? 'text-white border-transparent' : past ? 'bg-white border-[#E6E6E1] text-[#999999]' : 'bg-white border-[#E6E6E1] text-[#555555] hover:border-[#BBBBBB]'}`}
                                    style={current ? { background: s.color } : undefined}
                                >
                                    {past ? <Check size={10} className="inline -mt-0.5 mr-1" /> : null}{s.label}
                                </button>
                            );
                        })}
                        <span className="shrink-0 w-px h-6 bg-[#E6E6E1] mx-1" />
                        <select
                            aria-label="Close with resolution"
                            value={issue.status === 'closed' ? (issue.resolution ?? 'done') : ''}
                            onChange={e => e.target.value && save({ status: 'closed', resolution: e.target.value })}
                            className={`shrink-0 h-8 rounded-full border px-3 text-[10px] font-black uppercase tracking-[0.15em] outline-none ${issue.status === 'closed' ? 'bg-[#555555] text-white border-transparent' : 'bg-white border-[#E6E6E1] text-[#555555]'}`}
                        >
                            <option value="">{CLOSED_STATUS.label}…</option>
                            {RESOLUTIONS.map(r => <option key={r.key} value={r.key}>Closed · {r.label}</option>)}
                        </select>
                    </div>
                    <div className="text-[11px] text-[#888888] mt-1">{statusOf(issue.status).hint}</div>
                </div>

                <div className="px-5 sm:px-8 py-8 grid lg:grid-cols-[minmax(0,1fr)_320px] gap-10">
                    {/* Main column */}
                    <div className="space-y-10 min-w-0">
                        {blocked ? (
                            <div className="flex items-center gap-3 p-3 rounded-2xl border border-[#F97316]/40 bg-[#F97316]/10 text-[12px] text-[#9A3412]">
                                <TriangleAlert size={15} /> Blocked by an issue that isn't verified yet — see Related.
                            </div>
                        ) : null}

                        <div>
                            <SectionTitle right={
                                <button onClick={() => setEditingDesc(e => !e)} className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-[#888888] hover:text-[#1A1A1A]">
                                    <Pencil size={11} />{editingDesc ? 'Preview' : 'Edit'}
                                </button>
                            }>Details</SectionTitle>
                            {editingDesc ? (
                                <BlurField multiline rows={12} value={issue.description} onSave={v => save({ description: v })}
                                    placeholder="What's wrong or wanted, the evidence, and what done looks like. Markdown works." className="font-mono text-[12px]" />
                            ) : issue.description?.trim() ? (
                                <div className="bg-white border border-[#E6E6E1] rounded-2xl p-5 cursor-text" onDoubleClick={() => setEditingDesc(true)}>
                                    <Markdown text={issue.description} />
                                </div>
                            ) : (
                                <button onClick={() => setEditingDesc(true)} className="w-full text-left bg-white border border-dashed border-[#DDDDD8] rounded-2xl p-5 text-[13px] text-[#AAAAAA]">Add details…</button>
                            )}
                        </div>

                        {/* Ship plan */}
                        <div>
                            <SectionTitle right={progress.total ? <span className="text-[11px] font-bold text-[#555555]">{progress.done}/{progress.total} done</span> : null}>
                                How it reaches people
                            </SectionTitle>
                            {progress.total ? (
                                <div className="h-1.5 rounded-full bg-[#E6E6E1] overflow-hidden mb-3">
                                    <div className="h-full bg-[#10B981] transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                                </div>
                            ) : null}
                            <div className="bg-white border border-[#E6E6E1] rounded-2xl divide-y divide-[#F0F0EC]">
                                {steps.map(s => {
                                    const k = shipKindOf(s.kind);
                                    return (
                                        <div key={s.id} className="flex items-start gap-3 px-4 py-3">
                                            <button onClick={() => toggleStep(s.id)} aria-label={s.done ? 'Mark not done' : 'Mark done'}
                                                className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${s.done ? 'bg-[#10B981] border-[#10B981] text-white' : 'border-[#CCCCCC] bg-white'}`}>
                                                {s.done ? <Check size={12} /> : null}
                                            </button>
                                            <div className="flex-1 min-w-0">
                                                <div className={`text-[13px] ${s.done ? 'text-[#999999] line-through' : 'text-[#1A1A1A]'}`}>
                                                    <span className="font-bold">{k.label}</span>{s.target ? <span className="font-mono text-[12px]"> · {s.target}</span> : null}
                                                </div>
                                                {s.done && s.done_at ? <div className="text-[10px] text-[#AAAAAA]">done {ago(s.done_at)}</div> : null}
                                                {!s.done && k.note ? <div className="text-[11px] text-[#A16207] mt-0.5">{k.note}</div> : null}
                                            </div>
                                            <button onClick={() => removeStep(s.id)} aria-label="Remove step" className="text-[#CCCCCC] hover:text-[#F43F5E]"><X size={14} /></button>
                                        </div>
                                    );
                                })}
                                <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                                    <select aria-label="Step kind" value={newStep.kind} onChange={e => setNewStep({ kind: e.target.value, target: '' })} className={selectClass}>
                                        {SHIP_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
                                    </select>
                                    {newKind.options ? (
                                        <select aria-label="Step target" value={newStep.target} onChange={e => setNewStep(s => ({ ...s, target: e.target.value }))} className={`${selectClass} flex-1 min-w-[140px]`}>
                                            <option value="">Which…</option>
                                            {newKind.options.map(o => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                    ) : (
                                        <input aria-label="Step target" value={newStep.target} onChange={e => setNewStep(s => ({ ...s, target: e.target.value }))}
                                            onKeyDown={e => e.key === 'Enter' && addStep()} placeholder={newKind.placeholder} className={`${inputClass} flex-1 min-w-[140px] !w-auto`} />
                                    )}
                                    <button onClick={addStep} className="h-10 px-4 rounded-xl bg-[#1A1A1A] text-white text-[10px] font-black uppercase tracking-[0.2em] inline-flex items-center gap-1.5"><Plus size={12} />Add</button>
                                    {!steps.length && suggestShipSteps(issue).length ? (
                                        <button onClick={() => setSteps(suggestShipSteps(issue))} className="h-10 px-3 rounded-xl border border-[#E6E6E1] text-[10px] font-black uppercase tracking-[0.2em] text-[#666666] hover:border-[#BBBBBB]">
                                            Suggest
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        </div>

                        {/* Proof */}
                        <div>
                            <SectionTitle>How we'll know it worked</SectionTitle>
                            <BlurField multiline rows={2} value={issue.verify_how} onSave={v => save({ verify_how: v || null })}
                                placeholder="e.g. Sorine's next visit to Elite Xàbia opens and closes in Live Ops; no 23505 in claim-points logs for a week." />
                            {issue.status === 'live' || issue.status === 'verified' ? (
                                <div className="mt-4">
                                    <Label className="mb-2">{issue.status === 'verified' ? `Proof · verified ${ago(issue.verified_at)}` : 'Proof, once you have it'}</Label>
                                    <BlurField multiline rows={2} value={issue.verified_note} onSave={v => save({ verified_note: v || null })}
                                        placeholder="What you saw, where, when. Link the device, the query or the log." />
                                </div>
                            ) : null}
                        </div>

                        {/* Checklist */}
                        <div>
                            <SectionTitle right={checklist.length ? <span className="text-[11px] font-bold text-[#555555]">{checklist.filter(c => c.done).length}/{checklist.length}</span> : null}>Checklist</SectionTitle>
                            <div className="bg-white border border-[#E6E6E1] rounded-2xl divide-y divide-[#F0F0EC]">
                                {checklist.map(c => (
                                    <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                                        <button onClick={() => save({ checklist: checklist.map(x => x.id === c.id ? { ...x, done: !x.done } : x) })} aria-label={c.done ? 'Untick' : 'Tick'}
                                            className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${c.done ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'border-[#CCCCCC]'}`}>
                                            {c.done ? <Check size={12} /> : null}
                                        </button>
                                        <span className={`flex-1 text-[13px] ${c.done ? 'line-through text-[#AAAAAA]' : 'text-[#1A1A1A]'}`}>{c.text}</span>
                                        <button onClick={() => save({ checklist: checklist.filter(x => x.id !== c.id) })} aria-label="Remove" className="text-[#CCCCCC] hover:text-[#F43F5E]"><X size={14} /></button>
                                    </div>
                                ))}
                                <div className="flex items-center gap-2 px-4 py-2.5">
                                    <Plus size={14} className="text-[#BBBBBB]" />
                                    <input value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && addItem()} placeholder="Add a step and press Enter"
                                        className="flex-1 bg-transparent outline-none text-[13px] text-[#1A1A1A] placeholder-[#BBBBBB] h-8" />
                                </div>
                            </div>
                        </div>

                        {/* Related */}
                        <div>
                            <SectionTitle>Related issues</SectionTitle>
                            <div className="space-y-2">
                                {relationRows.map(({ r, other, label }) => (
                                    <div key={`${r.from_id}-${r.to_id}-${r.kind}`} className="flex items-center gap-3 bg-white border border-[#E6E6E1] rounded-xl px-3 py-2">
                                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#999999] w-24 shrink-0">{label}</span>
                                        <button onClick={() => onOpenIssue(other.number)} className="flex-1 min-w-0 text-left text-[13px] text-[#1A1A1A] truncate hover:underline">
                                            <span className="font-bold text-[#888888]">{issueKey(other)}</span> {other.title}
                                        </button>
                                        <span className="text-[10px] font-bold" style={{ color: statusOf(other.status).color }}>{statusOf(other.status).label}</span>
                                        <button onClick={async () => { await api.removeRelation(r).catch(() => {}); setRelations(await api.loadRelations(issue.id)); }} aria-label="Unlink" className="text-[#CCCCCC] hover:text-[#F43F5E]"><X size={14} /></button>
                                    </div>
                                ))}
                                <div className="flex flex-wrap items-center gap-2">
                                    <select aria-label="Relation" value={relKind} onChange={e => setRelKind(e.target.value)} className={selectClass}>
                                        <option value="relates">Relates to</option>
                                        <option value="blocks">Blocks</option>
                                        <option value="blocked_by">Blocked by</option>
                                        <option value="duplicates">Duplicates</option>
                                    </select>
                                    <input list="tracker-issue-keys" value={relInput} onChange={e => setRelInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addRelation()}
                                        placeholder="POWR-12" className={`${inputClass} flex-1 min-w-[160px] !w-auto`} />
                                    <datalist id="tracker-issue-keys">
                                        {allIssues.filter(i => i.id !== issue.id).slice(0, 300).map(i => <option key={i.id} value={`${issueKey(i)} ${i.title}`} />)}
                                    </datalist>
                                    <button onClick={addRelation} className="h-10 px-4 rounded-xl bg-[#1A1A1A] text-white text-[10px] font-black uppercase tracking-[0.2em]">Link</button>
                                </div>
                            </div>
                        </div>

                        {/* Thread */}
                        <div>
                            <SectionTitle>Activity</SectionTitle>
                            <div className="space-y-3">
                                {timeline.map(t => t.kind === 'comment' ? (
                                    <Comment key={`c-${t.row.id}`} row={t.row} author={adminById[t.row.author_id]} onSaved={loadThread} />
                                ) : (
                                    <div key={`a-${t.row.id}`} className="flex items-center gap-2 pl-1 text-[12px] text-[#777777]">
                                        <span className="w-1.5 h-1.5 rounded-full bg-[#CCCCCC] shrink-0" />
                                        <span className="font-bold text-[#555555]">{adminById[t.row.actor_id]?.name ?? 'System'}</span>
                                        <span className="min-w-0">{activityText(t.row, admins, sprints)}</span>
                                        <span className="text-[#BBBBBB] shrink-0">· {ago(t.at)}</span>
                                    </div>
                                ))}
                                <div className="bg-white border border-[#E6E6E1] rounded-2xl p-3">
                                    <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3}
                                        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendComment(); } }}
                                        placeholder="Add a note — what you tried, what you found. ⌘ Enter to post."
                                        className="w-full bg-transparent outline-none resize-y text-[13px] text-[#1A1A1A] placeholder-[#BBBBBB]" />
                                    <div className="flex justify-end">
                                        <button onClick={sendComment} disabled={sending || !comment.trim()} className="h-9 px-4 rounded-full bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] inline-flex items-center gap-1.5 disabled:opacity-40">
                                            <Send size={12} />Post
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Side column */}
                    <div className="space-y-6">
                        <Side label="Priority">
                            <div className="grid grid-cols-4 gap-1.5">
                                {PRIORITIES.map(p => (
                                    <button key={p.value} title={`${p.name} — ${p.hint}`} onClick={() => p.value !== issue.priority && save({ priority: p.value })} aria-pressed={issue.priority === p.value}
                                        className="h-8 rounded-full border text-[10px] font-black"
                                        style={issue.priority === p.value ? { background: p.color, borderColor: p.color, color: '#FFF' } : { background: '#FFF', borderColor: '#E6E6E1', color: p.color }}>
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </Side>

                        <Side label="Type">
                            <select value={issue.type} onChange={e => save({ type: e.target.value })} className={`${selectClass} w-full`}>
                                {TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                            </select>
                        </Side>

                        <Side label="Assignee">
                            <div className="flex items-center gap-2">
                                <Avatar person={adminById[issue.assignee_id]} size={28} />
                                <select value={issue.assignee_id ?? ''} onChange={e => save({ assignee_id: e.target.value || null })} className={`${selectClass} flex-1`}>
                                    <option value="">Nobody</option>
                                    {admins.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                </select>
                            </div>
                        </Side>

                        {sprints ? (
                            <Side label="Sprint">
                                <select value={issue.sprint_id ?? ''} onChange={e => save({ sprint_id: e.target.value || null })} className={`${selectClass} w-full`}>
                                    <option value="">Backlog (no sprint)</option>
                                    {sprints.filter(sp => sp.status !== 'completed' || sp.id === issue.sprint_id).map(sp => (
                                        <option key={sp.id} value={sp.id}>
                                            {sprintLabel(sp)} · {sp.status === 'active' ? 'running' : sp.status === 'planned' ? `starts ${fmtDay(sp.starts_on)}` : 'finished'}
                                        </option>
                                    ))}
                                </select>
                            </Side>
                        ) : null}

                        <Side label="Where in POWR">
                            <PlacePicker compact value={issue} onChange={place => save(place)} />
                            {area?.paths?.length ? (
                                <div className="mt-2 text-[10px] text-[#888888] leading-relaxed break-words">
                                    {area.paths.map((p, i) => <code key={p} className="font-mono">{i ? ' · ' : ''}{p}</code>)}
                                </div>
                            ) : null}
                        </Side>

                        <Side label="Platforms & version">
                            <div className="flex gap-1.5 mb-2">
                                {PLATFORMS.map(p => {
                                    const on = issue.platforms?.includes(p.key);
                                    return (
                                        <button key={p.key} aria-pressed={on} onClick={() => save({ platforms: on ? issue.platforms.filter(x => x !== p.key) : [...(issue.platforms ?? []), p.key] })}
                                            className={`h-8 px-3 rounded-full border text-[10px] font-black uppercase tracking-[0.15em] ${on ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-white border-[#E6E6E1] text-[#666666]'}`}>
                                            {p.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <BlurField value={issue.app_version} onSave={v => save({ app_version: v.trim() || null })} placeholder="App version, e.g. 1.6.0 (20)" />
                        </Side>

                        <Side label="Waiting on">
                            <select value={issue.waiting_on ?? ''} onChange={e => save({ waiting_on: e.target.value || null })} className={`${selectClass} w-full mb-2`}>
                                <option value="">Nobody</option>
                                {WAITING_ON.map(w => <option key={w.key} value={w.key}>{w.label}</option>)}
                            </select>
                            {issue.waiting_on ? <BlurField value={issue.waiting_note} onSave={v => save({ waiting_note: v.trim() || null })} placeholder="For what?" /> : null}
                        </Side>

                        <Side label="Target & due">
                            <BlurField list="tracker-targets" value={issue.target} onSave={v => save({ target: v.trim() || null })} placeholder="Next OTA, 1.6.1 build…" className="mb-2" />
                            <datalist id="tracker-targets">{TARGETS.map(t => <option key={t} value={t} />)}</datalist>
                            <input type="date" value={issue.due_date ?? ''} onChange={e => save({ due_date: e.target.value || null })} className={inputClass} aria-label="Due date" />
                        </Side>

                        <Side label="Effort">
                            <div className="grid grid-cols-5 gap-1.5">
                                {EFFORTS.map(ef => (
                                    <button key={ef.key} title={ef.hint} aria-pressed={issue.effort === ef.key} onClick={() => save({ effort: issue.effort === ef.key ? null : ef.key })}
                                        className={`h-8 rounded-full border text-[10px] font-black ${issue.effort === ef.key ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-white border-[#E6E6E1] text-[#666666]'}`}>
                                        {ef.label}
                                    </button>
                                ))}
                            </div>
                        </Side>

                        <Side label="What's at stake">
                            <div className="flex flex-wrap gap-1.5 mb-2">
                                {RISKS.map(r => {
                                    const on = issue.risks?.includes(r.key);
                                    return (
                                        <button key={r.key} aria-pressed={on} onClick={() => save({ risks: on ? issue.risks.filter(x => x !== r.key) : [...(issue.risks ?? []), r.key] })}
                                            className={`h-7 px-2.5 rounded-full border text-[10px] font-bold ${on ? 'bg-[#F43F5E]/10 border-[#F43F5E]/40 text-[#BE123C]' : 'bg-white border-[#E6E6E1] text-[#777777]'}`}>
                                            {r.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <BlurField type="number" min="0" value={issue.users_affected ?? ''} onSave={v => save({ users_affected: v === '' ? null : Math.max(0, parseInt(v, 10) || 0) })} placeholder="Members affected (estimate)" />
                        </Side>

                        <Side label="Labels">
                            <BlurField value={(issue.labels ?? []).join(', ')} onSave={v => save({ labels: [...new Set(v.split(',').map(x => x.trim().toLowerCase()).filter(Boolean))] })} placeholder="comma, separated" />
                        </Side>

                        <Side label="Pull requests">
                            <div className="flex flex-wrap gap-1.5 mb-2">
                                {(issue.pr_numbers ?? []).map(n => (
                                    <span key={n} className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1.5 rounded-full border border-[#E6E6E1] bg-white text-[11px] font-bold text-[#6D28D9]">
                                        <GitPullRequest size={11} />
                                        <a href={GITHUB_PR(n)} target="_blank" rel="noreferrer" className="hover:underline">#{n}</a>
                                        <button onClick={() => save({ pr_numbers: issue.pr_numbers.filter(x => x !== n) })} aria-label={`Unlink PR ${n}`} className="text-[#CCCCCC] hover:text-[#F43F5E]"><X size={11} /></button>
                                    </span>
                                ))}
                            </div>
                            <input value={prInput} onChange={e => setPrInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPr()} placeholder="PR number, Enter" className={inputClass} />
                        </Side>

                        <Side label="Linked to">
                            <div className="space-y-2">
                                {members.map(m => (
                                    <LinkedRow key={m.id} to={`/admin/users/${m.id}`} kind="Member" name={m.display_name || m.username || 'Member'}
                                        onRemove={() => save({ user_ids: issue.user_ids.filter(x => x !== m.id) })} />
                                ))}
                                {partner ? (
                                    <LinkedRow to={partner.category === 'gym' ? `/admin/gyms?gym=${partner.id}` : `/admin/partners/${partner.id}`} kind={partner.category === 'gym' ? 'Gym' : 'Partner'} name={partner.name}
                                        onRemove={() => save({ partner_id: null })} />
                                ) : null}
                                {issue.event_id ? (
                                    <LinkedRow to="/admin/events" kind="Event" name={event?.name ?? 'Live event'} onRemove={() => save({ event_id: null })} />
                                ) : null}
                                {ticket ? (
                                    <LinkedRow to={`/admin/support?ticket=${ticket.id}`} kind="Ticket" name={ticket.subject} onRemove={() => save({ support_ticket_id: null })} />
                                ) : null}
                                {(issue.links ?? []).map((l, i) => (
                                    <div key={`${l.url}-${i}`} className="flex items-center gap-2 bg-white border border-[#E6E6E1] rounded-xl px-3 py-2">
                                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#999999] w-14 shrink-0">Link</span>
                                        <a href={l.url} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate text-[12px] font-bold text-[#0369A1] hover:underline inline-flex items-center gap-1">
                                            {l.label}<ExternalLink size={10} className="shrink-0" />
                                        </a>
                                        <button onClick={() => save({ links: issue.links.filter((_, j) => j !== i) })} aria-label="Remove link" className="text-[#CCCCCC] hover:text-[#F43F5E]"><X size={13} /></button>
                                    </div>
                                ))}

                                <Finder placeholder="Link a member…" q={memberQ} setQ={setMemberQ} hits={memberHits}
                                    render={m => m.display_name || m.username}
                                    onPick={m => { if (!issue.user_ids?.includes(m.id)) save({ user_ids: [...(issue.user_ids ?? []), m.id] }); setMemberQ(''); }} />
                                {!partner ? (
                                    <Finder placeholder="Link a gym or partner…" q={partnerQ} setQ={setPartnerQ} hits={partnerHits}
                                        render={p => `${p.name}${p.category === 'gym' ? '' : ` · ${p.category}`}`}
                                        onPick={p => { save({ partner_id: p.id }); setPartnerQ(''); }} />
                                ) : null}
                                {!issue.event_id ? (
                                    <select value="" onFocus={() => events == null && api.recentEvents().then(setEvents).catch(() => setEvents([]))}
                                        onChange={e => e.target.value && save({ event_id: e.target.value })} className={`${selectClass} w-full`}>
                                        <option value="">Link a live event…</option>
                                        {(events ?? []).map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                                    </select>
                                ) : null}
                                <input value={linkInput} onChange={e => setLinkInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addLink()}
                                    placeholder="Paste a Sentry / Slack / Drive link, Enter" className={inputClass} />
                            </div>
                        </Side>

                        <div className="pt-4 border-t border-[#E6E6E1] space-y-1 text-[11px] text-[#999999]">
                            <div>Filed {new Date(issue.created_at).toLocaleString()} · {issue.source === 'claude' ? 'by Claude' : issue.source === 'support' ? 'from support' : reporter?.name ?? 'admin'}</div>
                            <div>Updated {ago(issue.updated_at)}{adminById[issue.updated_by] ? ` by ${adminById[issue.updated_by].name}` : ''}</div>
                            <button onClick={() => copy(claudeBrief(issue, { origin: window.location.origin }), toast, 'Brief for Claude')} className="inline-flex items-center gap-1.5 mt-2 text-[#555555] hover:text-[#1A1A1A]">
                                <Copy size={11} /> Copy brief for a Claude session
                            </button>
                            <div>
                                <button onClick={removeIssue} className="inline-flex items-center gap-1.5 mt-2 text-[#BE123C] hover:underline"><Trash2 size={11} /> Delete issue</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

const Side = ({ label, children }) => (
    <div>
        <Label className="mb-2">{label}</Label>
        {children}
    </div>
);

function LinkedRow({ to, kind, name, onRemove }) {
    return (
        <div className="flex items-center gap-2 bg-white border border-[#E6E6E1] rounded-xl px-3 py-2">
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#999999] w-14 shrink-0">{kind}</span>
            <Link to={to} className="flex-1 min-w-0 truncate text-[12px] font-bold text-[#1A1A1A] hover:underline">{name}</Link>
            <button onClick={onRemove} aria-label={`Unlink ${kind}`} className="text-[#CCCCCC] hover:text-[#F43F5E]"><X size={13} /></button>
        </div>
    );
}

function Finder({ placeholder, q, setQ, hits, render, onPick }) {
    return (
        <div className="relative">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} className={inputClass} />
            {hits.length ? (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-[#E6E6E1] rounded-xl overflow-hidden">
                    {hits.map(h => (
                        <button key={h.id} onClick={() => onPick(h)} className="block w-full text-left px-3 py-2 text-[12px] text-[#1A1A1A] hover:bg-[#F4F4F1] truncate">{render(h)}</button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function Comment({ row, author, onSaved }) {
    const toast = useToast();
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState(row.body);
    const save = async () => {
        try {
            await api.editComment(row.id, text.trim());
            setEditing(false);
            onSaved();
        } catch (e) {
            toast.error(e.message || 'Could not save');
        }
    };
    const remove = async () => {
        if (!window.confirm('Delete this note?')) return;
        await api.deleteComment(row.id).catch(e => toast.error(e.message));
        onSaved();
    };
    return (
        <div className="bg-white border border-[#E6E6E1] rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
                <Avatar person={author ?? { name: 'System' }} size={20} />
                <span className="text-[12px] font-bold text-[#1A1A1A]">{author?.name ?? 'System'}</span>
                <span className="text-[11px] text-[#BBBBBB]">{ago(row.created_at)}{row.edited_at ? ' · edited' : ''}</span>
                <div className="ml-auto flex items-center gap-2">
                    <button onClick={() => setEditing(e => !e)} aria-label="Edit note" className="text-[#BBBBBB] hover:text-[#1A1A1A]"><Pencil size={12} /></button>
                    <button onClick={remove} aria-label="Delete note" className="text-[#BBBBBB] hover:text-[#F43F5E]"><Trash2 size={12} /></button>
                </div>
            </div>
            {editing ? (
                <div>
                    <textarea value={text} onChange={e => setText(e.target.value)} rows={3} className="w-full bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl p-3 text-[13px] outline-none focus:border-[#E8D200]" />
                    <div className="flex justify-end mt-2">
                        <button onClick={save} disabled={!text.trim()} className="h-8 px-4 rounded-full bg-[#1A1A1A] text-white text-[10px] font-black uppercase tracking-[0.2em] disabled:opacity-40">Save</button>
                    </div>
                </div>
            ) : <Markdown text={row.body} />}
        </div>
    );
}
