import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { levelFromEarned } from '../../lib/levels';
import { User, Search, Users, Activity, Award, ChevronRight, Filter, MapPin, Star, UserPlus, Trash2, X, Eye, EyeOff, Watch, Smartphone } from 'lucide-react';
import { Link } from 'react-router-dom';

// Full connectable provider list — mirrors lib/health/providers/index.ts in the app
// (native HealthKit/Health Connect + every Terra provider we expose).
const PROVIDER_LABELS = {
    'apple-health': 'Apple Health',
    'health-connect': 'Health Connect',
    'samsung-health': 'Samsung Health',
    whoop: 'Whoop',
    oura: 'Oura',
    polar: 'Polar',
    garmin: 'Garmin',
    fitbit: 'Fitbit',
    strava: 'Strava',
    huawei: 'Huawei Health',
    withings: 'Withings',
    peloton: 'Peloton',
    zepp: 'Zepp',
    technogym: 'Technogym',
    coros: 'Coros',
    suunto: 'Suunto',
    wahoo: 'Wahoo',
    zwift: 'Zwift',
    concept2: 'Concept2',
    ifit: 'iFit',
    underarmour: 'Under Armour',
};
const providerLabel = (p) => PROVIDER_LABELS[p] || p;

// Native phone integrations — a connection here proves HealthKit/Health Connect
// permission, NOT a wearable. Everything else in the list is a genuine
// wearable/fitness-service link.
const NATIVE_PROVIDERS = new Set(['apple-health', 'health-connect', 'samsung-health']);

// seen_devices carries provenance labels stamped by the app (lib/health/dataSource.ts):
// "Apple Watch", "Garmin", "Oura", "Fitness band", ... vs plain "iPhone"/"Phone".
const PHONE_DEVICE_TOKENS = new Set(['iPhone', 'Phone']);
const isWearableDevice = (d) => !PHONE_DEVICE_TOKENS.has(d);

const ACTIVITY_TYPES = ['walking', 'running', 'cycling', 'swimming', 'gym', 'hiit', 'sports', 'yoga', 'sleep', 'dance'];

const DAY_MS = 24 * 60 * 60 * 1000;

const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

