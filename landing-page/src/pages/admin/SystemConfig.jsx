import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import {
    Settings, Save, RotateCcw, Minus, Plus, Search, ExternalLink,
    Coins, MapPin, Vault, ShieldCheck, Smartphone, Store, Sparkles, SlidersHorizontal,
    Rocket, Flame,
} from 'lucide-react';

const logAction = async (adminId, action, targetType, targetId, metadata = {}) => {
    await supabase.from('admin_audit_log').insert({ admin_id: adminId, action, target_type: targetType, target_id: targetId, metadata });
};

// A config is a boolean flag when its stored value is exactly 'true'/'false' —
// those render as a toggle switch instead of a free-text box.
const isBool = (v) => { const s = String(v).trim().toLowerCase(); return s === 'true' || s === 'false'; };

// Numeric keys that render as a clamped +/- stepper instead of a free-text box.
// Keyed by config key → { step, min, max, unit }. Value is stored as a plain
// integer string. A stepper flips + saves in a single tap (no edit/confirm step).
const STEPPERS = {
    min_gym_dwell_minutes: { step: 5, min: 5, max: 60, unit: 'min' },
    // Upgrade tier threshold. Setting it at/below the dwell threshold is allowed
    // and simply collapses the tiers (any qualifying session earns the upgrade
    // tier immediately) — the server stays coherent either way.
    gym_upgrade_minutes: { step: 5, min: 10, max: 120, unit: 'min' },
    // Vault economy. Vesting window applies to NEW deposits only; per-tier
    // level-up bonuses take effect on the next level crossing. min 0 on a
    // bonus disables that tier (the trigger skips 0-bonus deposits).
    vault_vest_days:     { step: 5,  min: 5, max: 365,  unit: 'days' },
    // Days a matured deposit waits for the user's press-and-hold unlock
    // before the cron auto-releases it. 0 = auto-release immediately.
    vault_auto_release_grace_days: { step: 1, min: 0, max: 30, unit: 'days' },
    // Level floor before POWR can leave the Vault. 1 = off (everyone is at
    // least level 1). Below it BOTH doors stay shut — the press-and-hold claim
    // and the grace auto-release — so raising this genuinely withholds POWR
    // rather than just hiding the button.
    vault_unlock_min_level: { step: 1, min: 1, max: 20, unit: 'level' },
    vault_bonus_recruit: { step: 5,  min: 0, max: 500,  unit: 'pts' },
    vault_bonus_athlete: { step: 10, min: 0, max: 1000, unit: 'pts' },
    vault_bonus_elite:   { step: 25, min: 0, max: 2000, unit: 'pts' },
    vault_bonus_legend:  { step: 50, min: 0, max: 5000, unit: 'pts' },
};
const clampStep = (n, { step, min, max }) => {
    const snapped = Math.round(n / step) * step;
    return Math.min(max, Math.max(min, snapped));
};

