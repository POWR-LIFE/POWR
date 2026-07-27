import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gift, TrendingUp, BarChart3, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';

const fmt = (n) => (n ?? 0).toLocaleString();

export default function PartnerRedemptions() {
    const { partnerData, deliveryMethod } = useAuth();
    const [redemptions, setRedemptions] = useState([]);
    const [rewards, setRewards] = useState([]);
    const [everRedeemed, setEverRedeemed] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [range, setRange] = useState('30'); // days

    const brand = partnerData?.brand_name;

    useEffect(() => {
        if (!brand) return;
        fetchData();
    }, [brand, range]);

    const fetchData = async () => {
        setLoading(true);
        setLoadError(false);
        const since = new Date();
        since.setDate(since.getDate() - Number(range));

        try {
            // Reward ids first — supabase-js .in() needs a concrete array.
            // It resolves rather than throws on a query error, so the error
            // has to be raised by hand: an RLS or PostgREST failure returns
            // no rows, and silently reads as "this brand has no rewards".
            const { data: rwds, error: rwdsError } = await supabase
                .from('rewards')
                .select('id, title, powr_cost, active')
                .ilike('brand_name', brand);
            if (rwdsError) throw rwdsError;
            const rewardIds = (rwds ?? []).map(r => r.id);

            // The selected window can hide a brand's entire history, so
            // "have they ever redeemed" is a separate unbounded probe — it
            // decides first-run, which the range must never fake.
            const [redems, ever] = rewardIds.length
                ? await Promise.all([
                    supabase
                        .from('redemptions')
                        .select('id, redeemed_at, reward_id, rewards(title)')
                        .in('reward_id', rewardIds)
                        .gte('redeemed_at', since.toISOString())
                        .order('redeemed_at', { ascending: false })
                        .limit(200),
                    supabase
                        .from('redemptions')
                        .select('id')
                        .in('reward_id', rewardIds)
                        .limit(1),
                ])
                : [{ data: [] }, { data: [] }];

            setRewards(rwds ?? []);
            setRedemptions(redems.data ?? []);
            setEverRedeemed((ever.data ?? []).length > 0);
        } catch (e) {
            console.error('[PartnerRedemptions]', e);
            setLoadError(true);
        } finally {
            setLoading(false);
        }
    };

    // Aggregate by reward — rewards nobody claimed are dropped rather than
    // padding the chart with empty bars.
    const byReward = rewards.map(r => ({
        ...r,
        count: redemptions.filter(x => x.reward_id === r.id).length,
    })).filter(r => r.count > 0).sort((a, b) => b.count - a.count);

    const total = redemptions.length;
    const activeCount = rewards.filter(r => r.active).length;

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
    // Named window, so an empty panel says which stretch of time it means
    const rangeLabel = (RANGE_OPTIONS.find(o => o.value === range)?.label ?? `Last ${range} days`).toLowerCase();

    // Both the figures and the delivery method have to land before anything
    // is decided — a grid of zeros that turns into an empty state reads as
    // broken.
    const ready = !loading && deliveryMethod !== undefined;
    // Analytics earn their place once there is something to measure: a live
    // reward, or a redemption at some point in the brand's history. Counting
    // rows in the selected window instead would show a brand with two years
    // of claims a "create your first reward" page for picking Last 7 days.
    const firstRun = ready && !loadError && activeCount === 0 && !everRedeemed;

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
                {/* Nothing to narrow down before the first reward is live */}
                {!firstRun && (
                    <select
                        value={range}
                        onChange={e => setRange(e.target.value)}
                        className="h-12 px-6 bg-white border border-[#E6E6E1] rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] text-[#555] outline-none focus:border-[#E8D200]/30 cursor-pointer"
                    >
                        {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                )}
            </div>

            {!ready ? (
                <div className="flex items-center justify-center py-32">
                    <div className="w-8 h-8 border-2 border-[#8B5CF6]/20 border-t-[#8B5CF6] rounded-full animate-spin" />
                </div>
            ) : loadError ? (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl py-16 px-8 text-center">
                    <BarChart3 size={28} className="text-[#E6E6E1] mx-auto mb-5" />
                    <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black">Couldn't load your figures</p>
                    <p className="text-xs text-[#BBBBBB] mt-3 max-w-sm mx-auto leading-relaxed">
                        Something went wrong fetching your redemptions. Nothing on your account has changed.
                    </p>
                    <button
                        type="button"
                        onClick={fetchData}
                        className="mt-8 h-10 px-6 bg-white border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600] transition-all"
                    >
                        Try again
                    </button>
                </div>
            ) : firstRun ? (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl py-16 px-8 text-center">
                    <Gift size={28} className="text-[#E6E6E1] mx-auto mb-5" />
                    <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black">No redemptions to report</p>
                    <p className="text-xs text-[#BBBBBB] mt-3 max-w-sm mx-auto leading-relaxed">
                        {rewards.length === 0
                            ? 'You have not created a reward yet. Once one is live, every member claim lands here with daily totals and a breakdown by reward.'
                            : 'None of your rewards are live yet, so there is nothing for members to claim. Your figures start building the moment one is approved.'}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
                        <Link
                            to="/partner/rewards"
                            className="inline-flex items-center gap-2 h-10 px-6 bg-[#E8D200] text-[#080808] text-[9px] font-black uppercase tracking-[0.2em] rounded-full hover:brightness-95 transition-all"
                        >
                            {rewards.length === 0 ? 'Create your first reward' : 'View my rewards'} <ChevronRight size={12} />
                        </Link>
                        {deliveryMethod === null && (
                            <Link
                                to="/partner/integration"
                                className="inline-flex items-center h-10 px-6 bg-white border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600] transition-all"
                            >
                                Choose delivery method
                            </Link>
                        )}
                    </div>
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
                            <div className="text-4xl font-light tracking-tighter text-[#1A1A1A]">{activeCount}</div>
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
                                <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black">No redemptions in the {rangeLabel}</p>
                                <p className="text-xs text-[#BBBBBB] mt-3 max-w-sm mx-auto leading-relaxed">
                                    {activeCount > 0
                                        ? 'Your live rewards are still in the app — claims will appear here as members make them. Widen the range to see older activity.'
                                        : 'You have nothing live at the moment, so there is nothing for members to claim.'}
                                </p>
                                <Link
                                    to="/partner/rewards"
                                    className={`inline-flex items-center gap-2 h-10 px-6 mt-8 rounded-full text-[9px] font-black uppercase tracking-[0.2em] transition-all ${
                                        activeCount > 0
                                            ? 'bg-white border border-[#E6E6E1] text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600]'
                                            : 'bg-[#E8D200] text-[#080808] hover:brightness-95'
                                    }`}
                                >
                                    {activeCount > 0 ? 'View my rewards' : 'Get a reward live'} <ChevronRight size={12} />
                                </Link>
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
