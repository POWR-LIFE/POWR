import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X, Play, Flag, Pencil, Trash2, ChevronDown, ChevronRight, Columns3, TrendingDown } from 'lucide-react';
import {
    PROGRESS_GROUPS, EFFORTS, sprintStats, burndown, daysLeft, fmtDay, addDays, todayIso, sprintLabel, issueKey,
    isOpen, byUrgency, statusOf,
} from './model';
import { PriorityBadge, PlaceChip, TypeIcon, Label, inputClass, selectClass } from './ui';

const STATUS_CHIP = {
    active:    'bg-[#10B981] text-white border-transparent',
    planned:   'bg-white text-[#555555] border-[#E6E6E1]',
    completed: 'bg-[#1A1A1A] text-white border-transparent',
};

export function SprintChip({ status }) {
    return (
        <span className={`inline-flex items-center h-6 px-2.5 rounded-full border text-[9px] font-black uppercase tracking-[0.2em] ${STATUS_CHIP[status]}`}>
            {status === 'active' ? 'Running' : status === 'planned' ? 'Planned' : 'Complete'}
        </span>
    );
}

function timeLeft(sprint) {
    if (sprint.status === 'completed') return sprint.completed_at ? `Completed ${new Date(sprint.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Completed';
    const d = daysLeft(sprint);
    if (sprint.status === 'planned') {
        const until = -daysLeft({ ends_on: sprint.starts_on });
        return until > 0 ? `Was due to start ${until}d ago` : until === 0 ? 'Due to start today' : `Starts in ${-until}d`;
    }
    if (d > 1) return `${d} days left`;
    if (d === 1) return 'Ends tomorrow';
    if (d === 0) return 'Ends today';
    return `${-d} day${d === -1 ? '' : 's'} over — complete it`;
}

// Segmented bar: one fill per group, 2px gaps, labels below in text ink.
export function ProgressBar({ stats, compact = false }) {
    const parts = PROGRESS_GROUPS.map(g => ({ ...g, n: stats.groups[g.key] })).filter(g => g.n > 0);
    return (
        <div>
            <div className="flex gap-[2px] h-2.5 rounded-full overflow-hidden bg-[#F0F0EC]" role="img"
                aria-label={parts.map(p => `${p.n} ${p.label.toLowerCase()}`).join(', ') || 'Nothing in this sprint yet'}>
                {parts.map(p => (
                    <div key={p.key} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(p.n / Math.max(1, stats.total)) * 100}%`, background: p.color }} title={`${p.n} ${p.label}`} />
                ))}
            </div>
            {!compact && parts.length ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                    {parts.map(p => (
                        <span key={p.key} className="inline-flex items-center gap-1.5 text-[11px] text-[#555555]">
                            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />{p.n} {p.label.toLowerCase()}
                        </span>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

/**
 * Burndown — issues left at the end of each day against the straight line to
 * zero. One actual series (solid, ink) and its reference (dashed, grey), a
 * legend, a direct label on the latest value, and a hover crosshair.
 */
export function Burndown({ sprint, members }) {
    const { total, days } = useMemo(() => burndown(sprint, members), [sprint, members]);
    const [hover, setHover] = useState(null);
    const wrap = useRef(null);
    const W = 560, H = 180, L = 30, R = 34, T = 14, B = 26;
    const n = days.length;
    const x = (k) => L + (k / n) * (W - L - R); // k = 0 (start) … n (end of last day)
    const y = (v) => T + (1 - v / Math.max(1, total)) * (H - T - B);
    const actual = [{ k: 0, v: total }, ...days.map((d, idx) => ({ k: idx + 1, v: d.remaining })).filter(p => p.v !== null)];
    const path = (pts) => pts.map((p, idx) => `${idx ? 'L' : 'M'}${x(p.k).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const today = todayIso();
    const todayIdx = days.findIndex(d => d.iso === today);
    const last = actual[actual.length - 1];
    const ticks = total <= 4 ? [...new Set([0, total])] : [0, Math.round(total / 2), total];

    if (!total) return <div className="text-[12px] text-[#AAAAAA] py-6">Nothing in this sprint to burn down yet.</div>;

    const onMove = (e) => {
        const box = wrap.current.getBoundingClientRect();
        const px = ((e.clientX - box.left) / box.width) * W;
        const k = Math.max(1, Math.min(n, Math.round(((px - L) / (W - L - R)) * n)));
        setHover(k);
    };
    const hoverDay = hover ? days[hover - 1] : null;

    return (
        <div>
            <div className="flex items-center gap-4 mb-2 text-[11px] text-[#555555]">
                <span className="inline-flex items-center gap-1.5"><svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke="#1A1A1A" strokeWidth="2" /></svg>Left to do</span>
                <span className="inline-flex items-center gap-1.5"><svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke="#AAAAAA" strokeWidth="1.5" strokeDasharray="4 3" /></svg>Ideal</span>
            </div>
            <div ref={wrap} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img"
                    aria-label={`Burndown: ${total} issues, ${last.v} left after ${last.k} of ${n} days`}>
                    {ticks.map(t => (
                        <g key={t}>
                            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#EFEFEC" strokeWidth="1" />
                            <text x={L - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="#999999">{t}</text>
                        </g>
                    ))}
                    <text x={x(0)} y={H - 8} fontSize="10" fill="#999999">{fmtDay(sprint.starts_on)}</text>
                    <text x={x(n)} y={H - 8} fontSize="10" fill="#999999" textAnchor="end">{fmtDay(sprint.ends_on)}</text>
                    {todayIdx >= 0 && sprint.status !== 'completed' ? (
                        <g>
                            <line x1={x(todayIdx + 1)} x2={x(todayIdx + 1)} y1={T} y2={H - B} stroke="#CBB800" strokeWidth="1" strokeDasharray="2 3" />
                            <text x={x(todayIdx + 1)} y={T - 3} fontSize="9" fill="#8a7600" textAnchor="middle">today</text>
                        </g>
                    ) : null}
                    <path d={path([{ k: 0, v: total }, ...days.map((d, idx) => ({ k: idx + 1, v: Math.max(0, d.ideal) }))])} fill="none" stroke="#AAAAAA" strokeWidth="1.5" strokeDasharray="4 3" />
                    <path d={path(actual)} fill="none" stroke="#1A1A1A" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                    <circle cx={x(last.k)} cy={y(last.v)} r="4" fill="#1A1A1A" stroke="#FFFFFF" strokeWidth="2" />
                    <text x={x(last.k) + 8} y={y(last.v) + 4} fontSize="11" fontWeight="700" fill="#1A1A1A">{last.v}</text>
                    {hover ? <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#1A1A1A" strokeOpacity="0.25" strokeWidth="1" /> : null}
                </svg>
                {hoverDay ? (
                    <div className="pointer-events-none absolute top-0 -translate-x-1/2 bg-[#1A1A1A] text-white rounded-lg px-2.5 py-1.5 text-[11px] leading-snug whitespace-nowrap"
                        style={{ left: `${(x(hover) / W) * 100}%` }}>
                        <div className="font-bold">{fmtDay(hoverDay.iso)}</div>
                        <div>{hoverDay.remaining === null ? 'Still to come' : `${hoverDay.remaining} left`} · ideal {Math.max(0, hoverDay.ideal).toFixed(1)}</div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

// The strip above the board when a sprint is picked.
export function SprintBar({ sprint, members, onStart, onComplete, onEdit, onPlan, canStart }) {
    const [chart, setChart] = useState(false);
    const stats = sprintStats(members);
    const summary = sprint.status === 'completed' ? sprint.summary : null;
    const late = sprint.status === 'active' && daysLeft(sprint) < 0;
    return (
        <div className={`bg-white border rounded-3xl p-5 mb-6 ${late ? 'border-[#F97316]/50' : 'border-[#E6E6E1]'}`}>
            <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                        <SprintChip status={sprint.status} />
                        <span className="text-2xl font-light tracking-tight text-[#1A1A1A]">{sprintLabel(sprint)}</span>
                        <span className="text-[12px] text-[#888888]">{fmtDay(sprint.starts_on)} → {fmtDay(sprint.ends_on)}</span>
                        <span className={`text-[12px] font-bold ${late ? 'text-[#C2410C]' : 'text-[#555555]'}`}>{timeLeft(sprint)}</span>
                    </div>
                    {sprint.goal ? <div className="text-[13px] text-[#333333] mt-2"><span className="font-bold">Goal:</span> {sprint.goal}</div> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {sprint.status === 'planned' ? (
                        <button onClick={onStart} disabled={!canStart} title={canStart ? undefined : 'Complete the running sprint first'}
                            className="h-10 px-4 rounded-full bg-[#10B981] text-white text-[10px] font-black uppercase tracking-[0.2em] inline-flex items-center gap-1.5 disabled:opacity-40">
                            <Play size={12} />Start sprint
                        </button>
                    ) : null}
                    {sprint.status === 'active' ? (
                        <button onClick={onComplete} className="h-10 px-4 rounded-full bg-[#1A1A1A] text-white text-[10px] font-black uppercase tracking-[0.2em] inline-flex items-center gap-1.5">
                            <Flag size={12} />Complete sprint
                        </button>
                    ) : null}
                    <button onClick={() => setChart(c => !c)} aria-pressed={chart} className="h-10 px-3 rounded-full border border-[#E6E6E1] text-[10px] font-black uppercase tracking-[0.2em] text-[#555555] inline-flex items-center gap-1.5 hover:border-[#BBBBBB]">
                        <TrendingDown size={12} />Burndown
                    </button>
                    {sprint.status !== 'completed' ? (
                        <button onClick={onEdit} aria-label="Edit sprint" className="w-10 h-10 rounded-full border border-[#E6E6E1] flex items-center justify-center text-[#888888] hover:text-[#1A1A1A]"><Pencil size={13} /></button>
                    ) : null}
                    <button onClick={onPlan} className="h-10 px-3 rounded-full border border-[#E6E6E1] text-[10px] font-black uppercase tracking-[0.2em] text-[#555555] hover:border-[#BBBBBB]">Plan</button>
                </div>
            </div>
            <div className="mt-4">
                <ProgressBar stats={stats} />
                <div className="text-[12px] text-[#555555] mt-2">
                    <b className="text-[#1A1A1A]">{stats.done} of {stats.total}</b> done
                    {stats.points ? <> · <b className="text-[#1A1A1A]">{stats.pointsDone}/{stats.points}</b> points</> : null}
                    {stats.unsized ? <span className="text-[#999999]"> · {stats.unsized} not sized</span> : null}
                    {summary ? <span className="text-[#999999]"> · at the end: {summary.committed} committed, {summary.added} added mid-sprint, {summary.carried} carried{summary.carried_to_name ? ` to ${summary.carried_to_name}` : ' to the backlog'}</span> : null}
                </div>
            </div>
            {chart ? <div className="mt-5 max-w-3xl"><Burndown sprint={sprint} members={members} /></div> : null}
        </div>
    );
}

// New sprint / edit sprint.
export function SprintForm({ sprint, defaults, onSave, onClose }) {
    const [name, setName] = useState(sprint?.name ?? defaults.name);
    const [goal, setGoal] = useState(sprint?.goal ?? '');
    const [startsOn, setStartsOn] = useState(sprint?.starts_on ?? defaults.starts_on);
    const [endsOn, setEndsOn] = useState(sprint?.ends_on ?? defaults.ends_on ?? addDays(defaults.starts_on, 13));
    const [saving, setSaving] = useState(false);
    const setWeeks = (w) => setEndsOn(addDays(startsOn, w * 7 - 1));
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    const submit = async () => {
        if (!name.trim() || !startsOn || !endsOn || endsOn < startsOn) return;
        setSaving(true);
        const ok = await onSave({ name: name.trim(), goal: goal.trim() || null, starts_on: startsOn, ends_on: endsOn });
        if (!ok) setSaving(false);
    };
    return (
        <Modal title={sprint ? `Edit ${sprintLabel(sprint)}` : 'New sprint'} onClose={onClose}>
            <div className="space-y-5">
                <div>
                    <Label className="mb-2">Name</Label>
                    <input value={name} onChange={e => setName(e.target.value)} maxLength={80} className={inputClass} autoFocus />
                </div>
                <div>
                    <Label className="mb-2">Goal <span className="normal-case tracking-normal text-[#BBBBBB]">(one line the team can say out loud)</span></Label>
                    <textarea value={goal} onChange={e => setGoal(e.target.value)} maxLength={500} rows={2} placeholder="e.g. Every midnight visit pays, and Android 1.6.0 is in Play"
                        className="w-full bg-white border border-[#E6E6E1] rounded-xl p-3 text-[13px] outline-none focus:border-[#E8D200] resize-none" />
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                        <Label className="mb-2">Starts</Label>
                        <input type="date" value={startsOn} onChange={e => setStartsOn(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                        <Label className="mb-2">Ends</Label>
                        <input type="date" value={endsOn} min={startsOn} onChange={e => setEndsOn(e.target.value)} className={inputClass} />
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4].map(w => (
                        <button key={w} type="button" onClick={() => setWeeks(w)} aria-pressed={endsOn === addDays(startsOn, w * 7 - 1)}
                            className={`h-8 px-3 rounded-full border text-[10px] font-black uppercase tracking-[0.15em] ${endsOn === addDays(startsOn, w * 7 - 1) ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-white border-[#E6E6E1] text-[#666666]'}`}>
                            {w} week{w > 1 ? 's' : ''}
                        </button>
                    ))}
                </div>
                {endsOn < startsOn ? <div className="text-[12px] text-[#BE123C]">It has to end on or after the day it starts.</div> : null}
            </div>
            <div className="flex justify-end mt-6">
                <button onClick={submit} disabled={saving || !name.trim() || endsOn < startsOn}
                    className="h-11 px-6 rounded-full bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.25em] disabled:opacity-40">
                    {saving ? 'Saving…' : sprint ? 'Save' : 'Create sprint'}
                </button>
            </div>
        </Modal>
    );
}

// Finishing a sprint: what got done, and where the rest goes.
export function CompleteSprint({ sprint, members, planned, nextName, onComplete, onClose }) {
    const unfinished = members.filter(isOpen).sort(byUrgency);
    const stats = sprintStats(members);
    const [carry, setCarry] = useState(planned[0]?.id ?? (unfinished.length ? 'new' : 'backlog'));
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    const submit = async () => {
        setSaving(true);
        const ok = await onComplete(carry === 'backlog' ? null : carry);
        if (!ok) setSaving(false);
    };
    return (
        <Modal title={`Complete ${sprintLabel(sprint)}`} onClose={onClose}>
            <div className="text-[13px] text-[#333333] mb-4">
                <b>{stats.done} of {stats.total}</b> done{stats.points ? <> · {stats.pointsDone}/{stats.points} points</> : null}.
                {stats.groups.live ? <> {stats.groups.live} {stats.groups.live === 1 ? 'is' : 'are'} live but not proven yet, so {stats.groups.live === 1 ? 'it carries' : 'they carry'} over.</> : null}
            </div>
            <ProgressBar stats={stats} />
            {unfinished.length ? (
                <>
                    <Label className="mt-6 mb-2">{unfinished.length} not finished</Label>
                    <div className="max-h-48 overflow-y-auto bg-white border border-[#E6E6E1] rounded-2xl divide-y divide-[#F0F0EC]">
                        {unfinished.map(i => (
                            <div key={i.id} className="flex items-center gap-2 px-3 py-2 text-[12px]">
                                <span className="font-bold text-[#888888] w-16 shrink-0">{issueKey(i)}</span>
                                <span className="flex-1 min-w-0 truncate text-[#1A1A1A]">{i.title}</span>
                                <span className="text-[10px] font-bold shrink-0" style={{ color: statusOf(i.status).color }}>{statusOf(i.status).label}</span>
                            </div>
                        ))}
                    </div>
                    <Label className="mt-6 mb-2">Move them to</Label>
                    <div className="space-y-2">
                        {planned.map(s => (
                            <Radio key={s.id} checked={carry === s.id} onChange={() => setCarry(s.id)}>
                                {sprintLabel(s)} <span className="text-[#999999]">· {fmtDay(s.starts_on)} → {fmtDay(s.ends_on)}</span>
                            </Radio>
                        ))}
                        <Radio checked={carry === 'new'} onChange={() => setCarry('new')}>
                            A new sprint <span className="text-[#999999]">· {nextName}, same length, starting the day after</span>
                        </Radio>
                        <Radio checked={carry === 'backlog'} onChange={() => setCarry('backlog')}>Back to the backlog</Radio>
                    </div>
                </>
            ) : <div className="text-[12px] text-[#047857] mt-4">Everything in it is finished.</div>}
            <div className="flex justify-end mt-6">
                <button onClick={submit} disabled={saving} className="h-11 px-6 rounded-full bg-[#1A1A1A] text-white text-[11px] font-black uppercase tracking-[0.25em] disabled:opacity-40">
                    {saving ? 'Completing…' : 'Complete sprint'}
                </button>
            </div>
        </Modal>
    );
}

const Radio = ({ checked, onChange, children }) => (
    <label className={`flex items-center gap-3 px-4 py-3 rounded-2xl border cursor-pointer text-[13px] ${checked ? 'border-[#1A1A1A] bg-white' : 'border-[#E6E6E1] bg-white/60'}`}>
        <input type="radio" checked={checked} onChange={onChange} className="accent-[#1A1A1A]" />
        <span>{children}</span>
    </label>
);

function Modal({ title, onClose, children }) {
    return (
        <div className="fixed inset-0 z-[300] flex items-start justify-center bg-[#1A1A1A]/40 backdrop-blur-sm px-4 py-10 overflow-y-auto" onMouseDown={onClose}>
            <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={e => e.stopPropagation()}
                className="w-full max-w-lg bg-[#F4F4F1] border border-[#E6E6E1] rounded-3xl p-6 sm:p-8 animate-in fade-in slide-in-from-bottom-4 duration-200">
                <div className="flex items-center justify-between mb-6">
                    <div className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">{title}</div>
                    <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-xl border border-[#E6E6E1] bg-white flex items-center justify-center text-[#888888] hover:text-[#1A1A1A]"><X size={15} /></button>
                </div>
                {children}
            </div>
        </div>
    );
}

function PlanRow({ issue, action, actionLabel, onOpen, onEffort, draggableId }) {
    return (
        <div
            draggable={!!draggableId}
            onDragStart={e => { e.dataTransfer.setData('text/plain', draggableId); e.dataTransfer.effectAllowed = 'move'; }}
            className="group flex items-center gap-2.5 px-3 py-2.5 bg-white hover:bg-[#FAFAF8] cursor-grab active:cursor-grabbing"
        >
            <PriorityBadge value={issue.priority} />
            <TypeIcon type={issue.type} size={12} />
            <button onClick={() => onOpen(issue)} className="flex-1 min-w-0 text-left">
                <div className="text-[12px] text-[#1A1A1A] leading-snug line-clamp-2"><span className="font-bold text-[#999999]">{issueKey(issue)}</span> {issue.title}</div>
                <div className="mt-0.5"><PlaceChip issue={issue} short /></div>
            </button>
            {issue.status !== 'triage' && issue.status !== 'backlog' && issue.status !== 'next' ? (
                <span className="text-[9px] font-black uppercase tracking-[0.1em] shrink-0" style={{ color: statusOf(issue.status).color }}>{statusOf(issue.status).label}</span>
            ) : null}
            <select aria-label="Size" value={issue.effort ?? ''} onChange={e => onEffort(issue, e.target.value || null)}
                title={EFFORTS.find(x => x.key === issue.effort)?.hint ?? 'Not sized'}
                className={`h-7 w-[52px] rounded-lg border text-[10px] font-black text-center outline-none shrink-0 ${issue.effort ? 'border-[#E6E6E1] text-[#1A1A1A] bg-white' : 'border-dashed border-[#CCCCCC] text-[#AAAAAA] bg-white'}`}>
                <option value="">—</option>
                {EFFORTS.map(ef => <option key={ef.key} value={ef.key}>{ef.label}</option>)}
            </select>
            <button onClick={() => action(issue)} title={actionLabel} aria-label={actionLabel}
                className="w-7 h-7 rounded-lg border border-[#E6E6E1] flex items-center justify-center text-[#888888] hover:text-[#1A1A1A] hover:border-[#1A1A1A] shrink-0">
                {actionLabel.startsWith('Add') ? <Plus size={13} /> : <X size={13} />}
            </button>
        </div>
    );
}

function DropZone({ onDropId, children, className = '' }) {
    const [over, setOver] = useState(false);
    return (
        <div
            onDragOver={e => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData('text/plain'); if (id) onDropId(id); }}
            className={`${className} ${over ? 'ring-2 ring-[#E8D200]' : ''}`}
        >
            {children}
        </div>
    );
}

/**
 * Planning: the backlog on the left, the running and planned sprints on the
 * right. Drag or press + to put work in a sprint; size it as you go so the
 * points add up. Finished sprints sit underneath with their numbers.
 */
export function SprintPlanner({ sprints, issues, backlog, onAssign, onEffort, onOpen, onNew, onEdit, onDelete, onStart, onComplete, onShowBoard }) {
    const running = sprints.find(s => s.status === 'active');
    const planned = sprints.filter(s => s.status === 'planned').sort((a, b) => a.starts_on.localeCompare(b.starts_on));
    const completed = sprints.filter(s => s.status === 'completed').sort((a, b) => b.ends_on.localeCompare(a.ends_on));
    const open = [running, ...planned].filter(Boolean);
    const [target, setTarget] = useState(null);
    const targetId = target && open.some(s => s.id === target) ? target : (planned[0]?.id ?? running?.id ?? null);
    const [expanded, setExpanded] = useState(null);
    const membersOf = (s) => issues.filter(i => i.sprint_id === s.id);
    const carriedOf = (s) => issues.filter(i => (s.summary?.carried_ids ?? []).includes(i.id));
    const backlogRows = backlog.filter(i => isOpen(i) && !i.sprint_id).sort(byUrgency);

    return (
        <div>
            <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-6 items-start">
                {/* Backlog */}
                <DropZone onDropId={id => onAssign([id], null)} className="bg-[#EDEDE9] rounded-3xl p-3 lg:sticky lg:top-24">
                    <div className="flex flex-wrap items-center gap-2 px-2 pt-1 pb-3">
                        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#444444]">Backlog</span>
                        <span className="text-[11px] font-bold text-[#999999]">{backlogRows.length} open, not in a sprint</span>
                        {open.length ? (
                            <label className="ml-auto inline-flex items-center gap-2 text-[11px] text-[#666666]">
                                + adds to
                                <select value={targetId ?? ''} onChange={e => setTarget(e.target.value)} className={`${selectClass} !h-8`}>
                                    {open.map(s => <option key={s.id} value={s.id}>{sprintLabel(s)}</option>)}
                                </select>
                            </label>
                        ) : null}
                    </div>
                    <div className="rounded-2xl overflow-hidden divide-y divide-[#F0F0EC] max-h-[70vh] overflow-y-auto">
                        {backlogRows.map(i => (
                            <PlanRow key={i.id} issue={i} draggableId={i.id} onOpen={onOpen} onEffort={onEffort}
                                actionLabel={targetId ? `Add to ${sprintLabel(open.find(s => s.id === targetId))}` : 'Add to a sprint'}
                                action={(iss) => (targetId ? onAssign([iss.id], targetId) : onNew())} />
                        ))}
                        {!backlogRows.length ? <div className="bg-white px-4 py-8 text-center text-[12px] text-[#AAAAAA]">Nothing waiting. Everything open is in a sprint, or filtered out.</div> : null}
                    </div>
                </DropZone>

                {/* Sprints */}
                <div className="space-y-4">
                    <button onClick={onNew} className="w-full h-12 rounded-2xl border border-dashed border-[#CCCCCC] text-[11px] font-black uppercase tracking-[0.2em] text-[#666666] hover:border-[#1A1A1A] hover:text-[#1A1A1A] inline-flex items-center justify-center gap-2">
                        <Plus size={14} />New sprint
                    </button>
                    {open.map(s => {
                        const members = membersOf(s).sort(byUrgency);
                        const stats = sprintStats(members);
                        return (
                            <DropZone key={s.id} onDropId={id => onAssign([id], s.id)} className="bg-white border border-[#E6E6E1] rounded-3xl">
                                <div className="p-4">
                                    <div className="flex flex-wrap items-center gap-2.5">
                                        <SprintChip status={s.status} />
                                        <span className="text-lg font-light tracking-tight text-[#1A1A1A]">{sprintLabel(s)}</span>
                                        <span className="text-[11px] text-[#888888]">{fmtDay(s.starts_on)} → {fmtDay(s.ends_on)} · {timeLeft(s)}</span>
                                        <div className="ml-auto flex items-center gap-1.5">
                                            {s.status === 'planned' ? (
                                                <button onClick={() => onStart(s)} disabled={!!running} title={running ? `${sprintLabel(running)} is still running` : 'Start this sprint'}
                                                    className="h-8 px-3 rounded-full bg-[#10B981] text-white text-[9px] font-black uppercase tracking-[0.2em] inline-flex items-center gap-1 disabled:opacity-40"><Play size={11} />Start</button>
                                            ) : (
                                                <button onClick={() => onComplete(s)} className="h-8 px-3 rounded-full bg-[#1A1A1A] text-white text-[9px] font-black uppercase tracking-[0.2em] inline-flex items-center gap-1"><Flag size={11} />Complete</button>
                                            )}
                                            <button onClick={() => onShowBoard(s)} title="Its board" aria-label="Open its board" className="w-8 h-8 rounded-full border border-[#E6E6E1] flex items-center justify-center text-[#888888] hover:text-[#1A1A1A]"><Columns3 size={13} /></button>
                                            <button onClick={() => onEdit(s)} aria-label="Edit sprint" className="w-8 h-8 rounded-full border border-[#E6E6E1] flex items-center justify-center text-[#888888] hover:text-[#1A1A1A]"><Pencil size={12} /></button>
                                            {s.status === 'planned' ? (
                                                <button onClick={() => onDelete(s)} aria-label="Delete sprint" className="w-8 h-8 rounded-full border border-[#E6E6E1] flex items-center justify-center text-[#BBBBBB] hover:text-[#BE123C]"><Trash2 size={12} /></button>
                                            ) : null}
                                        </div>
                                    </div>
                                    {s.goal ? <div className="text-[12px] text-[#444444] mt-2"><b>Goal:</b> {s.goal}</div> : null}
                                    <div className="mt-3"><ProgressBar stats={stats} compact /></div>
                                    <div className="text-[11px] text-[#666666] mt-1.5">
                                        {stats.total} issue{stats.total === 1 ? '' : 's'} · {stats.points} points{stats.unsized ? ` · ${stats.unsized} not sized` : ''}{s.status === 'active' ? ` · ${stats.done} done` : ''}
                                    </div>
                                </div>
                                <div className="border-t border-[#F0F0EC] divide-y divide-[#F0F0EC] rounded-b-3xl overflow-hidden">
                                    {members.map(i => (
                                        <PlanRow key={i.id} issue={i} draggableId={i.id} onOpen={onOpen} onEffort={onEffort}
                                            actionLabel="Back to the backlog" action={(iss) => onAssign([iss.id], null)} />
                                    ))}
                                    {!members.length ? <div className="px-4 py-6 text-center text-[12px] text-[#AAAAAA]">Drag work here from the backlog, or press + on it.</div> : null}
                                </div>
                                {s.status === 'active' && members.length ? (
                                    <div className="border-t border-[#F0F0EC] p-4"><Burndown sprint={s} members={members} /></div>
                                ) : null}
                            </DropZone>
                        );
                    })}
                    {!open.length ? (
                        <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8 text-center">
                            <div className="text-lg font-light text-[#1A1A1A] mb-1">No sprint planned.</div>
                            <p className="text-[12px] text-[#888888]">Create one, pull work in from the backlog, size it, start it. The board then shows that sprint.</p>
                        </div>
                    ) : null}
                </div>
            </div>

            {completed.length ? (
                <div className="mt-10">
                    <div className="text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black mb-3">Finished sprints</div>
                    <div className="space-y-2">
                        {completed.map(s => {
                            const m = s.summary ?? {};
                            const isOpenRow = expanded === s.id;
                            return (
                                <div key={s.id} className="bg-white border border-[#E6E6E1] rounded-2xl">
                                    <button onClick={() => setExpanded(isOpenRow ? null : s.id)} className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left">
                                        {isOpenRow ? <ChevronDown size={14} className="text-[#999999]" /> : <ChevronRight size={14} className="text-[#999999]" />}
                                        <span className="text-[14px] font-bold text-[#1A1A1A]">{sprintLabel(s)}</span>
                                        <span className="text-[11px] text-[#888888]">{fmtDay(s.starts_on)} → {fmtDay(s.ends_on)}</span>
                                        <span className="text-[12px] text-[#333333]"><b>{m.done ?? 0} of {m.total ?? 0}</b> done{m.points ? ` · ${m.points_done ?? 0}/${m.points} pts` : ''}</span>
                                        <span className="text-[11px] text-[#999999]">{m.carried ? `${m.carried} carried${m.carried_to_name ? ` to ${m.carried_to_name}` : ' to backlog'}` : 'nothing carried'}{m.added ? ` · ${m.added} added mid-sprint` : ''}</span>
                                    </button>
                                    {isOpenRow ? (
                                        <div className="border-t border-[#F0F0EC] p-4 grid lg:grid-cols-2 gap-6">
                                            <div>
                                                {s.goal ? <div className="text-[12px] text-[#444444] mb-3"><b>Goal:</b> {s.goal}</div> : null}
                                                <Burndown sprint={s} members={[...membersOf(s), ...carriedOf(s)]} />
                                            </div>
                                            <div className="space-y-1 max-h-72 overflow-y-auto">
                                                {[...membersOf(s), ...carriedOf(s)].sort(byUrgency).map(i => (
                                                    <button key={i.id} onClick={() => onOpen(i)} className="w-full flex items-center gap-2 text-left text-[12px] px-2 py-1.5 rounded-lg hover:bg-[#F4F4F1]">
                                                        <span className="font-bold text-[#999999] w-16 shrink-0">{issueKey(i)}</span>
                                                        <span className="flex-1 min-w-0 truncate">{i.title}</span>
                                                        <span className="text-[10px] font-bold shrink-0" style={{ color: statusOf(i.status).color }}>
                                                            {i.sprint_id === s.id ? statusOf(i.status).label : 'Carried over'}
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

