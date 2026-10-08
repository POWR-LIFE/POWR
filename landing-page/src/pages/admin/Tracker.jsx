import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, RefreshCw, Search, Columns3, List as ListIcon, Network, X, CalendarRange } from 'lucide-react';
import { useAuth } from '../../App';
import { useToast } from '../../lib/toast';
import { SURFACES, surfaceOf } from './tracker/taxonomy';
import {
    TYPES, PRIORITIES, PLATFORMS, QUICK_FILTERS, statusOf, parseIssueKey, issueKey, matchesSearch, draftFromTicket, shipProgress,
    sprintLabel, sprintStats, daysLeft, addDays, todayIso, DAY_MS,
} from './tracker/model';
import * as api from './tracker/api';
import { Board, List, EcosystemMap } from './tracker/views';
import IssueDrawer from './tracker/IssueDrawer';
import NewIssue from './tracker/NewIssue';
import { Chip, selectClass } from './tracker/ui';
import { SprintBar, SprintPlanner, SprintForm, CompleteSprint, ProgressBar } from './tracker/sprints';

const VIEWS = [
    { key: 'board', label: 'Board', icon: Columns3 },
    { key: 'list', label: 'List', icon: ListIcon },
    { key: 'map', label: 'Ecosystem', icon: Network },
    { key: 'sprints', label: 'Sprints', icon: CalendarRange },
];

// The Closed column shows the last fortnight unless you're looking for something.
const RECENT_CLOSED_MS = 14 * DAY_MS;

const STAT_TILES = ['triage', 'urgent', 'unshipped', 'unproven', 'waiting', 'done7'];

