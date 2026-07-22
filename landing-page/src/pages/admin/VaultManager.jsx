import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { Lock, CalendarClock, Users, Globe, X, Bell, BellOff, Gift, Eye } from 'lucide-react';

const logAction = async (adminId, action, targetType, targetId, metadata = {}) => {
    await supabase.from('admin_audit_log').insert({ admin_id: adminId, action, target_type: targetType, target_id: targetId, metadata });
};

const TIER_LEVELS = {
    RECRUIT: [1, 2, 3, 4, 5],
    ATHLETE: [6, 7, 8, 9, 10],
    ELITE: [11, 12, 13, 14, 15],
    LEGEND: [16, 17, 18, 19, 20],
};
const ACTIVITY_OPTIONS = ['walking', 'running', 'cycling', 'swimming', 'gym', 'hiit', 'sports', 'yoga', 'dance', 'sleep'];

const fmtDateTime = (iso) => new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

// datetime-local speaks naive local time; the stored value is UTC ISO.
const toLocalInput = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

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

    // Schedule form — same targeting vocabulary as the grant form below.
    const [unlockAt, setUnlockAt] = useState('');
    const [target, setTarget] = useState('all'); // 'all' | 'emails' | 'levels' | 'activities'
    const [emails, setEmails] = useState('');
    const [unlockTiers, setUnlockTiers] = useState([]);
    const [unlockExactLevels, setUnlockExactLevels] = useState('');
    const [unlockActivities, setUnlockActivities] = useState([]);
    const [note, setNote] = useState('');
    const [notify, setNotify] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [cancelling, setCancelling] = useState(null);

    // Rollout — who can SEE the Vault (surface only; POWR banks regardless).
    const [rollout, setRollout] = useState(null);
    const [rolloutMode, setRolloutMode] = useState('none');
    const [rolloutEmails, setRolloutEmails] = useState('');
    const [rolloutTiers, setRolloutTiers] = useState([]);
    const [rolloutExactLevels, setRolloutExactLevels] = useState('');
    const [rolloutActivities, setRolloutActivities] = useState([]);
    const [savingRollout, setSavingRollout] = useState(false);

    // Scheduled launch (vault_launch_at) — the moment 'targeted' opens to
    // everyone. Users outside the rollout see the app counting down to it.
    const [liveLaunchAt, setLiveLaunchAt] = useState(null);
    const [launchAtLocal, setLaunchAtLocal] = useState('');
    const [savingLaunch, setSavingLaunch] = useState(false);

    // Grant form
    const [grantTarget, setGrantTarget] = useState('emails'); // 'emails' | 'all' | 'levels' | 'activities'
    const [grantTiers, setGrantTiers] = useState([]);
    const [grantExactLevels, setGrantExactLevels] = useState('');
    const [grantActivities, setGrantActivities] = useState([]);
    const [grantEmails, setGrantEmails] = useState('');
    const [grantAmount, setGrantAmount] = useState('');
    const [grantVestDays, setGrantVestDays] = useState('');
    const [grantNote, setGrantNote] = useState('');
    const [grantNotify, setGrantNotify] = useState(true);
    const [granting, setGranting] = useState(false);

    useEffect(() => { fetchAll(); }, []);

    const fetchAll = async () => {
        setLoading(true);
        try {
            // ⚠ Stats come from an RPC, NOT from selecting every deposit and
            // reducing in the browser. PostgREST caps an unbounded select at
            // 1000 rows, so the old client-side version would have started
            // under-reporting the moment the table outgrew that — silently,
            // with the cards still looking perfectly plausible.
            const [statsRes, eventsRes, rolloutRes] = await Promise.all([
                supabase.rpc('admin_vault_stats'),
                supabase.from('vault_unlock_events').select('*').order('unlock_at', { ascending: false }).limit(50),
                supabase.rpc('admin_get_vault_rollout'),
            ]);
            if (statsRes.error) throw statsRes.error;
            if (eventsRes.error) throw eventsRes.error;

            // Seed the editor from what is live, so an admin edits the current
            // cohort rather than silently replacing it with an empty form.
            if (!rolloutRes.error && rolloutRes.data) {
                const r = rolloutRes.data;
                setRollout(r);
                setRolloutMode(r.mode || 'none');
                setRolloutEmails((r.emails || []).join('\n'));
                setRolloutActivities(r.activities || []);
                setRolloutExactLevels((r.levels || []).join(', '));
                setRolloutTiers([]);
                setLiveLaunchAt(r.launch_at || null);
                setLaunchAtLocal(r.launch_at ? toLocalInput(r.launch_at) : '');
            }

            const s = statsRes.data || {};
            setStats({
                vestingPoints: s.vesting_points || 0,
                vestingUsers: s.vesting_users || 0,
                readyPoints: s.ready_points || 0,
                readyUsers: s.ready_users || 0,
                hiddenPoints: s.hidden_points || 0,
                hiddenUsers: s.hidden_users || 0,
            });
            setEvents(eventsRes.data || []);
        } catch (e) {
            toast.error('Failed to load vault data');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveRollout = async () => {
        const params = { p_mode: rolloutMode };
        if (rolloutMode === 'targeted') {
            const emailList = rolloutEmails.split(/[\n,;]+/).map(e => e.trim()).filter(Boolean);
            const levels = new Set(rolloutTiers.flatMap(t => TIER_LEVELS[t]));
            rolloutExactLevels.split(/[\s,;]+/).map(x => parseInt(x, 10))
                .filter(n => Number.isFinite(n) && n >= 1 && n <= 20)
                .forEach(n => levels.add(n));
            if (emailList.length === 0 && levels.size === 0 && rolloutActivities.length === 0) {
                toast.error('Targeted rollout needs at least one email, level or activity');
                return;
            }
            params.p_emails = emailList;
            params.p_levels = [...levels];
            params.p_activities = rolloutActivities;
        }
        setSavingRollout(true);
        try {
            const { data, error } = await supabase.rpc('admin_set_vault_rollout', params);
            if (error) throw error;
            const missing = data?.missing_emails || [];
            if (missing.length > 0) {
                toast.error(`Saved, but ${missing.length} email(s) not found: ${missing.join(', ')}`);
            } else {
                toast.success(
                    rolloutMode === 'all' ? 'Vault visible to all users'
                    : rolloutMode === 'none' ? 'Vault hidden from everyone'
                    : `Vault visible to ${data?.resolved_users || 0} named user(s) + cohort rules`
                );
            }
            await logAction(user.id, 'vault_rollout_set', 'system_config', null, { mode: rolloutMode, params });
            fetchAll();
        } catch (e) {
            toast.error(e.message || 'Failed to save rollout');
        } finally {
            setSavingRollout(false);
        }
    };

    const handleSaveLaunch = async () => {
        if (!launchAtLocal) { toast.error('Pick a launch date & time'); return; }
        const iso = new Date(launchAtLocal).toISOString();
        setSavingLaunch(true);
        try {
            const { error } = await supabase.rpc('admin_set_vault_launch', { p_launch_at: iso });
            if (error) throw error;
            toast.success(new Date(iso) <= new Date()
                ? 'Launch date is in the past — the Vault is open to everyone now'
                : `Launch set — every Vault opens ${fmtDateTime(iso)}`);
            await logAction(user.id, 'vault_launch_set', 'system_config', null, { launch_at: iso });
            fetchAll();
        } catch (e) {
            toast.error(e.message || 'Failed to set launch');
        } finally {
            setSavingLaunch(false);
        }
    };

    const handleClearLaunch = async () => {
        setSavingLaunch(true);
        try {
            const { error } = await supabase.rpc('admin_set_vault_launch', { p_launch_at: null });
            if (error) throw error;
            toast.success('Launch cleared — no countdown shown in the app');
            await logAction(user.id, 'vault_launch_cleared', 'system_config', null, { was: liveLaunchAt });
            fetchAll();
        } catch (e) {
            toast.error(e.message || 'Failed to clear launch');
        } finally {
            setSavingLaunch(false);
        }
    };

    const handleSchedule = async () => {
        if (!unlockAt) { toast.error('Pick an unlock date & time'); return; }

        const params = {
            p_unlock_at: new Date(unlockAt).toISOString(),
            p_note: note || null,
            p_notify: notify,
        };
        if (target === 'all') {
            params.p_all = true;
        } else if (target === 'emails') {
            const emailList = emails.split(/[\n,;]+/).map(e => e.trim()).filter(Boolean);
            if (emailList.length === 0) { toast.error('Add at least one email'); return; }
            params.p_emails = emailList;
        } else if (target === 'levels') {
            const levels = new Set(unlockTiers.flatMap(t => TIER_LEVELS[t]));
            unlockExactLevels.split(/[\s,;]+/).map(x => parseInt(x, 10))
                .filter(n => Number.isFinite(n) && n >= 1 && n <= 20)
                .forEach(n => levels.add(n));
            if (levels.size === 0) { toast.error('Pick at least one tier or level'); return; }
            params.p_levels = [...levels];
        } else if (target === 'activities') {
            if (unlockActivities.length === 0) { toast.error('Pick at least one activity'); return; }
            params.p_activities = unlockActivities;
        }

        setSubmitting(true);
        try {
            const { data, error } = await supabase.rpc('admin_schedule_vault_unlock', params);
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
                unlock_at: unlockAt, target, params, note, notify, resolved: data?.resolved_users,
            });
            setUnlockAt(''); setEmails(''); setNote('');
            setUnlockTiers([]); setUnlockExactLevels(''); setUnlockActivities([]);
            fetchAll();
        } catch (e) {
            toast.error(e.message || 'Failed to schedule unlock');
        } finally {
            setSubmitting(false);
        }
    };

    const handleGrant = async () => {
        const amount = parseInt(grantAmount, 10);
        if (!Number.isFinite(amount) || amount < 1) { toast.error('Enter a valid amount'); return; }
        // Strict digits only. `parseInt || 0` silently turned junk ("7x", "-3",
        // "abc") into 0 — and 0 is not a safe default here, it means READY
        // INSTANTLY. A typo must be an error, not an immediate payout.
        const rawVest = grantVestDays.trim();
        if (rawVest !== '' && !/^\d+$/.test(rawVest)) {
            toast.error('Vest days must be a whole number — 0 releases instantly, blank uses the default');
            return;
        }
        const vestDays = rawVest === '' ? null : parseInt(rawVest, 10);

        const params = {
            p_amount: amount, p_note: grantNote || null, p_vest_days: vestDays, p_notify: grantNotify,
        };
        if (grantTarget === 'all') {
            params.p_all = true;
        } else if (grantTarget === 'emails') {
            const emailList = grantEmails.split(/[\n,;]+/).map(e => e.trim()).filter(Boolean);
            if (emailList.length === 0) { toast.error('Add at least one email'); return; }
            params.p_emails = emailList;
        } else if (grantTarget === 'levels') {
            const levels = new Set(grantTiers.flatMap(t => TIER_LEVELS[t]));
            grantExactLevels.split(/[\s,;]+/).map(x => parseInt(x, 10))
                .filter(n => Number.isFinite(n) && n >= 1 && n <= 20)
                .forEach(n => levels.add(n));
            if (levels.size === 0) { toast.error('Pick at least one tier or level'); return; }
            params.p_levels = [...levels];
        } else if (grantTarget === 'activities') {
            if (grantActivities.length === 0) { toast.error('Pick at least one activity'); return; }
            params.p_activities = grantActivities;
        }

        setGranting(true);
        try {
            const { data, error } = await supabase.rpc('admin_grant_vault_deposit', params);
            if (error) throw error;
            const missing = data?.missing_emails || [];
            // ⚠ "push sent" is NOT the same as "granted". notify-vault-grant
            // routes every push through send-push-notification, which drops
            // vault_* for anyone outside the rollout — so during a staged
            // rollout the real delivery count is a fraction of the grant. The
            // toast used to claim a push for all of them. Say what is actually
            // knowable here: the grant landed for everyone, the push only
            // reaches the people who can see a Vault.
            // The kill-switch outranks the rollout: while vault_granted is
            // disabled in admin → Notifications (the pre-launch hold),
            // send-push drops every grant push before tokens or feed writes.
            const { data: notifCfg } = await supabase
                .from('notification_config').select('enabled').eq('type', 'vault_granted').maybeSingle();
            const pushNote = !grantNotify
                ? ''
                : notifCfg?.enabled === false
                    ? ' · push HELD (vault_granted is disabled in Notifications)'
                    : rollout?.mode === 'all'
                        ? ' · push sent'
                        : rollout?.mode === 'none'
                            ? ' · no push (Vault hidden from everyone)'
                            : ' · push only to users in the rollout';
            if (missing.length > 0) {
                toast.error(`Granted to ${data?.granted_users}, but ${missing.length} email(s) not found: ${missing.join(', ')}`);
            } else {
                toast.success(`+${amount} POWR banked for ${data?.granted_users} user(s) · vests in ${data?.vest_days} day(s)${pushNote}`);
            }
            await logAction(user.id, 'vault_grant', 'vault_deposits', null, {
                amount, target: grantTarget, params, granted: data?.granted_users, vest_days: data?.vest_days,
                note: grantNote, notify: grantNotify, batch_id: data?.batch_id,
            });
            setGrantEmails(''); setGrantAmount(''); setGrantVestDays(''); setGrantNote('');
            setGrantTiers([]); setGrantExactLevels(''); setGrantActivities([]);
            fetchAll();
        } catch (e) {
            toast.error(e.message || 'Failed to grant');
        } finally {
            setGranting(false);
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
        // The size of the launch-day handover: POWR already banked for people
        // who cannot see their Vault yet. Switching them on hands them this.
        { label: 'Banked, Not Yet Visible', value: stats.hiddenPoints.toLocaleString(), sub: `${stats.hiddenUsers} users outside rollout` },
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

            {/* Rollout — first on the page: who can see the Vault frames every
                other control below it. */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-10 mb-12">
                <div className="flex items-center gap-4 mb-8">
                    <div className="w-12 h-12 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center">
                        <Eye size={18} className="text-[#8a7600]" />
                    </div>
                    <div>
                        <div className="text-base font-bold text-[#222222]">Rollout</div>
                        <div className="text-[10px] text-[#666666] font-black uppercase tracking-[0.3em]">Who can see the Vault</div>
                    </div>
                    {rollout && (
                        <div className="ml-auto px-4 py-2 rounded-full bg-[#F4F4F1] border border-[#E6E6E1]">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#555555]">
                                Live: {rollout.mode === 'all' ? 'Everyone'
                                     : rollout.mode === 'none' ? 'Nobody'
                                     : `${(rollout.emails || []).length} named${(rollout.levels || []).length ? ` + ${(rollout.levels || []).length} level(s)` : ''}${(rollout.activities || []).length ? ` + ${(rollout.activities || []).length} activity` : ''}`}
                            </span>
                        </div>
                    )}
                </div>

                {/* The property that makes staged rollout safe, stated where the
                    decision is made — not buried in a migration comment. */}
                <div className="px-4 py-3 mb-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl">
                    <p className="text-[11px] text-[#666666] leading-relaxed">
                        Surface only. POWR keeps banking for <strong>everyone</strong>, including users who
                        can&apos;t see the Vault — switch someone on later and they get everything
                        they already accrued. Nobody loses POWR by being added late.
                    </p>
                </div>

                <div className="grid lg:grid-cols-2 gap-8">
                    <div className="space-y-6">
                        <div>
                            <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Visible to</label>
                            <div className="grid grid-cols-3 gap-2">
                                {[['none', 'Nobody'], ['targeted', 'Selected'], ['all', 'Everyone']].map(([id, label]) => (
                                    <button key={id} type="button" onClick={() => setRolloutMode(id)}
                                        className={`h-11 rounded-xl border text-[9px] font-black uppercase tracking-[0.15em] transition-all ${rolloutMode === id ? 'border-[#E8D200] bg-[#E8D200]/10 text-[#1A1A1A]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#888888]'}`}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {rolloutMode === 'targeted' && (
                            <>
                                <div>
                                    <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Tiers</label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {Object.keys(TIER_LEVELS).map(tier => (
                                            <button key={tier} type="button"
                                                onClick={() => setRolloutTiers(prev => prev.includes(tier) ? prev.filter(t => t !== tier) : [...prev, tier])}
                                                className={`h-11 rounded-xl border text-[9px] font-black uppercase tracking-[0.15em] transition-all ${rolloutTiers.includes(tier) ? 'border-[#E8D200] bg-[#E8D200]/10 text-[#1A1A1A]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#888888]'}`}>
                                                {tier}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Or exact levels</label>
                                    <input type="text" value={rolloutExactLevels} onChange={e => setRolloutExactLevels(e.target.value)} placeholder="7, 12"
                                        className="w-full h-11 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl font-mono text-xs text-[#1A1A1A] outline-none focus:border-[#E8D200]/60 transition-all" />
                                    {/* Unlike grants and unlock events, cohort rules here are LIVE —
                                        worth saying, because the difference is invisible otherwise. */}
                                    <p className="text-[10px] text-[#888888] mt-2 leading-relaxed">
                                        Evaluated live — a user reaching one of these levels later is let in automatically.
                                    </p>
                                </div>
                            </>
                        )}
                        {rolloutMode === 'all' && (
                            <div className="px-4 py-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl">
                                <p className="text-[10px] text-[#666666] font-black uppercase tracking-[0.3em]">Full launch — every user sees the Vault.</p>
                            </div>
                        )}
                        {rolloutMode === 'none' && (
                            <div className="px-4 py-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl">
                                <p className="text-[10px] text-[#666666] font-black uppercase tracking-[0.3em]">Hidden from everyone. POWR still banks in the background.</p>
                            </div>
                        )}
                    </div>
                    <div className="space-y-6">
                        {rolloutMode === 'targeted' && (
                            <>
                                <div>
                                    <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Named users (comma or newline separated)</label>
                                    <textarea
                                        value={rolloutEmails}
                                        onChange={e => setRolloutEmails(e.target.value)}
                                        rows={4}
                                        placeholder={'tester@example.com'}
                                        className="w-full px-4 py-3 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl font-mono text-xs text-[#1A1A1A] outline-none focus:border-[#E8D200]/60 transition-all resize-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Preferred activities (any match)</label>
                                    <div className="flex flex-wrap gap-2">
                                        {ACTIVITY_OPTIONS.map(a => (
                                            <button key={a} type="button"
                                                onClick={() => setRolloutActivities(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a])}
                                                className={`h-9 px-4 rounded-full border text-[9px] font-black uppercase tracking-[0.15em] transition-all ${rolloutActivities.includes(a) ? 'border-[#E8D200] bg-[#E8D200]/10 text-[#1A1A1A]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#888888]'}`}>
                                                {a}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                        <button
                            onClick={handleSaveRollout}
                            disabled={savingRollout}
                            className="w-full h-12 rounded-xl bg-[#1A1A1A] text-white text-[10px] font-black uppercase tracking-[0.3em] hover:bg-[#333333] transition-all disabled:opacity-50"
                        >
                            {savingRollout ? 'Saving…' : 'Save rollout'}
                        </button>
                    </div>
                </div>

                {/* Scheduled launch — the countdown users outside the rollout
                    see. Lives inside the rollout card because it is the
                    rollout's end-date: when it passes, vault_has_access
                    answers true for everyone with no admin at the switch. */}
                <div className="mt-10 pt-8 border-t border-[#E6E6E1]">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="w-12 h-12 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center">
                            <CalendarClock size={18} className="text-[#8a7600]" />
                        </div>
                        <div>
                            <div className="text-base font-bold text-[#222222]">Scheduled launch</div>
                            <div className="text-[10px] text-[#666666] font-black uppercase tracking-[0.3em]">When every Vault opens — users see this counting down</div>
                        </div>
                        {liveLaunchAt && (
                            <div className={`ml-auto px-4 py-2 rounded-full border ${new Date(liveLaunchAt) <= new Date() ? 'bg-[#10B981]/10 border-[#10B981]/30' : 'bg-[#F4F4F1] border-[#E6E6E1]'}`}>
                                <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${new Date(liveLaunchAt) <= new Date() ? 'text-[#10B981]' : 'text-[#555555]'}`}>
                                    {new Date(liveLaunchAt) <= new Date() ? `Launched ${fmtDateTime(liveLaunchAt)}` : `Opens ${fmtDateTime(liveLaunchAt)}`}
                                </span>
                            </div>
                        )}
                    </div>

                    <div className="px-4 py-3 mb-6 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl">
                        <p className="text-[11px] text-[#666666] leading-relaxed">
                            Users the rollout hasn&apos;t reached see a <strong>coming soon</strong> Vault counting
                            down to this moment — their already-banked POWR behind the sealed door. When it
                            passes, every user&apos;s Vault opens automatically; no switch to flip. Flipping the
                            rollout to &ldquo;Everyone&rdquo; afterwards is optional hygiene.
                        </p>
                    </div>

                    {rolloutMode === 'none' && liveLaunchAt && (
                        <div className="px-4 py-3 mb-6 bg-[#F43F5E]/5 border border-[#F43F5E]/30 rounded-xl">
                            <p className="text-[11px] text-[#B91C1C] leading-relaxed font-bold">
                                Rollout is set to Nobody, but a launch date is live: the app keeps counting down,
                                and &ldquo;Nobody&rdquo; keeps the doors held shut past it. If the launch is off,
                                clear the date too — a countdown that ends on a closed door is the worst outcome.
                            </p>
                        </div>
                    )}

                    <div className="grid lg:grid-cols-2 gap-8 items-end">
                        <div>
                            <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Opens at (your local time)</label>
                            <input
                                type="datetime-local"
                                value={launchAtLocal}
                                onChange={e => setLaunchAtLocal(e.target.value)}
                                className="w-full h-12 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl font-mono text-sm text-[#1A1A1A] outline-none focus:border-[#E8D200]/60 transition-all"
                            />
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={handleSaveLaunch}
                                disabled={savingLaunch}
                                className="flex-1 h-12 rounded-xl bg-[#1A1A1A] text-white text-[10px] font-black uppercase tracking-[0.3em] hover:bg-[#333333] transition-all disabled:opacity-50"
                            >
                                {savingLaunch ? 'Saving…' : liveLaunchAt ? 'Update launch' : 'Set launch'}
                            </button>
                            {liveLaunchAt && (
                                <button
                                    onClick={handleClearLaunch}
                                    disabled={savingLaunch}
                                    className="h-12 px-6 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] text-[#888888] text-[10px] font-black uppercase tracking-[0.3em] hover:text-[#F43F5E] hover:border-[#F43F5E]/30 transition-all disabled:opacity-50"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 max-w-4xl">
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
                            <div className="grid grid-cols-4 gap-2">
                                {[['emails', 'Emails'], ['all', 'All users'], ['levels', 'Levels'], ['activities', 'Activities']].map(([id, label]) => (
                                    <button key={id} type="button" onClick={() => setTarget(id)}
                                        className={`h-11 rounded-xl border text-[9px] font-black uppercase tracking-[0.15em] transition-all ${target === id ? 'border-[#E8D200] bg-[#E8D200]/10 text-[#1A1A1A]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#888888]'}`}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {/* Levels and activities resolve to a fixed user list AT SCHEDULE
                            TIME, not when the event fires — see the migration. Say so:
                            "level 5" reads like a live rule, and an admin who assumes it
                            keeps matching would be surprised by who does not get it. */}
                        {(target === 'levels' || target === 'activities') && (
                            <div className="px-4 py-3 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl">
                                <p className="text-[10px] text-[#666666] font-black uppercase tracking-[0.25em] leading-relaxed">
                                    Matched now, locked in — users who qualify later are not added.
                                </p>
                            </div>
                        )}
                        <div>
                            <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Notify users</label>
                            <button type="button" onClick={() => setNotify(!notify)}
                                className={`h-12 px-5 rounded-xl border flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] transition-all ${notify ? 'border-[#10B981]/40 bg-[#10B981]/10 text-[#10B981]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#888888]'}`}>
                                {notify ? <Bell size={13} /> : <BellOff size={13} />}
                                {notify ? 'Announced in-app + push on fire' : 'Silent — surprise drop'}
                            </button>
                            {/* notify is not just "send a push": get_my_vault_outlook only
                                reveals announceable events, so this switch also decides
                                whether users see it coming in the app. */}
                            <p className="text-[10px] text-[#888888] mt-2 leading-relaxed">
                                {notify
                                    ? 'Users see the date counting down in their Vault, then get a push when it opens.'
                                    : 'Nothing shown in-app beforehand — their Vault simply opens on the day.'}
                            </p>
                        </div>
                    </div>
                    <div className="space-y-6">
                        {target === 'emails' && (
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
                        {target === 'all' && (
                            <div className="px-4 py-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl">
                                <p className="text-[10px] text-[#666666] font-black uppercase tracking-[0.3em]">Every vault opens — including users who join before the date.</p>
                            </div>
                        )}
                        {target === 'levels' && (
                            <>
                                <div>
                                    <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Tiers</label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {Object.keys(TIER_LEVELS).map(tier => (
                                            <button key={tier} type="button"
                                                onClick={() => setUnlockTiers(prev => prev.includes(tier) ? prev.filter(t => t !== tier) : [...prev, tier])}
                                                className={`h-11 rounded-xl border text-[9px] font-black uppercase tracking-[0.15em] transition-all ${unlockTiers.includes(tier) ? 'border-[#E8D200] bg-[#E8D200]/10 text-[#1A1A1A]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#888888]'}`}>
                                                {tier}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Or exact levels (e.g. 7, 12)</label>
                                    <input type="text" value={unlockExactLevels} onChange={e => setUnlockExactLevels(e.target.value)} placeholder="7, 12"
                                        className="w-full h-11 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl font-mono text-xs text-[#1A1A1A] outline-none focus:border-[#E8D200]/60 transition-all" />
                                </div>
                            </>
                        )}
                        {target === 'activities' && (
                            <div>
                                <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Preferred activities (any match)</label>
                                <div className="flex flex-wrap gap-2">
                                    {ACTIVITY_OPTIONS.map(a => (
                                        <button key={a} type="button"
                                            onClick={() => setUnlockActivities(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a])}
                                            className={`h-9 px-4 rounded-full border text-[9px] font-black uppercase tracking-[0.15em] transition-all ${unlockActivities.includes(a) ? 'border-[#E8D200] bg-[#E8D200]/10 text-[#1A1A1A]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#888888]'}`}>
                                            {a}
                                        </button>
                                    ))}
                                </div>
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

            {/* Grant */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-10 mb-12">
                <div className="flex items-center gap-4 mb-8">
                    <div className="w-12 h-12 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center">
                        <Gift size={18} className="text-[#8a7600]" />
                    </div>
                    <div>
                        <div className="text-base font-bold text-[#222222]">Grant a deposit</div>
                        <div className="text-[10px] text-[#666666] font-black uppercase tracking-[0.3em]">Bank bonus POWR into vaults — vests like any deposit. 0 days = ready immediately</div>
                    </div>
                </div>
                <div className="grid lg:grid-cols-2 gap-8">
                    <div className="space-y-5">
                        <div>
                            <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Target</label>
                            <div className="grid grid-cols-4 gap-2">
                                {[['emails', 'Emails'], ['all', 'All users'], ['levels', 'Levels'], ['activities', 'Activities']].map(([id, label]) => (
                                    <button key={id} type="button" onClick={() => setGrantTarget(id)}
                                        className={`h-11 rounded-xl border text-[9px] font-black uppercase tracking-[0.15em] transition-all ${grantTarget === id ? 'border-[#E8D200] bg-[#E8D200]/10 text-[#1A1A1A]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#888888]'}`}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {grantTarget === 'emails' && (
                            <div>
                                <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">User emails (comma or newline separated)</label>
                                <textarea
                                    value={grantEmails}
                                    onChange={e => setGrantEmails(e.target.value)}
                                    rows={4}
                                    placeholder={'user1@example.com\nuser2@example.com'}
                                    className="w-full px-4 py-3 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl font-mono text-xs text-[#1A1A1A] outline-none focus:border-[#E8D200]/60 transition-all resize-none"
                                />
                            </div>
                        )}
                        {grantTarget === 'all' && (
                            <div className="px-4 py-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl">
                                <p className="text-[10px] text-[#666666] font-black uppercase tracking-[0.3em]">Every user gets the deposit — check the total before you fire.</p>
                            </div>
                        )}
                        {grantTarget === 'levels' && (
                            <>
                                <div>
                                    <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Tiers</label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {Object.keys(TIER_LEVELS).map(tier => (
                                            <button key={tier} type="button"
                                                onClick={() => setGrantTiers(prev => prev.includes(tier) ? prev.filter(t => t !== tier) : [...prev, tier])}
                                                className={`h-11 rounded-xl border text-[9px] font-black uppercase tracking-[0.15em] transition-all ${grantTiers.includes(tier) ? 'border-[#E8D200] bg-[#E8D200]/10 text-[#1A1A1A]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#888888]'}`}>
                                                {tier}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Or exact levels (e.g. 7, 12)</label>
                                    <input type="text" value={grantExactLevels} onChange={e => setGrantExactLevels(e.target.value)} placeholder="7, 12"
                                        className="w-full h-11 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl font-mono text-xs text-[#1A1A1A] outline-none focus:border-[#E8D200]/60 transition-all" />
                                </div>
                            </>
                        )}
                        {grantTarget === 'activities' && (
                            <div>
                                <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Preferred activities (any match)</label>
                                <div className="flex flex-wrap gap-2">
                                    {ACTIVITY_OPTIONS.map(a => (
                                        <button key={a} type="button"
                                            onClick={() => setGrantActivities(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a])}
                                            className={`h-9 px-4 rounded-full border text-[9px] font-black uppercase tracking-[0.15em] transition-all ${grantActivities.includes(a) ? 'border-[#E8D200] bg-[#E8D200]/10 text-[#1A1A1A]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#888888]'}`}>
                                            {a}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">POWR each</label>
                                <input
                                    type="number" min="1"
                                    value={grantAmount}
                                    onChange={e => setGrantAmount(e.target.value)}
                                    placeholder="50"
                                    className="w-full h-12 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl font-mono text-sm text-[#1A1A1A] outline-none focus:border-[#E8D200]/60 transition-all"
                                />
                            </div>
                            <div>
                                <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Vest days (blank = default)</label>
                                <input
                                    type="number" min="0"
                                    value={grantVestDays}
                                    onChange={e => setGrantVestDays(e.target.value)}
                                    placeholder="60"
                                    className="w-full h-12 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl font-mono text-sm text-[#1A1A1A] outline-none focus:border-[#E8D200]/60 transition-all"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-[9px] uppercase tracking-[0.4em] text-[#888888] font-black mb-2">Note (shown on the deposit + in the push)</label>
                            <input
                                type="text"
                                value={grantNote}
                                onChange={e => setGrantNote(e.target.value)}
                                placeholder="Launch week drop"
                                className="w-full h-12 px-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-xl text-sm text-[#1A1A1A] outline-none focus:border-[#E8D200]/60 transition-all"
                            />
                        </div>
                        <button type="button" onClick={() => setGrantNotify(!grantNotify)}
                            className={`w-full h-12 px-5 rounded-xl border flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] transition-all ${grantNotify ? 'border-[#10B981]/40 bg-[#10B981]/10 text-[#10B981]' : 'border-[#E6E6E1] bg-[#F4F4F1] text-[#888888]'}`}>
                            {grantNotify ? <Bell size={13} /> : <BellOff size={13} />}
                            {grantNotify ? 'Push the drop to users' : 'Silent — no push'}
                        </button>
                        <button
                            onClick={handleGrant}
                            disabled={granting}
                            className="w-full h-12 rounded-xl bg-[#1A1A1A] text-white text-[10px] font-black uppercase tracking-[0.3em] hover:bg-[#333333] transition-all disabled:opacity-50"
                        >
                            {granting ? 'Granting…' : 'Grant deposit'}
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
