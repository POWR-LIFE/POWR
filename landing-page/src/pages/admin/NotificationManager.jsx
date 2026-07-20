import React, { useEffect, useState } from 'react';
import { Bell, Edit2, X, Save, ChevronRight, Zap, Users, Award, Activity, Megaphone, CalendarDays } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';

// Default copy from the edge function (for display reference).
const DEFAULTS = {
    daily_reminder:            { title: 'Time to move 💪',                      body: 'Every step earns POWR. Log your activity and keep the streak alive.' },
    streak_at_risk:            { title: 'Your N-day streak is at risk 🔥',       body: 'Log any activity before midnight to keep it alive.',                  dynamic: true },
    weekly_challenge_expiry:   { title: 'Challenge ending soon ⏰',              body: '"Challenge" expires in 24 hours. Don\'t miss your bonus POWR points.', dynamic: true },
    check_in_reminder:         { title: 'POWR',                                 body: 'You\'re in. Every minute counts.' },
    inactivity_nudge:          { title: 'We miss you 👋',                        body: 'It\'s been 3 days. Even a short walk earns POWR points.',              dynamic: true },
    session_completed:         { title: 'Session recorded 🔥',                  body: '[Partner] · +X pts · Day N streak',                                   dynamic: true },
    session_upgraded:          { title: 'Bonus unlocked 🔓',                    body: '[Partner] · +X pts · 40-min bonus',                                   dynamic: true },
    sleep_target_met:          { title: 'Sleep goal reached 🌙',                 body: 'X.Xh of sleep earned you N POWR points.',                             dynamic: true },
    reward_unlocked:           { title: 'New reward unlocked 🎁',                body: 'You\'ve unlocked "Reward". Redeem it before it expires.',             dynamic: true },
    points_milestone:          { title: 'Reward within reach',                  body: 'You\'re close. N pts to unlock your next reward.',                    dynamic: true },
    friend_request:            { title: 'New friend request 👋',                 body: '[Name] wants to team up on POWR.',                                    dynamic: true },
    friend_accepted:           { title: 'You\'re connected 🤝',                  body: '[Name] accepted your friend request. Take on a challenge together.',  dynamic: true },
    challenge_invite:          { title: '[Name] invited you 🤜🤛',               body: 'Take on "challenge" together — tap to join.',                         dynamic: true },
    challenge_accepted:        { title: '[Name] is in 🤜🤛',                     body: '[Name] accepted "challenge".',                                        dynamic: true },
    challenge_started:         { title: 'Challenge on 🔥',                      body: '"Challenge" has started — everyone\'s in. Get your part done.',       dynamic: true },
    challenge_friend_finished: { title: '[Name] finished their part 💪',         body: 'They\'re done with "challenge". Finish yours to lock in the group bonus.', dynamic: true },
    challenge_pool_milestone:  { title: 'Halfway there 🏁',                      body: 'Your group\'s hit 50% of "challenge" — N to go together.',            dynamic: true },
    challenge_completed:       { title: 'Challenge complete 🎉',                 body: '"Challenge" done — +N POWR.',                                         dynamic: true },
    challenge_expiring:        { title: 'Challenge ending soon ⏰',              body: '"Challenge" ends in Nh — finish your part to earn the group bonus.',  dynamic: true },
};

const CATEGORY_META = {
    system:   { label: 'System',   color: '#6B7280', accent: '#6B728015' },
    activity: { label: 'Activity', color: '#0EA5E9', accent: '#0EA5E915' },
    rewards:  { label: 'Rewards',  color: '#F97316', accent: '#F9731615' },
    social:   { label: 'Social',   color: '#8B5CF6', accent: '#8B5CF615' },
};

const CATEGORY_ORDER = ['system', 'activity', 'rewards', 'social'];

const CATEGORY_ICONS = { system: Activity, activity: Zap, rewards: Award, social: Users };