export default function Tracker() {
    const toast = useToast();
    const { user } = useAuth();
    const [params, setParams] = useSearchParams();
    const [issues, setIssues] = useState([]);
    const [admins, setAdmins] = useState([]);
    const [loading, setLoading] = useState(true);
    const [missing, setMissing] = useState(false);
    const [composer, setComposer] = useState(null); // prefill object while the New issue modal is open
    // null = the sprints migration isn't applied; the rest works without it.
    const [sprints, setSprints] = useState(null);
    const [sprintForm, setSprintForm] = useState(null); // { sprint? } while the form is open
    const [completing, setCompleting] = useState(null); // the sprint being completed
    const searchRef = useRef(null);

    const [q, setQ] = useState('');
    const [type, setType] = useState('');
    const [priority, setPriority] = useState('');
    const [assignee, setAssignee] = useState('');
    const [platform, setPlatform] = useState('');
    const [hideClosed, setHideClosed] = useState(false);

    const view = params.get('view') || 'board';
    const quick = params.get('quick') || '';
    const surface = params.get('surface') || '';
    const area = params.get('area') || '';
    const openNumber = parseIssueKey(params.get('issue'));
    // all (default) | backlog | active | <sprint number>
    const sprintParam = params.get('sprint') || 'all';

    const running = sprints?.find(sp => sp.status === 'active') ?? null;
    const selectedSprint = !sprints ? null
        : sprintParam === 'active' ? running
        : /^\d+$/.test(sprintParam) ? sprints.find(sp => sp.number === Number(sprintParam)) ?? null
        : null;
    const sprintById = useMemo(() => Object.fromEntries((sprints ?? []).map(sp => [sp.id, sp])), [sprints]);

    const setParam = useCallback((patch) => {
        setParams(prev => {
            const next = new URLSearchParams(prev);
            Object.entries(patch).forEach(([k, v]) => (v == null || v === '' ? next.delete(k) : next.set(k, v)));
            return next;
        }, { replace: true });
    }, [setParams]);

    // A new issue starts where the board is filtered to — including its sprint.
    const newHere = useCallback(() => setComposer({
        ...(surface ? { surface } : {}),
        ...(area && area !== '_none' ? { area } : {}),
        ...(selectedSprint && selectedSprint.status !== 'completed' ? { sprint_id: selectedSprint.id } : {}),
    }), [surface, area, selectedSprint]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [rows, people, sprintRows] = await Promise.all([api.loadIssues(), api.loadAdmins(), api.loadSprints()]);
            setIssues(rows);
            setAdmins(people);
            setSprints(sprintRows);
            setMissing(false);
        } catch (e) {
            if (api.isMissingTable(e)) setMissing(true);
            else toast.error(e.message || 'Could not load the tracker');
        }
        setLoading(false);
    }, [toast]);

    useEffect(() => { load(); }, [load]);

    // ?new=1 with ticket / user / gym / event opens a pre-filled issue —
    // Support, member profiles and Gym Portals link here.
    useEffect(() => {
        if (params.get('new') !== '1') return;
        const ticketId = params.get('ticket');
        const draft = {};
        if (params.get('user')) draft.user_ids = [params.get('user')];
        if (params.get('gym')) { draft.partner_id = params.get('gym'); draft.surface = 'gym_portal'; }
        if (params.get('event')) { draft.event_id = params.get('event'); draft.surface = 'app'; draft.area = 'league'; }
        if (params.get('title')) draft.title = params.get('title');
        setParam({ new: null, ticket: null, user: null, gym: null, event: null, title: null });
        if (ticketId) {
            api.ticketById(ticketId)
                .then(t => setComposer(t ? { ...draftFromTicket(t), ...draft } : draft))
                .catch(() => setComposer(draft));
        } else {
            setComposer(draft);
        }
    }, [params, setParam]);

    // Keyboard: c files an issue, / searches.
    useEffect(() => {
        const onKey = (e) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
            if (composer || openNumber != null) return;
            if (e.key === 'c') { e.preventDefault(); newHere(); }
            if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [composer, openNumber, newHere]);

    const adminById = useMemo(() => Object.fromEntries(admins.map(a => [a.id, a])), [admins]);

    // Everything but the sprint filter — the planner's backlog uses this.
    const matching = useMemo(() => {
        const quickTest = QUICK_FILTERS.find(f => f.key === quick)?.test;
        return issues.filter(i =>
            (!quickTest || quickTest(i))
            && (!surface || i.surface === surface)
            && (!area || (area === '_none' ? !i.area : i.area === area))
            && (!type || i.type === type)
            && (priority === '' || i.priority === Number(priority))
            && (!assignee || (assignee === 'none' ? !i.assignee_id : assignee === 'me' ? i.assignee_id === user?.id : i.assignee_id === assignee))
            && (!platform || i.platforms?.includes(platform))
            && matchesSearch(i, q));
    }, [issues, quick, surface, area, type, priority, assignee, platform, q, user?.id]);

    const filtered = useMemo(() => matching.filter(i =>
        sprintParam === 'backlog' ? !i.sprint_id
        : selectedSprint ? i.sprint_id === selectedSprint.id
        : true), [matching, sprintParam, selectedSprint]);

    // Closed issues: the board's last column. Recent ones by default; all of
    // them when you're searching, filtering to a sprint or using a tile.
    const { boardOpen, boardClosed, hiddenClosed } = useMemo(() => {
        const open = filtered.filter(i => i.status !== 'closed');
        const closed = filtered.filter(i => i.status === 'closed');
        if (q || selectedSprint || quick) return { boardOpen: open, boardClosed: closed, hiddenClosed: 0 };
        const recent = closed.filter(i => !i.closed_at || Date.now() - new Date(i.closed_at).getTime() <= RECENT_CLOSED_MS);
        return { boardOpen: open, boardClosed: recent, hiddenClosed: closed.length - recent.length };
    }, [filtered, q, selectedSprint, quick]);

    const quickCounts = useMemo(() => Object.fromEntries(QUICK_FILTERS.map(f => [f.key, issues.filter(f.test).length])), [issues]);

    const replaceIssue = useCallback((next) => {
        setIssues(prev => prev.some(i => i.id === next.id) ? prev.map(i => (i.id === next.id ? next : i)) : [next, ...prev]);
    }, []);

    // ── Sprints ────────────────────────────────────────────────────────────
    const reloadSprints = useCallback(async () => setSprints(await api.loadSprints()), []);

    const assignToSprint = async (ids, sprintId) => {
        const moving = issues.filter(i => ids.includes(i.id) && (i.sprint_id ?? null) !== (sprintId ?? null));
        if (!moving.length) return;
        moving.forEach(i => replaceIssue({ ...i, sprint_id: sprintId }));
        try {
            (await api.setIssuesSprint(moving.map(i => i.id), sprintId)).forEach(replaceIssue);
        } catch (e) {
            moving.forEach(replaceIssue);
            toast.error(e.message || 'Could not move it');
        }
    };

    const setEffort = async (issue, effort) => {
        replaceIssue({ ...issue, effort });
        try { replaceIssue(await api.updateIssue(issue.id, { effort })); } catch (e) { replaceIssue(issue); toast.error(e.message || 'Could not size it'); }
    };

    const nextSprintDefaults = useCallback((after) => {
        const list = sprints ?? [];
        const last = after ?? [...list].filter(sp => sp.status !== 'completed').sort((a, b) => b.ends_on.localeCompare(a.ends_on))[0];
        const n = list.reduce((m, sp) => Math.max(m, sp.number), 0) + 1;
        const start = last ? addDays(last.ends_on, 1) : todayIso();
        const length = last ? Math.round((new Date(`${last.ends_on}T00:00:00`) - new Date(`${last.starts_on}T00:00:00`)) / DAY_MS) : 13;
        return { name: `Sprint ${n}`, starts_on: start, ends_on: addDays(start, length) };
    }, [sprints]);

    const saveSprint = async (values) => {
        try {
            if (sprintForm?.sprint) await api.updateSprint(sprintForm.sprint.id, values);
            else await api.createSprint(values);
            await reloadSprints();
            toast.success(sprintForm?.sprint ? 'Sprint saved' : `${values.name} created — pull work into it from the backlog`);
            setSprintForm(null);
            return true;
        } catch (e) {
            toast.error(e.message || 'Could not save the sprint');
            return false;
        }
    };

    const deleteSprint = async (sp) => {
        const count = issues.filter(i => i.sprint_id === sp.id).length;
        if (!window.confirm(`Delete ${sprintLabel(sp)}?${count ? ` Its ${count} issue${count === 1 ? '' : 's'} go back to the backlog.` : ''}`)) return;
        try {
            await api.deleteSprint(sp.id);
            setIssues(prev => prev.map(i => (i.sprint_id === sp.id ? { ...i, sprint_id: null } : i)));
            await reloadSprints();
        } catch (e) {
            toast.error(e.message || 'Could not delete it');
        }
    };

    const startSprint = async (sp) => {
        const members = issues.filter(i => i.sprint_id === sp.id);
        if (!members.length && !window.confirm(`${sprintLabel(sp)} is empty. Start it anyway?`)) return;
        try {
            await api.startSprint(sp.id);
            await reloadSprints();
            toast.success(`${sprintLabel(sp)} is running — ${members.length} issue${members.length === 1 ? '' : 's'}`);
            setParam({ sprint: 'active', view: null });
        } catch (e) {
            toast.error(e.message || 'Could not start it');
        }
    };

    const completeSprint = async (carry) => {
        const sp = completing;
        try {
            let carryTo = carry;
            if (carry === 'new') carryTo = (await api.createSprint(nextSprintDefaults(sp))).id;
            const done = await api.completeSprint(sp.id, carryTo);
            await load();
            const m = done?.summary ?? {};
            toast.success(`${sprintLabel(sp)} complete — ${m.done ?? 0} of ${m.total ?? 0} done${m.carried ? `, ${m.carried} carried over` : ''}`);
            setCompleting(null);
            setParam({ sprint: String(sp.number), view: null });
            return true;
        } catch (e) {
            toast.error(e.message || 'Could not complete it');
            return false;
        }
    };

    const moveIssue = async (id, status) => {
        const before = issues.find(i => i.id === id);
        if (!before || before.status === status) return;
        const ship = shipProgress(before.ship_steps);
        if ((status === 'live' || status === 'verified') && ship.done < ship.total
            && !window.confirm(`${issueKey(before)} has ${ship.total - ship.done} ship step(s) not ticked. Mark it ${statusOf(status).label.toLowerCase()} anyway?`)) return;
        replaceIssue({ ...before, status });
        try {
            replaceIssue(await api.updateIssue(id, { status }));
        } catch (e) {
            replaceIssue(before);
            toast.error(e.message || 'Could not move it');
        }
    };

    const openIssue = (issue) => setParam({ issue: issueKey(issue) });
    const closeDrawer = useCallback(() => setParam({ issue: null }), [setParam]);
    const openIssueNumber = useCallback((n) => setParam({ issue: `POWR-${n}` }), [setParam]);
    const current = openNumber != null ? issues.find(i => i.number === openNumber) : null;

    const activeSurface = surfaceOf(surface);
    const filtersOn = !!(q || type || priority !== '' || assignee || platform || surface || area || quick || sprintParam !== 'all');
    const clearFilters = () => {
        setQ(''); setType(''); setPriority(''); setAssignee(''); setPlatform('');
        setParam({ surface: null, area: null, quick: null, sprint: null });
    };
    const sprintMembers = selectedSprint
        ? issues.filter(i => i.sprint_id === selectedSprint.id || (selectedSprint.summary?.carried_ids ?? []).includes(i.id))
        : [];
    const runningMembers = running ? issues.filter(i => i.sprint_id === running.id) : [];
    const plannedSprints = (sprints ?? []).filter(sp => sp.status === 'planned').sort((a, b) => a.starts_on.localeCompare(b.starts_on));

    return (
        <div className="px-4 lg:px-0 py-16 animate-in fade-in slide-in-from-bottom-8 duration-700">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 mb-12">
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-[1px] w-12 bg-[#E8D200]"></div>
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Subsystem / Tracker</span>
                    </div>
                    <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-6">Tracker</h1>
                    <p className="text-[#666666] text-[11px] max-w-2xl font-black uppercase tracking-[0.4em] leading-relaxed">
                        Everything broken, wanted or waiting across POWR — the app, the portals, the backend, the ops. Done means verified.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={load} aria-label="Refresh" className="w-12 h-12 rounded-2xl bg-white border border-[#E6E6E1] flex items-center justify-center text-[#888888] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all">
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    </button>
                    <button onClick={newHere} disabled={missing}
                        className="h-12 px-6 rounded-full bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.25em] inline-flex items-center gap-2 disabled:opacity-40">
                        <Plus size={15} /> New issue <span className="hidden md:inline text-[#080808]/50">· C</span>
                    </button>
                </div>
            </div>

            {missing ? (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl p-10 max-w-2xl">
                    <div className="text-[10px] uppercase tracking-[0.4em] text-[#C2410C] font-black mb-3">Not set up in this database</div>
                    <p className="text-[14px] text-[#333333] leading-relaxed">
                        The tracker tables don't exist yet. Apply <code className="font-mono text-[12px] bg-[#F4F4F1] px-1.5 py-0.5 rounded">supabase/migrations/20261007200000_tracker.sql</code> and refresh.
                    </p>
                </div>
            ) : (
                <>
                    {/* Questions the team asks, as tiles that filter */}
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-8">
                        {STAT_TILES.map(key => {
                            const f = QUICK_FILTERS.find(x => x.key === key);
                            const active = quick === key;
                            const tone = key === 'urgent' ? '#DC2626' : key === 'unshipped' ? '#F97316' : key === 'unproven' ? '#8a7600' : key === 'done7' ? '#10B981' : '#1A1A1A';
                            return (
                                <button key={key} onClick={() => setParam({ quick: active ? null : key })} aria-pressed={active}
                                    className={`text-left p-5 rounded-3xl border transition-all ${active ? 'bg-white border-[#1A1A1A]' : 'bg-white border-[#E6E6E1] hover:border-[#BBBBBB]'}`}>
                                    <div className="text-4xl font-extralight tracking-tighter mb-1" style={{ color: quickCounts[key] ? tone : '#CCCCCC' }}>{loading ? '·' : quickCounts[key]}</div>
                                    <div className="text-[9px] uppercase tracking-[0.3em] font-black text-[#999999]">{f.label}</div>
                                </button>
                            );
                        })}
                    </div>

                    {/* Surfaces */}
                    <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-4 px-4 lg:mx-0 lg:px-0">
                        <Chip active={!surface} onClick={() => setParam({ surface: null, area: null })}>All of POWR</Chip>
                        {SURFACES.map(s => (
                            <Chip key={s.key} active={surface === s.key} color={s.color} title={s.blurb}
                                onClick={() => setParam({ surface: surface === s.key ? null : s.key, area: null })}>
                                {s.short}
                            </Chip>
                        ))}
                    </div>
                    {activeSurface ? (
                        <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-4 px-4 lg:mx-0 lg:px-0">
                            {activeSurface.areas.map(a => (
                                <button key={a.key} onClick={() => setParam({ area: area === a.key ? null : a.key })} aria-pressed={area === a.key}
                                    className={`h-7 px-3 rounded-full border text-[11px] font-bold whitespace-nowrap ${area === a.key ? 'text-white border-transparent' : 'bg-white border-[#E6E6E1] text-[#555555] hover:border-[#BBBBBB]'}`}
                                    style={area === a.key ? { background: activeSurface.ink } : undefined}>
                                    {a.label}
                                </button>
                            ))}
                        </div>
                    ) : null}

                    {/* Search + view switch, then the filters */}
                    <div className="flex flex-col md:flex-row md:items-center gap-3 mb-3">
                        <div className="relative flex-1 min-w-[220px]">
                            <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#BBBBBB]" />
                            <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search titles, details, POWR-12, #527…  ( / )"
                                className="w-full h-11 bg-white border border-[#E6E6E1] rounded-2xl pl-11 pr-4 text-[13px] text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200] outline-none" />
                        </div>
                        <div className="flex items-center bg-white border border-[#E6E6E1] rounded-xl p-1 shrink-0 overflow-x-auto max-w-full">
                            {VIEWS.map(v => (
                                <button key={v.key} onClick={() => setParam({ view: v.key === 'board' ? null : v.key })} aria-pressed={view === v.key}
                                    className={`h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.15em] ${view === v.key ? 'bg-[#1A1A1A] text-white' : 'text-[#777777] hover:text-[#1A1A1A]'}`}>
                                    <v.icon size={13} />{v.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mb-6">
                        <select aria-label="Type" value={type} onChange={e => setType(e.target.value)} className={selectClass}>
                            <option value="">Any type</option>
                            {TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                        </select>
                        <select aria-label="Priority" value={priority} onChange={e => setPriority(e.target.value)} className={selectClass}>
                            <option value="">Any priority</option>
                            {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label} · {p.name}</option>)}
                        </select>
                        <select aria-label="Assignee" value={assignee} onChange={e => setAssignee(e.target.value)} className={selectClass}>
                            <option value="">Anyone</option>
                            <option value="me">Me</option>
                            <option value="none">Unassigned</option>
                            {admins.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                        <select aria-label="Platform" value={platform} onChange={e => setPlatform(e.target.value)} className={selectClass}>
                            <option value="">All platforms</option>
                            {PLATFORMS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                        </select>
                        {sprints ? (
                            <select aria-label="Sprint"
                                value={selectedSprint ? (selectedSprint.status === 'active' ? 'active' : String(selectedSprint.number)) : sprintParam === 'backlog' ? 'backlog' : 'all'}
                                onChange={e => setParam({ sprint: e.target.value === 'all' ? null : e.target.value })} className={selectClass}>
                                <option value="all">Every sprint</option>
                                {running ? <option value="active">{sprintLabel(running)} · running</option> : null}
                                <option value="backlog">Backlog (no sprint)</option>
                                {plannedSprints.length ? (
                                    <optgroup label="Planned">
                                        {plannedSprints.map(sp => <option key={sp.id} value={String(sp.number)}>{sprintLabel(sp)}</option>)}
                                    </optgroup>
                                ) : null}
                                {sprints.some(sp => sp.status === 'completed') ? (
                                    <optgroup label="Finished">
                                        {sprints.filter(sp => sp.status === 'completed').map(sp => <option key={sp.id} value={String(sp.number)}>{sprintLabel(sp)}</option>)}
                                    </optgroup>
                                ) : null}
                            </select>
                        ) : null}
                        {filtersOn ? (
                            <button onClick={clearFilters} className="h-10 px-3 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] text-[#888888] hover:text-[#1A1A1A] inline-flex items-center gap-1">
                                <X size={12} />Clear
                            </button>
                        ) : null}
                    </div>

                    {view !== 'sprints' && selectedSprint ? (
                        <SprintBar
                            sprint={selectedSprint}
                            members={sprintMembers}
                            canStart={!running}
                            onStart={() => startSprint(selectedSprint)}
                            onComplete={() => setCompleting(selectedSprint)}
                            onEdit={() => setSprintForm({ sprint: selectedSprint })}
                            onPlan={() => setParam({ view: 'sprints' })}
                        />
                    ) : view !== 'sprints' && running && sprintParam === 'all' ? (
                        <div className="flex flex-col md:flex-row md:items-center gap-3 bg-white border border-[#E6E6E1] rounded-2xl px-4 py-3 mb-6">
                            <span className="inline-flex items-center gap-2 text-[12px] text-[#1A1A1A]">
                                <span className="w-2 h-2 rounded-full bg-[#10B981]" />
                                <b>{sprintLabel(running)}</b> is running
                                <span className="text-[#888888]">· {(() => { const d = daysLeft(running); return d > 0 ? `${d} day${d === 1 ? '' : 's'} left` : d === 0 ? 'ends today' : `${-d} day${d === -1 ? '' : 's'} over`; })()} · {sprintStats(runningMembers).done} of {runningMembers.length} done</span>
                            </span>
                            <div className="flex-1 min-w-[120px]"><ProgressBar stats={sprintStats(runningMembers)} compact /></div>
                            <button onClick={() => setParam({ sprint: 'active' })} className="h-8 px-3 rounded-full bg-[#1A1A1A] text-white text-[9px] font-black uppercase tracking-[0.2em] shrink-0">Show its board</button>
                        </div>
                    ) : null}

                    {view === 'sprints' ? (
                        sprints ? (
                            <SprintPlanner
                                sprints={sprints}
                                issues={issues}
                                backlog={matching}
                                onAssign={assignToSprint}
                                onEffort={setEffort}
                                onOpen={openIssue}
                                onNew={() => setSprintForm({})}
                                onEdit={(sp) => setSprintForm({ sprint: sp })}
                                onDelete={deleteSprint}
                                onStart={startSprint}
                                onComplete={(sp) => setCompleting(sp)}
                                onShowBoard={(sp) => setParam({ sprint: sp.status === 'active' ? 'active' : String(sp.number), view: null })}
                            />
                        ) : (
                            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-10 max-w-2xl">
                                <div className="text-[10px] uppercase tracking-[0.4em] text-[#C2410C] font-black mb-3">Sprints aren't set up in this database</div>
                                <p className="text-[14px] text-[#333333] leading-relaxed">
                                    Apply <code className="font-mono text-[12px] bg-[#F4F4F1] px-1.5 py-0.5 rounded">supabase/migrations/20261007220000_tracker_sprints.sql</code> and refresh.
                                </p>
                            </div>
                        )
                    ) : loading && !issues.length ? (
                        <div className="flex items-center justify-center py-32">
                            <div className="w-8 h-8 border-2 border-[#E8D200] border-t-transparent rounded-full animate-spin" />
                        </div>
                    ) : !issues.length ? (
                        <div className="bg-white border border-dashed border-[#DDDDD8] rounded-3xl p-12 text-center">
                            <div className="text-2xl font-light tracking-tight text-[#1A1A1A] mb-2">Nothing on the board yet.</div>
                            <p className="text-[13px] text-[#888888] mb-6">File the first thing that's broken, wanted or waiting. Press C anywhere on this page.</p>
                            <button onClick={newHere} className="h-11 px-6 rounded-full bg-[#E8D200] text-[#080808] text-[11px] font-black uppercase tracking-[0.25em]">New issue</button>
                        </div>
                    ) : view === 'list' ? (
                        <>
                            <label className="inline-flex items-center gap-2 mb-3 text-[11px] text-[#777777] cursor-pointer">
                                <input type="checkbox" checked={hideClosed} onChange={e => setHideClosed(e.target.checked)} className="accent-[#1A1A1A]" />
                                Hide closed
                            </label>
                            <List issues={hideClosed ? filtered.filter(i => i.status !== 'closed') : filtered} adminById={adminById} sprintById={sprintById} onOpen={openIssue} />
                        </>
                    ) : view === 'map' ? (
                        <EcosystemMap issues={filtered} onPick={(s, a) => setParam({ surface: s, area: a, view: null })} />
                    ) : (
                        <Board issues={boardOpen} closed={boardClosed} hiddenClosed={hiddenClosed} adminById={adminById}
                            sprintById={sprintById} showSprint={!selectedSprint && sprintParam !== 'backlog'} onOpen={openIssue} onMove={moveIssue} />
                    )}
                </>
            )}

            {current ? (
                <IssueDrawer
                    key={current.id}
                    issue={current}
                    allIssues={issues}
                    admins={admins}
                    sprints={sprints}
                    onChange={replaceIssue}
                    onDelete={(id) => { setIssues(prev => prev.filter(i => i.id !== id)); closeDrawer(); }}
                    onClose={closeDrawer}
                    onOpenIssue={openIssueNumber}
                />
            ) : null}

            {composer ? (
                <NewIssue
                    prefill={composer}
                    admins={admins}
                    sprints={sprints}
                    onClose={() => setComposer(null)}
                    onCreated={(issue) => { replaceIssue(issue); setComposer(null); openIssue(issue); }}
                />
            ) : null}

            {sprintForm ? (
                <SprintForm sprint={sprintForm.sprint} defaults={nextSprintDefaults()} onSave={saveSprint} onClose={() => setSprintForm(null)} />
            ) : null}

            {completing ? (
                <CompleteSprint
                    sprint={completing}
                    members={issues.filter(i => i.sprint_id === completing.id)}
                    planned={plannedSprints}
                    nextName={nextSprintDefaults(completing).name}
                    onComplete={completeSprint}
                    onClose={() => setCompleting(null)}
                />
            ) : null}
        </div>
    );
}
