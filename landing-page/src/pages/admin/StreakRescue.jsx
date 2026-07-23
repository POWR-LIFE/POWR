import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Flame, Plus, Trash2, Save, X, Edit2, ChevronRight, Settings, ShieldCheck,
    Dumbbell, CalendarCheck, Footprints, Activity,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';

const logAction = async (adminId, action, targetType, targetId, metadata = {}) => {
    await supabase.from('admin_audit_log').insert({ admin_id: adminId, action, target_type: targetType, target_id: targetId, metadata });
};

// Requirement kinds the progress engine understands (streak_rescue_requirement_progress).
const REQUIREMENT_KINDS = [
    { value: 'sessions',     label: 'Sessions (any activity)', unit: 'sessions',  icon: Activity,      hint: 'Any verified workout counts — gym, run, wearable, walking day. Offered to everyone.' },
    { value: 'gym_sessions', label: 'Gym sessions',            unit: 'gym visits', icon: Dumbbell,     hint: 'Only verified gym sessions count. Only offered to users with gym history — walkers never draw it.' },
    { value: 'active_days',  label: 'Active days',             unit: 'days',      icon: CalendarCheck, hint: 'Distinct days with at least one verified session. Offered to everyone.' },
    { value: 'steps',        label: 'Steps total',             unit: 'steps',     icon: Footprints,    hint: 'Steps summed across verified sessions. Only offered to users whose sessions carry step data.' },
];
const kindMeta = (v) => REQUIREMENT_KINDS.find(k => k.value === v) ?? REQUIREMENT_KINDS[0];

function requirementText(type, count) {
    const n = Number(count ?? 0).toLocaleString();
    switch (type) {
        case 'gym_sessions': return `${n} gym session${count !== 1 ? 's' : ''}`;
        case 'active_days':  return `${n} active day${count !== 1 ? 's' : ''}`;
        case 'steps':        return `${n} steps`;
        default:             return `${n} session${count !== 1 ? 's' : ''}`;
    }
}

const STATUS_META = {
    offered:   { label: 'Offered',   color: '#0EA5E9' },
    completed: { label: 'Completed', color: '#10B981' },
    expired:   { label: 'Expired',   color: '#9CA3AF' },
};

const EMPTY_DRAFT = { label: '', requirement_type: 'sessions', requirement_count: 2, window_hours: 48 };

