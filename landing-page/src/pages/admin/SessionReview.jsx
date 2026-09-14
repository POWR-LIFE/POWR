import {
    AlertTriangle, CheckCircle, CheckSquare, Clock, Coins, Eye, EyeOff, History, RefreshCw, Search, Square, Users, XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';

// Why claim-points flagged the session (set in supabase/functions/claim-points).
const FLAG_REASONS = {
    duplicate:         { label: 'Duplicate',    color: '#F59E0B', hint: 'A second session of the same type and evidence class on the same UTC day.' },
    multi_device:      { label: 'Multi-Device', color: '#F43F5E', hint: '3+ distinct devices on this account in the last 7 days.' },
    // Claimed duration exceeds what the device PROVED during the gym visit by
    // >30 min — the award went through (never drop a workout), this is the
    // review queue for it. Re-evaluated whenever the visit changes
    // (reconcile_session_proof_flag), so a row still here is still unproven.
    unproven_duration: { label: 'Unproven Duration', color: '#8B5CF6', hint: 'Claimed more than 30 min beyond what the device proved (last proof or a witnessed exit).' },
};
const flagReason = (r) => FLAG_REASONS[r] || { label: 'Flagged', color: '#999', hint: 'Flagged before reasons were recorded.' };
// claim-points APPENDS a second verdict (e.g. 'duplicate,unproven_duration')
// rather than losing it — render one chip per reason.
const reasonKeys = (raw) => String(raw || '').split(',').map((k) => k.trim()).filter(Boolean);
const flagReasons = (raw) => {
    const keys = reasonKeys(raw);
    return (keys.length ? keys : ['']).map((k) => ({ key: k || 'flagged', ...flagReason(k) }));
};

// How the row came to exist. A server settle is the beacon's own policy
// decision (visit proved its check-in, no exit seen, never contradicted) —
// not a device claim, and since 2026-09-14 no longer flagged on its own.
const ORIGINS = {
    device:        { label: 'Device claim',   color: '#10B981' },
    server_settle: { label: 'Server settle',  color: '#0EA5E9' },
    wearable:      { label: 'Wearable import', color: '#666666' },
    manual:        { label: 'Manual',         color: '#666666' },
};
const origin = (o) => ORIGINS[o] || { label: o || '—', color: '#666666' };

const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};
const mins = (sec) => `${Math.floor((sec || 0) / 60)}m`;

// Both actions run through a service-role edge function so the writes persist
// (activity_sessions has no client UPDATE/DELETE policy) and reject can also
// reverse the points (earn + streak) already awarded for the session. Accepts
// one id or many.
const callReview = async (action, sessionIds) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
        `${import.meta.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/admin-review-session`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
                'apikey': import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ action, session_ids: sessionIds }),
        }
    );
    return res.json();
};

const FILTERS = [
    { key: 'all',               label: 'All' },
    { key: 'unproven_duration', label: 'Unproven' },
    { key: 'duplicate',         label: 'Duplicate' },
    { key: 'multi_device',      label: 'Multi-device' },
    { key: 'twins',             label: 'Twin rows' },
    { key: 'disowned',          label: 'Device disowned' },
    { key: 'server_settle',     label: 'Server settle' },
];

const matchesFilter = (row, key) => {
    switch (key) {
        case 'all':           return true;
        case 'twins':         return !!row.twin_session_id;
        case 'disowned':      return (row.no_active_answers || 0) > 0;
        case 'server_settle': return row.origin === 'server_settle';
        default:              return reasonKeys(row.flag_reason).includes(key);
    }
};

