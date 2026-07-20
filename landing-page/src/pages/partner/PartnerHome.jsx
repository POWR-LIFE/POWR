import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, Gift, Inbox, ChevronRight, TrendingUp, FilePenLine, CircleAlert, Ticket, CheckCircle2, Send, Zap, X, Plug, ArrowUpRight, ArrowDownRight, Minus, Smartphone } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';
import { integrationPathFor, methodMeta } from './integrationShared';
import { fetchMethodStatuses } from '../../lib/partnerApi';
import RewardAppPreview, { previewFromReward } from '../../components/RewardAppPreview';

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
    const { partnerData, deliveryMethod } = useAuth();
    const [stats, setStats] = useState({ activeRewards: 0, monthRedemptions: 0, pendingSubmissions: 0 });
    const [recentRedemptions, setRecentRedemptions] = useState([]);
    const [actions, setActions] = useState([]);
    const [journey, setJourney] = useState(null);
    const [loading, setLoading] = useState(true);
    const [introDismissed, setIntroDismissed] = useState(true);
    const [liveRewards, setLiveRewards] = useState([]);
    const [previewIdx, setPreviewIdx] = useState(0);
    const [weekTrend, setWeekTrend] = useState(null); // { last7, prior7 }
    const [methodStatuses, setMethodStatuses] = useState(null);

    // Connection detail for the "delivering via" bar (keys/webhooks, store
    // domain, or codes available — depending on the chosen method).
    useEffect(() => {
        if (!partnerData?.brand_name) return;
        let cancelled = false;
        fetchMethodStatuses(partnerData.brand_name)
            .then(s => { if (!cancelled) setMethodStatuses(s); })
            .catch(() => { /* bar just shows the method without detail */ });
        return () => { cancelled = true; };
    }, [partnerData?.brand_name]);

    // Per-brand so an admin previewing another brand doesn't inherit the dismissal
    const introKey = partnerData?.brand_name
        ? `powr-partner-intro-dismissed:${partnerData.brand_name.trim().toLowerCase()}`
        : null;

    useEffect(() => {
        if (introKey) setIntroDismissed(localStorage.getItem(introKey) === '1');
    }, [introKey]);

    useEffect(() => {
        if (!partnerData?.brand_name) return;
        const brand = partnerData.brand_name;

        const fetchAll = async () => {
            try {
                const monthStart = new Date();
                monthStart.setDate(1);
                monthStart.setHours(0, 0, 0, 0);

                // Reward ids first — supabase-js .in() needs a concrete array.
                // Full listing fields so the live phone preview renders
                // exactly what members see.
                const { data: rewardRows } = await supabase
                    .from('rewards')
                    .select('id, title, active, reward_kind, integration_type, promo_code, brand_name, description, partner_blurb, offer, value_label, discount_type, discount_value, powr_cost, image_url, hero_image_url, hero_video_url, created_at')
                    .ilike('brand_name', brand)
                    .order('created_at', { ascending: false });
                const rewardIds = (rewardRows ?? []).map(r => r.id);
                const activeCount = (rewardRows ?? []).filter(r => r.active).length;

                const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
                const [submissions, monthRedem, recent, fortnight] = await Promise.all([
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
                    rewardIds.length
                        ? supabase
                            .from('redemptions')
                            .select('redeemed_at')
                            .in('reward_id', rewardIds)
                            .gte('redeemed_at', fourteenDaysAgo)
                            .limit(2000)
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
                        // Manual brands top the pool up directly; API/Shopify
                        // brands sort it on their integration page.
                        to: 'codes', icon: Ticket, tone: 'text-[#8a7600] bg-[#E8D200]/10',
                    })),
                ].slice(0, 4);

                setStats({
                    activeRewards: activeCount,
                    pendingSubmissions: (submissions.data ?? []).filter(s => s.status === 'pending').length,
                    monthRedemptions: monthRedem.count ?? 0,
                });
                setRecentRedemptions(recent.data ?? []);
                setActions(nextActions);
                setLiveRewards((rewardRows ?? []).filter(r => r.active));

                const sevenDaysAgo = Date.now() - 7 * 86400000;
                const stamps = (fortnight.data ?? []).map(r => new Date(r.redeemed_at).getTime());
                setWeekTrend({
                    last7: stamps.filter(t => t >= sevenDaysAgo).length,
                    prior7: stamps.filter(t => t < sevenDaysAgo).length,
                });

                // 'invited' rows are POWR-created submission links the partner
                // hasn't touched yet — they don't count as partner activity.
                const authored = (submissions.data ?? []).filter(s => s.status !== 'invited');
                setJourney({
                    hasReward: rewardIds.length > 0,
                    hasDraft: authored.length > 0,
                    hasSubmitted: rewardIds.length > 0 || authored.some(s => s.status !== 'draft'),
                    hasLive: activeCount > 0,
                    hasRedemption: (recent.data ?? []).length > 0,
                });
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
        { label: 'This Month', value: stats.monthRedemptions, icon: Gift, color: '#E8D200', to: '/partner/redemptions', sub: 'Redemptions', trend: weekTrend },
        { label: 'Pending Review', value: stats.pendingSubmissions, icon: Inbox, color: '#F43F5E', to: '/partner/rewards', sub: 'Submissions' },
    ];

    // Redemptions momentum: last 7 days vs the 7 before. Direction is carried
    // by the icon + signed number, not color alone.
    const trendChip = (trend) => {
        if (!trend || (trend.last7 === 0 && trend.prior7 === 0)) return null;
        const diff = trend.last7 - trend.prior7;
        const TrendIcon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
        const tone = diff > 0 ? 'text-[#10B981]' : diff < 0 ? 'text-red-500' : 'text-[#999]';
        return (
            <div className="flex items-center gap-1.5 mt-4">
                <TrendIcon size={13} className={tone} strokeWidth={3} />
                <span className="text-[10px] font-black text-[#666]">{trend.last7} this week</span>
                <span className={`text-[10px] font-black ${tone}`}>{diff > 0 ? `+${diff}` : diff < 0 ? diff : '±0'} vs prior 7 days</span>
            </div>
        );
    };

    // Header chip: where codes come from, one glance, one click.
    const method = methodMeta(deliveryMethod);

    // First run = nothing created yet; the checklist stays until a reward exists
    const firstRun = journey && !journey.hasReward && !journey.hasDraft;
    const showChecklist = journey && !journey.hasReward;
    const showIntro = journey && !journey.hasRedemption && !introDismissed;

    const dismissIntro = () => {
        if (introKey) localStorage.setItem(introKey, '1');
        setIntroDismissed(true);
    };

    const introBeats = [
        { icon: FilePenLine, title: 'Submit', detail: 'Create a reward and send it to POWR for review.' },
        { icon: Inbox, title: 'Review', detail: 'The POWR team checks the details and approves it.' },
        { icon: Zap, title: 'Live', detail: 'Members redeem it in the app — you track everything here.' },
    ];

    const journeySteps = [
        { title: 'Choose your delivery method', detail: 'API, Shopify or managed promo codes — how codes reach members.', icon: Plug, done: deliveryMethod != null, to: '/partner/integration' },
        { title: 'Create your first reward', detail: 'Set up your offer, imagery and value in My Rewards.', icon: FilePenLine, done: !!journey?.hasDraft, to: '/partner/rewards' },
        { title: 'Submit it for review', detail: 'POWR checks every reward before it goes live — usually quick.', icon: Send, done: !!journey?.hasSubmitted, to: '/partner/rewards' },
        { title: 'Go live and track redemptions', detail: 'Approved rewards appear in the app; member claims show up right here.', icon: Zap, done: !!journey?.hasLive, to: '/partner/rewards' },
    ];
    const journeyDone = journeySteps.filter(s => s.done).length;

    return (
        <div className="py-10 animate-in fade-in slide-in-from-bottom-6 duration-700">
            {/* Header — kept shallow so the phone rail sits fully in view */}
            <header className="mb-8">
                <div className="flex items-center gap-3 mb-4">
                    <div className="h-[1px] w-10 bg-[#E8D200]"></div>
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Partner Dashboard</span>
                </div>
                <h1 className="text-4xl font-light tracking-tighter text-[#1A1A1A] mb-3">
                    {firstRun ? 'Welcome' : 'Welcome back'}{partnerData?.name ? `, ${partnerData.name}` : ''}.
                </h1>
                <p className="text-[#AAAAAA] text-[11px] font-black uppercase tracking-[0.35em]">
                    {firstRun ? "Let's get your first reward live." : 'Manage your rewards and track performance.'}
                </p>
            </header>

            {/* Main column + live phone rail (the rail is the "what's live
                right now" surface — it renders the real listing component) */}
            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-14 items-start">
            <div className="min-w-0">

            {/* What this brand is connected with — method + live detail.
                Chosen-but-unconfigured flips the bar into an explicit CTA:
                the status line alone ("Not connected yet") wasn't telling
                partners what to actually do next. */}
            {method ? (() => {
                const status = methodStatuses?.[deliveryMethod];
                const needsSetup = status && !status.configured;
                const SETUP_CTA = { shopify: 'Connect your store', api: 'Create your first key', manual: 'Load your first codes' };
                return (
                    <Link to={integrationPathFor(deliveryMethod)}
                        className={`flex items-center gap-4 rounded-2xl px-6 py-4 mb-10 transition-all group ${
                            needsSetup
                                ? 'bg-[#E8D200]/5 border border-[#E8D200]/30 hover:border-[#E8D200]/60'
                                : 'bg-white border border-[#E6E6E1] hover:border-[#E8D200]/40'
                        }`}>
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${needsSetup ? 'bg-[#E8D200]/10' : 'bg-[#F4F4F1]'}`}>
                            <method.icon size={16} className="text-[#8a7600]" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className={`text-[9px] uppercase tracking-[0.4em] font-black mb-0.5 ${needsSetup ? 'text-[#8a7600]' : 'text-[#BBBBBB]'}`}>Delivering via {method.label}</div>
                            <div className="text-[12px] font-bold text-[#333] truncate">
                                {status ? (needsSetup ? `${status.line} — a few guided steps finish the job` : status.line) : 'Checking connection…'}
                            </div>
                        </div>
                        {needsSetup ? (
                            <span className="flex items-center gap-2 h-9 px-5 bg-[#E8D200] text-[#080808] text-[9px] font-black uppercase tracking-[0.2em] rounded-full group-hover:brightness-95 transition-all shrink-0">
                                {SETUP_CTA[deliveryMethod] ?? 'Finish setup'} <ChevronRight size={12} />
                            </span>
                        ) : (
                            <>
                                <span className={`h-2 w-2 rounded-full shrink-0 ${methodStatuses ? (status?.configured ? 'bg-emerald-500' : 'bg-amber-400') : 'bg-[#D5D5D0]'}`} />
                                <ChevronRight size={15} className="text-[#CCC] group-hover:text-[#8a7600] transition-colors shrink-0" />
                            </>
                        )}
                    </Link>
                );
            })() : deliveryMethod === null ? (
                <Link to="/partner/integration"
                    className="flex items-center gap-4 bg-[#E8D200]/5 border border-[#E8D200]/25 rounded-2xl px-6 py-4 mb-10 hover:border-[#E8D200]/50 transition-all group">
                    <div className="w-9 h-9 rounded-xl bg-[#E8D200]/10 flex items-center justify-center shrink-0">
                        <Plug size={16} className="text-[#8a7600]" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[9px] uppercase tracking-[0.4em] text-[#8a7600] font-black mb-0.5">Not connected yet</div>
                        <div className="text-[12px] font-bold text-[#8a7600]">Choose how you deliver rewards — API, Shopify or promo codes</div>
                    </div>
                    <ChevronRight size={15} className="text-[#8a7600] shrink-0" />
                </Link>
            ) : null}

            {/* How POWR works — orientation for partners without a redemption yet */}
            {showIntro && (
                <section className="relative mb-10 bg-[#E8D200]/5 border border-[#E8D200]/20 rounded-3xl px-10 py-8">
                    <button
                        onClick={dismissIntro}
                        aria-label="Dismiss"
                        className="absolute top-5 right-5 w-8 h-8 rounded-full flex items-center justify-center text-[#BBBBBB] hover:text-[#666] hover:bg-black/5 transition-colors"
                    >
                        <X size={15} />
                    </button>
                    <div className="text-[9px] uppercase tracking-[0.5em] text-[#8a7600] font-black mb-7">How POWR works for partners</div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {introBeats.map((beat, index) => (
                            <div key={beat.title} className="flex items-start gap-4">
                                <div className="w-10 h-10 rounded-2xl bg-[#E8D200]/10 flex items-center justify-center shrink-0">
                                    <beat.icon size={17} className="text-[#8a7600]" />
                                </div>
                                <div>
                                    <div className="text-[13px] font-bold text-[#222]">
                                        <span className="text-[#8a7600] mr-2">{index + 1}</span>{beat.title}
                                    </div>
                                    <div className="text-[11px] text-[#999] mt-1 leading-relaxed">{beat.detail}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* Getting started — replaces the zero-stat dashboard until the first reward exists */}
            {showChecklist && (
                <section className="mb-12 bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                    <div className="flex items-center justify-between px-10 py-7 border-b border-[#E6E6E1]">
                        <div>
                            <h2 className="text-xl font-light tracking-tighter text-[#1A1A1A]">Getting started</h2>
                            <p className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mt-1">Four steps to your first live reward</p>
                        </div>
                        <span className="text-[10px] uppercase tracking-[0.3em] text-[#8a7600] font-black">{journeyDone} of {journeySteps.length} done</span>
                    </div>
                    <div className="divide-y divide-[#F4F4F1]">
                        {journeySteps.map(step => {
                            const Icon = step.icon;
                            const inner = (
                                <>
                                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${step.done ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-[#F4F4F1] text-[#8a7600]'}`}>
                                        {step.done ? <CheckCircle2 size={17} /> : <Icon size={17} />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className={`text-[13px] font-bold ${step.done ? 'text-[#999]' : 'text-[#222]'}`}>{step.title}</div>
                                        <div className="text-[10px] text-[#999] mt-1">{step.detail}</div>
                                    </div>
                                    {!step.done && <ChevronRight size={16} className="text-[#CCC] group-hover:text-[#8a7600] transition-colors shrink-0" />}
                                </>
                            );
                            return step.done ? (
                                <div key={step.title} className="flex items-center gap-5 px-10 py-5">{inner}</div>
                            ) : (
                                <Link key={step.title} to={step.to} className="flex items-center gap-5 px-10 py-5 hover:bg-[#FAFAFA] transition-colors group">{inner}</Link>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* Stat cards — compact so the fold belongs to the phone rail */}
            {!showChecklist && <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-12">
                {cards.map(c => (
                    <Link key={c.label} to={c.to} className="group bg-white border border-[#E6E6E1] p-6 rounded-2xl hover:border-[#E8D200]/30 transition-all hover:shadow-lg">
                        <div className="flex items-start justify-between mb-5">
                            <div className="w-10 h-10 rounded-xl bg-[#F4F4F1] flex items-center justify-center group-hover:scale-110 transition-transform">
                                <c.icon size={18} style={{ color: c.color }} />
                            </div>
                            <ChevronRight size={15} className="text-[#BBBBBB] group-hover:text-[#8a7600] transition-colors mt-1" />
                        </div>
                        <div className="text-3xl font-light tracking-tighter text-[#1A1A1A] mb-1.5 leading-none">
                            {loading ? '—' : c.value.toLocaleString()}
                        </div>
                        <div className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">{c.sub}</div>
                        <div className="text-[11px] font-black text-[#888] mt-0.5">{c.label}</div>
                        {c.trend ? trendChip(c.trend) : null}
                    </Link>
                ))}
            </div>}

            {actions.length > 0 && (
                <section className="mb-12 bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
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
                            // 'codes' resolves at render time so it tracks the
                            // async-loaded delivery method.
                            const to = action.to === 'codes'
                                ? (deliveryMethod && deliveryMethod !== 'manual' ? integrationPathFor(deliveryMethod) : '/partner/promo-codes')
                                : action.to;
                            return <Link key={`${action.title}-${index}`} to={to} className="flex items-center gap-5 px-10 py-5 hover:bg-[#FAFAFA] transition-colors group">
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
            {!showChecklist && <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
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
            </div>}

            </div>

            {/* ── Live phone preview — sticky rail; PartnerLayout's main is
                   the scroll container so sticky works (same as Rewards) */}
            <aside className="hidden lg:block sticky top-4">
                <div className="flex items-center gap-3 mb-4">
                    <span className={`h-1.5 w-1.5 rounded-full ${liveRewards.length ? 'bg-[#10B981] shadow-[0_0_10px_rgba(16,185,129,0.6)] animate-pulse' : 'bg-[#D5D5D0]'}`} />
                    <span className="text-[10px] uppercase tracking-[0.4em] text-[#8a7600] font-black">Live in app</span>
                    {liveRewards.length > 0 && (
                        <span className="text-[9px] font-black text-[#BBB] uppercase tracking-[0.2em]">
                            {liveRewards.length} reward{liveRewards.length === 1 ? '' : 's'}
                        </span>
                    )}
                </div>
                {liveRewards.length > 0 ? (
                    <>
                        {(() => {
                            const idx = Math.min(previewIdx, liveRewards.length - 1);
                            const reward = liveRewards[idx];
                            return <RewardAppPreview key={reward.id} pageTheme="light" {...previewFromReward(reward, partnerData?.name)} />;
                        })()}
                        {liveRewards.length > 1 && (
                            <div className="flex items-center justify-center gap-2 mt-5">
                                {liveRewards.map((r, i) => (
                                    <button key={r.id} type="button" onClick={() => setPreviewIdx(i)} title={r.title}
                                        aria-label={`Preview ${r.title}`}
                                        className={`h-2 rounded-full transition-all ${i === Math.min(previewIdx, liveRewards.length - 1) ? 'w-6 bg-[#8a7600]' : 'w-2 bg-[#D5D5D0] hover:bg-[#BBBBBB]'}`} />
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    <div className="border-2 border-dashed border-[#E6E6E1] rounded-3xl px-8 py-14 text-center">
                        <Smartphone size={24} className="text-[#DDDDDD] mx-auto mb-5" />
                        <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black leading-relaxed mb-3">
                            Nothing live yet
                        </p>
                        <p className="text-[11px] text-[#BBBBBB] leading-relaxed mb-6">
                            Approved rewards appear here exactly as members see them in the app.
                        </p>
                        <Link to="/partner/rewards"
                            className="inline-flex items-center gap-2 h-10 px-6 bg-[#E8D200] text-[#080808] text-[9px] font-black uppercase tracking-[0.2em] rounded-full hover:brightness-95 transition-all">
                            Create your first reward <ChevronRight size={12} />
                        </Link>
                    </div>
                )}
            </aside>
            </div>
        </div>
    );
}