export default function StreakRescue() {
    const toast = useToast();
    const { user } = useAuth();
    const [loading, setLoading]       = useState(true);
    const [enabled, setEnabled]       = useState(true);
    const [minStreak, setMinStreak]   = useState('3');
    const [cooldown, setCooldown]     = useState('30');
    const [challenges, setChallenges] = useState([]);
    const [rescues, setRescues]       = useState([]);
    const [names, setNames]           = useState({});
    const [draft, setDraft]           = useState(null);   // null | {id?, ...fields} — id set = editing
    const [saving, setSaving]         = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const [{ data: cfg }, { data: ch }, { data: rs }] = await Promise.all([
                supabase.from('system_config').select('key, value')
                    .in('key', ['streak_rescue_enabled', 'streak_rescue_min_streak', 'streak_rescue_cooldown_days']),
                supabase.from('streak_rescue_challenges').select('*').order('created_at'),
                supabase.from('streak_rescues').select('*').order('created_at', { ascending: false }).limit(30),
            ]);
            setEnabled((cfg ?? []).find(r => r.key === 'streak_rescue_enabled')?.value !== 'false');
            setMinStreak((cfg ?? []).find(r => r.key === 'streak_rescue_min_streak')?.value ?? '3');
            setCooldown((cfg ?? []).find(r => r.key === 'streak_rescue_cooldown_days')?.value ?? '30');
            setChallenges(ch ?? []);
            setRescues(rs ?? []);

            const ids = [...new Set((rs ?? []).map(r => r.user_id))];
            if (ids.length) {
                const { data: profiles } = await supabase.from('profiles').select('id, username, display_name').in('id', ids);
                setNames(Object.fromEntries((profiles ?? []).map(p => [p.id, p.display_name || p.username || p.id.slice(0, 8)])));
            }
        } catch (e) {
            toast.error('Failed to load streak rescue data');
        }
        setLoading(false);
    };
    useEffect(() => { load(); }, []);

    const saveEligibility = async (key, value, label) => {
        const clean = String(parseInt(value, 10) || 0);
        if (parseInt(clean, 10) <= 0) { toast.error(`${label} must be a positive number`); return; }
        const { error } = await supabase.from('system_config')
            .update({ value: clean, updated_at: new Date().toISOString(), updated_by: user.id })
            .eq('key', key);
        if (error) { toast.error(`Failed to save ${label}`); return; }
        await logAction(user.id, 'update_config', 'system_config', key, { value: clean });
        toast.success(`${label} saved`);
    };

    const saveDraft = async () => {
        if (!draft) return;
        const label = draft.label.trim();
        const count = parseInt(draft.requirement_count, 10);
        const windowH = parseInt(draft.window_hours, 10);
        if (!label) { toast.error('Give the challenge a name'); return; }
        if (!count || count <= 0) { toast.error('Requirement must be a positive number'); return; }
        if (!windowH || windowH < 1 || windowH > 168) { toast.error('Window must be 1–168 hours'); return; }

        setSaving(true);
        const row = {
            label,
            requirement_type: draft.requirement_type,
            requirement_count: count,
            window_hours: windowH,
            updated_at: new Date().toISOString(),
            updated_by: user.id,
        };
        const { error } = draft.id
            ? await supabase.from('streak_rescue_challenges').update(row).eq('id', draft.id)
            : await supabase.from('streak_rescue_challenges').insert(row);
        setSaving(false);
        if (error) { toast.error('Save failed'); return; }
        await logAction(user.id, draft.id ? 'update_rescue_challenge' : 'create_rescue_challenge', 'streak_rescue_challenges', draft.id ?? label, row);
        toast.success(draft.id ? 'Challenge updated' : 'Challenge added');
        setDraft(null);
        load();
    };

    const toggleChallenge = async (ch) => {
        const { error } = await supabase.from('streak_rescue_challenges')
            .update({ active: !ch.active, updated_at: new Date().toISOString(), updated_by: user.id })
            .eq('id', ch.id);
        if (error) { toast.error('Toggle failed'); return; }
        await logAction(user.id, 'toggle_rescue_challenge', 'streak_rescue_challenges', ch.id, { active: !ch.active });
        load();
    };

    const deleteChallenge = async (ch) => {
        if (!window.confirm(`Delete "${ch.label}"? In-flight rescues keep their frozen terms.`)) return;
        const { error } = await supabase.from('streak_rescue_challenges').delete().eq('id', ch.id);
        if (error) { toast.error('Delete failed'); return; }
        await logAction(user.id, 'delete_rescue_challenge', 'streak_rescue_challenges', ch.id, { label: ch.label });
        toast.success('Challenge deleted');
        load();
    };

    const stats = useMemo(() => {
        const by = (s) => rescues.filter(r => r.status === s).length;
        const completed = by('completed'); const expired = by('expired');
        const settled = completed + expired;
        return {
            offered: by('offered'), completed, expired,
            rate: settled ? `${Math.round((completed / settled) * 100)}%` : '—',
        };
    }, [rescues]);

    const activeCount = challenges.filter(c => c.active).length;

    return (
        <div className="max-w-5xl">
            {/* Header */}
            <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <Flame size={18} className="text-[#EF4444]" />
                        <h1 className="text-2xl font-black tracking-tight text-[#1A1A1A]">Streak Rescue</h1>
                        <span className={`text-[9px] uppercase tracking-[0.3em] font-black px-2.5 py-1 rounded-full ${enabled ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-[#F43F5E]/10 text-[#F43F5E]'}`}>
                            {enabled ? 'On' : 'Off'}
                        </span>
                    </div>
                    <p className="text-xs text-[#888888] max-w-xl leading-relaxed">
                        When a qualifying streak dies, the morning sweep offers ONE challenge drawn at random from the
                        active set below — complete it inside its window and the whole streak comes back. The draw is
                        matched to how each user actually trains (gym challenges need gym history, step challenges need
                        step data; walkers fall back to the universal kinds). Terms are frozen onto each offer, so edits
                        here never move goalposts mid-rescue. No active challenges = no offers.
                    </p>
                </div>
                <Link to="/admin/config"
                    className="flex items-center gap-3 px-5 py-3 bg-white border border-[#E6E6E1] rounded-xl hover:border-[#E8D200] transition-colors group">
                    <Settings size={15} className="text-[#E8D200]" />
                    <span className="text-[10px] uppercase tracking-[0.3em] font-black text-[#555555] group-hover:text-[#1A1A1A]">On / Off toggle lives in Config</span>
                    <ChevronRight size={12} className="text-[#CCCCCC]" />
                </Link>
            </div>

            {/* Stats strip (last 30 offers) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
                {[
                    { label: 'Live Offers',     value: loading ? '—' : stats.offered,   color: '#0EA5E9' },
                    { label: 'Completed',       value: loading ? '—' : stats.completed, color: '#10B981' },
                    { label: 'Expired',         value: loading ? '—' : stats.expired,   color: '#9CA3AF' },
                    { label: 'Rescue Rate',     value: loading ? '—' : stats.rate,      color: '#E8D200' },
                ].map(s => (
                    <div key={s.label} className="bg-white border border-[#E6E6E1] rounded-2xl px-6 py-5">
                        <div className="text-[9px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black mb-2">{s.label}</div>
                        <div className="text-3xl font-light tracking-tighter" style={{ color: s.color }}>{s.value}</div>
                    </div>
                ))}
            </div>

            {/* Eligibility */}
            <div className="flex items-center gap-3 mb-4">
                <ShieldCheck size={14} className="text-[#F97316]" />
                <span className="text-[10px] uppercase tracking-[0.5em] font-black text-[#F97316]">Eligibility</span>
                <div className="flex-1 h-[1px] bg-[#F0F0EC]" />
            </div>
            <div className="bg-white border border-[#E6E6E1] rounded-3xl px-8 py-6 mb-12 flex flex-wrap gap-10">
                {[
                    { key: 'streak_rescue_min_streak', label: 'Minimum streak to qualify', unit: 'days', value: minStreak, set: setMinStreak, hint: 'Shorter streaks just restart' },
                    { key: 'streak_rescue_cooldown_days', label: 'Cooldown between offers', unit: 'days', value: cooldown, set: setCooldown, hint: 'Counted from the last offer of any outcome' },
                ].map(f => (
                    <div key={f.key}>
                        <div className="text-[9px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black mb-2">{f.label}</div>
                        <div className="flex items-center gap-2">
                            <input type="number" min="1" value={f.value}
                                onChange={e => f.set(e.target.value)}
                                onBlur={() => saveEligibility(f.key, f.value, f.label)}
                                className="w-24 px-4 py-2.5 bg-[#FAFAF8] border border-[#E6E6E1] rounded-xl text-sm font-bold text-[#1A1A1A] focus:outline-none focus:border-[#E8D200]" />
                            <span className="text-[10px] uppercase tracking-[0.2em] text-[#AAAAAA] font-black">{f.unit}</span>
                        </div>
                        <div className="text-[10px] text-[#BBBBBB] mt-2">{f.hint}</div>
                    </div>
                ))}
            </div>

            {/* Challenges */}
            <div className="flex items-center gap-3 mb-4">
                <Flame size={14} className="text-[#EF4444]" />
                <span className="text-[10px] uppercase tracking-[0.5em] font-black text-[#EF4444]">Rescue Challenges</span>
                <div className="flex-1 h-[1px] bg-[#F0F0EC]" />
                <span className="text-[9px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black">{activeCount} / {challenges.length} active</span>
                <button onClick={() => setDraft({ ...EMPTY_DRAFT })}
                    className="flex items-center gap-2 px-4 py-2 bg-[#1A1A1A] text-white rounded-xl text-[10px] uppercase tracking-[0.3em] font-black hover:bg-[#333333] transition-colors">
                    <Plus size={12} /> Add challenge
                </button>
            </div>

            {activeCount === 0 && !loading && (
                <div className="mb-4 px-5 py-3 bg-[#FEF3C7] border border-[#FDE68A] rounded-xl text-[11px] text-[#92400E] font-bold">
                    No active challenges — the sweep is offering nothing, even while the feature is on.
                </div>
            )}

            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden divide-y divide-[#F4F4F1] mb-12">
                {loading ? (
                    <div className="px-8 py-10 text-[10px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black">Loading…</div>
                ) : challenges.length === 0 && !draft ? (
                    <div className="px-8 py-10 text-xs text-[#999999]">No challenges yet — add one to switch rescues on.</div>
                ) : (
                    challenges.map(ch => {
                        const meta = kindMeta(ch.requirement_type);
                        const KindIcon = meta.icon;
                        const editing = draft?.id === ch.id;
                        if (editing) return null; // rendered in the editor block below
                        return (
                            <div key={ch.id} className={`flex items-center gap-6 px-8 py-5 ${!ch.active ? 'opacity-50' : ''}`}>
                                <button onClick={() => toggleChallenge(ch)} title={ch.active ? 'Deactivate' : 'Activate'}>
                                    <div className={`w-11 h-6 rounded-full relative transition-all duration-200 ${ch.active ? 'bg-[#10B981]' : 'bg-[#E6E6E1]'}`}>
                                        <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${ch.active ? 'translate-x-5' : 'translate-x-0'}`} />
                                    </div>
                                </button>
                                <KindIcon size={16} className="text-[#888888] shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-black text-[#1A1A1A] tracking-tight">{ch.label}</div>
                                    <div className="text-[11px] text-[#888888] mt-0.5">
                                        {requirementText(ch.requirement_type, ch.requirement_count)} within {ch.window_hours}h
                                    </div>
                                </div>
                                <button onClick={() => setDraft({ id: ch.id, label: ch.label, requirement_type: ch.requirement_type, requirement_count: ch.requirement_count, window_hours: ch.window_hours })}
                                    className="p-2 text-[#AAAAAA] hover:text-[#1A1A1A] transition-colors" title="Edit"><Edit2 size={14} /></button>
                                <button onClick={() => deleteChallenge(ch)}
                                    className="p-2 text-[#AAAAAA] hover:text-[#F43F5E] transition-colors" title="Delete"><Trash2 size={14} /></button>
                            </div>
                        );
                    })
                )}

                {/* Add / edit editor */}
                {draft && (
                    <div className="px-8 py-6 bg-[#FAFAF8]">
                        <div className="grid md:grid-cols-4 gap-4 mb-4">
                            <div className="md:col-span-2">
                                <div className="text-[9px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black mb-2">Name</div>
                                <input value={draft.label} autoFocus placeholder='e.g. "Back on track"'
                                    onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                                    className="w-full px-4 py-2.5 bg-white border border-[#E6E6E1] rounded-xl text-sm focus:outline-none focus:border-[#E8D200]" />
                            </div>
                            <div>
                                <div className="text-[9px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black mb-2">Requirement</div>
                                <select value={draft.requirement_type}
                                    onChange={e => setDraft(d => ({ ...d, requirement_type: e.target.value }))}
                                    className="w-full px-4 py-2.5 bg-white border border-[#E6E6E1] rounded-xl text-sm focus:outline-none focus:border-[#E8D200]">
                                    {REQUIREMENT_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                                </select>
                            </div>
                            <div className="flex gap-3">
                                <div className="flex-1">
                                    <div className="text-[9px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black mb-2">Count</div>
                                    <input type="number" min="1" value={draft.requirement_count}
                                        onChange={e => setDraft(d => ({ ...d, requirement_count: e.target.value }))}
                                        className="w-full px-4 py-2.5 bg-white border border-[#E6E6E1] rounded-xl text-sm focus:outline-none focus:border-[#E8D200]" />
                                </div>
                                <div className="flex-1">
                                    <div className="text-[9px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black mb-2">Window (h)</div>
                                    <input type="number" min="1" max="168" value={draft.window_hours}
                                        onChange={e => setDraft(d => ({ ...d, window_hours: e.target.value }))}
                                        className="w-full px-4 py-2.5 bg-white border border-[#E6E6E1] rounded-xl text-sm focus:outline-none focus:border-[#E8D200]" />
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <button onClick={saveDraft} disabled={saving}
                                className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] text-white rounded-xl text-[10px] uppercase tracking-[0.3em] font-black hover:bg-[#333333] transition-colors disabled:opacity-40">
                                <Save size={12} /> {draft.id ? 'Save changes' : 'Add challenge'}
                            </button>
                            <button onClick={() => setDraft(null)}
                                className="flex items-center gap-2 px-5 py-2.5 bg-white border border-[#E6E6E1] rounded-xl text-[10px] uppercase tracking-[0.3em] font-black text-[#888888] hover:text-[#1A1A1A] transition-colors">
                                <X size={12} /> Cancel
                            </button>
                            <span className="text-[10px] text-[#BBBBBB] ml-2">{kindMeta(draft.requirement_type).hint}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Recent rescues */}
            <div className="flex items-center gap-3 mb-4">
                <Activity size={14} className="text-[#0EA5E9]" />
                <span className="text-[10px] uppercase tracking-[0.5em] font-black text-[#0EA5E9]">Recent Rescues</span>
                <div className="flex-1 h-[1px] bg-[#F0F0EC]" />
            </div>
            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden mb-16">
                {loading ? (
                    <div className="px-8 py-10 text-[10px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black">Loading…</div>
                ) : rescues.length === 0 ? (
                    <div className="px-8 py-10 text-xs text-[#999999]">No rescues offered yet — they appear here the morning after someone loses a qualifying streak.</div>
                ) : (
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-[#F0F0EC]">
                                {['User', 'Lost Streak', 'Challenge', 'Progress', 'Status', 'Offered'].map(h => (
                                    <th key={h} className="px-6 py-4 text-[9px] uppercase tracking-[0.35em] text-[#AAAAAA] font-black">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F4F4F1]">
                            {rescues.map(r => {
                                const s = STATUS_META[r.status] ?? STATUS_META.offered;
                                return (
                                    <tr key={r.id} className="hover:bg-[#FAFAF8] transition-colors">
                                        <td className="px-6 py-4">
                                            <Link to={`/admin/users/${r.user_id}`} className="text-xs font-bold text-[#1A1A1A] hover:text-[#0EA5E9] transition-colors">
                                                {names[r.user_id] ?? r.user_id.slice(0, 8)}
                                            </Link>
                                        </td>
                                        <td className="px-6 py-4 text-xs font-bold text-[#1A1A1A]">{r.lost_streak}d</td>
                                        <td className="px-6 py-4 text-xs text-[#555555]">
                                            {r.label ? `${r.label} · ` : ''}{requirementText(r.requirement_type ?? 'sessions', r.sessions_required)} / {Math.round((new Date(r.expires_at) - new Date(r.offered_at)) / 3600000)}h
                                        </td>
                                        <td className="px-6 py-4 text-xs text-[#555555]">
                                            {Number(r.sessions_done ?? 0).toLocaleString()} / {Number(r.sessions_required ?? 0).toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="text-[9px] uppercase tracking-[0.3em] font-black px-2.5 py-1 rounded-full"
                                                style={{ color: s.color, backgroundColor: `${s.color}15` }}>{s.label}</span>
                                        </td>
                                        <td className="px-6 py-4 text-[11px] text-[#999999]">{new Date(r.offered_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
