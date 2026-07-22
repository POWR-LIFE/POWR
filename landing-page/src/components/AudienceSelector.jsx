import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Users, Search, X, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';

// Activity-preference values (profiles.activity_preferences), ordered by reach.
const ACTIVITIES = ['gym', 'walking', 'running', 'cycling', 'swimming', 'hiit', 'yoga', 'sports', 'dance'];
const ACTIVITY_LABEL = { hiit: 'HIIT' };
export const activityLabel = (a) => ACTIVITY_LABEL[a] ?? a.charAt(0).toUpperCase() + a.slice(1);

// Human label for a stored audience spec (history + confirm dialogs).
export const audienceLabel = (a) => {
    // Device-level filters suffix every mode (platform / app-version targeting).
    const device = [];
    if (a?.platforms?.length) device.push(a.platforms.map((p) => (p === 'ios' ? 'iOS' : 'Android')).join(' + '));
    if (a?.below_version) device.push(`below v${a.below_version}`);
    const suffix = device.length ? ` · ${device.join(' · ')}` : '';
    if (!a || a.mode === 'all' || !a.mode) return `Everyone${suffix}`;
    if (a.mode === 'users') return `${a.user_ids?.length ?? 0} specific${suffix}`;
    const parts = [];
    if (a.user_type === 'pro') parts.push('Athletes');
    else if (a.user_type === 'normal') parts.push('Normal users');
    if (a.activities?.length) parts.push(a.activities.map(activityLabel).join(' / '));
    return (parts.join(' · ') || 'Everyone') + suffix;
};

// Hits the broadcast edge function (dry_run for live recipient counts).
export async function callBroadcast(body) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
        `${import.meta.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/admin-broadcast-push`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
                'apikey': import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify(body),
        },
    );
    return res.json();
}