export default function SessionReview() {
    const toast = useToast();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [includeInternal, setIncludeInternal] = useState(false);
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(() => new Set());

    // Everything this page READS comes from one SECURITY DEFINER RPC that proves
    // is_admin() server-side and joins the visit (proof clock, end witness, gym,
    // origin, twin). Never a bare select — see LiveOps.jsx for the leak history.
    const fetchQueue = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.rpc('admin_session_review_queue', {
                p_include_internal: includeInternal,
                p_limit: 500,
            });
            if (error) throw error;
            setRows(data || []);
            setSelected(new Set());
        } catch (e) {
            toast.error('Failed to load session data');
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [includeInternal, toast]);

    useEffect(() => { fetchQueue(); }, [fetchQueue]);

    const counts = useMemo(() => {
        const c = {};
        for (const f of FILTERS) c[f.key] = rows.filter((r) => matchesFilter(r, f.key)).length;
        return c;
    }, [rows]);

    const filtered = useMemo(() => rows.filter((r) => {
        if (!matchesFilter(r, filter)) return false;
        if (!search) return true;
        const q = search.toLowerCase();
        return [r.display_name, r.username, r.email, r.type, r.partner_name]
            .some((v) => String(v || '').toLowerCase().includes(q));
    }), [rows, filter, search]);

    const uniqueUsers = new Set(rows.map((r) => r.user_id)).size;
    const oldest = rows.length
        ? timeAgo(rows.reduce((a, b) => (a.started_at < b.started_at ? a : b)).started_at)
        : '—';
    const pointsAtStake = rows.reduce((sum, r) => sum + (r.earned_points || 0), 0);

    const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.session_id));
    const toggleAll = () => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (allVisibleSelected) filtered.forEach((r) => next.delete(r.session_id));
            else filtered.forEach((r) => next.add(r.session_id));
            return next;
        });
    };
    const toggleOne = (id) => setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const act = async (action, ids) => {
        if (!ids.length) return;
        if (action === 'reject') {
            const pts = rows.filter((r) => ids.includes(r.session_id)).reduce((s, r) => s + (r.earned_points || 0), 0);
            const ok = window.confirm(
                `Reject ${ids.length} session${ids.length === 1 ? '' : 's'}? ` +
                `This deletes ${ids.length === 1 ? 'it' : 'them'} and reverses ${pts} pts (earn + streak).`,
            );
            if (!ok) return;
        }
        setBusy(true);
        const result = await callReview(action, ids);
        setBusy(false);
        if (result.error) { toast.error(result.error); return; }
        const done = result[action === 'approve' ? 'approved' : 'rejected'] ?? 0;
        const failed = ids.length - done;
        if (action === 'approve') {
            toast.success(`${done} approved — flag cleared${failed ? ` (${failed} failed)` : ''}`);
        } else {
            toast.success(`${done} rejected — ${result.reversed_points ?? 0} pts reversed${failed ? ` (${failed} failed)` : ''}`);
        }
        const okIds = new Set((result.results || []).filter((r) => r.ok).map((r) => r.session_id));
        setRows((prev) => prev.filter((r) => !okIds.has(r.session_id)));
        setSelected((prev) => { const n = new Set(prev); okIds.forEach((id) => n.delete(id)); return n; });
    };

    const selectedIds = [...selected].filter((id) => rows.some((r) => r.session_id === id));

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-12 mb-20">
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-[1px] w-12 bg-[#F43F5E]"></div>
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#F43F5E] font-black">Subsystem / Integrity</span>
                    </div>
                    <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-6">Session Review</h1>
                    <p className="text-[#666666] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                        Sessions claim-points paid but could not vouch for — unproven duration, duplicates, multi-device. Approve to clear the flag, or reject to remove the session and reverse its points.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setIncludeInternal((v) => !v)}
                        className="h-12 px-5 rounded-full bg-white border border-[#E6E6E1] text-[#666666] text-[9px] font-black uppercase tracking-[0.2em] hover:border-[#BBBBBB] transition-all flex items-center gap-2"
                        title="Admin accounts and the Stratford test geofence are hidden by default"
                    >
                        {includeInternal ? <Eye size={14} /> : <EyeOff size={14} />}
                        {includeInternal ? 'Showing internal' : 'Internal hidden'}
                    </button>
                    <button
                        onClick={fetchQueue}
                        disabled={loading}
                        className="h-12 px-5 rounded-full bg-white border border-[#E6E6E1] text-[#666666] text-[9px] font-black uppercase tracking-[0.2em] hover:border-[#BBBBBB] transition-all flex items-center gap-2 disabled:opacity-40"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                    </button>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-20">
                {[
                    { label: 'Flagged Sessions', value: rows.length, icon: AlertTriangle, color: '#F43F5E', desc: 'QUEUE' },
                    { label: 'Unique Users', value: uniqueUsers, icon: Users, color: '#F59E0B', desc: 'ACCOUNTS' },
                    { label: 'Points At Stake', value: pointsAtStake, icon: Coins, color: '#E8D200', desc: 'EARN + STREAK' },
                    { label: 'Oldest Pending', value: oldest, icon: History, color: '#0EA5E9', desc: 'BACKLOG' },
                ].map(s => (
                    <div key={s.label} className="bg-white border border-[#E6E6E1] p-10 rounded-3xl flex items-center gap-8 group hover:border-[#E6E6E1] transition-all relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 opacity-5">
                            <span className="text-[9px] font-black text-[#666666] uppercase tracking-[0.4em]">{s.desc}</span>
                        </div>
                        <div className="w-14 h-14 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center shrink-0">
                            <s.icon size={22} style={{ color: s.color }} />
                        </div>
                        <div>
                            <div className="text-4xl font-light tracking-tighter text-[#222222] leading-none mb-2">
                                {loading ? '...' : s.value}
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black">{s.label}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Controls */}
            <div className="flex flex-col gap-6 mb-10">
                <div className="relative flex-1 group">
                    <Search size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-[#888888] group-focus-within:text-[#8a7600] transition-colors" />
                    <input type="text" placeholder="SEARCH BY USER, EMAIL, GYM OR TYPE..." className="w-full h-16 pl-16 pr-8 bg-white border border-[#E6E6E1] rounded-[2rem] text-[11px] font-black tracking-[0.2em] text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/40 outline-none transition-all uppercase" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <div className="flex flex-wrap gap-2">
                    {FILTERS.map((f) => (
                        <button
                            key={f.key}
                            onClick={() => setFilter(f.key)}
                            className={`h-10 px-4 rounded-full border text-[9px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 ${filter === f.key ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-white border-[#E6E6E1] text-[#666666] hover:border-[#BBBBBB]'}`}
                        >
                            {f.label}
                            <span className={`px-2 py-0.5 rounded-full text-[9px] ${filter === f.key ? 'bg-white/15' : 'bg-[#F4F4F1]'}`}>{loading ? '…' : counts[f.key] ?? 0}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Bulk bar */}
            {selectedIds.length > 0 && (
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 px-8 py-5 bg-[#1A1A1A] rounded-3xl text-white">
                    <span className="text-[10px] font-black uppercase tracking-[0.4em]">{selectedIds.length} selected</span>
                    <div className="flex items-center gap-3">
                        <button onClick={() => act('approve', selectedIds)} disabled={busy} className="h-10 px-5 rounded-full bg-[#10B981]/20 border border-[#10B981]/40 text-[#10B981] text-[9px] font-black uppercase tracking-[0.2em] hover:bg-[#10B981]/30 transition-all flex items-center gap-2 disabled:opacity-40">
                            <CheckCircle size={14} /> Approve selected
                        </button>
                        <button onClick={() => act('reject', selectedIds)} disabled={busy} className="h-10 px-5 rounded-full bg-[#F43F5E]/20 border border-[#F43F5E]/40 text-[#F43F5E] text-[9px] font-black uppercase tracking-[0.2em] hover:bg-[#F43F5E]/30 transition-all flex items-center gap-2 disabled:opacity-40">
                            <XCircle size={14} /> Reject selected
                        </button>
                        <button onClick={() => setSelected(new Set())} className="h-10 px-4 rounded-full border border-white/20 text-white/70 text-[9px] font-black uppercase tracking-[0.2em] hover:bg-white/10 transition-all">
                            Clear
                        </button>
                    </div>
                </div>
            )}

            {/* Table */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-48 gap-6">
                        <div className="w-12 h-12 border-2 border-[#F43F5E]/20 border-t-[#F43F5E] rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Scanning Integrity Layer...</span>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[#F4F4F1] border-b border-[#E6E6E1]">
                                    <th className="px-6 py-5 w-10">
                                        <button onClick={toggleAll} className="text-[#888888] hover:text-[#1A1A1A]" title={allVisibleSelected ? 'Clear visible' : 'Select visible'}>
                                            {allVisibleSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                                        </button>
                                    </th>
                                    {['User', 'Gym', 'Origin', 'Claimed / Proven', 'Reason', 'Actions'].map(h => (
                                        <th key={h} className={`px-6 py-5 text-[10px] font-black uppercase tracking-[0.5em] text-[#888888] ${h === 'Actions' ? 'text-right' : ''}`}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E6E6E1]">
                                {filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-6 py-24 text-center">
                                            <div className="flex flex-col items-center gap-6">
                                                <CheckCircle size={48} className="text-[#10B981]/30" />
                                                <p className="text-[11px] uppercase tracking-[0.4em] text-[#888888] font-black">
                                                    {rows.length === 0 ? 'All Clear — No Sessions Require Review' : 'Nothing matches this filter'}
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filtered.map(row => {
                                    const excessSec = Math.max(0, (row.duration_sec || 0) - (row.proven_sec || 0));
                                    const o = origin(row.origin);
                                    const isSelected = selected.has(row.session_id);
                                    return (
                                        <tr key={row.session_id} className={`group transition-all ${isSelected ? 'bg-[#FFFBE6]' : 'hover:bg-[#F4F4F1]'}`}>
                                            <td className="px-6 py-5">
                                                <button onClick={() => toggleOne(row.session_id)} className="text-[#888888] hover:text-[#1A1A1A]">
                                                    {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                                                </button>
                                            </td>
                                            <td className="px-6 py-5">
                                                <span className="text-base font-bold text-[#222222] block mb-1">
                                                    {row.display_name || row.username || 'Unknown'}
                                                    {row.is_internal && <span className="ml-2 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-[0.2em] bg-[#F4F4F1] text-[#888888] border border-[#E6E6E1]">Internal</span>}
                                                </span>
                                                <span className="text-[9px] text-[#666666] font-black uppercase tracking-[0.3em]">{timeAgo(row.started_at)} · {row.type}</span>
                                                {row.email && <span className="block text-[9px] text-[#BBBBBB] mt-1">{row.email}</span>}
                                            </td>
                                            <td className="px-6 py-5">
                                                <span className="text-sm font-bold text-[#444444] block">{row.partner_name || '—'}</span>
                                                {row.visit_id ? (
                                                    <span className="text-[9px] text-[#888888] font-black uppercase tracking-[0.2em]">
                                                        visit {row.visit_status}{row.close_reason ? ` · ${row.close_reason.replace(/_/g, ' ')}` : ''}
                                                    </span>
                                                ) : row.verification === 'geofence' ? (
                                                    <span className="text-[9px] text-[#F43F5E] font-black uppercase tracking-[0.2em]">no visit resolved</span>
                                                ) : null}
                                            </td>
                                            <td className="px-6 py-5">
                                                <span className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.2em] border" style={{ color: o.color, borderColor: `${o.color}33` }}>
                                                    {o.label}
                                                </span>
                                                <span className="block mt-2 text-[9px] text-[#888888] font-black uppercase tracking-[0.2em]">{row.verification} · {row.earned_points || 0} pts</span>
                                            </td>
                                            <td className="px-6 py-5">
                                                <div className="flex items-center gap-2 text-[12px] text-[#222222] font-bold">
                                                    <Clock size={14} className="text-[#BBBBBB]" /> {mins(row.duration_sec)}
                                                    <span className="text-[#BBBBBB] font-normal">/</span>
                                                    <span style={{ color: excessSec > 30 * 60 ? '#F43F5E' : '#10B981' }}>{mins(row.proven_sec)} proven</span>
                                                </div>
                                                <span className="block mt-1 text-[9px] text-[#888888] font-black uppercase tracking-[0.2em]">
                                                    {row.end_witnessed_at ? 'exit witnessed' : row.last_proven_at ? 'last proof' : 'no proof'}
                                                    {excessSec > 0 ? ` · +${mins(excessSec)} unproven` : ''}
                                                </span>
                                            </td>
                                            <td className="px-6 py-5">
                                                <div className="flex flex-wrap gap-1">
                                                    {flagReasons(row.flag_reason).map((r) => (
                                                        <span key={r.key} title={r.hint} className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.2em] border" style={{ color: r.color, borderColor: `${r.color}33` }}>
                                                            {r.label}
                                                        </span>
                                                    ))}
                                                    {row.twin_session_id && (
                                                        <span title="Another session row exists for the same visit (same start time). One of the pair is a twin, not a second workout." className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.2em] border border-[#F59E0B]/30 text-[#F59E0B]">
                                                            Twin row
                                                        </span>
                                                    )}
                                                    {(row.no_active_answers || 0) > 0 && (
                                                        <span title="The device answered a dwell wake with 'no session for this visit' — it had already left (drive-by) or lost local state." className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.2em] border border-[#F43F5E]/30 text-[#F43F5E]">
                                                            Disowned ×{row.no_active_answers}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-5 text-right">
                                                <div className="flex items-center justify-end gap-3">
                                                    <button onClick={() => act('approve', [row.session_id])} disabled={busy} className="h-10 px-5 rounded-full bg-[#10B981]/10 border border-[#10B981]/20 text-[#10B981] text-[9px] font-black uppercase tracking-[0.2em] hover:bg-[#10B981]/20 transition-all flex items-center gap-2 disabled:opacity-40 disabled:pointer-events-none">
                                                        <CheckCircle size={14} /> Approve
                                                    </button>
                                                    <button onClick={() => act('reject', [row.session_id])} disabled={busy} className="h-10 px-5 rounded-full bg-[#F43F5E]/10 border border-[#F43F5E]/20 text-[#F43F5E] text-[9px] font-black uppercase tracking-[0.2em] hover:bg-[#F43F5E]/20 transition-all flex items-center gap-2 disabled:opacity-40 disabled:pointer-events-none">
                                                        <XCircle size={14} /> Reject
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