export default function UserManager() {
    const toast = useToast();
    const { user: adminUser } = useAuth();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [stats, setStats] = useState({ total: 0, avgLevel: 0, activeToday: 0 });

    // Filters
    const [filterDevice, setFilterDevice] = useState('all');       // all | none | seen-wearable | phone-only | <provider>
    const [filterActivity, setFilterActivity] = useState('all');   // all | none | <type>
    const [activityOnly, setActivityOnly] = useState(false);       // exclusively that activity
    const [filterTier, setFilterTier] = useState('all');           // all | pro | standard
    const [filterLocation, setFilterLocation] = useState('all');   // all | granted | denied
    const [filterActive, setFilterActive] = useState('all');       // all | 1 | 7 | 30 | inactive30 | never
    const [filterMinLevel, setFilterMinLevel] = useState('');
    const [showFilters, setShowFilters] = useState(false);

    // Create user modal
    const [showCreate, setShowCreate] = useState(false);
    const [createEmail, setCreateEmail] = useState('');
    const [createName, setCreateName] = useState('');
    const [createUsername, setCreateUsername] = useState('');
    const [createPassword, setCreatePassword] = useState('');
    const [createIsPro, setCreateIsPro] = useState(false);
    const [createLoading, setCreateLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    // Invite link modal (shown after creating a pro user)
    const [inviteLink, setInviteLink] = useState(null);
    const [inviteCopied, setInviteCopied] = useState(false);

    // Delete confirmation
    const [deletingId, setDeletingId] = useState(null);
    const [deleteLoading, setDeleteLoading] = useState(false);

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

            // Fetch users (with email via admin RPC) and active-today count in parallel
            const [profilesRes, activeRes] = await Promise.all([
                supabase.rpc('admin_get_users'),
                supabase
                    .from('activity_sessions')
                    .select('user_id', { count: 'exact', head: false })
                    .gte('started_at', since24h),
            ]);

            if (profilesRes.error) throw profilesRes.error;
            const profiles = profilesRes.data || [];
            setUsers(profiles);

            // Calculate stats
            const total = profiles.length;
            const avgLevel = total > 0
                ? (profiles.reduce((acc, u) => acc + levelFromEarned(u.total_earned), 0) / total).toFixed(1)
                : 0;

            // Distinct users with a session in the last 24 h
            const activeToday = activeRes.data
                ? new Set(activeRes.data.map(r => r.user_id)).size
                : 0;

            setStats({ total, avgLevel, activeToday });

        } catch (e) {
            toast.error('Failed to load user intelligence');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    // Per-provider connected-user counts; dropdown shows the full connectable
    // list plus anything unexpected found in the data.
    const providerCounts = users.reduce((acc, u) => {
        (u.connected_providers || []).forEach(p => { acc[p] = (acc[p] || 0) + 1; });
        return acc;
    }, {});
    const knownProviders = [...new Set([...Object.keys(PROVIDER_LABELS), ...Object.keys(providerCounts)])]
        .sort((a, b) => providerLabel(a).localeCompare(providerLabel(b)));

    // Provenance-based counts — who has actually produced wearable-sourced
    // samples, regardless of which provider chip they carry.
    const wearableSeenCount = users.filter(u => (u.seen_devices || []).some(isWearableDevice)).length;
    const phoneOnlyCount = users.filter(u => {
        const d = u.seen_devices || [];
        return d.length > 0 && !d.some(isWearableDevice);
    }).length;

    const activeFilterCount = [
        filterDevice !== 'all',
        filterActivity !== 'all',
        filterTier !== 'all',
        filterLocation !== 'all',
        filterActive !== 'all',
        filterMinLevel !== '',
    ].filter(Boolean).length;

    const clearFilters = () => {
        setFilterDevice('all'); setFilterActivity('all'); setActivityOnly(false);
        setFilterTier('all'); setFilterLocation('all'); setFilterActive('all');
        setFilterMinLevel('');
    };

    const filtered = users.filter(u => {
        if (search) {
            const q = search.toLowerCase();
            const hit = (u.display_name?.toLowerCase().includes(q)) ||
                (u.username?.toLowerCase().includes(q)) ||
                (u.email?.toLowerCase().includes(q));
            if (!hit) return false;
        }

        const providers = u.connected_providers || [];
        const devices = u.seen_devices || [];
        if (filterDevice === 'none' && providers.length > 0) return false;
        if (filterDevice === 'seen-wearable' && !devices.some(isWearableDevice)) return false;
        if (filterDevice === 'phone-only' && (devices.length === 0 || devices.some(isWearableDevice))) return false;
        if (!['all', 'none', 'seen-wearable', 'phone-only'].includes(filterDevice) && !providers.includes(filterDevice)) return false;

        const types = u.activity_types || [];
        if (filterActivity === 'none' && types.length > 0) return false;
        if (filterActivity !== 'all' && filterActivity !== 'none') {
            if (!types.includes(filterActivity)) return false;
            // "Only" = no other activity types besides this one (sleep doesn't count as activity)
            if (activityOnly && types.some(t => t !== filterActivity && t !== 'sleep')) return false;
        }

        if (filterTier === 'pro' && !u.is_pro) return false;
        if (filterTier === 'standard' && u.is_pro) return false;

        if (filterLocation === 'granted' && !u.location_granted) return false;
        if (filterLocation === 'denied' && u.location_granted) return false;

        if (filterActive !== 'all') {
            const last = u.last_active_at ? new Date(u.last_active_at).getTime() : null;
            if (filterActive === 'never') {
                if (last) return false;
            } else if (filterActive === 'inactive30') {
                if (last && Date.now() - last < 30 * DAY_MS) return false;
            } else {
                if (!last || Date.now() - last > Number(filterActive) * DAY_MS) return false;
            }
        }

        if (filterMinLevel !== '' && levelFromEarned(u.total_earned) < Number(filterMinLevel)) return false;

        return true;
    });

    useEffect(() => { fetchUsers(); }, []);

    const callEdgeFunction = async (body) => {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(
            `${import.meta.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/admin-manage-user`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                    'apikey': import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
                },
                body: JSON.stringify(body),
            }
        );
        return res.json();
    };

    const handleCreateUser = async () => {
        if (!createEmail || !createPassword) { toast.error('Email and password are required'); return; }
        setCreateLoading(true);
        const result = await callEdgeFunction({
            action: 'create',
            email: createEmail,
            password: createPassword,
            display_name: createName || undefined,
            username: createUsername || undefined,
            is_pro: createIsPro,
        });
        setCreateLoading(false);
        if (result.error) { toast.error(result.error); return; }

        // If Pro, generate an athlete profile invite token
        if (createIsPro) {
            const token = crypto.randomUUID();
            const profileId = result.user_id ?? result.user?.id ?? result.profile?.id ?? null;
            await supabase.from('athlete_applications').insert({
                email: createEmail,
                display_name: createName || createEmail.split('@')[0],
                invite_token: token,
                status: 'invited',
                activity_preferences: [],
                achievements: [],
                gallery_urls: [],
                profile_id: profileId,
            });
            const link = `${window.location.origin}/athlete/${token}`;
            setShowCreate(false);
            setCreateEmail(''); setCreateName(''); setCreateUsername('');
            setCreatePassword(''); setCreateIsPro(false);
            setInviteLink(link);
            fetchUsers();
            return;
        }

        toast.success('User created successfully');
        setShowCreate(false);
        setCreateEmail(''); setCreateName(''); setCreateUsername('');
        setCreatePassword(''); setCreateIsPro(false);
        fetchUsers();
    };

    const copyInviteLink = () => {
        navigator.clipboard.writeText(inviteLink);
        setInviteCopied(true);
        setTimeout(() => setInviteCopied(false), 2000);
    };

    const handleDeleteUser = async (userId) => {
        setDeleteLoading(true);
        const result = await callEdgeFunction({ action: 'delete', user_id: userId });
        setDeleteLoading(false);
        setDeletingId(null);
        if (result.error) { toast.error(result.error); return; }
        toast.success('User deleted');
        fetchUsers();
    };

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-12 mb-20">
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-[1px] w-12 bg-[#E8D200]"></div>
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Subsystem / Intelligence</span>
                    </div>
                    <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-6">User Network</h1>
                    <p className="text-[#666666] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                        Global registry of active nodes and historical performance telemetry.
                    </p>
                </div>
            </div>

            {/* Stats Bar */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-20">
                {[
                    { label: 'Total Nodes', value: stats.total, icon: Users, color: '#8a7600', desc: 'SATELLITE' },
                    { label: 'Avg Performance', value: `LVL ${stats.avgLevel}`, icon: Award, color: '#10B981', desc: 'EFFICIENCY' },
                    { label: 'Active Uplinks', value: stats.activeToday, icon: Activity, color: '#0EA5E9', desc: 'TELEMETRY' },
                ].map(s => (
                    <div key={s.label} className="bg-white border border-[#E6E6E1] p-10 rounded-3xl flex items-center gap-8 group hover:border-[#E6E6E1] transition-all relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 opacity-5">
                            <span className="text-[9px] font-black text-[#666666] uppercase tracking-[0.4em]">{s.desc}</span>
                        </div>
                        <div className="w-14 h-14 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center shrink-0 group-hover:border-[#E8D200]/20 transition-all">
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
            <div className="flex flex-col md:flex-row gap-6 mb-10">
                <div className="relative flex-1 group">
                    <Search size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-[#888888] group-focus-within:text-[#8a7600] transition-colors" />
                    <input
                        type="text"
                        placeholder="SEARCH NODE IDENTIFIER..."
                        className="w-full h-16 pl-16 pr-8 bg-white border border-[#E6E6E1] rounded-[2rem] text-[11px] font-black tracking-[0.2em] text-[#1A1A1A] placeholder-[#BBBBBB] focus:border-[#E8D200]/40 outline-none transition-all uppercase"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
                <button
                    onClick={() => setShowFilters(f => !f)}
                    className={`h-16 px-8 rounded-full flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.3em] border transition-all shrink-0 ${
                        showFilters || activeFilterCount > 0
                            ? 'bg-[#E8D200]/10 border-[#E8D200]/40 text-[#8a7600]'
                            : 'bg-white border-[#E6E6E1] text-[#666666] hover:border-[#DDDDDD]'
                    }`}
                >
                    <Filter size={16} />
                    Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                </button>
                <button
                    onClick={() => setShowCreate(true)}
                    className="h-16 px-10 bg-[#E8D200] text-[#080808] rounded-full flex items-center gap-4 text-[10px] font-black uppercase tracking-[0.3em] hover:translate-y-[-2px] transition-all shadow-lg shadow-[#E8D200]/10 shrink-0"
                >
                    <UserPlus size={16} /> New User
                </button>
            </div>

            {/* Filter Panel */}
            {showFilters && (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8 mb-10 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
                        <div>
                            <label className="block text-[9px] uppercase tracking-[0.3em] text-[#888888] font-black mb-3">Connected Device</label>
                            <select
                                value={filterDevice}
                                onChange={e => setFilterDevice(e.target.value)}
                                className="w-full h-12 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-[11px] font-black uppercase tracking-[0.15em] text-[#1A1A1A] outline-none focus:border-[#E8D200]/40 transition-all"
                            >
                                <option value="all">All</option>
                                <option value="seen-wearable">Wearable seen ({wearableSeenCount})</option>
                                <option value="phone-only">Phone data only ({phoneOnlyCount})</option>
                                {knownProviders.map(p => (
                                    <option key={p} value={p}>{providerLabel(p)} ({providerCounts[p] || 0})</option>
                                ))}
                                <option value="none">No device</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[9px] uppercase tracking-[0.3em] text-[#888888] font-black mb-3">Activity Type</label>
                            <select
                                value={filterActivity}
                                onChange={e => setFilterActivity(e.target.value)}
                                className="w-full h-12 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-[11px] font-black uppercase tracking-[0.15em] text-[#1A1A1A] outline-none focus:border-[#E8D200]/40 transition-all"
                            >
                                <option value="all">All</option>
                                {ACTIVITY_TYPES.map(t => (
                                    <option key={t} value={t}>{t}</option>
                                ))}
                                <option value="none">No sessions</option>
                            </select>
                            {filterActivity !== 'all' && filterActivity !== 'none' && (
                                <button
                                    onClick={() => setActivityOnly(o => !o)}
                                    className={`mt-3 px-3 py-1.5 rounded-full border text-[9px] font-black uppercase tracking-[0.2em] transition-all ${
                                        activityOnly
                                            ? 'bg-[#E8D200]/10 border-[#E8D200]/40 text-[#8a7600]'
                                            : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#999999]'
                                    }`}
                                >
                                    {filterActivity} only
                                </button>
                            )}
                        </div>
                        <div>
                            <label className="block text-[9px] uppercase tracking-[0.3em] text-[#888888] font-black mb-3">Tier</label>
                            <select
                                value={filterTier}
                                onChange={e => setFilterTier(e.target.value)}
                                className="w-full h-12 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-[11px] font-black uppercase tracking-[0.15em] text-[#1A1A1A] outline-none focus:border-[#E8D200]/40 transition-all"
                            >
                                <option value="all">All</option>
                                <option value="pro">Pro</option>
                                <option value="standard">Standard</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[9px] uppercase tracking-[0.3em] text-[#888888] font-black mb-3">Location</label>
                            <select
                                value={filterLocation}
                                onChange={e => setFilterLocation(e.target.value)}
                                className="w-full h-12 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-[11px] font-black uppercase tracking-[0.15em] text-[#1A1A1A] outline-none focus:border-[#E8D200]/40 transition-all"
                            >
                                <option value="all">All</option>
                                <option value="granted">Granted</option>
                                <option value="denied">Denied</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[9px] uppercase tracking-[0.3em] text-[#888888] font-black mb-3">Last Active</label>
                            <select
                                value={filterActive}
                                onChange={e => setFilterActive(e.target.value)}
                                className="w-full h-12 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-[11px] font-black uppercase tracking-[0.15em] text-[#1A1A1A] outline-none focus:border-[#E8D200]/40 transition-all"
                            >
                                <option value="all">Any time</option>
                                <option value="1">Last 24h</option>
                                <option value="7">Last 7 days</option>
                                <option value="30">Last 30 days</option>
                                <option value="inactive30">Inactive 30d+</option>
                                <option value="never">Never active</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[9px] uppercase tracking-[0.3em] text-[#888888] font-black mb-3">Min Level</label>
                            <input
                                type="number"
                                min="1"
                                value={filterMinLevel}
                                onChange={e => setFilterMinLevel(e.target.value)}
                                placeholder="Any"
                                className="w-full h-12 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-[11px] font-black tracking-[0.15em] text-[#1A1A1A] placeholder-[#BBBBBB] outline-none focus:border-[#E8D200]/40 transition-all"
                            />
                        </div>
                    </div>
                    <div className="flex items-center justify-between mt-8 pt-6 border-t border-[#E6E6E1]">
                        <span className="text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black">
                            {filtered.length} of {users.length} users match
                        </span>
                        {activeFilterCount > 0 && (
                            <button
                                onClick={clearFilters}
                                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] text-[9px] font-black uppercase tracking-[0.3em] text-[#666666] hover:text-[#1A1A1A] transition-all"
                            >
                                <X size={12} /> Clear Filters
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Content Container */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-48 gap-6">
                        <div className="w-12 h-12 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Syncing Node Hive...</span>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[#F4F4F1] border-b border-[#E6E6E1]">
                                    {['User Identity', 'Protocol Level', 'Devices', 'Activity', 'Location', 'Registration', 'Status', ''].map(h => (
                                        <th key={h} className={`px-6 py-5 text-[10px] font-black uppercase tracking-[0.3em] text-[#888888] whitespace-nowrap ${h === '' ? 'text-right' : ''}`}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E6E6E1]">
                                {filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="px-6 py-24 text-center">
                                            <div className="flex flex-col items-center gap-6">
                                                <div className="w-20 h-20 rounded-3xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center">
                                                    <Users size={32} className="text-[#333333]" />
                                                </div>
                                                <p className="text-[11px] uppercase tracking-[0.4em] text-[#888888] font-black">
                                                    No Nodes Detected
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filtered.map(user => (
                                    <tr key={user.id} className="group hover:bg-[#F4F4F1] transition-all">
                                        <td className="px-6 py-5">
                                            <div className="flex items-center gap-6 max-w-[280px]">
                                                <div className="w-12 h-12 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center overflow-hidden shrink-0">
                                                    {user.avatar_url ? (
                                                        <img
                                                            src={user.avatar_url}
                                                            alt=""
                                                            className="w-full h-full object-cover"
                                                            onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = ''; }}
                                                        />
                                                    ) : null}
                                                    <User size={18} className="text-[#888888]" style={{ display: user.avatar_url ? 'none' : '' }} />
                                                </div>
                                                <div className="min-w-0">
                                                    <span className="text-base font-bold text-[#222222] group-hover:text-[#1A1A1A] transition-colors block mb-1 truncate">
                                                        {user.display_name || user.username || user.email?.split('@')[0] || 'Anonymous Node'}
                                                    </span>
                                                    <span className="block truncate text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black">
                                                        {user.username ? `@${user.username}` : user.email || 'unidentified'}
                                                    </span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-5">
                                            <div className="flex items-center gap-4">
                                                <span className="px-4 py-1.5 rounded-full bg-[#E8D200] text-[#080808] text-[9px] font-black uppercase tracking-[0.2em]">
                                                    LVL {levelFromEarned(user.total_earned)}
                                                </span>
                                                <span className="text-[9px] uppercase tracking-[0.2em] text-[#888888] font-black whitespace-nowrap">
                                                    {user.total_points ?? 0} PTS
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-5">
                                            <div className="flex flex-col gap-2 max-w-[200px]">
                                                {(user.connected_providers || []).length > 0 ? (
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {user.connected_providers.map(p => (
                                                            <span key={p} className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] text-[8px] font-black uppercase tracking-[0.15em] text-[#555555] whitespace-nowrap">
                                                                {NATIVE_PROVIDERS.has(p)
                                                                    ? <Smartphone size={9} className="text-[#999999]" />
                                                                    : <Watch size={9} className="text-[#8a7600]" />} {providerLabel(p)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <span className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">None</span>
                                                )}
                                                {(user.seen_devices || []).length > 0 && (
                                                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                                                        {user.seen_devices.map(d => (
                                                            <span
                                                                key={d}
                                                                className={`flex items-center gap-1 text-[8px] font-black uppercase tracking-[0.15em] whitespace-nowrap ${
                                                                    isWearableDevice(d) ? 'text-[#8a7600]' : 'text-[#AAAAAA]'
                                                                }`}
                                                            >
                                                                {isWearableDevice(d) ? <Watch size={9} /> : <Smartphone size={9} />}{d}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-5">
                                            {(user.activity_types || []).length > 0 ? (
                                                <div className="flex flex-col gap-1.5 max-w-[160px]">
                                                    <span className="text-[12px] text-[#222222] font-medium">
                                                        {user.session_count} session{user.session_count === 1 ? '' : 's'}
                                                    </span>
                                                    <span className="text-[8px] uppercase tracking-[0.15em] text-[#888888] font-black leading-relaxed">
                                                        {user.activity_types.join(' · ')}
                                                    </span>
                                                    {user.last_active_at && (
                                                        <span className="text-[9px] uppercase tracking-[0.2em] text-[#666666] font-black">
                                                            {timeAgo(user.last_active_at)}
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-[9px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">No sessions</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-5">
                                            {user.location_granted ? (
                                                <div className="flex items-center gap-3">
                                                    <MapPin size={14} className="text-[#10B981]" />
                                                    <span className="text-[9px] uppercase tracking-[0.3em] text-[#10B981] font-black">Granted</span>
                                                </div>
                                            ) : (
                                                <span className="text-[9px] uppercase tracking-[0.3em] text-[#666666] font-black">Denied</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-5 whitespace-nowrap">
                                            <div className="flex flex-col">
                                                <span className="text-[12px] text-[#222222] font-medium mb-1">
                                                    {new Date(user.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </span>
                                                <span className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black">
                                                    {timeAgo(user.created_at)}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-5">
                                            <div className="flex flex-col gap-2">
                                                <div className="flex items-center gap-4">
                                                    <div className="h-1.5 w-1.5 rounded-full bg-[#10B981] shadow-[0_0_10px_rgba(16,185,129,0.4)]"></div>
                                                    <span className="text-[9px] uppercase tracking-[0.3em] text-[#555555] font-black">ACTIVE</span>
                                                </div>
                                                {user.is_pro && (
                                                    <span className="flex items-center gap-1.5 px-3 py-1 self-start rounded-full bg-[#E8D200]/10 border border-[#E8D200]/30 text-[#8a7600] text-[9px] font-black uppercase tracking-[0.2em]">
                                                        <Star size={9} fill="#E8D200" /> Pro
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-5 text-right">
                                            <div className="flex items-center justify-end gap-3">
                                                <Link
                                                    to={`/admin/users/${user.id}`}
                                                    title="Query profile"
                                                    className="inline-flex items-center gap-3 px-5 py-3 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[9px] font-black uppercase tracking-[0.3em] text-[#666666] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all group/btn whitespace-nowrap"
                                                >
                                                    <span className="hidden 2xl:inline">Query Profile</span>
                                                    <ChevronRight size={14} className="text-[#333333] group-hover/btn:text-[#8a7600] transition-colors" />
                                                </Link>
                                                <button
                                                    onClick={() => setDeletingId(user.id)}
                                                    className="w-10 h-10 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#999999] hover:text-red-400 hover:border-red-400/30 transition-all"
                                                    title="Delete user"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            
            <div className="mt-12 flex items-center justify-between px-12">
                <div className="flex items-center gap-4">
                    <div className="h-1.5 w-1.5 rounded-full bg-[#10B981] animate-pulse"></div>
                    <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Intra-Network Sync Active</span>
                </div>
                <span className="text-[10px] uppercase tracking-[0.6em] text-[#333333] font-black">POWR / USR / V3.0</span>
            </div>

            {/* ── Create User Modal ────────────────────────────────── */}
            {showCreate && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center" onClick={() => setShowCreate(false)}>
                    <div className="bg-white border border-[#E6E6E1] rounded-3xl p-12 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-10">
                            <h3 className="text-2xl font-light tracking-tighter text-[#1A1A1A]">New User</h3>
                            <button onClick={() => setShowCreate(false)} className="w-10 h-10 rounded-full bg-[#EFEFEC] flex items-center justify-center text-[#BBB] hover:text-[#1A1A1A] transition-colors"><X size={18} /></button>
                        </div>
                        <div className="space-y-5">
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-[#BBB] font-black mb-3">Email *</label>
                                <input type="email" value={createEmail} onChange={e => setCreateEmail(e.target.value)} placeholder="user@example.com" className="w-full h-14 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-[#1A1A1A] text-sm font-light outline-none focus:border-[#E8D200]/40 transition-all" />
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-[#BBB] font-black mb-3">Password *</label>
                                <div className="relative">
                                    <input type={showPassword ? 'text' : 'password'} value={createPassword} onChange={e => setCreatePassword(e.target.value)} placeholder="Min 6 characters" className="w-full h-14 px-6 pr-14 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-[#1A1A1A] text-sm font-light outline-none focus:border-[#E8D200]/40 transition-all" />
                                    <button type="button" onClick={() => setShowPassword(p => !p)} className="absolute right-4 top-1/2 -translate-y-1/2 text-[#999999] hover:text-[#666666] transition-colors">
                                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-[#BBB] font-black mb-3">Display Name</label>
                                    <input type="text" value={createName} onChange={e => setCreateName(e.target.value)} placeholder="Jane Smith" className="w-full h-14 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-[#1A1A1A] text-sm font-light outline-none focus:border-[#E8D200]/40 transition-all" />
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-[#BBB] font-black mb-3">Username</label>
                                    <input type="text" value={createUsername} onChange={e => setCreateUsername(e.target.value)} placeholder="jane_smith" className="w-full h-14 px-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-[#1A1A1A] text-sm font-light outline-none focus:border-[#E8D200]/40 transition-all" />
                                </div>
                            </div>
                            <button
                                onClick={() => setCreateIsPro(p => !p)}
                                className={`w-full h-12 rounded-xl border text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 transition-all ${
                                    createIsPro
                                        ? 'bg-[#E8D200]/10 border-[#E8D200]/40 text-[#8a7600]'
                                        : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#999999] hover:border-[#DDDDDD]'
                                }`}
                            >
                                <Star size={13} fill={createIsPro ? '#E8D200' : 'none'} />
                                {createIsPro ? 'Pro Athlete' : 'Standard User'}
                            </button>
                            <button onClick={handleCreateUser} disabled={createLoading} className="w-full h-14 bg-[#E8D200] text-[#080808] font-black uppercase tracking-widest text-xs rounded-xl hover:translate-y-[-2px] transition-all shadow-lg shadow-[#E8D200]/10 disabled:opacity-50">
                                {createLoading ? 'Creating...' : 'Create User'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Pro Athlete Invite Link Modal ───────────────────── */}
            {inviteLink && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-center justify-center" onClick={() => setInviteLink(null)}>
                    <div className="bg-white border border-[#E8D200]/20 rounded-3xl p-12 w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-start mb-8">
                            <div>
                                <div className="flex items-center gap-3 mb-2">
                                    <Star size={16} className="text-[#8a7600]" fill="#E8D200" />
                                    <span className="text-[10px] uppercase tracking-widest font-black text-[#8a7600]">Pro Athlete Invite</span>
                                </div>
                                <h3 className="text-2xl font-light tracking-tighter text-[#1A1A1A]">User created</h3>
                            </div>
                            <button onClick={() => setInviteLink(null)} className="w-10 h-10 rounded-full bg-[#EFEFEC] flex items-center justify-center text-[#BBB] hover:text-[#1A1A1A] transition-colors">
                                <X size={18} />
                            </button>
                        </div>

                        <p className="text-[#999999] text-sm font-light mb-8 leading-relaxed">
                            Send this link to the athlete. They'll use it to fill in their profile — it expires once submitted.
                        </p>

                        {/* Link display */}
                        <div className="flex gap-3 mb-6">
                            <div className="flex-1 h-12 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl flex items-center overflow-hidden">
                                <span className="text-[11px] text-[#999999] font-mono truncate">{inviteLink}</span>
                            </div>
                            <button
                                onClick={copyInviteLink}
                                className={`h-12 px-6 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shrink-0 ${
                                    inviteCopied
                                        ? 'bg-[#4ade80]/10 border border-[#4ade80]/30 text-[#4ade80]'
                                        : 'bg-[#E8D200] text-[#080808] hover:opacity-90'
                                }`}
                            >
                                {inviteCopied ? 'Copied!' : 'Copy'}
                            </button>
                        </div>

                        <p className="text-[10px] text-[#BBBBBB] font-mono text-center">
                            This link is single-use. A new one can be generated from the athlete's profile.
                        </p>
                    </div>
                </div>
            )}

            {/* ── Delete Confirmation Modal ────────────────────────── */}
            {deletingId && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center" onClick={() => setDeletingId(null)}>
                    <div className="bg-white border border-red-200 rounded-3xl p-12 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center mb-8">
                            <Trash2 size={22} className="text-red-400" />
                        </div>
                        <h3 className="text-2xl font-light tracking-tighter text-[#1A1A1A] mb-3">Delete User?</h3>
                        <p className="text-[#999999] text-sm font-light mb-10 leading-relaxed">This permanently removes the account, all activity data, and point history. This cannot be undone.</p>
                        <div className="flex gap-4">
                            <button onClick={() => setDeletingId(null)} className="flex-1 h-12 bg-[#EFEFEC] border border-[#E6E6E1] rounded-xl text-[10px] font-black uppercase tracking-widest text-[#666666] hover:text-[#1A1A1A] transition-colors">
                                Cancel
                            </button>
                            <button onClick={() => handleDeleteUser(deletingId)} disabled={deleteLoading} className="flex-1 h-12 bg-red-50 border border-red-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-red-400 hover:bg-red-100 transition-all disabled:opacity-50">
                                {deleteLoading ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
