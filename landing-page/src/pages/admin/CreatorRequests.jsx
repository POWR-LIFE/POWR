import React, { useCallback, useEffect, useState } from 'react';
import { Check, X, Sparkles, UserCheck, Clock, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { invokeFn } from '../../lib/invokeFn';
import { CreatorTabs } from './CreatorPrograms';

/**
 * /admin/creators/requests — members who EARNED the invite (Home card after
 * `creator_invite_threshold` converted referrals) and asked to join.
 *
 * Approve = the same create_creator call the "New creator" form makes, with
 * the member pre-picked: their POWR ID is the code, they log into the portal
 * with the account they already have. The request row is marked approved
 * AFTER the creator exists, because that update is what fires the
 * "you're in" push — never promise a portal that isn't there yet.
 */

const INPUT = "w-full h-11 px-4 bg-white border border-[#E6E6E1] rounded-xl text-sm text-[#1A1A1A] placeholder-[#CCCCCC] focus:border-[#E8D200]/50 outline-none transition-all";
const LABEL = "block text-[9px] uppercase tracking-[0.35em] text-[#BBBBBB] font-black mb-2";
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;

function fmt(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function handleGuess(r) {
    return (r.username || r.display_name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

function Avatar({ r }) {
    return r.avatar_url
        ? <img src={r.avatar_url} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />
        : <div className="w-11 h-11 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[11px] font-black text-[#8a7600] uppercase shrink-0">{(r.display_name || r.username || '?')[0]}</div>;
}

function PendingCard({ r, onDone }) {
    const [mode, setMode] = useState(null); // null | 'approve' | 'decline'
    const [form, setForm] = useState({ display_name: r.display_name || r.username || '', handle: handleGuess(r), bio: '' });
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);

    const approve = async (e) => {
        e.preventDefault();
        const handle = form.handle.trim().toLowerCase();
        if (!HANDLE_RE.test(handle)) return setErr('Handle: 2–30 chars, lowercase letters, numbers or hyphens.');
        if (!form.display_name.trim()) return setErr('Display name is required.');
        setErr(null); setBusy(true);
        try {
            const res = await invokeFn('manage-creator-user', {
                action: 'create_creator',
                member_user_id: r.user_id,
                avatar_url: r.avatar_url ?? null,
                display_name: form.display_name.trim(),
                handle,
                code: r.member_id,           // their POWR ID — never a second identifier
                bio: form.bio.trim() || null,
                notes: `Earned invite: ${r.converted_count} converted referrals (bar ${r.threshold}) · request ${r.id}`,
            });
            const { data: { user } } = await supabase.auth.getUser();
            const { error } = await supabase
                .from('creator_invite_requests')
                .update({ status: 'approved', creator_id: res?.creator?.id ?? null, decided_at: new Date().toISOString(), decided_by: user?.id ?? null, note: note.trim() || null })
                .eq('id', r.id);
            if (error) throw error;
            onDone();
        } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
    };

    const decline = async (e) => {
        e.preventDefault();
        setBusy(true); setErr(null);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            const { error } = await supabase
                .from('creator_invite_requests')
                .update({ status: 'declined', decided_at: new Date().toISOString(), decided_by: user?.id ?? null, note: note.trim() || null })
                .eq('id', r.id);
            if (error) throw error;
            onDone();
        } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
    };

    return (
        <div className="bg-white border border-[#E6E6E1] rounded-3xl p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <Avatar r={r} />
                <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-bold text-[#1A1A1A] truncate">{r.display_name || r.username || 'Member'}</div>
                    <div className="text-[10px] text-[#999] font-black mt-0.5 truncate">
                        {r.username ? `@${r.username} · ` : ''}{r.email || '—'} · POWR ID <span className="font-mono tracking-widest text-[#8a7600]">{r.member_id}</span>
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-[#BBBBBB] font-black mt-2">
                        Asked {fmt(r.created_at)} · {r.converted_count} converted at the time (bar {r.threshold}) · {r.converted_now} now
                    </div>
                </div>
                {!mode && (
                    <div className="flex gap-2 shrink-0">
                        <button onClick={() => setMode('approve')} className="h-10 px-5 bg-[#E8D200] text-[#080808] rounded-full text-[10px] uppercase tracking-[0.2em] font-black hover:-translate-y-0.5 transition-all flex items-center gap-2"><Check size={13} /> Approve</button>
                        <button onClick={() => setMode('decline')} className="h-10 px-5 bg-white border border-[#E6E6E1] text-[#888] rounded-full text-[10px] uppercase tracking-[0.2em] font-black hover:border-red-300 hover:text-red-500 transition-all flex items-center gap-2"><X size={13} /> Decline</button>
                    </div>
                )}
            </div>

            <div className="mt-4 pl-0 sm:pl-15">
                <Link to={`/admin/users?q=${encodeURIComponent(r.member_id ?? '')}`} className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-black">
                    <span className="text-[#BBBBBB] hover:text-[#8a7600] flex items-center gap-2">Open in Users <ExternalLink size={11} /></span>
                </Link>
            </div>

            {mode === 'approve' && (
                <form onSubmit={approve} className="mt-6 pt-6 border-t border-[#F0F0ED] space-y-5">
                    <p className="text-[12px] text-[#888] font-light leading-relaxed max-w-2xl">
                        This creates their affiliate profile on the Default programme with their POWR ID as the code, links the portal to their app login, and sends them a "you're in" push. You can change programme or points on their card afterwards.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-2xl">
                        <div>
                            <label className={LABEL}>Display name</label>
                            <input className={INPUT} value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} required />
                        </div>
                        <div>
                            <label className={LABEL}>Handle · powr.life/join/…</label>
                            <input className={`${INPUT} font-mono`} value={form.handle} onChange={e => setForm(f => ({ ...f, handle: e.target.value.toLowerCase() }))} required />
                        </div>
                    </div>
                    <div className="max-w-2xl">
                        <label className={LABEL}>Note (internal)</label>
                        <input className={INPUT} value={note} onChange={e => setNote(e.target.value)} placeholder="Optional — why, or anything to remember" />
                    </div>
                    {err && <div className="text-red-500 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-xl max-w-2xl">{err}</div>}
                    <div className="flex gap-2">
                        <button type="submit" disabled={busy} className="h-10 px-6 bg-[#E8D200] text-[#080808] rounded-full text-[10px] uppercase tracking-[0.2em] font-black disabled:opacity-50 flex items-center gap-2"><UserCheck size={13} /> {busy ? 'Creating…' : 'Create affiliate & approve'}</button>
                        <button type="button" onClick={() => setMode(null)} className="h-10 px-5 text-[10px] uppercase tracking-[0.2em] font-black text-[#999]">Cancel</button>
                    </div>
                </form>
            )}

            {mode === 'decline' && (
                <form onSubmit={decline} className="mt-6 pt-6 border-t border-[#F0F0ED] space-y-5">
                    <p className="text-[12px] text-[#888] font-light leading-relaxed max-w-2xl">
                        Quiet decline — they aren't notified, the Home card goes away, and they can ask again in 30 days if they still qualify.
                    </p>
                    <div className="max-w-2xl">
                        <label className={LABEL}>Note (internal)</label>
                        <input className={INPUT} value={note} onChange={e => setNote(e.target.value)} placeholder="Why — for the next person who looks" />
                    </div>
                    {err && <div className="text-red-500 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-xl max-w-2xl">{err}</div>}
                    <div className="flex gap-2">
                        <button type="submit" disabled={busy} className="h-10 px-6 bg-[#1A1A1A] text-white rounded-full text-[10px] uppercase tracking-[0.2em] font-black disabled:opacity-50">{busy ? 'Saving…' : 'Decline'}</button>
                        <button type="button" onClick={() => setMode(null)} className="h-10 px-5 text-[10px] uppercase tracking-[0.2em] font-black text-[#999]">Cancel</button>
                    </div>
                </form>
            )}
        </div>
    );
}

export default function CreatorRequests() {
    const [rows, setRows] = useState(null);
    const [config, setConfig] = useState({ threshold: null, window: null });
    const [err, setErr] = useState(null);

    const load = useCallback(async () => {
        const [{ data, error }, { data: cfg }] = await Promise.all([
            supabase.rpc('admin_creator_invite_requests'),
            supabase.from('system_config').select('key, value').in('key', ['creator_invite_threshold', 'creator_invite_window_days']),
        ]);
        if (error) setErr(error.message);
        setRows(data ?? []);
        const map = Object.fromEntries((cfg ?? []).map(c => [c.key, c.value]));
        setConfig({ threshold: map.creator_invite_threshold ?? '3', window: map.creator_invite_window_days ?? '90' });
    }, []);

    useEffect(() => { load(); }, [load]);

    const pending = (rows ?? []).filter(r => r.status === 'pending');
    const decided = (rows ?? []).filter(r => r.status !== 'pending');

    return (
        <div>
            <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
                <div>
                    <h1 className="text-4xl font-light tracking-tighter text-[#1A1A1A] mb-2">Affiliate requests</h1>
                    <p className="text-[11px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">
                        Members who earned the invite and asked to join
                    </p>
                </div>
                <Link to="/admin/config" className="text-[10px] uppercase tracking-[0.2em] font-black">
                    <span className="text-[#BBBBBB] hover:text-[#8a7600]">
                        Bar: {config.threshold ?? '…'} converted in {config.window === '0' ? 'all time' : `${config.window ?? '…'} days`} · edit in Config
                    </span>
                </Link>
            </div>
            <CreatorTabs />

            {err && <div className="text-red-500 text-xs bg-red-500/5 p-4 border border-red-500/20 rounded-2xl mb-6">{err}</div>}

            {rows === null ? (
                <div className="flex justify-center py-24"><div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" /></div>
            ) : pending.length === 0 ? (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl p-12 text-center">
                    <Sparkles size={22} className="text-[#E8D200] mx-auto mb-4" />
                    <h2 className="text-2xl font-light tracking-tight text-[#1A1A1A] mb-2">No one waiting</h2>
                    <p className="text-sm text-[#888] font-light max-w-md mx-auto">
                        When a member reaches {config.threshold ?? '…'} converted referrals, Home asks them if they want in. Their request lands here and pings Slack.
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {pending.map(r => <PendingCard key={r.id} r={r} onDone={load} />)}
                </div>
            )}

            {decided.length > 0 && (
                <div className="mt-10">
                    <h2 className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mb-4">Decided</h2>
                    <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                        {decided.map(r => (
                            <div key={r.id} className="flex items-center gap-4 px-6 py-4 border-b border-[#F0F0ED] last:border-0">
                                <Avatar r={r} />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-bold text-[#1A1A1A] truncate">{r.display_name || r.username || 'Member'}</div>
                                    <div className="text-[10px] text-[#999] font-black mt-0.5 truncate">{r.email || '—'}{r.note ? ` · ${r.note}` : ''}</div>
                                </div>
                                <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[9px] uppercase tracking-[0.2em] font-black border ${
                                    r.status === 'approved' ? 'bg-[#E8D200]/10 border-[#E8D200]/30 text-[#8a7600]' : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#999]'
                                }`}>
                                    {r.status === 'approved' ? <Check size={11} /> : <Clock size={11} />} {r.status} · {fmt(r.decided_at)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
