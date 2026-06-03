import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { Gift, Users, TrendingUp, Clock, Award, Package } from 'lucide-react';

export default function RedemptionTracker() {
    const toast = useToast();
    const [loading, setLoading] = useState(true);
    const [redemptions, setRedemptions] = useState([]);
    const [stats, setStats] = useState({ total: 0, active: 0, used: 0, expired: 0 });

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('redemptions')
                .select('*, rewards(title, powr_cost, category), profiles:user_id(display_name, username)')
                .order('redeemed_at', { ascending: false });
            if (error) throw error;

            const list = data || [];
            setRedemptions(list);
            setStats({
                total: list.length,
                active: list.filter(r => r.status === 'active').length,
                used: list.filter(r => r.status === 'used').length,
                expired: list.filter(r => r.status === 'expired').length,
            });
        } catch (e) {
            toast.error('Failed to load redemptions');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <div className="mb-20">
                <div className="flex items-center gap-3 mb-6">
                    <div className="h-[1px] w-12 bg-[#10B981]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#10B981] font-black">Subsystem / Rewards</span>
                </div>
                <h1 className="text-6xl font-light tracking-tighter text-[#1A1A1A] mb-6">Redemption Tracker</h1>
                <p className="text-[#666666] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                    Real-time inventory and redemption velocity across the reward ecosystem.
                </p>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 mb-20">
                {[
                    { label: 'Total Redeemed', value: stats.total, icon: Gift, color: '#10B981' },
                    { label: 'Active Codes', value: stats.active, icon: Package, color: '#8a7600' },
                    { label: 'Used', value: stats.used, icon: Award, color: '#0EA5E9' },
                    { label: 'Expired', value: stats.expired, icon: Clock, color: '#F43F5E' },
                ].map(c => (
                    <div key={c.label} className="bg-white border border-[#E6E6E1] p-10 rounded-3xl group hover:border-[#E6E6E1] transition-all">
                        <div className="flex items-center gap-3 mb-6">
                            <c.icon size={16} style={{ color: c.color }} />
                            <span className="text-[9px] uppercase tracking-[0.4em] text-[#666666] font-black">{c.label}</span>
                        </div>
                        <div className="text-5xl font-light tracking-tighter text-[#222222] leading-none">
                            {loading ? '...' : c.value}
                        </div>
                    </div>
                ))}
            </div>

            {/* Table */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-32 gap-6">
                        <div className="w-12 h-12 border-2 border-[#10B981]/20 border-t-[#10B981] rounded-full animate-spin" />
                        <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Loading Redemptions...</span>
                    </div>
                ) : redemptions.length === 0 ? (
                    <div className="p-20 text-center">
                        <Gift size={48} className="mx-auto text-[#333333] mb-6" />
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#888888] font-black">No redemptions recorded</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-[#F4F4F1] border-b border-[#E6E6E1]">
                                    {['User', 'Reward', 'Code', 'Cost', 'Status', 'Date'].map(h => (
                                        <th key={h} className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.5em] text-[#888888]">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E6E6E1]">
                                {redemptions.map(r => (
                                    <tr key={r.id} className="group hover:bg-[#F4F4F1] transition-all">
                                        <td className="px-6 py-5">
                                            <span className="text-sm font-bold text-[#222222]">{r.profiles?.display_name || r.profiles?.username || 'Unknown'}</span>
                                        </td>
                                        <td className="px-6 py-5">
                                            <span className="text-sm text-[#BBB]">{r.rewards?.title || 'Unknown Reward'}</span>
                                        </td>
                                        <td className="px-6 py-5">
                                            <span className="font-mono text-xs text-[#8a7600] bg-white px-3 py-1 rounded-lg border border-[#E6E6E1] uppercase tracking-[0.2em]">{r.code}</span>
                                        </td>
                                        <td className="px-6 py-5">
                                            <span className="text-sm font-bold text-[#BBB]">{r.rewards?.powr_cost || 0} pts</span>
                                        </td>
                                        <td className="px-6 py-5">
                                            <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.2em] ${
                                                r.status === 'active' ? 'bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20' :
                                                r.status === 'used' ? 'bg-[#0EA5E9]/10 text-[#0EA5E9] border border-[#0EA5E9]/20' :
                                                'bg-[#F43F5E]/10 text-[#F43F5E] border border-[#F43F5E]/20'
                                            }`}>{r.status}</span>
                                        </td>
                                        <td className="px-6 py-5 text-[11px] text-[#BBB]">
                                            {new Date(r.redeemed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