// ── Presentation metadata ──────────────────────────────────────────────
// Groups give the flat system_config table a legible shape. Order here is the
// order shown on the page. Any key NOT listed in a group falls through to an
// "Other" catch-all so future config rows never silently disappear.
const GROUPS = [
    {
        id: 'points', title: 'Points Economy', icon: Coins, accent: '#E8D200',
        blurb: 'Base POWR earned per session and the daily earning limits.',
        keys: ['base_points_per_session', 'max_daily_sessions', 'streak_multiplier'],
    },
    {
        id: 'gym', title: 'Gym Check-in', icon: MapPin, accent: '#10B981',
        blurb: 'Geofence radius and the dwell timers that gate gym points.',
        keys: ['min_gym_dwell_minutes', 'gym_upgrade_minutes', 'geofence_radius_m'],
    },
    {
        id: 'vault', title: 'Points Vault', icon: Vault, accent: '#8B5CF6',
        blurb: 'Vesting bonuses, daily-cap overflow banking and release timing.',
        keys: [
            // Rollout first: who can see the Vault at all frames everything below it.
            'vault_rollout',
            'vault_cap_overflow_enabled', 'vault_level_up_enabled', 'vault_vest_days',
            'vault_auto_release_grace_days', 'vault_unlock_min_level',
            'vault_bonus_recruit', 'vault_bonus_athlete',
            'vault_bonus_elite', 'vault_bonus_legend',
        ],
    },
    {
        id: 'streaks', title: 'Streaks & Nudges', icon: Flame, accent: '#EF4444',
        blurb: 'Master rescue switch and the daily nudge budget. Rescue challenge design (what earns a streak back) lives on its own Streak Rescue page; per-type copy and kill-switches on Notifications.',
        keys: [
            'streak_rescue_enabled', 'streak_rescue_min_streak', 'streak_rescue_cooldown_days',
            'nudge_daily_cap', 'streak_at_risk_min_streak',
        ],
    },
    {
        id: 'trust', title: 'Trust & Safety', icon: ShieldCheck, accent: '#F97316',
        blurb: 'Fraud thresholds that auto-flag sessions for admin review.',
        keys: ['flagged_trust_threshold'],
    },
    {
        id: 'devices', title: 'Devices & Accounts', icon: Smartphone, accent: '#3B82F6',
        blurb: 'Guardrails on self-service device transfers.',
        keys: ['device_transfer_max_per_30d', 'device_transfer_stale_days'],
    },
    {
        id: 'release', title: 'App Release', icon: Rocket, accent: '#06B6D4',
        blurb: 'Bump these when a release goes live on its store — the app shows an update banner to anyone running an older version. Also the version to type into a Broadcast "below version" nudge.',
        keys: ['latest_ios_version', 'latest_android_version'],
    },
    {
        id: 'partner', title: 'Partner Portal', icon: Store, accent: '#EC4899',
        blurb: 'Feature flags for the brand-facing partner portal.',
        keys: ['partner_placements_enabled'],
    },
    {
        id: 'content', title: 'App Content', icon: Sparkles, accent: '#14B8A6',
        blurb: 'Home-screen content edited in its own dedicated screen.',
        keys: ['weekly_challenges'],
    },
];

// Friendly titles. Falls back to a prettified key when a row isn't listed.
const LABELS = {
    base_points_per_session: 'Base points per session',
    max_daily_sessions: 'Point-earning sessions per day',
    streak_multiplier: 'Streak multiplier',
    min_gym_dwell_minutes: 'Dwell to earn the base gym point',
    gym_upgrade_minutes: 'Dwell to unlock the upgrade tier',
    geofence_radius_m: 'Geofence radius',
    flagged_trust_threshold: 'Auto-flag trust threshold',
    vault_cap_overflow_enabled: 'Bank daily-cap overflow',
    vault_level_up_enabled: 'Bank level-up bonuses',
    vault_vest_days: 'Vesting period',
    vault_auto_release_grace_days: 'Auto-release grace period',
    vault_bonus_recruit: 'Recruit bonus (lv 2–5)',
    vault_bonus_athlete: 'Athlete bonus (lv 6–10)',
    vault_bonus_elite: 'Elite bonus (lv 11–15)',
    vault_bonus_legend: 'Legend bonus (lv 16–20)',
    streak_rescue_enabled: 'Offer streak rescues',
    streak_rescue_window_hours: 'Rescue window',
    streak_rescue_sessions_required: 'Sessions to restore',
    streak_rescue_min_streak: 'Minimum streak to qualify',
    streak_rescue_cooldown_days: 'Cooldown between rescues',
    nudge_daily_cap: 'Nudge pushes per day',
    streak_at_risk_min_streak: 'Streak-warning minimum',
    device_transfer_max_per_30d: 'Max transfers per 30 days',
    device_transfer_stale_days: 'Stale-device threshold',
    latest_ios_version: 'Latest App Store version',
    latest_android_version: 'Latest Play Store version',
    partner_placements_enabled: 'Self-serve placements',
    weekly_challenges: 'Weekly challenges',
};

