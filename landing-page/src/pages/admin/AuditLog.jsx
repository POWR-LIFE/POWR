import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import {
    ScrollText, Search, ChevronDown, ChevronRight, Check, X,
    RefreshCw, User, Building2, Shield, Calendar, ExternalLink,
} from 'lucide-react';

const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

const shorten = (id) => (id ? `${String(id).substring(0, 8)}…` : '—');

const humanize = (s) =>
    String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Colour an action by its intent keyword, so new action types still get sensible colours.
const actionColor = (action = '') => {
    const a = action.toLowerCase();
    if (/(reject|delete|remove|revoke|ban|block)/.test(a)) return '#F43F5E';      // destructive
    if (/(approve|grant|create|add|invite|enable)/.test(a)) return '#10B981';      // constructive
    if (/(config|system|override)/.test(a)) return '#8B5CF6';                       // config
    if (/(email|link|send|notify)/.test(a)) return '#3B82F6';                       // comms
    if (/(point|adjust|update|upload|edit|change|logo|avatar|cover)/.test(a)) return '#E8D200'; // mutation
    return '#888888';
};

// Where clicking a row should take the admin.
const navTargetFor = (log) => {
    const t = log.target_type;
    if (t === 'user' && log.target_id) return `/admin/users/${log.target_id}`;
    if (t === 'partner' && log.target_id) return `/admin/partners/${log.target_id}`;
    if (t === 'activity_session' && log.metadata?.user_id) return `/admin/users/${log.metadata.user_id}`;
    if (t === 'system_config') return '/admin/config';
    if (t === 'reward_brand') return '/admin/rewards';
    return null;
};

const DATE_PRESETS = [
    { key: '24h', label: '24H', ms: 86400000 },
    { key: '7d', label: '7D', ms: 7 * 86400000 },
    { key: '30d', label: '30D', ms: 30 * 86400000 },
    { key: 'all', label: 'ALL', ms: null },
];

