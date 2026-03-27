import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../App';
import { Settings, Save, RotateCcw } from 'lucide-react';

const logAction = async (adminId, action, targetType, targetId, metadata = {}) => {
    await supabase.from('admin_audit_log').insert({ admin_id: adminId, action, target_type: targetType, target_id: targetId, metadata });
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

    const handleSave = async (key) => {
        const newValue = editing[key];
        if (newValue === undefined) return;
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
                <h1 className="text-6xl font-light tracking-tighter text-[#F2F2F2] mb-6">System Config</h1>
                <p className="text-[#333] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                    Tunable platform parameters. Changes take effect immediately across the network.
                </p>
            </div>

            <div className="bg-[#0A0A0A] border border-[#151515] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-32 gap-6">
                        <div className="w-12 h-12 border-2 border-[#8B5CF6]/20 border-t-[#8B5CF6] rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.6em] text-[#222] font-black">Loading Config Kernel...</span>
                    </div>
                ) : configs.length === 0 ? (
                    <div className="p-20 text-center">
                        <Settings size={48} className="mx-auto text-[#151515] mb-6" />
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#1A1A1A] font-black">No config parameters found</p>
                    </div>
                ) : (
                    <div className="divide-y divide-[#111]">
                        {configs.map(c => {
                            const isEdited = editing[c.key] !== undefined;
                            const currentValue = isEdited ? editing[c.key] : c.value;
                            return (
                                <div key={c.key} className="flex items-center gap-10 p-10 group hover:bg-[#080808] transition-all">
                                    <div className="w-14 h-14 rounded-2xl bg-[#050505] border border-[#151515] flex items-center justify-center shrink-0">
                                        <Settings size={18} className="text-[#333]" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-base font-bold text-[#DDD] mb-1 font-mono">{c.key}</div>
                                        <div className="text-[10px] text-[#333] font-black uppercase tracking-[0.3em]">{c.description || 'No description'}</div>
                                    </div>
                                    <div className="flex items-center gap-4 shrink-0">
                                        <input
                                            type="text"
                                            value={currentValue}
                                            onChange={e => setEditing(prev => ({ ...prev, [c.key]: e.target.value }))}
                                            className={`w-32 h-12 px-4 bg-[#050505] border rounded-xl text-center font-mono text-sm text-[#F2F2F2] outline-none transition-all ${isEdited ? 'border-[#E8D200]/40' : 'border-[#151515]'}`}
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
                                                    className="w-12 h-12 rounded-xl bg-[#050505] border border-[#151515] flex items-center justify-center text-[#333] hover:text-[#F2F2F2] transition-all"
                                                >
                                                    <RotateCcw size={16} />
                                                </button>
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
                <p className="text-[9px] uppercase tracking-[0.5em] text-[#1A1A1A] font-black">
                    All changes are logged in the audit trail. Handle with care.
                </p>
            </div>
        </div>
    );
}