// Unit suffix shown beside free-text numeric inputs (steppers carry their own).
const UNITS = {
    streak_rescue_window_hours: 'h',
    streak_rescue_sessions_required: 'sessions',
    streak_rescue_min_streak: 'days',
    streak_rescue_cooldown_days: 'days',
    nudge_daily_cap: '/ day',
    streak_at_risk_min_streak: 'days',
    base_points_per_session: 'pts',
    max_daily_sessions: '/ day',
    streak_multiplier: '×',
    flagged_trust_threshold: 'score',
    geofence_radius_m: 'm',
};

// Keys whose value is edited elsewhere — link out instead of a raw text box.
const MANAGED = {
    weekly_challenges: { to: '/admin/challenges', cta: 'Edit on Challenges' },
    // Rescue eligibility is tuned on the dedicated page next to the challenge
    // templates it applies to — one home for the whole feature.
    streak_rescue_min_streak:    { to: '/admin/streak-rescue', cta: 'Edit on Streak Rescue' },
    streak_rescue_cooldown_days: { to: '/admin/streak-rescue', cta: 'Edit on Streak Rescue' },
    // A JSON blob with cohort rules — it is read by a STABLE function on the
    // app-load path, so hand-editing it in a 128px text box is a good way to
    // black out the Vault. The Vault page has a real editor with validation.
    vault_rollout: { to: '/admin/vault', cta: 'Edit on Vault' },
};

const prettyKey = (k) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const labelFor = (k) => LABELS[k] || prettyKey(k);

