import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, Gift, Inbox, ChevronRight, TrendingUp, FilePenLine, CircleAlert, Ticket } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';

const timeAgo = (dateStr) => {
    if (!dateStr) return '—';
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
};

export default function PartnerHome() {
    const { partnerData } = useAuth();
    const [stats, setStats] = useState({ activeRewards: 0, monthRedemptions: 0, pendingSubmissions: 0 });
    const [recentRedemptions, setRecentRedemptions] = useState([]);
    const [actions, setActions] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!partnerData?.brand_name) return;
        const brand = partnerData.brand_name;

        const fetchAll = async () => {
            try {
                const monthStart = new Date();
                monthStart.setDate(1);
                monthStart.setHours(0, 0, 0, 0);

                // Reward ids first — supabase-js .in() needs a concrete array
                const { data: rewardRows } = await supabase
                    .from('rewards')
                    .select('id, title, active, reward_kind, integration_type, promo_code')
                    .ilike('brand_name', brand);
                const rewardIds = (rewardRows ?? []).map(r => r.id);
                const activeCount = (rewardRows ?? []).filter(r => r.active).length;

                const [submissions, monthRedem, recent] = await Promise.all([
                    supabase
                        .from('reward_submissions')
                        .select('id, title, status, partner_feedback, updated_at')
                        .ilike('brand_name', brand),
                    rewardIds.length
                        ? supabase
                            .from('redemptions')
                            .select('id', { count: 'exact', head: true })
                            .in('reward_id', rewardIds)
                            .gte('redeemed_at', monthStart.toISOString())
                        : Promise.resolve({ count: 0 }),
                    rewardIds.length
                        ? supabase
                            .from('redemptions')
                            .select('id, redeemed_at, reward_id, rewards(title)')
                            .in('reward_id', rewardIds)
                            .order('redeemed_at', { ascending: false })
                            .limit(6)
                        : Promise.resolve({ data: [] }),
                ]);

                const poolRewards = (rewardRows ?? []).filter(r =>
                    r.active && r.reward_kind === 'digital' && r.integration_type === 'POOL' && !r.promo_code?.trim()
                );
                const poolCounts = await Promise.all(poolRewards.map(async reward => {
                    const { count } = await supabase
                        .from('redemption_codes')
                        .select('id', { count: 'exact', head: true })
                        .eq('reward_id', reward.id)
                        .eq('status', 'available');
                    return { reward, count: count ?? 0 };
                }));

                const nextActions = [
                    ...(submissions.data ?? []).filter(s => s.status === 'draft').map(s => ({
                        title: `Finish ${s.title || 'reward draft'}`,
                        detail: 'Your draft is saved and ready to continue.',
                        to: '/partner/rewards', icon: FilePenLine, tone: 'text-[#8a7600] bg-[#E8D200]/10',
                    })),
                    ...(submissions.data ?? []).filter(s => s.status === 'rejected').map(s => ({
                        title: `Revise ${s.title || 'reward request'}`,
                        detail: s.partner_feedback || 'POWR has requested changes before review can continue.',
                        to: '/partner/rewards', icon: CircleAlert, tone: 'text-red-500 bg-red-500/10',
                    })),
                    ...poolCounts.filter(({ count }) => count === 0).map(({ reward }) => ({
                        title: `Add code supply for ${reward.title || 'reward'}`,
                        detail: 'This live reward has no available unique codes.',
                        to: '/partner/promo-codes', icon: Ticket, tone: 'text-[#8a7600] bg-[#E8D200]/10',
                    })),
                ].slice(0, 4);

                setStats({
                    activeRewards: activeCount,
                    pendingSubmissions: (submissions.data ?? []).filter(s => s.status === 'pending').length,
                    monthRedemptions: monthRedem.count ?? 0,
                });
                setRecentRedemptions(recent.data ?? []);
                setActions(nextActions);
            } catch (e) {
                console.error('[PartnerHome]', e);
            } finally {
                setLoading(false);
            }
        };
        fetchAll();
    }, [partnerData?.brand_name]);

    const cards = [
        { label: 'Active Rewards', value: stats.activeRewards, icon: Award, color: '#10B981', to: '/partner/rewards', sub: 'Live in app' },
        { label: 'This Month', value: stats.monthRedemptions, icon: Gift, color: '#E8D200', to: '/partner/redemptions', sub: 'Redemptions' },
        { label: 'Pending Review', value: stats.pendingSubmissions, icon: Inbox, color: '#F43F5E', to: '/partner/rewards', sub: 'Submissions' },
    ];

    return (
        <div className="py-16 animate-in fade-in slide-in-from-bottom-6 duration-700">
            {/* Header */}
            <header className="mb-16">
                <div className="flex items-center gap-3 mb-6">
                    <div className="h-[1px] w-10 bg-[#E8D200]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Partner Dashboard</span>
                </div>
                <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-4">
                    Welcome back{partnerData?.name ? `, ${partnerData.name}` : ''}.
                </h1>
                <p className="text-[#AAAAAA] text-[11px] font-black uppercase tracking-[0.35em]">
                    Manage your rewards and track performance.
                </p>
            </header>

            {/* Stat cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
                {cards.map(c => (
                    <Link key={c.label} to={c.to} className="group bg-white border border-[#E6E6E1] p-10 rounded-3xl hover:border-[#E8D200]/30 transition-all hover:shadow-lg">
                        <div className="flex items-start justify-between mb-8">
                            <div className="w-12 h-12 rounded-2xl bg-[#F4F4F1] flex items-center justify-center group-hover:scale-110 transition-transform">
                                <c.icon size={22} style={{ color: c.color }} />
                            </div>
                            <ChevronRight size={16} className="text-[#BBBBBB] group-hover:text-[#8a7600] transition-colors mt-1" />
                        </div>
                        <div className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-2 leading-none">
                            {loading ? '—' : c.value.toLocaleString()}
                        </div>
                        <div className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">{c.sub}</div>
                        <div className="text-[11px] font-black text-[#888] mt-1">{c.label}</div>
                    </Link>
                ))}
            </div>

            {actions.length > 0 && (
                <section className="mb-16 bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                    <div className="flex items-center justify-between px-10 py-7 border-b border-[#E6E6E1]">
                        <div>
                            <h2 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Needs attention</h2>
                            <p className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mt-1">The next operational tasks for your rewards</p>
                        </div>
                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#8a7600] font-black">{actions.length} open</span>
                    </div>
                    <div className="divide-y divide-[#F4F4F1]">
                        {actions.map((action, index) => {
                            const Icon = action.icon;
                            return <Link key={`${action.title}-${index}`} to={action.to} className="flex items-center gap-5 px-10 py-5 hover:bg-[#FAFAFA] transition-colors group">
                                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${action.tone}`}><Icon size={17} /></div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-bold text-[#222] truncate">{action.title}</div>
                                    <div className="text-[10px] text-[#999] mt-1 truncate">{action.detail}</div>
                                </div>
                                <ChevronRight size={16} className="text-[#CCC] group-hover:text-[#8a7600] transition-colors shrink-0" />
                            </Link>;
                        })}
                    </div>
                </section>
            )}

            {/* Recent redemptions */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                <div className="flex items-center justify-between px-10 py-8 border-b border-[#E6E6E1]">
                    <div>
                        <h3 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Recent Redemptions</h3>
                        <p className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mt-1">Latest member claims</p>
                    </div>
                    <Link to="/partner/redemptions" className="flex items-center gap-2 px-6 py-3 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:border-[#E8D200]/30 hover:text-[#8a7600] transition-all">
                        View All <ChevronRight size={13} />
                    </Link>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                    </div>
                ) : recentRedemptions.length === 0 ? (
                    <div className="py-16 text-center">
                        <TrendingUp size={28} className="text-[#E6E6E1] mx-auto mb-4" />
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black">No redemptions yet</p>
                        <p className="text-xs text-[#BBBBBB] mt-2">Redemptions will appear here once members start claiming your rewards.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-[#F4F4F1]">
                        {recentRedemptions.map(r => (
                            <div key={r.id} className="flex items-center gap-6 px-10 py-5 hover:bg-[#FAFAFA] transition-colors">
                                <div className="w-8 h-8 rounded-xl bg-[#E8D200]/5 border border-[#E8D200]/20 flex items-center justify-center shrink-0">
                                    <Gift size={14} className="text-[#8a7600]" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-bold text-[#222] truncate">{r.rewards?.title ?? 'Reward'}</div>
                                    <div className="text-[10px] text-[#BBB] font-black uppercase tracking-wider mt-0.5">Member redemption</div>
                                </div>
                                <div className="text-[10px] text-[#BBB] font-black uppercase tracking-[0.3em] shrink-0">{timeAgo(r.redeemed_at)}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
