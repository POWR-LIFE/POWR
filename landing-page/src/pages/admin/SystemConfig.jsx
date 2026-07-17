import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { Settings, Save, RotateCcw, Minus, Plus } from 'lucide-react';

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
    vault_bonus_recruit: { step: 5,  min: 0, max: 500,  unit: 'pts' },
    vault_bonus_athlete: { step: 10, min: 0, max: 1000, unit: 'pts' },
    vault_bonus_elite:   { step: 25, min: 0, max: 2000, unit: 'pts' },
    vault_bonus_legend:  { step: 50, min: 0, max: 5000, unit: 'pts' },
};
const clampStep = (n, { step, min, max }) => {
    const snapped = Math.round(n / step) * step;
    return Math.min(max, Math.max(min, snapped));
};

export default function SystemConfig() {
    const toast = useToast();
    const { user } = useAuth();
    const [configs, setConfigs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState({}); // key -> new value
    const [saving, setSaving] = useState(null);

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
        toast.success(`${key} updated`);
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

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <div className="mb-20">
                <div className="flex items-center gap-3 mb-6">
                    <div className="h-[1px] w-12 bg-[#8B5CF6]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8B5CF6] font-black">Subsystem / Core</span>
                </div>
                <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-6">System Config</h1>
                <p className="text-[#666666] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                    Tunable platform parameters. Changes take effect immediately across the network.
                </p>
            </div>

            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-32 gap-6">
                        <div className="w-12 h-12 border-2 border-[#8B5CF6]/20 border-t-[#8B5CF6] rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Loading Config Kernel...</span>
                    </div>
                ) : configs.length === 0 ? (
                    <div className="p-20 text-center">
                        <Settings size={48} className="mx-auto text-[#333333] mb-6" />
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black">No config parameters found</p>
                    </div>
                ) : (
                    <div className="divide-y divide-[#E6E6E1]">
                        {configs.map(c => {
                            const isEdited = editing[c.key] !== undefined;
                            const currentValue = isEdited ? editing[c.key] : c.value;
                            const bool = isBool(c.value);
                            const on = String(currentValue).trim().toLowerCase() === 'true';
                            const stepCfg = STEPPERS[c.key];
                            const stepVal = stepCfg ? clampStep(parseInt(c.value, 10) || stepCfg.min, stepCfg) : null;
                            return (
                                <div key={c.key} className="flex items-center gap-10 p-10 group hover:bg-[#F4F4F1] transition-all">
                                    <div className="w-14 h-14 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center shrink-0">
                                        <Settings size={18} className="text-[#666666]" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-base font-bold text-[#222222] mb-1 font-mono">{c.key}</div>
                                        <div className="text-[10px] text-[#666666] font-black uppercase tracking-[0.3em]">{c.description || 'No description'}</div>
                                    </div>
                                    <div className="flex items-center gap-4 shrink-0">
                                        {stepCfg ? (
                                            <>
                                                <button
                                                    type="button"
                                                    aria-label={`Decrease ${c.key}`}
                                                    disabled={saving === c.key || stepVal <= stepCfg.min}
                                                    onClick={() => handleToggle(c.key, String(clampStep(stepVal - stepCfg.step, stepCfg)))}
                                                    className="w-12 h-12 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#666666] hover:text-[#1A1A1A] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                                >
                                                    <Minus size={16} />
                                                </button>
                                                <div className="w-24 text-center">
                                                    <span className="font-mono text-lg font-bold text-[#1A1A1A]">{stepVal}</span>
                                                    <span className="text-[10px] text-[#888888] font-black uppercase tracking-[0.2em] ml-1">{stepCfg.unit}</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    aria-label={`Increase ${c.key}`}
                                                    disabled={saving === c.key || stepVal >= stepCfg.max}
                                                    onClick={() => handleToggle(c.key, String(clampStep(stepVal + stepCfg.step, stepCfg)))}
                                                    className="w-12 h-12 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#666666] hover:text-[#1A1A1A] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                                >
                                                    <Plus size={16} />
                                                </button>
                                            </>
                                        ) : bool ? (
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
                                        ) : (
                                            <>
                                                <input
                                                    type="text"
                                                    value={currentValue}
                                                    onChange={e => setEditing(prev => ({ ...prev, [c.key]: e.target.value }))}
                                                    className={`w-32 h-12 px-4 bg-[#F4F4F1] border rounded-xl text-center font-mono text-sm text-[#1A1A1A] outline-none transition-all ${isEdited ? 'border-[#E8D200]/40' : 'border-[#E6E6E1]'}`}
                                                />
                                                {isEdited && (
                                                    <>
                                                        <button
                                                            onClick={() => handleSave(c.key)}
                                                            disabled={saving === c.key}
                                                            className="w-12 h-12 rounded-xl bg-[#10B981]/10 border border-[#10B981]/20 flex items-center justify-center text-[#10B981] hover:bg-[#10B981]/20 transition-all disabled:opacity-50"
                                                        >
                                                            <Save size={16} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleReset(c.key)}
                                                            className="w-12 h-12 rounded-xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#666666] hover:text-[#1A1A1A] transition-all"
                                                        >
                                                            <RotateCcw size={16} />
                                                        </button>
                                                    </>
                                                )}
                                            </>
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
                    All changes are logged in the audit trail. Handle with care.
                </p>
            </div>
        </div>
    );
}