// Self-contained audience picker (Everyone / Segment / Specific people) with a
// live recipient count. Reports { audience, count, checking } up via onChange.
// Shared by the immediate Broadcast page and the scheduled Campaigns page.
export default function AudienceSelector({ onChange }) {
    const [mode, setMode]         = useState('all');   // all | segment | users
    const [userType, setUserType] = useState('all');   // all | pro | normal
    const [activities, setActivities] = useState([]);  // stated preferences (ANY of)
    const [picked, setPicked]     = useState([]);      // [{id, username, display_name, email, ...}]
    const [search, setSearch]     = useState('');
    const [allUsers, setAllUsers] = useState(null);    // cached admin_get_users directory

    // Device filters — orthogonal to mode; a user is only pushed on matching devices.
    const [platform, setPlatform] = useState('all');   // all | ios | android
    const [belowVersion, setBelowVersion] = useState(''); // 'x.y.z' or ''

    const [count, setCount]       = useState(null);
    const [checking, setChecking] = useState(false);

    const belowValid = /^\d+\.\d+\.\d+$/.test(belowVersion.trim());

    const audience = useMemo(() => {
        const base = mode === 'segment' ? { mode: 'segment', user_type: userType, activities }
                   : mode === 'users'   ? { mode: 'users', user_ids: picked.map((u) => u.id) }
                   : { mode: 'all' };
        if (platform !== 'all') base.platforms = [platform];
        if (belowValid) base.below_version = belowVersion.trim();
        return base;
    }, [mode, userType, activities, picked, platform, belowVersion, belowValid]);

    // Refresh the recipient count whenever the audience spec changes (debounced).
    useEffect(() => {
        if (mode === 'users' && picked.length === 0) { setCount(0); return; }
        let cancelled = false;
        setChecking(true);
        const t = setTimeout(async () => {
            try {
                const r = await callBroadcast({ dry_run: true, audience });
                if (!cancelled) setCount(r.error ? null : r.recipients);
            } catch {
                if (!cancelled) setCount(null);
            } finally {
                if (!cancelled) setChecking(false);
            }
        }, 350);
        return () => { cancelled = true; clearTimeout(t); };
    }, [audience, mode, picked.length]); // eslint-disable-line react-hooks/exhaustive-deps

    // Bubble state up. Kept in a ref-stable callback so parents don't loop.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    useEffect(() => {
        onChangeRef.current?.({ audience, count, checking, picked });
    }, [audience, count, checking, picked]);

    // Load the full user directory once (incl. email) when entering this mode.
    useEffect(() => {
        if (mode !== 'users' || allUsers !== null) return;
        supabase.rpc('admin_get_users').then(({ data }) => setAllUsers(data ?? []));
    }, [mode, allUsers]);

    const results = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (q.length < 2 || !allUsers) return [];
        return allUsers.filter((u) =>
            (u.display_name || '').toLowerCase().includes(q) ||
            (u.username || '').toLowerCase().includes(q) ||
            (u.email || '').toLowerCase().includes(q),
        ).slice(0, 8);
    }, [search, allUsers]);

    const toggleActivity = (a) =>
        setActivities((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
    const addUser = (u) => {
        if (!picked.some((p) => p.id === u.id)) setPicked((prev) => [...prev, u]);
        setSearch('');
    };
    const removeUser = (id) => setPicked((prev) => prev.filter((p) => p.id !== id));

    const ModeTab = ({ value, children }) => (
        <button
            type="button"
            onClick={() => setMode(value)}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === value ? 'bg-white text-[#111] shadow-sm' : 'text-[#777] hover:text-[#333]'
            }`}
        >
            {children}
        </button>
    );

    return (
        <div>
            <label className="block text-xs font-semibold text-[#888] mb-2 uppercase tracking-wide">Audience</label>
            <div className="flex gap-1 p-1 rounded-xl bg-[#F4F4F1] mb-4">
                <ModeTab value="all">Everyone</ModeTab>
                <ModeTab value="segment">Segment</ModeTab>
                <ModeTab value="users">Specific people</ModeTab>
            </div>

            {mode === 'segment' && (
                <div className="space-y-4">
                    <div>
                        <div className="text-xs font-medium text-[#999] mb-1.5">User type</div>
                        <div className="flex gap-1 p-1 rounded-lg bg-[#F4F4F1] w-fit">
                            {[['all', 'All'], ['pro', 'Athletes'], ['normal', 'Normal users']].map(([v, l]) => (
                                <button
                                    key={v}
                                    type="button"
                                    onClick={() => setUserType(v)}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                        userType === v ? 'bg-white text-[#111] shadow-sm' : 'text-[#777] hover:text-[#333]'
                                    }`}
                                >
                                    {l}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <div className="text-xs font-medium text-[#999] mb-1.5">
                            Interested in <span className="text-[#BBB]">(any selected — leave empty for all)</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {ACTIVITIES.map((a) => {
                                const on = activities.includes(a);
                                return (
                                    <button
                                        key={a}
                                        type="button"
                                        onClick={() => toggleActivity(a)}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                            on ? 'bg-[#E8D200] border-[#E8D200] text-[#080808]'
                                               : 'bg-white border-[#E6E6E1] text-[#666] hover:border-[#CFCFCF]'
                                        }`}
                                    >
                                        {on && <Check size={12} />}
                                        {activityLabel(a)}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {mode === 'users' && (
                <div>
                    <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AAA]" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search by name, username or email…"
                            className="w-full rounded-xl border border-[#E6E6E1] bg-[#FAFAF8] pl-9 pr-4 py-2.5 text-[#111] text-sm focus:outline-none focus:border-[#E8D200]"
                        />
                        {results.length > 0 && (
                            <div className="absolute z-20 mt-1 w-full rounded-xl border border-[#E6E6E1] bg-white shadow-lg overflow-hidden">
                                {results.map((u) => (
                                    <button
                                        key={u.id}
                                        type="button"
                                        onClick={() => addUser(u)}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#F4F4F1]"
                                    >
                                        <div className="w-7 h-7 rounded-full bg-[#EEE] overflow-hidden shrink-0">
                                            {u.avatar_url && <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="text-sm text-[#111] truncate">
                                                {u.display_name || u.username || u.email || 'User'}
                                                {u.is_pro ? <span className="text-[#B59B00]"> · athlete</span> : ''}
                                            </div>
                                            <div className="text-xs text-[#999] truncate">{u.email}{u.username ? ` · @${u.username}` : ''}</div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    {picked.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3">
                            {picked.map((u) => (
                                <span key={u.id} className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg bg-[#F4F4F1] text-xs text-[#333]">
                                    {u.display_name || u.username}
                                    <button type="button" onClick={() => removeUser(u.id)} className="text-[#999] hover:text-[#111]"><X size={13} /></button>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Device filters — apply on top of whichever mode is active */}
            <div className="mt-4 pt-4 border-t border-[#F0F0EC] flex flex-wrap items-end gap-x-6 gap-y-3">
                <div>
                    <div className="text-xs font-medium text-[#999] mb-1.5">Platform</div>
                    <div className="flex gap-1 p-1 rounded-lg bg-[#F4F4F1] w-fit">
                        {[['all', 'All devices'], ['ios', 'iOS'], ['android', 'Android']].map(([v, l]) => (
                            <button
                                key={v}
                                type="button"
                                onClick={() => setPlatform(v)}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                    platform === v ? 'bg-white text-[#111] shadow-sm' : 'text-[#777] hover:text-[#333]'
                                }`}
                            >
                                {l}
                            </button>
                        ))}
                    </div>
                </div>
                <div>
                    <div className="text-xs font-medium text-[#999] mb-1.5">
                        On app version below <span className="text-[#BBB]">(optional — catches never-updated devices too)</span>
                    </div>
                    <input
                        value={belowVersion}
                        onChange={(e) => setBelowVersion(e.target.value)}
                        placeholder="e.g. 1.4.11"
                        className={`w-32 rounded-lg border bg-[#FAFAF8] px-3 py-1.5 text-sm text-[#111] focus:outline-none ${
                            belowVersion.trim() && !belowValid
                                ? 'border-[#E0A800]' : 'border-[#E6E6E1] focus:border-[#E8D200]'
                        }`}
                    />
                    {belowVersion.trim() && !belowValid && (
                        <div className="text-[11px] text-[#B58900] mt-1">Needs the full x.y.z form — ignored until then.</div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2 mt-4 text-sm text-[#666]">
                <Users size={15} />
                {checking ? 'Counting…'
                    : count == null ? 'Audience unknown'
                    : <span>
                        <span className="font-semibold text-[#111]">{count}</span> device{count === 1 ? '' : 's'} will receive this
                        {mode === 'users' && picked.length > 0 && (
                            <span className="text-[#999]"> · {picked.length} {picked.length === 1 ? 'person' : 'people'}</span>
                        )}
                      </span>}
            </div>
        </div>
    );
}
