import React, { useEffect, useState } from 'react';
import { Gift, TrendingUp, BarChart3 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';

const fmt = (n) => (n ?? 0).toLocaleString();

export default function PartnerRedemptions() {
    const { partnerData } = useAuth();
    const [redemptions, setRedemptions] = useState([]);
    const [rewards, setRewards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState('30'); // days

    const brand = partnerData?.brand_name;

    useEffect(() => {
        if (!brand) return;
        fetchData();
    }, [brand, range]);

    const fetchData = async () => {
        setLoading(true);
        const since = new Date();
        since.setDate(since.getDate() - Number(range));

        // Reward ids first — supabase-js .in() needs a concrete array
        const { data: rwds } = await supabase
            .from('rewards')
            .select('id, title, powr_cost, active')
            .ilike('brand_name', brand);
        const rewardIds = (rwds ?? []).map(r => r.id);

        const { data: redems } = rewardIds.length
            ? await supabase
                .from('redemptions')
                .select('id, redeemed_at, reward_id, rewards(title)')
                .in('reward_id', rewardIds)
                .gte('redeemed_at', since.toISOString())
                .order('redeemed_at', { ascending: false })
                .limit(200)
            : { data: [] };

        setRewards(rwds ?? []);
        setRedemptions(redems ?? []);
        setLoading(false);
    };

    // Aggregate by reward
    const byReward = rewards.map(r => ({
        ...r,
        count: redemptions.filter(x => x.reward_id === r.id).length,
    })).sort((a, b) => b.count - a.count);

    const total = redemptions.length;

    // Group by day for the last N days
    const dayBuckets = {};
    redemptions.forEach(r => {
        const d = new Date(r.redeemed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        dayBuckets[d] = (dayBuckets[d] ?? 0) + 1;
    });
    const maxDay = Math.max(1, ...Object.values(dayBuckets));

    const RANGE_OPTIONS = [
        { value: '7',  label: 'Last 7 days' },
        { value: '30', label: 'Last 30 days' },
        { value: '90', label: 'Last 90 days' },
    ];

    return (
        <div className="py-16 animate-in fade-in slide-in-from-bottom-6 duration-700">
            {/* Header */}
            <div className="flex items-end justify-between mb-12">
                <div>
                    <div className="flex items-center gap-3 mb-5">
                        <div className="h-[1px] w-10 bg-[#8B5CF6]"></div>
                        <span className="text-[10px] uppercase tracking-[0.5em] text-[#8B5CF6] font-black">Analytics</span>
                    </div>
                    <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A]">Redemptions</h1>
                </div>
                <select
                    value={range}
                    onChange={e => setRange(e.target.value)}
                    className="h-12 px-6 bg-white border border-[#E6E6E1] rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] text-[#555] outline-none focus:border-[#E8D200]/30 cursor-pointer"
                >
                    {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-32">
                    <div className="w-8 h-8 border-2 border-[#8B5CF6]/20 border-t-[#8B5CF6] rounded-full animate-spin" />
                </div>
            ) : (
                <>
                    {/* Summary stat */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                        <div className="bg-white border border-[#E6E6E1] p-8 rounded-3xl">
                            <div className="flex items-center gap-3 mb-4">
                                <Gift size={18} className="text-[#8B5CF6]" />
                                <span className="text-[10px] uppercase tracking-[0.4em] font-black text-[#BBBBBB]">Total</span>
                            </div>
                            <div className="text-4xl font-light tracking-tighter text-[#1A1A1A]">{fmt(total)}</div>
                            <div className="text-[10px] uppercase tracking-[0.3em] text-[#BBB] font-black mt-1">redemptions</div>
                        </div>
                        <div className="bg-white border border-[#E6E6E1] p-8 rounded-3xl">
                            <div className="flex items-center gap-3 mb-4">
                                <TrendingUp size={18} className="text-[#10B981]" />
                                <span className="text-[10px] uppercase tracking-[0.4em] font-black text-[#BBBBBB]">Daily avg</span>
                            </div>
                            <div className="text-4xl font-light tracking-tighter text-[#1A1A1A]">{(total / Number(range)).toFixed(1)}</div>
                            <div className="text-[10px] uppercase tracking-[0.3em] text-[#BBB] font-black mt-1">per day</div>
                        </div>
                        <div className="bg-white border border-[#E6E6E1] p-8 rounded-3xl">
                            <div className="flex items-center gap-3 mb-4">
                                <BarChart3 size={18} className="text-[#E8D200]" />
                                <span className="text-[10px] uppercase tracking-[0.4em] font-black text-[#BBBBBB]">Rewards</span>
                            </div>
                            <div className="text-4xl font-light tracking-tighter text-[#1A1A1A]">{rewards.filter(r => r.active).length}</div>
                            <div className="text-[10px] uppercase tracking-[0.3em] text-[#BBB] font-black mt-1">live</div>
                        </div>
                    </div>

                    {/* By reward breakdown */}
                    {byReward.length > 0 && (
                        <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden mb-8">
                            <div className="px-8 py-6 border-b border-[#E6E6E1]">
                                <h3 className="text-lg font-light tracking-tighter text-[#1A1A1A]">By Reward</h3>
                            </div>
                            <div className="divide-y divide-[#F4F4F1]">
                                {byReward.map(r => (
                                    <div key={r.id} className="flex items-center gap-6 px-8 py-5">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-2">
                                                <span className="text-sm font-bold text-[#222]">{r.title}</span>
                                                {!r.active && <span className="text-[9px] uppercase tracking-[0.3em] text-[#BBB] font-black px-2 py-0.5 bg-[#F4F4F1] rounded-full">Inactive</span>}
                                            </div>
                                            {/* Bar */}
                                            <div className="h-1.5 bg-[#F4F4F1] rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-[#8B5CF6] rounded-full transition-all duration-700"
                                                    style={{ width: `${Math.round((r.count / Math.max(1, byReward[0].count)) * 100)}%` }}
                                                />
                                            </div>
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <div className="text-xl font-light tracking-tighter text-[#1A1A1A]">{fmt(r.count)}</div>
                                            <div className="text-[9px] uppercase tracking-[0.3em] text-[#BBB] font-black">redemptions</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Recent list */}
                    <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                        <div className="px-8 py-6 border-b border-[#E6E6E1]">
                            <h3 className="text-lg font-light tracking-tighter text-[#1A1A1A]">Recent Activity</h3>
                        </div>
                        {redemptions.length === 0 ? (
                            <div className="py-16 text-center">
                                <Gift size={28} className="text-[#E6E6E1] mx-auto mb-4" />
                                <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black">No redemptions in this period</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-[#F4F4F1] border-b border-[#E6E6E1]">
                                            {['Date & Time', 'Reward', ''].map(h => (
                                                <th key={h} className="px-8 py-4 text-[10px] font-black uppercase tracking-[0.4em] text-[#888]">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#F4F4F1]">
                                        {redemptions.slice(0, 50).map(r => (
                                            <tr key={r.id} className="hover:bg-[#FAFAFA] transition-colors">
                                                <td className="px-8 py-4 text-[12px] font-black text-[#666]">
                                                    {new Date(r.redeemed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                </td>
                                                <td className="px-8 py-4 text-sm font-bold text-[#222]">{r.rewards?.title ?? '—'}</td>
                                                <td className="px-8 py-4">
                                                    <div className="flex items-center gap-2 justify-end">
                                                        <div className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
                                                        <span className="text-[9px] uppercase tracking-[0.3em] text-[#BBB] font-black">Claimed</span>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {redemptions.length > 50 && (
                                    <div className="px-8 py-4 text-center text-[10px] text-[#BBB] font-black uppercase tracking-[0.3em]">
                                        Showing 50 of {fmt(redemptions.length)} — narrow the date range to see more
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
