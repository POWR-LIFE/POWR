import React, { useMemo, useState } from 'react';
import { GitPullRequest, Hourglass, ArrowUpDown, TriangleAlert } from 'lucide-react';
import { STATUSES, CLOSED_STATUS, PRIORITIES, priorityOf, issueKey, shipProgress, byUrgency, ago, waitingLabel, ecosystemCounts, isOpen, resolutionLabel, sprintLabel } from './model';
import { SURFACES } from './taxonomy';
import { TypeIcon, PriorityBadge, PlaceChip, PlatformIcons, Avatar, StatusPill } from './ui';

function Card({ issue, admin, sprint, onOpen, dragging, setDragging }) {
    const ship = shipProgress(issue.ship_steps);
    const closed = issue.status === 'closed';
    const overdue = issue.due_date && isOpen(issue) && new Date(`${issue.due_date}T23:59:59`) < new Date();
    return (
        <div
            role="button"
            tabIndex={0}
            draggable
            onDragStart={e => { e.dataTransfer.setData('text/plain', issue.id); e.dataTransfer.effectAllowed = 'move'; setDragging(issue.id); }}
            onDragEnd={() => setDragging(null)}
            onClick={() => onOpen(issue)}
            onKeyDown={e => { if (e.key === 'Enter') onOpen(issue); }}
            className={`group border rounded-2xl p-3.5 cursor-pointer transition-all hover:border-[#BBBBBB] focus:outline-none focus:border-[#E8D200] ${closed ? 'bg-white/70' : 'bg-white'} ${dragging === issue.id ? 'opacity-40' : ''} ${issue.priority === 0 && isOpen(issue) ? 'border-[#DC2626]/40' : 'border-[#E6E6E1]'}`}
        >
            <div className="flex items-center gap-2 mb-1.5">
                <TypeIcon type={issue.type} size={13} />
                <span className="text-[10px] font-black tracking-[0.15em] text-[#999999]">{issueKey(issue)}</span>
                <span className="ml-auto"><PriorityBadge value={issue.priority} /></span>
            </div>
            <div className={`text-[13px] font-semibold leading-snug line-clamp-3 mb-2 ${closed ? 'text-[#777777]' : 'text-[#1A1A1A]'}`}>{issue.title}</div>
            <PlaceChip issue={issue} short />
            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                {closed ? (
                    <span className="inline-flex items-center h-5 px-1.5 rounded-md bg-[#1A1A1A]/5 text-[#555555] text-[9px] font-black uppercase tracking-[0.1em]">
                        {resolutionLabel(issue.resolution)} · {ago(issue.closed_at)}
                    </span>
                ) : null}
                {sprint ? (
                    <span title={sprintLabel(sprint)} className="inline-flex items-center h-5 px-1.5 rounded-md border border-[#E6E6E1] text-[#666666] text-[9px] font-black uppercase tracking-[0.1em] max-w-[110px] truncate">
                        {sprintLabel(sprint)}
                    </span>
                ) : null}
                <PlatformIcons platforms={issue.platforms} />
                {ship.total ? (
                    <span title="Ship plan" className={`inline-flex items-center h-5 px-1.5 rounded-md text-[9px] font-black tracking-[0.1em] ${ship.done === ship.total ? 'bg-[#10B981]/10 text-[#047857]' : 'bg-[#F4F4F1] text-[#666666]'}`}>
                        SHIP {ship.done}/{ship.total}
                    </span>
                ) : null}
                {(issue.pr_numbers ?? []).slice(0, 2).map(n => (
                    <span key={n} className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#6D28D9]"><GitPullRequest size={10} />{n}</span>
                ))}
                {issue.waiting_on ? (
                    <span title={issue.waiting_note ?? ''} className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md bg-[#F97316]/10 text-[#C2410C] text-[9px] font-black uppercase tracking-[0.1em]">
                        <Hourglass size={9} />{waitingLabel(issue.waiting_on)}
                    </span>
                ) : null}
                {overdue ? <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.1em] text-[#DC2626]"><TriangleAlert size={10} />Due</span> : null}
                <span className="ml-auto"><Avatar person={admin} size={20} /></span>
            </div>
        </div>
    );
}

/**
 * The flow, plus Closed at the end. `closed` is what the Closed column shows
 * (the page decides: recent ones, a sprint's, or search matches); dropping a
 * card there closes it as done, dragging one out reopens it.
 */
export function Board({ issues, closed = [], hiddenClosed = 0, adminById, sprintById, showSprint = false, onOpen, onMove }) {
    const [dragging, setDragging] = useState(null);
    const [over, setOver] = useState(null);
    const columns = useMemo(() => [
        ...STATUSES.map(s => ({ ...s, items: issues.filter(i => i.status === s.key).sort(byUrgency) })),
        {
            ...CLOSED_STATUS,
            hint: 'Done, dropped or duplicates. Drop a card here to close it as done.',
            items: [...closed].sort((a, b) => new Date(b.closed_at ?? 0) - new Date(a.closed_at ?? 0)),
            footer: hiddenClosed ? `${hiddenClosed} closed more than two weeks ago — they're in the List.` : null,
        },
    ], [issues, closed, hiddenClosed]);

    return (
        <div className="-mx-4 lg:mx-0 overflow-x-auto pb-6">
            <div className="flex gap-3 px-4 lg:px-0 min-w-max">
                {columns.map(col => (
                    <div
                        key={col.key}
                        onDragOver={e => { e.preventDefault(); setOver(col.key); }}
                        onDragLeave={() => setOver(o => (o === col.key ? null : o))}
                        onDrop={e => {
                            e.preventDefault();
                            setOver(null);
                            const id = e.dataTransfer.getData('text/plain');
                            if (id) onMove(id, col.key);
                        }}
                        className={`w-[272px] shrink-0 rounded-3xl p-2.5 transition-colors ${over === col.key ? 'bg-[#E8D200]/15' : 'bg-[#EDEDE9]'}`}
                    >
                        <div className="flex items-center gap-2 px-2 pt-1 pb-2.5" title={col.hint}>
                            <span className="w-2 h-2 rounded-full" style={{ background: col.color }} />
                            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#444444]">{col.label}</span>
                            <span className="text-[11px] font-bold text-[#999999]">{col.items.length}</span>
                        </div>
                        <div className="space-y-2 min-h-[80px]">
                            {col.items.map(i => (
                                <Card key={i.id} issue={i} admin={adminById[i.assignee_id]} sprint={showSprint ? sprintById?.[i.sprint_id] : null}
                                    onOpen={onOpen} dragging={dragging} setDragging={setDragging} />
                            ))}
                            {!col.items.length ? <div className="text-[11px] text-[#AAAAAA] px-2 py-3 leading-snug">{col.hint}</div> : null}
                            {col.footer ? <div className="text-[11px] text-[#999999] px-2 pt-1 leading-snug">{col.footer}</div> : null}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

const SORTS = {
    key:      (a, b) => a.number - b.number,
    title:    (a, b) => a.title.localeCompare(b.title),
    place:    (a, b) => `${a.surface}/${a.area}`.localeCompare(`${b.surface}/${b.area}`),
    priority: (a, b) => a.priority - b.priority,
    status:   (a, b) => [...STATUSES, { key: 'closed' }].findIndex(s => s.key === a.status) - [...STATUSES, { key: 'closed' }].findIndex(s => s.key === b.status),
    updated:  (a, b) => new Date(b.updated_at) - new Date(a.updated_at),
};

export function List({ issues, adminById, sprintById, onOpen }) {
    const [sort, setSort] = useState({ by: 'priority', dir: 1 });
    const rows = useMemo(() => {
        const cmp = SORTS[sort.by];
        return [...issues].sort((a, b) => (cmp(a, b) * sort.dir) || byUrgency(a, b));
    }, [issues, sort]);
    const Th = ({ by, children, className = '' }) => (
        <th className={`text-left px-3 py-3 ${className}`}>
            <button onClick={() => setSort(s => ({ by, dir: s.by === by ? -s.dir : 1 }))} className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.3em] text-[#999999] hover:text-[#1A1A1A]">
                {children}<ArrowUpDown size={10} className={sort.by === by ? 'text-[#1A1A1A]' : 'opacity-40'} />
            </button>
        </th>
    );
    return (
        <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-x-auto">
            <table className="w-full min-w-[860px]">
                <thead className="border-b border-[#E6E6E1]">
                    <tr>
                        <Th by="key" className="w-[110px]">Key</Th>
                        <Th by="title">Title</Th>
                        <Th by="place" className="w-[240px]">Where</Th>
                        <Th by="priority" className="w-[70px]">P</Th>
                        <Th by="status" className="w-[130px]">Status</Th>
                        <th className="text-left px-3 py-3 text-[9px] font-black uppercase tracking-[0.3em] text-[#999999] w-[70px]">Ship</th>
                        <th className="text-left px-3 py-3 text-[9px] font-black uppercase tracking-[0.3em] text-[#999999] w-[110px]">Sprint</th>
                        <Th by="updated" className="w-[100px]">Updated</Th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(i => {
                        const ship = shipProgress(i.ship_steps);
                        return (
                            <tr key={i.id} onClick={() => onOpen(i)} className="border-b border-[#F0F0EC] last:border-0 hover:bg-[#FAFAF8] cursor-pointer">
                                <td className="px-3 py-3"><span className="inline-flex items-center gap-2 text-[11px] font-black tracking-[0.1em] text-[#888888]"><TypeIcon type={i.type} size={12} />{issueKey(i)}</span></td>
                                <td className="px-3 py-3">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[13px] font-semibold text-[#1A1A1A] line-clamp-1">{i.title}</span>
                                        {i.waiting_on ? <span className="shrink-0 text-[9px] font-black uppercase tracking-[0.1em] text-[#C2410C]">· {waitingLabel(i.waiting_on)}</span> : null}
                                    </div>
                                </td>
                                <td className="px-3 py-3 max-w-[240px]"><PlaceChip issue={i} short /></td>
                                <td className="px-3 py-3"><PriorityBadge value={i.priority} /></td>
                                <td className="px-3 py-3"><StatusPill status={i.status} resolution={i.resolution} /></td>
                                <td className="px-3 py-3 text-[11px] font-bold text-[#666666]">{ship.total ? `${ship.done}/${ship.total}` : '—'}</td>
                                <td className="px-3 py-3 text-[11px] text-[#666666] truncate max-w-[110px]">{sprintById?.[i.sprint_id] ? sprintLabel(sprintById[i.sprint_id]) : '—'}</td>
                                <td className="px-3 py-3"><span className="inline-flex items-center gap-2 text-[11px] text-[#999999]"><Avatar person={adminById[i.assignee_id]} size={18} />{ago(i.updated_at)}</span></td>
                            </tr>
                        );
                    })}
                    {!rows.length ? <tr><td colSpan={8} className="px-3 py-16 text-center text-[12px] text-[#AAAAAA]">Nothing matches.</td></tr> : null}
                </tbody>
            </table>
        </div>
    );
}

// Where POWR hurts: open issues by surface and area, coloured by the most
// urgent one in each. Click an area to see its board.
export function EcosystemMap({ issues, onPick }) {
    const counts = useMemo(() => ecosystemCounts(issues), [issues]);
    const maxArea = Math.max(1, ...Object.values(counts).flatMap(s => Object.values(s.areas).map(a => a.open)));
    return (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {SURFACES.map(s => {
                const c = counts[s.key];
                return (
                    <div key={s.key} className="bg-white border border-[#E6E6E1] rounded-3xl p-5">
                        <button onClick={() => onPick(s.key, null)} className="w-full text-left flex items-start gap-3 mb-4 group">
                            <span className="mt-1 w-3 h-3 rounded-full shrink-0" style={{ background: s.color }} />
                            <div className="min-w-0 flex-1">
                                <div className="text-[15px] font-bold text-[#1A1A1A] group-hover:underline">{s.label}</div>
                                <div className="text-[11px] text-[#888888] leading-snug">{s.blurb}</div>
                            </div>
                            <div className="text-right shrink-0">
                                <div className="text-3xl font-extralight tracking-tighter" style={{ color: c.worst != null ? priorityOf(c.worst).color : '#CCCCCC' }}>{c.open}</div>
                                <div className="text-[8px] font-black uppercase tracking-[0.3em] text-[#AAAAAA]">open</div>
                            </div>
                        </button>
                        {c.unproven ? (
                            <div className="text-[10px] font-bold text-[#C2410C] mb-3">{c.unproven} merged or live, not yet proven</div>
                        ) : null}
                        <div className="space-y-1">
                            {s.areas.map(a => {
                                const ac = c.areas[a.key];
                                return (
                                    <button key={a.key} onClick={() => onPick(s.key, a.key)} className={`w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left hover:bg-[#F4F4F1] ${ac ? '' : 'opacity-45'}`}>
                                        <span className="text-[12px] text-[#333333] w-[44%] truncate">{a.label}</span>
                                        <span className="flex-1 h-1.5 rounded-full bg-[#F0F0EC] overflow-hidden">
                                            {ac ? <span className="block h-full rounded-full" style={{ width: `${Math.max(8, (ac.open / maxArea) * 100)}%`, background: priorityOf(ac.worst).color }} /> : null}
                                        </span>
                                        <span className="w-6 text-right text-[11px] font-bold text-[#666666]">{ac?.open ?? ''}</span>
                                    </button>
                                );
                            })}
                            {c.areas._none ? (
                                <button onClick={() => onPick(s.key, '_none')} className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left hover:bg-[#F4F4F1]">
                                    <span className="text-[12px] italic text-[#888888] w-[44%] truncate">No area yet</span>
                                    <span className="flex-1" />
                                    <span className="w-6 text-right text-[11px] font-bold text-[#666666]">{c.areas._none.open}</span>
                                </button>
                            ) : null}
                        </div>
                    </div>
                );
            })}
            <div className="sm:col-span-2 xl:col-span-3 flex flex-wrap items-center gap-4 text-[10px] text-[#888888]">
                <span className="font-black uppercase tracking-[0.3em]">Bar colour = most urgent open issue</span>
                {PRIORITIES.map(p => <span key={p.value} className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: p.color }} />{p.label} {p.name}</span>)}
            </div>
        </div>
    );
}

