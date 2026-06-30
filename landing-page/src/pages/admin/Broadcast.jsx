import React, { useCallback, useEffect, useState } from 'react';
import { Megaphone, Send, AlertTriangle, History, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import AudienceSelector, { audienceLabel, callBroadcast } from '../../components/AudienceSelector';

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

const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

export default function Broadcast() {
    const toast = useToast();
    const [title, setTitle] = useState('');
    const [body, setBody]   = useState('');
    const [route, setRoute] = useState('');

    const [audience, setAudience] = useState({ mode: 'all' });
    const [audienceCount, setAudienceCount] = useState(null);

    const [sending, setSending] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [history, setHistory] = useState([]);

    const onAudienceChange = useCallback(({ audience, count }) => {
        setAudience(audience);
        setAudienceCount(count);
    }, []);

    const loadHistory = async () => {
        const { data } = await supabase
            .from('broadcast_log')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(20);
        setHistory(data ?? []);
    };
    useEffect(() => { loadHistory(); }, []);

    const canSend = title.trim() && body.trim() && !sending && audienceCount > 0;

    const send = async () => {
        setConfirm(false);
        setSending(true);
        try {
            const r = await callBroadcast({ title: title.trim(), body: body.trim(), route: route || undefined, audience });
            if (r.error) throw new Error(r.error);
            const reached = (r.delivered ?? 0) + (r.pending ?? 0);
            let msg = `Sent to ${reached} of ${r.recipients} device${r.recipients === 1 ? '' : 's'}`;
            if (r.pruned) msg += ` · ${r.pruned} dead token${r.pruned === 1 ? '' : 's'} removed`;
            if (r.failed) msg += ` · ${r.failed} failed`;
            toast.success(msg);
            setTitle(''); setBody(''); setRoute('');
            loadHistory();
        } catch (e) {
            toast.error(e.message || 'Broadcast failed');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="max-w-3xl mx-auto px-4 py-6">
            <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-3">
                    <Megaphone size={22} className="text-[#E8D200]" />
                    <h1 className="text-xl font-bold text-[#111]">Broadcast Push</h1>
                </div>
                <Link to="/admin/campaigns" className="flex items-center gap-1.5 text-sm text-[#777] hover:text-[#111] transition-colors">
                    <Clock size={15} /> Schedule instead
                </Link>
            </div>
            <p className="text-sm text-[#777] mb-6">
                Reaches every installed device — including older app versions — whose owner
                hasn't turned off announcements.
            </p>

            {/* Audience */}
            <div className="rounded-2xl border border-[#E6E6E1] bg-white p-5 mb-4">
                <AudienceSelector onChange={onAudienceChange} />
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