function fmtType(t) {
    return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function NotificationManager() {
    const toast = useToast();
    const { user } = useAuth();
    const [configs, setConfigs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [toggling, setToggling] = useState(null);
    const [editRow, setEditRow] = useState(null);
    const [draft, setDraft] = useState({ title: '', body: '' });
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('notification_config')
            .select('*')
            .order('category')
            .order('type');
        if (error) { toast.error('Failed to load notification config'); setLoading(false); return; }
        setConfigs(data ?? []);
        setLoading(false);
    };

    useEffect(() => { load(); }, []);

    const logAction = async (action, type, meta = {}) => {
        await supabase.from('admin_audit_log').insert({
            admin_id: user.id, action, target_type: 'notification_config', target_id: type, metadata: meta,
        }).catch(() => {});
    };

    const handleToggle = async (row) => {
        if (toggling) return;
        setToggling(row.type);
        const next = !row.enabled;
        const { error } = await supabase
            .from('notification_config')
            .update({ enabled: next, updated_at: new Date().toISOString(), updated_by: user.id })
            .eq('type', row.type);
        if (error) { toast.error(error.message); setToggling(null); return; }
        await logAction(next ? 'notif_enabled' : 'notif_disabled', row.type, { enabled: next });
        toast.success(`${fmtType(row.type)} ${next ? 'enabled' : 'disabled'}`);
        setConfigs(prev => prev.map(c => c.type === row.type ? { ...c, enabled: next } : c));
        setToggling(null);
    };

    const openEdit = (row) => {
        setEditRow(row);
        setDraft({ title: row.title_override ?? '', body: row.body_override ?? '' });
    };

    const saveEdit = async () => {
        if (!editRow || saving) return;
        setSaving(true);
        const upd = {
            title_override: draft.title.trim() || null,
            body_override:  draft.body.trim()  || null,
            updated_at: new Date().toISOString(),
            updated_by: user.id,
        };
        const { error } = await supabase.from('notification_config').update(upd).eq('type', editRow.type);
        if (error) { toast.error(error.message); setSaving(false); return; }
        await logAction('notif_copy_updated', editRow.type, { title: upd.title_override, body: upd.body_override });
        toast.success('Copy override saved');
        setConfigs(prev => prev.map(c => c.type === editRow.type ? { ...c, ...upd } : c));
        setEditRow(null);
        setSaving(false);
    };

    const clearOverride = async (row) => {
        const upd = { title_override: null, body_override: null, updated_at: new Date().toISOString(), updated_by: user.id };
        const { error } = await supabase.from('notification_config').update(upd).eq('type', row.type);
        if (error) { toast.error(error.message); return; }
        await logAction('notif_copy_cleared', row.type, {});
        toast.success('Override cleared — using default copy');
        setConfigs(prev => prev.map(c => c.type === row.type ? { ...c, ...upd } : c));
    };

    const byCategory = CATEGORY_ORDER.reduce((acc, cat) => {
        acc[cat] = configs.filter(c => c.category === cat);
        return acc;
    }, {});

    const totalEnabled  = configs.filter(c => c.enabled).length;
    const totalDisabled = configs.filter(c => !c.enabled).length;
    const totalOverride = configs.filter(c => c.title_override || c.body_override).length;

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">

            {/* Header */}
            <div className="mb-16">
                <div className="flex items-center gap-3 mb-6">
                    <div className="h-[1px] w-12 bg-[#0EA5E9]" />
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#0EA5E9] font-black">Subsystem / Notifications</span>
                </div>
                <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-6">Push Notifications</h1>
                <p className="text-[#666666] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                    Global controls for every automated push type. Disabled types are suppressed system-wide before any per-user preference is checked.
                </p>
            </div>

            {/* Stats strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
                {[
                    { label: 'Total Types',     value: loading ? '—' : configs.length,     color: '#1A1A1A' },
                    { label: 'Active',          value: loading ? '—' : totalEnabled,       color: '#10B981' },
                    { label: 'Disabled',        value: loading ? '—' : totalDisabled,      color: '#F43F5E' },
                    { label: 'Custom Copy',     value: loading ? '—' : totalOverride,      color: '#E8D200' },
                ].map(s => (
                    <div key={s.label} className="bg-white border border-[#E6E6E1] rounded-2xl px-6 py-5">
                        <div className="text-[9px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black mb-2">{s.label}</div>
                        <div className="text-3xl font-light tracking-tighter" style={{ color: s.color }}>{s.value}</div>
                    </div>
                ))}
            </div>

            {/* Quick links */}
            <div className="flex flex-wrap gap-3 mb-12">
                <Link to="/admin/broadcast"
                    className="flex items-center gap-3 px-5 py-3 bg-white border border-[#E6E6E1] rounded-xl hover:border-[#E8D200] transition-colors group">
                    <Megaphone size={15} className="text-[#E8D200]" />
                    <span className="text-[10px] uppercase tracking-[0.3em] font-black text-[#555555] group-hover:text-[#1A1A1A] transition-colors">Broadcast</span>
                    <ChevronRight size={12} className="text-[#CCCCCC]" />
                </Link>
                <Link to="/admin/campaigns"
                    className="flex items-center gap-3 px-5 py-3 bg-white border border-[#E6E6E1] rounded-xl hover:border-[#0EA5E9] transition-colors group">
                    <CalendarDays size={15} className="text-[#0EA5E9]" />
                    <span className="text-[10px] uppercase tracking-[0.3em] font-black text-[#555555] group-hover:text-[#1A1A1A] transition-colors">Campaigns</span>
                    <ChevronRight size={12} className="text-[#CCCCCC]" />
                </Link>
            </div>

            {/* Category sections */}
            {loading ? (
                <div className="flex flex-col items-center justify-center py-32 gap-6">
                    <div className="w-12 h-12 border-2 border-[#0EA5E9]/20 border-t-[#0EA5E9] rounded-full animate-spin" />
                    <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Loading notification matrix...</span>
                </div>
            ) : (
                <div className="space-y-10">
                    {CATEGORY_ORDER.map(cat => {
                        const rows = byCategory[cat] ?? [];
                        if (!rows.length) return null;
                        const meta = CATEGORY_META[cat];
                        const CatIcon = CATEGORY_ICONS[cat];
                        const activeCount = rows.filter(r => r.enabled).length;
                        return (
                            <div key={cat}>
                                <div className="flex items-center gap-3 mb-4">
                                    <CatIcon size={14} style={{ color: meta.color }} />
                                    <span className="text-[10px] uppercase tracking-[0.5em] font-black" style={{ color: meta.color }}>{meta.label}</span>
                                    <div className="flex-1 h-[1px] bg-[#F0F0EC]" />
                                    <span className="text-[9px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black">
                                        {activeCount} / {rows.length} active
                                    </span>
                                </div>
                                <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden divide-y divide-[#F4F4F1]">
                                    {rows.map(row => {
                                        const def = DEFAULTS[row.type];
                                        const hasOverride = row.title_override || row.body_override;
                                        const isToggling = toggling === row.type;
                                        return (
                                            <div key={row.type}
                                                className={`flex items-start gap-6 px-8 py-6 transition-all ${!row.enabled ? 'opacity-50' : ''}`}>

                                                {/* Toggle */}
                                                <button
                                                    onClick={() => handleToggle(row)}
                                                    disabled={!!toggling}
                                                    className={`mt-0.5 shrink-0 ${isToggling ? 'opacity-40' : ''}`}
                                                    title={row.enabled ? 'Click to disable' : 'Click to enable'}>
                                                    <div className={`w-11 h-6 rounded-full relative transition-all duration-200 ${row.enabled ? 'bg-[#10B981]' : 'bg-[#E6E6E1]'}`}>
                                                        <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${row.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                                                    </div>
                                                </button>

                                                {/* Content */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                                                        <span className="text-sm font-black text-[#1A1A1A] tracking-tight">{fmtType(row.type)}</span>
                                                        {def?.dynamic && (
                                                            <span className="text-[8px] uppercase tracking-[0.3em] font-black px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#9CA3AF]">Dynamic</span>
                                                        )}
                                                        {hasOverride && (
                                                            <span className="text-[8px] uppercase tracking-[0.3em] font-black px-2 py-0.5 rounded-full bg-[#FEF9C3] text-[#854D0E]">Custom copy</span>
                                                        )}
                                                    </div>
                                                    <p className="text-[11px] text-[#888888] mb-3 leading-relaxed">{row.description}</p>
                                                    <div className="bg-[#F9F9F8] rounded-xl px-4 py-3 space-y-1.5">
                                                        <div className="flex gap-2 items-start">
                                                            <span className="text-[8px] uppercase tracking-widest text-[#BBBBBB] font-black w-9 shrink-0 pt-[3px]">Title</span>
                                                            <span className="text-[11px] text-[#555555] font-medium leading-snug">
                                                                {row.title_override
                                                                    ? <><span className="text-[#1A1A1A]">{row.title_override}</span><span className="ml-1.5 text-[8px] text-[#E8D200] font-black uppercase tracking-[0.2em]">custom</span></>
                                                                    : def?.title ?? '—'
                                                                }
                                                            </span>
                                                        </div>
                                                        <div className="flex gap-2 items-start">
                                                            <span className="text-[8px] uppercase tracking-widest text-[#BBBBBB] font-black w-9 shrink-0 pt-[3px]">Body</span>
                                                            <span className="text-[11px] text-[#777777] leading-snug">
                                                                {row.body_override
                                                                    ? <><span className="text-[#555555]">{row.body_override}</span><span className="ml-1.5 text-[8px] text-[#E8D200] font-black uppercase tracking-[0.2em]">custom</span></>
                                                                    : def?.body ?? '—'
                                                                }
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Actions */}
                                                <div className="flex items-center gap-1 mt-1 shrink-0">
                                                    {hasOverride && (
                                                        <button
                                                            onClick={() => clearOverride(row)}
                                                            className="p-2 rounded-xl text-[#CCCCCC] hover:text-[#F43F5E] hover:bg-[#FEE2E2] transition-all"
                                                            title="Clear copy override">
                                                            <X size={14} />
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => openEdit(row)}
                                                        className="p-2 rounded-xl text-[#CCCCCC] hover:text-[#555555] hover:bg-[#F4F4F1] transition-all"
                                                        title="Edit copy override">
                                                        <Edit2 size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Edit modal */}
            {editRow && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
                        <div className="flex items-center justify-between px-8 py-6 border-b border-[#F0F0EC]">
                            <div>
                                <div className="text-[9px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black mb-1">Override copy</div>
                                <h3 className="text-xl font-light tracking-tight text-[#1A1A1A]">{fmtType(editRow.type)}</h3>
                            </div>
                            <button onClick={() => setEditRow(null)} className="p-2 rounded-xl text-[#CCCCCC] hover:text-[#555555] hover:bg-[#F4F4F1] transition-all">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="px-8 py-6 space-y-6 max-h-[60vh] overflow-y-auto">
                            {DEFAULTS[editRow.type]?.dynamic && (
                                <div className="text-[10px] text-[#888888] bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-4 py-3 leading-relaxed">
                                    ⚠ This notification uses live data (e.g. user name, streak count, reward name). Overrides replace the entire title/body with static text — live values won't be injected.
                                </div>
                            )}

                            <div>
                                <div className="text-[9px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black mb-1">Default title</div>
                                <div className="text-[11px] text-[#BBBBBB] bg-[#F9F9F8] rounded-lg px-3 py-2 mb-3 font-mono">{DEFAULTS[editRow.type]?.title ?? '—'}</div>
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-2">Override title <span className="text-[#CCCCCC] normal-case">(blank = use default)</span></label>
                                <input
                                    className="w-full h-11 px-4 text-sm bg-[#F9F9F8] border border-[#E6E6E1] rounded-xl focus:outline-none focus:border-[#0EA5E9] text-[#1A1A1A] transition-colors"
                                    placeholder="Override title..."
                                    value={draft.title}
                                    onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                                    maxLength={65}
                                />
                                <div className="text-right text-[9px] text-[#CCCCCC] mt-1">{draft.title.length} / 65</div>
                            </div>

                            <div>
                                <div className="text-[9px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black mb-1">Default body</div>
                                <div className="text-[11px] text-[#BBBBBB] bg-[#F9F9F8] rounded-lg px-3 py-2 mb-3 font-mono leading-relaxed">{DEFAULTS[editRow.type]?.body ?? '—'}</div>
                                <label className="block text-[10px] uppercase tracking-[0.4em] text-[#666666] font-black mb-2">Override body <span className="text-[#CCCCCC] normal-case">(blank = use default)</span></label>
                                <textarea
                                    className="w-full px-4 py-3 text-sm bg-[#F9F9F8] border border-[#E6E6E1] rounded-xl focus:outline-none focus:border-[#0EA5E9] text-[#1A1A1A] transition-colors resize-none"
                                    placeholder="Override body..."
                                    rows={3}
                                    value={draft.body}
                                    onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
                                    maxLength={178}
                                />
                                <div className="text-right text-[9px] text-[#CCCCCC] mt-1">{draft.body.length} / 178</div>
                            </div>
                        </div>
                        <div className="flex gap-3 px-8 pb-8">
                            <button
                                onClick={() => setEditRow(null)}
                                className="flex-1 h-11 border border-[#E6E6E1] text-[#666666] text-[10px] font-black uppercase tracking-[0.4em] rounded-xl hover:bg-[#F4F4F1] transition-all">
                                Cancel
                            </button>
                            <button
                                onClick={saveEdit}
                                disabled={saving}
                                className="flex-1 h-11 bg-[#1A1A1A] text-white text-[10px] font-black uppercase tracking-[0.4em] rounded-xl hover:bg-[#333333] transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                                <Save size={14} />
                                {saving ? 'Saving...' : 'Save Override'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
