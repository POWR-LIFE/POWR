import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { Lock, CalendarClock, Users, Globe, X, Bell, BellOff } from 'lucide-react';

const logAction = async (adminId, action, targetType, targetId, metadata = {}) => {
    await supabase.from('admin_audit_log').insert({ admin_id: adminId, action, target_type: targetType, target_id: targetId, metadata });
};

const fmtDateTime = (iso) => new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/**
 * Vault control room: economy snapshot + scheduled unlock events.
 *
 * An unlock event makes the targeted users' pending deposits READY at the
 * chosen moment (they still press-and-hold to claim; the grace-window cron
 * eventually pays out non-claimers). Targets: all users, or specific email
 * addresses. Events fire on the vault cron tick — within 15 minutes of the
 * chosen time.
 */
export default function VaultManager() {
    const toast = useToast();
    const { user } = useAuth();

    const [stats, setStats] = useState(null);
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);

    // Schedule form
    const [unlockAt, setUnlockAt] = useState('');
    const [target, setTarget] = useState('all'); // 'all' | 'users'
    const [emails, setEmails] = useState('');
    const [note, setNote] = useState('');
    const [notify, setNotify] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [cancelling, setCancelling] = useState(null);

    useEffect(() => { fetchAll(); }, []);

    const fetchAll = async () => {
        setLoading(true);
        try {
            const nowIso = new Date().toISOString();
            const [depositsRes, eventsRes] = await Promise.all([
                supabase.from('vault_deposits').select('user_id, amount, vests_at, released_at'),
                supabase.from('vault_unlock_events').select('*').order('unlock_at', { ascending: false }).limit(50),
            ]);
            if (depositsRes.error) throw depositsRes.error;
            if (eventsRes.error) throw eventsRes.error;

            const pending = (depositsRes.data || []).filter(d => !d.released_at);
            const ready = pending.filter(d => d.vests_at <= nowIso);
            setStats({
                vestingPoints: pending.reduce((s, d) => s + d.amount, 0),
                vestingUsers: new Set(pending.map(d => d.user_id)).size,
                readyPoints: ready.reduce((s, d) => s + d.amount, 0),
                readyUsers: new Set(ready.map(d => d.user_id)).size,
            });
            setEvents(eventsRes.data || []);
        } catch (e) {
            toast.error('Failed to load vault data');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSchedule = async () => {
        if (!unlockAt) { toast.error('Pick an unlock date & time'); return; }
        const emailList = target === 'users'
            ? emails.split(/[\n,;]+/).map(e => e.trim()).filter(Boolean)
            : null;
        if (target === 'users' && (!emailList || emailList.length === 0)) {
            toast.error('Add at least one email, or target all users');
            return;
        }
        setSubmitting(true);
        try {
            const { data, error } = await supabase.rpc('admin_schedule_vault_unlock', {
                p_unlock_at: new Date(unlockAt).toISOString(),
                p_emails: emailList,
                p_note: note || null,
                p_notify: notify,
            });
            if (error) throw error;
            const missing = data?.missing_emails || [];
            if (missing.length > 0) {
                toast.error(`Scheduled, but ${missing.length} email(s) not found: ${missing.join(', ')}`);
            } else {
                toast.success(data?.target === 'all'
                    ? 'Unlock scheduled for all users'
                    : `Unlock scheduled for ${data?.resolved_users} user(s)`);
            }
            await logAction(user.id, 'vault_unlock_scheduled', 'vault_unlock_events', data?.id, {
                unlock_at: unlockAt, target, emails: emailList, note, notify,
            });
            setUnlockAt(''); setEmails(''); setNote('');
            fetchAll();
        } catch (e) {
            toast.error(e.message || 'Failed to schedule unlock');
        } finally {
            setSubmitting(false);
        }
    };

    const handleCancel = async (ev) => {
        setCancelling(ev.id);
        try {
            const { data, error } = await supabase.rpc('admin_cancel_vault_unlock', { p_event_id: ev.id });
            if (error) throw error;
            if (data) {
                toast.success('Unlock cancelled');
                await logAction(user.id, 'vault_unlock_cancelled', 'vault_unlock_events', ev.id, { unlock_at: ev.unlock_at });
            } else {
                toast.error('Already fired — cannot cancel');
            }
            fetchAll();
        } catch (e) {
            toast.error(e.message || 'Failed to cancel');
        } finally {
            setCancelling(null);
        }
    };

    const statCards = stats ? [
        { label: 'POWR Vesting', value: stats.vestingPoints.toLocaleString(), sub: `${stats.vestingUsers} users` },
        { label: 'Ready To Unlock', value: stats.readyPoints.toLocaleString(), sub: `${stats.readyUsers} users` },
    ] : [];

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <div className="mb-20">
                <div className="flex items-center gap-3 mb-6">
                    <div className="h-[1px] w-12 bg-[#E8D200]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Subsystem / Economy</span>
                </div>
                <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-6">Vault</h1>
                <p className="text-[#666666] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                    Scheduled unlock events. Deposits become claimable — users still press &amp; hold. Fires within 15 minutes of the chosen time.
                </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-6 mb-12 max-w-xl">
                {statCards.map(c => (
                    <div key={c.label} className="bg-white border border-[#E6E6E1] rounded-3xl p-8">
                        <div className="text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-3">{c.label}</div>
                        <div className="text-4xl font-light tracking-tight text-[#1A1A1A]">{c.value}</div>
                        <div className="text-[10px] text-[#8a7600] font-black uppercase tracking-[0.3em] mt-2">{c.sub}</div>
                    </div>
                ))}
            </div>

            {/* Schedule */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-10 mb-12">
                <div className="flex items-center gap-4 mb-8">
                    <div className="w-12 h-12 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center">
                        <CalendarClock size={18} className="text-[#8a7600]" />
                    </div>
                    <div>
                        <div className="text-base font-bold text-[#222222]">Schedule an unlock</div>
                        <div className="text-[10px] text-[#666666] font-black uppercase tracking-[0.3em]">Event day, promo, apology — vaults open on your date</div>
                    </div>
                </div>

                <div className="grid lg:grid-cols-2 gap-8">
                    <div className="space-y-6">
                        <div>
                            <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Unlock at</label>
                            <input
                                type="datetime-local"
                                value={unlockAt}
                                onChange={e => setUnlockAt(e.target.value)}
                                className="w-full h-12 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl font-mono text-sm text-[#1A1A1A] outline-none focus:border-[#E8D200]/60 transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Target</label>
                            <div className="flex gap-3">
                                <button type="button" onClick={() => setTarget('all')}
                                    className={`flex-1 h-12 rounded-xl border flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] transition-all ${target === 'all' ? 'border-[#E8D200] bg-[#E8D200]/10 text-[#1A1A1A]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#888888]'}`}>
                                    <Globe size={13} /> All users
                                </button>
                                <button type="button" onClick={() => setTarget('users')}
                                    className={`flex-1 h-12 rounded-xl border flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] transition-all ${target === 'users' ? 'border-[#E8D200] bg-[#E8D200]/10 text-[#1A1A1A]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#888888]'}`}>
                                    <Users size={13} /> Specific users
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Notify users</label>
                            <button type="button" onClick={() => setNotify(!notify)}
                                className={`h-12 px-5 rounded-xl border flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] transition-all ${notify ? 'border-[#10B981]/40 bg-[#10B981]/10 text-[#10B981]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#888888]'}`}>
                                {notify ? <Bell size={13} /> : <BellOff size={13} />}
                                {notify ? '"Vault ready" push on fire' : 'Silent — no push'}
                            </button>
                        </div>
                    </div>
                    <div className="space-y-6">
                        {target === 'users' && (
                            <div>
                                <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">User emails (comma or newline separated)</label>
                                <textarea
                                    value={emails}
                                    onChange={e => setEmails(e.target.value)}
                                    rows={4}
                                    placeholder={'user1@example.com\nuser2@example.com'}
                                    className="w-full px-4 py-3 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl font-mono text-xs text-[#1A1A1A] outline-none focus:border-[#E8D200]/60 transition-all resize-none"
                                />
                            </div>
                        )}
                        <div>
                            <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Note (internal)</label>
                            <input
                                type="text"
                                value={note}
                                onChange={e => setNote(e.target.value)}
                                placeholder="Summer launch event"
                                className="w-full h-12 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm text-[#1A1A1A] outline-none focus:border-[#E8D200]/60 transition-all"
                            />
                        </div>
                        <button
                            onClick={handleSchedule}
                            disabled={submitting}
                            className="w-full h-12 rounded-xl bg-[#1A1A1A] text-white text-[10px] font-black uppercase tracking-[0.3em] hover:bg-[#333333] transition-all disabled:opacity-50"
                        >
                            {submitting ? 'Scheduling…' : 'Schedule unlock'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Events */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-6">
                        <div className="w-12 h-12 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Loading Vault…</span>
                    </div>
                ) : events.length === 0 ? (
                    <div className="p-20 text-center">
                        <Lock size={48} className="mx-auto text-[#333333] mb-6" />
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black">No unlock events yet</p>
                    </div>
                ) : (
                    <div className="divide-y divide-[#E6E6E1]">
                        {events.map(ev => {
                            const applied = !!ev.applied_at;
                            return (
                                <div key={ev.id} className="flex items-center gap-8 p-8 hover:bg-[#F4F4F1] transition-all">
                                    <div className="w-12 h-12 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center shrink-0">
                                        {ev.target === 'all' ? <Globe size={16} className="text-[#8a7600]" /> : <Users size={16} className="text-[#8a7600]" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-bold text-[#222222]">
                                            {fmtDateTime(ev.unlock_at)}
                                            <span className="ml-3 text-[10px] font-black uppercase tracking-[0.2em] text-[#888888]">
                                                {ev.target === 'all' ? 'All users' : `${(ev.user_ids || []).length} user(s)`}
                                            </span>
                                            {!ev.notify && <span className="ml-3 text-[9px] font-black uppercase tracking-[0.2em] text-[#BBBBBB]">Silent</span>}
                                        </div>
                                        <div className="text-[10px] text-[#666666] font-black uppercase tracking-[0.3em] mt-1">
                                            {ev.note || 'No note'}
                                            {applied && ` · Fired — ${ev.affected_users ?? 0} users / ${(ev.affected_points ?? 0).toLocaleString()} pts made ready`}
                                        </div>
                                    </div>
                                    <div className="shrink-0 flex items-center gap-4">
                                        <span className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.2em] border ${applied ? 'border-[#10B981]/30 bg-[#10B981]/10 text-[#10B981]' : 'border-[#E8D200]/40 bg-[#E8D200]/10 text-[#8a7600]'}`}>
                                            {applied ? 'Fired' : 'Scheduled'}
                                        </span>
                                        {!applied && (
                                            <button
                                                onClick={() => handleCancel(ev)}
                                                disabled={cancelling === ev.id}
                                                className="w-10 h-10 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#888888] hover:text-[#F43F5E] hover:border-[#F43F5E]/30 transition-all disabled:opacity-50"
                                                aria-label="Cancel unlock"
                                            >
                                                <X size={14} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="mt-8 px-4">
                <p className="text-[9px] uppercase tracking-[0.5em] text-[#888888] font-black">
                    Unlocks make deposits claimable — they never credit balances directly. All actions are audit-logged.
                </p>
            </div>
        </div>
    );
}
