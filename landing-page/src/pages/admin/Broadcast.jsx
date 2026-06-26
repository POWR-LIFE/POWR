import React, { useEffect, useMemo, useState } from 'react';
import { Megaphone, Send, Users, AlertTriangle, History, Search, X, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';

const TITLE_MAX = 65;
const BODY_MAX = 178; // Comfortably within APNs/FCM display limits.

// Where tapping the notification lands. Keep to long-standing routes so older
// app builds don't dead-end (the notification itself shows on any version).
const ROUTE_PRESETS = [
    { label: 'Home',     value: '' },
    { label: 'Rewards',  value: '/(tabs)/rewards' },
    { label: 'Progress', value: '/(tabs)/progress' },
    { label: 'Friends',  value: '/friends' },
];

// Activity-preference values (profiles.activity_preferences), ordered by reach.
const ACTIVITIES = ['gym', 'walking', 'running', 'cycling', 'swimming', 'hiit', 'yoga', 'sports', 'dance'];
const ACTIVITY_LABEL = { hiit: 'HIIT' };
const label = (a) => ACTIVITY_LABEL[a] ?? a.charAt(0).toUpperCase() + a.slice(1);

const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

// Human label for a stored audience spec (history + confirm).
const audienceLabel = (a) => {
    if (!a || a.mode === 'all' || !a.mode) return 'Everyone';
    if (a.mode === 'users') return `${a.user_ids?.length ?? 0} specific`;
    const parts = [];
    if (a.user_type === 'pro') parts.push('Athletes');
    else if (a.user_type === 'normal') parts.push('Normal users');
    if (a.activities?.length) parts.push(a.activities.map(label).join(' / '));
    return parts.join(' · ') || 'Everyone';
};

async function callBroadcast(body) {
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

export default function Broadcast() {
    const toast = useToast();
    const [title, setTitle] = useState('');
    const [body, setBody]   = useState('');
    const [route, setRoute] = useState('');

    // Audience state
    const [mode, setMode]         = useState('all');          // all | segment | users
    const [userType, setUserType] = useState('all');          // all | pro | normal
    const [activities, setActivities] = useState([]);         // stated preferences (ANY of)
    const [picked, setPicked]     = useState([]);             // [{id, username, display_name, email, ...}]
    const [search, setSearch]     = useState('');
    const [allUsers, setAllUsers] = useState(null);           // cached admin_get_users directory (incl. email)

    const [audienceCount, setAudienceCount] = useState(null);
    const [checking, setChecking] = useState(false);
    const [sending, setSending]   = useState(false);
    const [confirm, setConfirm]   = useState(false);
    const [history, setHistory]   = useState([]);

    const audience = useMemo(() => {
        if (mode === 'segment') return { mode: 'segment', user_type: userType, activities };
        if (mode === 'users')   return { mode: 'users', user_ids: picked.map((u) => u.id) };
        return { mode: 'all' };
    }, [mode, userType, activities, picked]);

    const loadHistory = async () => {
        const { data } = await supabase
            .from('broadcast_log')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(20);
        setHistory(data ?? []);
    };
    useEffect(() => { loadHistory(); }, []);

    // Refresh the recipient count whenever the audience spec changes (debounced).
    useEffect(() => {
        if (mode === 'users' && picked.length === 0) { setAudienceCount(0); return; }
        let cancelled = false;
        setChecking(true);
        const t = setTimeout(async () => {
            try {
                const r = await callBroadcast({ dry_run: true, audience });
                if (!cancelled) setAudienceCount(r.error ? null : r.recipients);
            } catch {
                if (!cancelled) setAudienceCount(null);
            } finally {
                if (!cancelled) setChecking(false);
            }
        }, 350);
        return () => { cancelled = true; clearTimeout(t); };
    }, [audience, mode, picked.length]); // eslint-disable-line react-hooks/exhaustive-deps

    // Load the full user directory once (incl. email) when entering this mode.
    // Reuses the same admin_get_users RPC the Users page uses, so we can search
    // by email — which lives in auth.users, not profiles.
    useEffect(() => {
        if (mode !== 'users' || allUsers !== null) return;
        supabase.rpc('admin_get_users').then(({ data }) => setAllUsers(data ?? []));
    }, [mode, allUsers]);

    // Local search across name, username and email.
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

    const canSend = title.trim() && body.trim() && !sending && audienceCount > 0;

    const send = async () => {
        setConfirm(false);
        setSending(true);
        try {
            const r = await callBroadcast({ title: title.trim(), body: body.trim(), route: route || undefined, audience });
            if (r.error) throw new Error(r.error);
            toast.success(`Sent to ${r.sent} of ${r.recipients} device${r.recipients === 1 ? '' : 's'}`);
            setTitle(''); setBody(''); setRoute('');
            loadHistory();
        } catch (e) {
            toast.error(e.message || 'Broadcast failed');
        } finally {
            setSending(false);
        }
    };

    const ModeTab = ({ value, children }) => (
        <button
            onClick={() => setMode(value)}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === value ? 'bg-white text-[#111] shadow-sm' : 'text-[#777] hover:text-[#333]'
            }`}
        >
            {children}
        </button>
    );

    return (
        <div className="max-w-3xl mx-auto px-4 py-6">
            <div className="flex items-center gap-3 mb-1">
                <Megaphone size={22} className="text-[#E8D200]" />
                <h1 className="text-xl font-bold text-[#111]">Broadcast Push</h1>
            </div>
            <p className="text-sm text-[#777] mb-6">
                Reaches every installed device — including older app versions — whose owner
                hasn't turned off announcements.
            </p>

            {/* Audience */}
            <div className="rounded-2xl border border-[#E6E6E1] bg-white p-5 mb-4">
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
                                            onClick={() => toggleActivity(a)}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                                on ? 'bg-[#E8D200] border-[#E8D200] text-[#080808]'
                                                   : 'bg-white border-[#E6E6E1] text-[#666] hover:border-[#CFCFCF]'
                                            }`}
                                        >
                                            {on && <Check size={12} />}
                                            {label(a)}
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
                                        <button onClick={() => removeUser(u.id)} className="text-[#999] hover:text-[#111]"><X size={13} /></button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <div className="flex items-center gap-2 mt-4 text-sm text-[#666]">
                    <Users size={15} />
                    {checking ? 'Counting…'
                        : audienceCount == null ? 'Audience unknown'
                        : <span>
                            <span className="font-semibold text-[#111]">{audienceCount}</span> device{audienceCount === 1 ? '' : 's'} will receive this
                            {mode === 'users' && picked.length > 0 && (
                                <span className="text-[#999]"> · {picked.length} {picked.length === 1 ? 'person' : 'people'}</span>
                            )}
                          </span>}
                </div>
            </div>

            {/* Composer */}
            <div className="rounded-2xl border border-[#E6E6E1] bg-white p-5 space-y-4">
                <div>
                    <label className="block text-xs font-semibold text-[#888] mb-1.5 uppercase tracking-wide">Title</label>
                    <input
                        value={title} maxLength={TITLE_MAX}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. New rewards just dropped 🎁"
                        className="w-full rounded-xl border border-[#E6E6E1] bg-[#FAFAF8] px-4 py-2.5 text-[#111] text-sm focus:outline-none focus:border-[#E8D200]"
                    />
                    <div className="text-right text-[11px] text-[#AAA] mt-1">{title.length}/{TITLE_MAX}</div>
                </div>

                <div>
                    <label className="block text-xs font-semibold text-[#888] mb-1.5 uppercase tracking-wide">Message</label>
                    <textarea
                        value={body} maxLength={BODY_MAX} rows={3}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder="Tap to see what's new."
                        className="w-full rounded-xl border border-[#E6E6E1] bg-[#FAFAF8] px-4 py-2.5 text-[#111] text-sm resize-none focus:outline-none focus:border-[#E8D200]"
                    />
                    <div className="text-right text-[11px] text-[#AAA] mt-1">{body.length}/{BODY_MAX}</div>
                </div>

                <div>
                    <label className="block text-xs font-semibold text-[#888] mb-1.5 uppercase tracking-wide">Opens</label>
                    <div className="flex flex-wrap gap-2">
                        {ROUTE_PRESETS.map((p) => (
                            <button
                                key={p.label}
                                onClick={() => setRoute(p.value)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                    route === p.value ? 'bg-[#E8D200] border-[#E8D200] text-[#080808]'
                                                      : 'bg-white border-[#E6E6E1] text-[#666] hover:border-[#CFCFCF]'
                                }`}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="rounded-xl bg-[#111] p-4">
                    <div className="text-[10px] uppercase tracking-wider text-[#666] mb-2">Preview</div>
                    <div className="rounded-xl bg-[#1f1f1f] px-4 py-3">
                        <div className="text-sm font-semibold text-white">{title || 'Title'}</div>
                        <div className="text-sm text-[#BBB] mt-0.5">{body || 'Message body'}</div>
                    </div>
                </div>

                <div className="flex justify-end pt-1">
                    <button
                        onClick={() => setConfirm(true)}
                        disabled={!canSend}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#E8D200] text-[#080808] text-sm font-semibold hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Send size={15} />
                        {sending ? 'Sending…' : 'Send broadcast'}
                    </button>
                </div>
            </div>

            {/* History */}
            <div className="flex items-center gap-2 mt-8 mb-3">
                <History size={16} className="text-[#999]" />
                <h2 className="text-sm font-semibold text-[#555]">Recent broadcasts</h2>
            </div>
            <div className="rounded-2xl border border-[#E6E6E1] bg-white divide-y divide-[#F0F0EC]">
                {history.length === 0 && (
                    <div className="px-5 py-6 text-sm text-[#AAA] text-center">No broadcasts yet.</div>
                )}
                {history.map((h) => (
                    <div key={h.id} className="px-5 py-3.5 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <div className="text-sm font-semibold text-[#111] truncate">{h.title}</div>
                            <div className="text-xs text-[#888] truncate">{h.body}</div>
                            <div className="text-[11px] text-[#B59B00] mt-0.5">→ {audienceLabel(h.audience)}</div>
                        </div>
                        <div className="text-right shrink-0">
                            <div className="text-xs text-[#666]">{h.tickets_ok}/{h.recipients} sent</div>
                            <div className="text-[11px] text-[#AAA]">{timeAgo(h.created_at)}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Confirm modal */}
            {confirm && (
                <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 px-4" onClick={() => setConfirm(false)}>
                    <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle size={18} className="text-[#E8D200]" />
                            <h3 className="text-base font-bold text-[#111]">Send this broadcast?</h3>
                        </div>
                        <p className="text-sm text-[#666] mb-5">
                            Pushes <span className="font-semibold text-[#111]">"{title}"</span> to{' '}
                            <span className="font-semibold text-[#111]">{audienceLabel(audience)}</span>
                            {audienceCount != null && <> — {audienceCount} device{audienceCount === 1 ? '' : 's'}</>}. This can't be undone.
                        </p>
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setConfirm(false)} className="px-4 py-2 rounded-xl text-sm text-[#666] hover:bg-[#F4F4F1]">Cancel</button>
                            <button onClick={send} className="px-4 py-2 rounded-xl bg-[#E8D200] text-[#080808] text-sm font-semibold hover:brightness-95">Send now</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