export default function SystemConfig() {
    const toast = useToast();
    const { user } = useAuth();
    const [configs, setConfigs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState({}); // key -> new value
    const [saving, setSaving] = useState(null);
    const [query, setQuery] = useState('');

    useEffect(() => { fetchConfigs(); }, []);

    const fetchConfigs = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.from('system_config').select('*').order('key');
            if (error) throw error;
            setConfigs(data || []);
        } catch (e) {
            toast.error('Failed to load config');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const persist = async (key, newValue) => {
        setSaving(key);
        const oldConfig = configs.find(c => c.key === key);
        const { error } = await supabase
            .from('system_config')
            .update({ value: newValue, updated_at: new Date().toISOString(), updated_by: user.id })
            .eq('key', key);
        if (error) { toast.error(error.message); setSaving(null); return; }
        await logAction(user.id, 'config_update', 'system_config', key, { old_value: oldConfig?.value, new_value: newValue });
        toast.success(`${labelFor(key)} updated`);
        setEditing(prev => { const next = { ...prev }; delete next[key]; return next; });
        setSaving(null);
        fetchConfigs();
    };

    const handleSave = (key) => {
        const newValue = editing[key];
        if (newValue === undefined) return;
        persist(key, newValue);
    };

    // Boolean flags flip + save in a single tap (no edit/confirm step).
    const handleToggle = (key, nextValue) => persist(key, nextValue);

    const handleReset = (key) => {
        setEditing(prev => { const next = { ...prev }; delete next[key]; return next; });
    };

    // Bucket configs into their groups + an "Other" catch-all, honouring search.
    const { sections, matchCount } = useMemo(() => {
        const q = query.trim().toLowerCase();
        const matches = (c) => !q
            || c.key.toLowerCase().includes(q)
            || labelFor(c.key).toLowerCase().includes(q)
            || (c.description || '').toLowerCase().includes(q);

        const byKey = new Map(configs.map(c => [c.key, c]));
        const claimed = new Set();
        const out = [];
        let count = 0;

        for (const g of GROUPS) {
            const rows = [];
            for (const key of g.keys) {
                const c = byKey.get(key);
                if (!c) continue;
                claimed.add(key);
                if (matches(c)) rows.push(c);
            }
            if (rows.length) { out.push({ ...g, rows }); count += rows.length; }
        }

        const leftovers = configs.filter(c => !claimed.has(c.key) && matches(c));
        if (leftovers.length) {
            out.push({ id: 'other', title: 'Other', icon: SlidersHorizontal, accent: '#9CA3AF', blurb: 'Uncategorised parameters.', rows: leftovers });
            count += leftovers.length;
        }
        return { sections: out, matchCount: count };
    }, [configs, query]);

    const renderControl = (c) => {
        const managed = MANAGED[c.key];
        if (managed) {
            return (
                <Link
                    to={managed.to}
                    className="inline-flex items-center gap-2 h-11 px-4 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] text-[11px] font-bold uppercase tracking-[0.2em] text-[#555555] hover:text-[#1A1A1A] hover:border-[#D8D8D2] transition-all"
                >
                    {managed.cta}
                    <ExternalLink size={13} />
                </Link>
            );
        }

        const isEdited = editing[c.key] !== undefined;
        const currentValue = isEdited ? editing[c.key] : c.value;
        const bool = isBool(c.value);
        const on = String(currentValue).trim().toLowerCase() === 'true';
        const stepCfg = STEPPERS[c.key];

        if (stepCfg) {
            const stepVal = clampStep(parseInt(c.value, 10) || stepCfg.min, stepCfg);
            return (
                <>
                    <button
                        type="button"
                        aria-label={`Decrease ${labelFor(c.key)}`}
                        disabled={saving === c.key || stepVal <= stepCfg.min}
                        onClick={() => handleToggle(c.key, String(clampStep(stepVal - stepCfg.step, stepCfg)))}
                        className="w-11 h-11 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#666666] hover:text-[#1A1A1A] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Minus size={16} />
                    </button>
                    <div className="w-24 text-center">
                        <span className="font-mono text-lg font-bold text-[#1A1A1A]">{stepVal}</span>
                        <span className="text-[10px] text-[#888888] font-black uppercase tracking-[0.2em] ml-1">{stepCfg.unit}</span>
                    </div>
                    <button
                        type="button"
                        aria-label={`Increase ${labelFor(c.key)}`}
                        disabled={saving === c.key || stepVal >= stepCfg.max}
                        onClick={() => handleToggle(c.key, String(clampStep(stepVal + stepCfg.step, stepCfg)))}
                        className="w-11 h-11 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#666666] hover:text-[#1A1A1A] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Plus size={16} />
                    </button>
                </>
            );
        }

        if (bool) {
            return (
                <>
                    <span className={`text-[10px] font-black uppercase tracking-[0.3em] w-8 text-right ${on ? 'text-[#10B981]' : 'text-[#BBBBBB]'}`}>{on ? 'On' : 'Off'}</span>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        disabled={saving === c.key}
                        onClick={() => handleToggle(c.key, on ? 'false' : 'true')}
                        className={`relative w-14 h-8 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-[#10B981]' : 'bg-[#D8D8D2]'}`}
                    >
                        <span className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : ''}`} />
                    </button>
                </>
            );
        }

        const unit = UNITS[c.key];
        return (
            <>
                <div className="relative">
                    <input
                        type="text"
                        value={currentValue}
                        onChange={e => setEditing(prev => ({ ...prev, [c.key]: e.target.value }))}
                        className={`w-32 h-11 px-4 ${unit ? 'pr-12' : ''} bg-[#F4F4F1] border rounded-xl text-center font-mono text-sm text-[#1A1A1A] outline-none transition-all focus:border-[#8B5CF6]/40 ${isEdited ? 'border-[#E8D200]/60' : 'border-[#E6E6E1]'}`}
                    />
                    {unit && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#999999] font-black uppercase tracking-[0.15em] pointer-events-none">{unit}</span>
                    )}
                </div>
                {isEdited && (
                    <>
                        <button
                            onClick={() => handleSave(c.key)}
                            disabled={saving === c.key}
                            className="w-11 h-11 rounded-xl bg-[#10B981]/10 border border-[#10B981]/20 flex items-center justify-center text-[#10B981] hover:bg-[#10B981]/20 transition-all disabled:opacity-50"
                            aria-label="Save"
                        >
                            <Save size={16} />
                        </button>
                        <button
                            onClick={() => handleReset(c.key)}
                            className="w-11 h-11 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#666666] hover:text-[#1A1A1A] transition-all"
                            aria-label="Discard"
                        >
                            <RotateCcw size={16} />
                        </button>
                    </>
                )}
            </>
        );
    };

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {/* Header */}
            <div className="mb-12">
                <div className="flex items-center gap-3 mb-6">
                    <div className="h-[1px] w-12 bg-[#8B5CF6]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8B5CF6] font-black">Subsystem / Core</span>
                </div>
                <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-5">System Config</h1>
                <p className="text-[#666666] text-sm max-w-2xl leading-relaxed">
                    Tunable platform parameters, grouped by what they control. Changes take effect
                    immediately across the network and every edit is written to the audit trail.
                </p>
            </div>

            {/* Toolbar: search */}
            {!loading && configs.length > 0 && (
                <div className="flex items-center justify-between gap-4 mb-8">
                    <div className="relative flex-1 max-w-sm">
                        <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#AAAAAA]" />
                        <input
                            type="text"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search parameters…"
                            className="w-full h-11 pl-11 pr-4 bg-white border border-[#E6E6E1] rounded-xl text-sm text-[#1A1A1A] placeholder:text-[#AAAAAA] outline-none focus:border-[#8B5CF6]/40 transition-all"
                        />
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.35em] text-[#999999] font-black shrink-0">
                        {query ? `${matchCount} match${matchCount === 1 ? '' : 'es'}` : `${configs.length} parameters`}
                    </span>
                </div>
            )}

            {loading ? (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl flex flex-col items-center justify-center py-32 gap-6">
                    <div className="w-12 h-12 border-2 border-[#8B5CF6]/20 border-t-[#8B5CF6] rounded-full animate-spin" />
                    <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Loading Config Kernel...</span>
                </div>
            ) : configs.length === 0 ? (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl p-20 text-center">
                    <Settings size={48} className="mx-auto text-[#333333] mb-6" />
                    <p className="text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black">No config parameters found</p>
                </div>
            ) : sections.length === 0 ? (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl p-20 text-center">
                    <Search size={40} className="mx-auto text-[#CCCCCC] mb-5" />
                    <p className="text-[11px] uppercase tracking-[0.35em] text-[#888888] font-black">No parameters match “{query}”</p>
                </div>
            ) : (
                <div className="space-y-10">
                    {sections.map(section => {
                        const Icon = section.icon;
                        return (
                            <section key={section.id}>
                                {/* Group header */}
                                <div className="flex items-center gap-4 mb-4 px-1">
                                    <div
                                        className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border"
                                        style={{ backgroundColor: `${section.accent}14`, borderColor: `${section.accent}33` }}
                                    >
                                        <Icon size={18} style={{ color: section.accent }} />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-3">
                                            <h2 className="text-lg font-bold text-[#1A1A1A] tracking-tight">{section.title}</h2>
                                            <span className="text-[10px] font-black text-[#AAAAAA] tabular-nums">{section.rows.length}</span>
                                        </div>
                                        <p className="text-[12px] text-[#888888] leading-snug">{section.blurb}</p>
                                    </div>
                                    <div className="flex-1 h-[1.5px] rounded-full" style={{ background: `linear-gradient(90deg, ${section.accent}40, transparent)` }} />
                                </div>

                                {/* Group card */}
                                <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden divide-y divide-[#F0F0EC]">
                                    {section.rows.map(c => (
                                        <div key={c.key} className="flex items-start gap-6 px-7 py-5 group hover:bg-[#FAFAF8] transition-colors">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                                                    <span className="text-[15px] font-semibold text-[#1A1A1A] leading-none">{labelFor(c.key)}</span>
                                                    <code className="text-[10px] font-mono text-[#999999] bg-[#F4F4F1] border border-[#EAEAE5] rounded-md px-1.5 py-0.5 leading-none">{c.key}</code>
                                                </div>
                                                <p className="text-[12.5px] text-[#777777] leading-relaxed max-w-2xl">{c.description || 'No description.'}</p>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0 pt-0.5">
                                                {renderControl(c)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}

            <div className="mt-10 px-1">
                <p className="text-[9px] uppercase tracking-[0.5em] text-[#AAAAAA] font-black">
                    All changes are logged in the audit trail. Handle with care.
                </p>
            </div>
        </div>
    );
}