/* ── Reusable multi-select dropdown ─────────────────────────────── */
function MultiSelect({ label, icon: Icon, options, selected, onChange }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
        const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const toggle = (val) =>
        onChange(selected.includes(val) ? selected.filter((v) => v !== val) : [...selected, val]);

    const count = selected.length;
    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen((o) => !o)}
                className={`h-16 px-6 flex items-center gap-3 bg-white border rounded-[2rem] text-[10px] font-black uppercase tracking-[0.2em] transition-all ${count ? 'border-[#E8D200] text-[#1A1A1A]' : 'border-[#E6E6E1] text-[#666666] hover:border-[#CFCFCA]'}`}
            >
                {Icon && <Icon size={15} className={count ? 'text-[#8a7600]' : 'text-[#999999]'} />}
                <span>{label}{count ? ` · ${count}` : ''}</span>
                <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="absolute z-40 mt-2 w-72 max-h-96 overflow-auto bg-white border border-[#E6E6E1] rounded-2xl shadow-xl p-2">
                    {count > 0 && (
                        <button
                            onClick={() => onChange([])}
                            className="w-full flex items-center gap-2 px-4 py-2 mb-1 rounded-xl text-[9px] font-black uppercase tracking-[0.3em] text-[#F43F5E] hover:bg-[#FFF1F3] transition-all"
                        >
                            <X size={12} /> Clear selection
                        </button>
                    )}
                    {options.length === 0 && (
                        <div className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.3em] text-[#BBBBBB]">No options</div>
                    )}
                    {options.map((opt) => {
                        const on = selected.includes(opt.value);
                        return (
                            <button
                                key={opt.value}
                                onClick={() => toggle(opt.value)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#F4F4F1] text-left transition-all"
                            >
                                <span className={`w-4 h-4 rounded-[6px] border flex items-center justify-center shrink-0 ${on ? 'bg-[#E8D200] border-[#E8D200]' : 'border-[#CFCFCA]'}`}>
                                    {on && <Check size={11} className="text-[#1A1A1A]" strokeWidth={4} />}
                                </span>
                                <span className="text-[11px] font-bold text-[#222222] capitalize truncate">{opt.label}</span>
                                {opt.count != null && (
                                    <span className="ml-auto text-[9px] font-black text-[#AAAAAA]">{opt.count}</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/* ── Metadata chips ─────────────────────────────────────────────── */
function MetaChips({ metadata }) {
    if (!metadata || typeof metadata !== 'object') return null;
    const entries = Object.entries(metadata).filter(([, v]) => v !== null && v !== undefined && v !== '');
    if (entries.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-2 mt-3">
            {entries.map(([k, v]) => {
                let val = typeof v === 'object' ? JSON.stringify(v) : String(v);
                if (val.length > 60) val = `${val.substring(0, 60)}…`;
                return (
                    <span key={k} className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[9px] font-bold text-[#555555]">
                        <span className="uppercase tracking-[0.15em] text-[#999999]">{k.replace(/_/g, ' ')}</span>
                        <span className="text-[#1A1A1A]">{val}</span>
                    </span>
                );
            })}
        </div>
    );
}

export default function AuditLog() {
    const toast = useToast();
    const navigate = useNavigate();

    const [logs, setLogs] = useState([]);
    const [profileMap, setProfileMap] = useState({});
    const [partnerMap, setPartnerMap] = useState({});
    const [loading, setLoading] = useState(true);

    // Filters
    const [search, setSearch] = useState('');
    const [actionFilter, setActionFilter] = useState([]);
    const [typeFilter, setTypeFilter] = useState([]);
    const [adminFilter, setAdminFilter] = useState([]);
    const [preset, setPreset] = useState('all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [expanded, setExpanded] = useState({});

    useEffect(() => { fetchLogs(); }, []);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('admin_audit_log')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(500);
            if (error) throw error;
            const rows = data || [];
            setLogs(rows);

            // Resolve names/avatars for admins + targets so rows are human-readable.
            const userIds = new Set();
            const partnerIds = new Set();
            rows.forEach((l) => {
                if (l.admin_id) userIds.add(l.admin_id);
                if (l.target_type === 'user' && l.target_id) userIds.add(l.target_id);
                if (l.target_type === 'activity_session' && l.metadata?.user_id) userIds.add(l.metadata.user_id);
                if (l.target_type === 'partner' && l.target_id) partnerIds.add(l.target_id);
            });

            const [profilesRes, partnersRes] = await Promise.all([
                userIds.size
                    ? supabase.from('profiles').select('id, display_name, username, avatar_url').in('id', [...userIds])
                    : Promise.resolve({ data: [] }),
                partnerIds.size
                    ? supabase.from('partners').select('id, name, logo_url').in('id', [...partnerIds])
                    : Promise.resolve({ data: [] }),
            ]);

            const pMap = {};
            (profilesRes.data || []).forEach((p) => { pMap[p.id] = p; });
            const gMap = {};
            (partnersRes.data || []).forEach((g) => { gMap[g.id] = g; });
            setProfileMap(pMap);
            setPartnerMap(gMap);
        } catch (e) {
            toast.error('Failed to load audit log');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const adminName = (id) => {
        const p = profileMap[id];
        return p ? (p.display_name || p.username || shorten(id)) : shorten(id);
    };

    // Resolved target identity for a row (name / sublabel / image).
    const targetInfo = (log) => {
        const t = log.target_type;
        if (t === 'user' && log.target_id) {
            const p = profileMap[log.target_id];
            return p
                ? { name: p.display_name || p.username || 'User', sub: p.username ? `@${p.username}` : null, img: p.avatar_url, icon: User }
                : { name: shorten(log.target_id), icon: User };
        }
        if (t === 'activity_session' && log.metadata?.user_id) {
            const p = profileMap[log.metadata.user_id];
            return p
                ? { name: p.display_name || p.username || 'User', sub: 'activity session', img: p.avatar_url, icon: User }
                : { name: 'activity session', sub: shorten(log.metadata.user_id), icon: User };
        }
        if (t === 'partner' && log.target_id) {
            const p = partnerMap[log.target_id];
            return p ? { name: p.name, sub: 'gym', img: p.logo_url, icon: Building2 } : { name: shorten(log.target_id), icon: Building2 };
        }
        if (t === 'reward_brand') return { name: log.metadata?.brand_name || 'Reward brand', sub: 'reward brand' };
        if (t === 'system_config') return { name: log.target_id || 'system config', sub: 'system config' };
        return { name: log.target_id ? shorten(log.target_id) : '—' };
    };

    // Filter option lists (with counts) derived from loaded data.
    const actionOptions = useMemo(() => {
        const m = {};
        logs.forEach((l) => { m[l.action] = (m[l.action] || 0) + 1; });
        return Object.keys(m).sort().map((a) => ({ value: a, label: humanize(a), count: m[a] }));
    }, [logs]);

    const typeOptions = useMemo(() => {
        const m = {};
        logs.forEach((l) => { if (l.target_type) m[l.target_type] = (m[l.target_type] || 0) + 1; });
        return Object.keys(m).sort().map((t) => ({ value: t, label: humanize(t), count: m[t] }));
    }, [logs]);

    const adminOptions = useMemo(() => {
        const m = {};
        logs.forEach((l) => { if (l.admin_id) m[l.admin_id] = (m[l.admin_id] || 0) + 1; });
        return Object.keys(m)
            .map((id) => ({ value: id, label: adminName(id), count: m[id] }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [logs, profileMap]);

    const { fromTs, toTs } = useMemo(() => {
        let from = null, to = null;
        if (dateFrom) from = new Date(`${dateFrom}T00:00:00`);
        if (dateTo) to = new Date(`${dateTo}T23:59:59`);
        if (!dateFrom && !dateTo && preset !== 'all') {
            const p = DATE_PRESETS.find((x) => x.key === preset);
            if (p?.ms) from = new Date(Date.now() - p.ms);
        }
        return { fromTs: from, toTs: to };
    }, [dateFrom, dateTo, preset]);

    const filtered = useMemo(() => logs.filter((l) => {
        if (actionFilter.length && !actionFilter.includes(l.action)) return false;
        if (typeFilter.length && !typeFilter.includes(l.target_type)) return false;
        if (adminFilter.length && !adminFilter.includes(l.admin_id)) return false;
        const ts = new Date(l.created_at);
        if (fromTs && ts < fromTs) return false;
        if (toTs && ts > toTs) return false;
        if (search) {
            const q = search.toLowerCase();
            const ti = targetInfo(l);
            const hay = [
                l.action, l.target_type, l.target_id,
                adminName(l.admin_id), ti.name, ti.sub,
                JSON.stringify(l.metadata || {}),
            ].join(' ').toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    }), [logs, actionFilter, typeFilter, adminFilter, fromTs, toTs, search, profileMap, partnerMap]);

    const customActive = !!(dateFrom || dateTo);
    const activeFilters = actionFilter.length + typeFilter.length + adminFilter.length
        + (search ? 1 : 0) + (preset !== 'all' || customActive ? 1 : 0);

    const clearAll = () => {
        setSearch(''); setActionFilter([]); setTypeFilter([]); setAdminFilter([]);
        setPreset('all'); setDateFrom(''); setDateTo('');
    };

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <div className="mb-16">
                <div className="flex items-center gap-3 mb-6">
                    <div className="h-[1px] w-12 bg-[#F59E0B]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#F59E0B] font-black">Subsystem / Compliance</span>
                </div>
                <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-6">Audit Log</h1>
                <p className="text-[#666666] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                    Immutable record of all administrative actions performed on the platform.
                </p>
            </div>

            {/* ── Filters ─────────────────────────────────────────── */}
            <div className="space-y-4 mb-8">
                <div className="relative group">
                    <Search size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-[#888888] group-focus-within:text-[#8a7600] transition-colors" />
                    <input
                        type="text"
                        placeholder="SEARCH ACTION, ADMIN, TARGET OR METADATA..."
                        className="w-full h-16 pl-16 pr-8 bg-white border border-[#E6E6E1] rounded-[2rem] text-[11px] font-black tracking-[0.2em] text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/40 outline-none transition-all uppercase"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <MultiSelect label="Action" icon={ScrollText} options={actionOptions} selected={actionFilter} onChange={setActionFilter} />
                    <MultiSelect label="Type" icon={Building2} options={typeOptions} selected={typeFilter} onChange={setTypeFilter} />
                    <MultiSelect label="Admin" icon={Shield} options={adminOptions} selected={adminFilter} onChange={setAdminFilter} />

                    {/* Date presets */}
                    <div className="h-16 flex items-center gap-1 bg-white border border-[#E6E6E1] rounded-[2rem] px-2">
                        <Calendar size={15} className="text-[#999999] ml-3 mr-1" />
                        {DATE_PRESETS.map((p) => {
                            const on = !customActive && preset === p.key;
                            return (
                                <button
                                    key={p.key}
                                    onClick={() => { setPreset(p.key); setDateFrom(''); setDateTo(''); }}
                                    className={`px-3 py-2 rounded-full text-[9px] font-black uppercase tracking-[0.2em] transition-all ${on ? 'bg-[#E8D200] text-[#1A1A1A]' : 'text-[#999999] hover:text-[#1A1A1A]'}`}
                                >
                                    {p.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Custom range */}
                    <div className="h-16 flex items-center gap-2 bg-white border border-[#E6E6E1] rounded-[2rem] px-5">
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className="bg-transparent text-[10px] font-black uppercase tracking-[0.1em] text-[#1A1A1A] outline-none"
                        />
                        <ChevronRight size={12} className="text-[#CCCCCC]" />
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            className="bg-transparent text-[10px] font-black uppercase tracking-[0.1em] text-[#1A1A1A] outline-none"
                        />
                    </div>

                    {activeFilters > 0 && (
                        <button
                            onClick={clearAll}
                            className="h-16 px-5 flex items-center gap-2 bg-white border border-[#E6E6E1] rounded-[2rem] text-[9px] font-black uppercase tracking-[0.3em] text-[#F43F5E] hover:border-[#F43F5E]/40 transition-all"
                        >
                            <X size={13} /> Clear
                        </button>
                    )}

                    <button
                        onClick={fetchLogs}
                        className="h-16 w-16 ml-auto flex items-center justify-center bg-white border border-[#E6E6E1] rounded-full text-[#666666] hover:border-[#E8D200]/40 hover:text-[#8a7600] transition-all"
                        title="Refresh"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>

                <div className="flex items-center gap-2 px-2">
                    <span className="text-[9px] font-black uppercase tracking-[0.4em] text-[#999999]">
                        {filtered.length} {filtered.length === 1 ? 'Record' : 'Records'}
                    </span>
                    {filtered.length !== logs.length && (
                        <span className="text-[9px] font-black uppercase tracking-[0.4em] text-[#CCCCCC]">/ {logs.length} total</span>
                    )}
                </div>
            </div>

            {/* ── Log Table ───────────────────────────────────────── */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-32 gap-6">
                        <div className="w-12 h-12 border-2 border-[#F59E0B]/20 border-t-[#F59E0B] rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Scanning Audit Trail...</span>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="p-20 text-center">
                        <ScrollText size={48} className="mx-auto text-[#333333] mb-6" />
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black">
                            {logs.length === 0 ? 'No audit records found' : 'No records match these filters'}
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-[#E6E6E1]">
                        {filtered.map((log) => {
                            const dest = navTargetFor(log);
                            const ti = targetInfo(log);
                            const TIcon = ti.icon;
                            const isOpen = !!expanded[log.id];
                            return (
                                <div key={log.id}>
                                    <div
                                        onClick={() => dest && navigate(dest)}
                                        className={`flex items-center gap-6 p-7 transition-all ${dest ? 'cursor-pointer hover:bg-[#F4F4F1]' : ''}`}
                                    >
                                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: actionColor(log.action) }} />

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                                                <span className="text-sm font-bold text-[#222222]">{humanize(log.action)}</span>
                                                {log.target_type && (
                                                    <span className="px-3 py-0.5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[8px] font-black uppercase tracking-[0.3em] text-[#666666]">{humanize(log.target_type)}</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2.5 flex-wrap text-[9px] font-black uppercase tracking-[0.25em] text-[#888888]">
                                                <Shield size={11} className="text-[#BBBBBB]" />
                                                <span>{adminName(log.admin_id)}</span>
                                                <span className="text-[#DDDDDD]">→</span>
                                                {ti.img ? (
                                                    <img src={ti.img} alt="" className="w-4 h-4 rounded-full object-cover" />
                                                ) : TIcon ? (
                                                    <TIcon size={11} className="text-[#BBBBBB]" />
                                                ) : null}
                                                <span className="text-[#555555] normal-case tracking-normal text-[11px] font-bold">{ti.name}</span>
                                                {ti.sub && <span className="text-[#BBBBBB] normal-case tracking-normal">{ti.sub}</span>}
                                            </div>
                                            {isOpen && <MetaChips metadata={log.metadata} />}
                                        </div>

                                        <div className="flex items-center gap-4 shrink-0">
                                            {log.metadata && Object.keys(log.metadata).length > 0 && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setExpanded((m) => ({ ...m, [log.id]: !m[log.id] })); }}
                                                    className="text-[8px] font-black uppercase tracking-[0.3em] text-[#999999] hover:text-[#1A1A1A] transition-all"
                                                >
                                                    {isOpen ? 'Hide' : 'Details'}
                                                </button>
                                            )}
                                            <div className="text-right">
                                                <div className="text-[11px] text-[#BBB] mb-0.5">{new Date(log.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                                                <div className="text-[9px] text-[#888888] font-black uppercase tracking-[0.3em]">{timeAgo(log.created_at)}</div>
                                            </div>
                                            {dest && <ExternalLink size={14} className="text-[#CCCCCC]" />}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
