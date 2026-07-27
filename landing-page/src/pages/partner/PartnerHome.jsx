import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, FilePenLine, CircleAlert, Ticket, Send, Plug, Smartphone, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';
import { integrationPathFor, methodMeta } from './integrationShared';
import { fetchMethodStatuses } from '../../lib/partnerApi';
import RewardAppPreview, { previewFromReward } from '../../components/RewardAppPreview';

// Matches PartnerRewards — the cap only lives in brand_reward_limits when an
// admin has raised it for a brand.
const DEFAULT_REWARD_LIMIT = 2;

// A brand is "quiet" once a month passes with nothing claimed. Below this the
// verdict reports activity; above it, the absence is the story. Set at 30 and
// not a fortnight because the typical gap between claims is already ~36 days —
// at 14 almost every brand would be told it was quiet almost all the time,
// which is nagging rather than informative.
const QUIET_AFTER_DAYS = 30;

const DAY = 86400000;
const SERIES_DAYS = 30;

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const daysBetween = (a, b) => Math.floor((a - b) / DAY);

// Tone drives the status dot, the chain and nothing else — the verdict is a
// sentence first, a colour second.
const TONE = {
    good: { dot: '#10B981', label: 'text-[#10B981]' },
    warn: { dot: '#D97706', label: 'text-[#D97706]' },
    bad: { dot: '#E11D48', label: 'text-[#E11D48]' },
};

export default function PartnerHome() {
    const { partnerData, deliveryMethod } = useAuth();

    const [rewards, setRewards] = useState([]);
    const [submissions, setSubmissions] = useState([]);
    const [claims, setClaims] = useState([]);          // every claim, newest first
    const [truncated, setTruncated] = useState(false); // hit the PostgREST cap
    const [dryRewards, setDryRewards] = useState([]);  // live pool rewards with nothing claimable
    const [anyCodeUsed, setAnyCodeUsed] = useState(false);
    const [rewardLimit, setRewardLimit] = useState(DEFAULT_REWARD_LIMIT);
    const [methodStatuses, setMethodStatuses] = useState(null);
    const [statusesLoaded, setStatusesLoaded] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [previewIdx, setPreviewIdx] = useState(0);
    const [showMore, setShowMore] = useState(true);

    // Loaded is tracked apart from the payload so a failed fetch still settles
    // the page instead of pinning it on a spinner forever.
    useEffect(() => {
        if (!partnerData?.brand_name) return;
        let cancelled = false;
        setStatusesLoaded(false);
        fetchMethodStatuses(partnerData.brand_name)
            .then(s => { if (!cancelled) setMethodStatuses(s); })
            .catch(() => { /* the chain shows Connected as unknown rather than broken */ })
            .finally(() => { if (!cancelled) setStatusesLoaded(true); });
        return () => { cancelled = true; };
    }, [partnerData?.brand_name]);

    useEffect(() => {
        if (!partnerData?.brand_name) return;
        const brand = partnerData.brand_name;
        let cancelled = false;

        const fetchAll = async () => {
            setLoading(true);
            setLoadError(false);
            try {
                // supabase-js resolves rather than throws on a query error, so
                // every error is raised by hand — otherwise an RLS failure
                // returns no rows and reads as "this brand has nothing".
                if (rewardRes.error) throw rewardRes.error;
                if (subRes.error) throw subRes.error;
                if (limitRes.error) throw limitRes.error;
                const rewardRows = rewardRes.data ?? [];
                const rewardIds = rewardRows.map(r => r.id);

                // One unbounded claims query serves everything — the lifetime
                // count, the last-claim gap, the 30-day strip and per-reward
                // attribution. Volumes are tiny (the busiest brand has ten),
                // so a second windowed query would only add a round trip.
                const claimRes = rewardIds.length
                    ? await supabase.from('redemptions')
                        .select('id, redeemed_at, reward_id, powr_spent')
                        .in('reward_id', rewardIds)
                        .order('redeemed_at', { ascending: false })
                        .limit(1000)
                    : { data: [] };
                if (claimRes.error) throw claimRes.error;

                // Only POOL rewards draw from stock — Shopify and API brands
                // mint on demand, so "out of codes" cannot apply to them and
                // must never be raised as their blocker.
                const poolRewards = rewardRows.filter(r =>
                    r.active && r.reward_kind === 'digital'
                    && r.integration_type === 'POOL' && !r.promo_code?.trim()
                );
                const nowIso = new Date().toISOString();
                const [poolCounts, usedRes] = await Promise.all([
                    Promise.all(poolRewards.map(async reward => {
                        // A code past its expiry is not claimable, however
                        // 'available' its status column says it is.
                        const { count } = await supabase.from('redemption_codes')
                            .select('id', { count: 'exact', head: true })
                            .eq('reward_id', reward.id).eq('status', 'available')
                            .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
                        return { reward, count: count ?? 0 };
                    })),
                    rewardIds.length
                        ? supabase.from('redemption_codes')
                            .select('id', { count: 'exact', head: true })
                            .in('reward_id', rewardIds).eq('status', 'used')
                        : Promise.resolve({ count: 0 }),
                ]);

                if (cancelled) return;
                setRewards(rewardRows);
                setSubmissions(subRes.data ?? []);
                setClaims(claimRes.data ?? []);
                setTruncated((claimRes.data ?? []).length >= 1000);
                setDryRewards(poolCounts.filter(p => p.count === 0).map(p => p.reward));
                setAnyCodeUsed((usedRes.count ?? 0) > 0);
                setRewardLimit(limitRes.data?.[0]?.reward_limit ?? DEFAULT_REWARD_LIMIT);
            } catch (e) {
                console.error('[PartnerHome]', e);
                if (!cancelled) setLoadError(true);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        fetchAll();
        return () => { cancelled = true; };
    }, [partnerData?.brand_name]);

    const method = methodMeta(deliveryMethod);
    const methodStatus = deliveryMethod ? methodStatuses?.[deliveryMethod] : null;
    const connected = !!methodStatus?.configured;

    // Nothing is decided until the figures and the delivery method have both
    // landed — a verdict that changes its mind on screen is worse than a wait.
    const ready = !loading
        && deliveryMethod !== undefined
        && (deliveryMethod === null || statusesLoaded);

    const liveRewards = rewards.filter(r => r.active);
    const authored = submissions.filter(s => s.status !== 'invited');
    const rejected = authored.filter(s => s.status === 'rejected');
    const drafts = authored.filter(s => s.status === 'draft');
    const pending = authored.filter(s => s.status === 'pending');

    const now = Date.now();
    const lastClaimAt = claims.length ? new Date(claims[0].redeemed_at).getTime() : null;
    const daysSinceLast = lastClaimAt === null ? null : daysBetween(now, lastClaimAt);
    const claimsIn30 = claims.filter(c => new Date(c.redeemed_at).getTime() > now - SERIES_DAYS * DAY).length;
    const spent = claims.reduce((sum, c) => sum + (c.powr_spent ?? 0), 0);
    const oldestReward = rewards.length ? rewards[rewards.length - 1] : null;
    const daysLive = oldestReward ? daysBetween(now, new Date(oldestReward.created_at).getTime()) : 0;

    const claimsFor = (rewardId) => claims.filter(c => c.reward_id === rewardId).length;

    // ── The verdict ladder ────────────────────────────────────────
    // Ordered, first match wins. Rung 1-3 mean a member is blocked RIGHT NOW;
    // 4-9 mean something needs the brand but nobody is stuck; 10 is clear.
    // A dead webhook deliberately sits in "more things" rather than up here —
    // it stops the brand being notified, it blocks no member.
    const verdict = (() => {
        const fact = (label, value, qual) => ({ label, value, qual });

        if (rewards.length > 0 && liveRewards.length === 0) return {
            tone: 'bad',
            headline: 'Members can’t claim anything from you right now.',
            covers: ['paused'],
            support: claims.length
                ? `Nothing of yours is live. Your rewards took ${plural(claims.length, 'claim', 'claims')} before they stopped.`
                : 'Nothing of yours is live, so there is nothing for members to claim.',
            action: { label: 'Get a reward live', to: '/partner/rewards' },
            facts: [
                fact('Live rewards', '0', `${plural(rewards.length, 'reward', 'rewards')} paused or awaiting approval`),
                claims.length
                    ? fact('Claims before it stopped', claims.length.toLocaleString(), `most recent ${daysSinceLast} days ago`)
                    : fact('Reward slots', `${rewards.length} of ${rewardLimit}`, 'submit one for review to go live'),
                fact('Delivery', connected ? (method?.label ?? 'Ready') : (method?.label ?? 'Not chosen'),
                    connected ? 'connected and ready to mint' : (methodStatus?.line ?? 'choose how codes reach members')),
            ],
        };

        if (dryRewards.length > 0) return {
            tone: 'bad',
            headline: `Members can’t claim ${dryRewards[0].title} — you’re out of codes.`,
            // For a manual brand "no codes" and "not connected" are the same
            // fact, so the headline covers both. For Shopify or API they are
            // genuinely separate failures and both deserve saying.
            covers: deliveryMethod === 'manual' ? ['dry', 'connection'] : ['dry'],
            support: dryRewards.length > 1
                ? `${dryRewards.length} of your live rewards have no claimable codes left.`
                : 'The pool behind this reward is empty, so a member who tries to claim it hits a wall.',
            action: { label: 'Top up your codes', to: deliveryMethod && deliveryMethod !== 'manual' ? integrationPathFor(deliveryMethod) : '/partner/promo-codes' },
            facts: [
                fact('Rewards out of stock', dryRewards.length.toLocaleString(), 'live in the app with an empty pool'),
                fact('Still live', liveRewards.length.toLocaleString(), 'visible to members right now'),
                fact('Claims all-time', claims.length.toLocaleString(), daysSinceLast === null ? 'none yet' : `most recent ${daysSinceLast} days ago`),
            ],
        };

        if (liveRewards.length > 0 && deliveryMethod && !connected) return {
            tone: 'bad',
            headline: `Members can’t claim — ${method?.label ?? 'your integration'} isn’t connected.`,
            covers: ['connection'],
            support: `${methodStatus?.line ?? 'The connection is down'}. Your rewards are still listed, so members can see them and then fail at the last step.`,
            action: { label: `Reconnect ${method?.label ?? 'delivery'}`, to: integrationPathFor(deliveryMethod) },
            facts: [
                fact('Live rewards', liveRewards.length.toLocaleString(), 'visible but undeliverable'),
                fact('Delivery', method?.label ?? '—', methodStatus?.line ?? 'not connected'),
                fact('Claims all-time', claims.length.toLocaleString(), daysSinceLast === null ? 'none yet' : `most recent ${daysSinceLast} days ago`),
            ],
        };

        if (rewards.length === 0 && authored.length === 0) return {
            tone: 'warn',
            headline: connected ? 'Nothing’s live yet. One step and you are.' : 'Nothing’s live yet. Two steps and you are.',
            covers: ['connection'],
            support: connected
                ? `${method?.label ?? 'Delivery'} is connected and ready. Submit your first reward and POWR reviews it — usually about a day.`
                : deliveryMethod
                    // They have already chosen — don't send them back to choose again.
                    ? `${methodStatus?.line ?? `${method?.label} isn’t finished`}. Once codes have a route, submit your first reward for review.`
                    : 'Choose how codes reach members, then submit your first reward. POWR reviews it before it goes live.',
            action: connected
                ? { label: 'Create your first reward', to: '/partner/rewards' }
                : { label: deliveryMethod ? `Finish connecting ${method?.label}` : 'Choose delivery method', to: integrationPathFor(deliveryMethod) },
            facts: [
                fact('Reward slots used', `0 of ${rewardLimit}`, 'nothing submitted yet'),
                fact('Delivery', method?.label ?? 'Not chosen', methodStatus?.line ?? 'how codes reach members'),
                fact('Review time', '~1 day', 'typical turnaround once you submit'),
            ],
        };

        // Submission problems only take the headline when nothing is live.
        // A brand whose rewards are up and selling should hear that first —
        // the rejection is real, but it drops to the list below rather than
        // becoming the whole story.
        if (rejected.length > 0 && liveRewards.length === 0) return {
            tone: 'warn',
            headline: 'Your reward needs changes before it can go live.',
            covers: ['rejected'],
            support: rejected[0].partner_feedback || 'POWR has asked for changes. Revise it and send it back for review.',
            action: { label: 'Revise your reward', to: '/partner/rewards' },
            facts: [
                fact('Needs changes', rejected.length.toLocaleString(), 'sent back by the POWR team'),
                fact('Live rewards', liveRewards.length.toLocaleString(), liveRewards.length ? 'unaffected and still claimable' : 'nothing live in the meantime'),
                fact('Reward slots', `${rewards.length} of ${rewardLimit}`, 'used by approved rewards'),
            ],
        };

        if (drafts.length > 0 && liveRewards.length === 0) return {
            tone: 'warn',
            headline: 'You’ve a reward half-written.',
            covers: ['draft'],
            support: 'Your draft is saved. Finish it and send it to POWR — review usually takes about a day.',
            action: { label: 'Finish your draft', to: '/partner/rewards' },
            facts: [
                fact('Drafts', drafts.length.toLocaleString(), 'saved and waiting on you'),
                fact('Reward slots', `${rewards.length} of ${rewardLimit}`, 'room to submit'),
                fact('Delivery', connected ? (method?.label ?? 'Ready') : (method?.label ?? 'Not chosen'),
                    connected ? 'connected and ready to mint' : (methodStatus?.line ?? 'still to connect')),
            ],
        };

        if (pending.length > 0 && liveRewards.length === 0) return {
            tone: 'warn',
            headline: 'You’re waiting on POWR. Usually about a day.',
            support: 'Your reward is with our team for review. Nothing needs you — we’ll email you the moment it’s approved.',
            action: null,
            facts: [
                fact('With POWR', pending.length.toLocaleString(), 'in review right now'),
                fact('Delivery', connected ? (method?.label ?? 'Ready') : (method?.label ?? 'Not chosen'),
                    connected ? 'connected, so it can go live immediately' : (methodStatus?.line ?? 'connect it before approval')),
                fact('Review time', '~1 day', 'typical turnaround'),
            ],
        };

        if (liveRewards.length > 0 && claims.length === 0) return {
            tone: 'warn',
            headline: 'You’re live, and no one’s claimed yet.',
            support: 'Delivery is healthy, so this isn’t plumbing — it’s reach. Check your listing reads well and your price feels attainable.',
            action: { label: 'Review your listing', to: '/partner/rewards' },
            facts: [
                fact('Live rewards', liveRewards.length.toLocaleString(), daysLive > 0 ? `listed for ${plural(daysLive, 'day', 'days')}` : 'listed today'),
                fact('Delivery', method?.label ?? 'Ready', 'connected and ready to mint'),
                fact('Price', `${(liveRewards[0].powr_cost ?? 0).toLocaleString()} POWR`, 'what a member pays for your cheapest reward'),
            ],
        };

        if (liveRewards.length > 0 && daysSinceLast !== null && daysSinceLast > QUIET_AFTER_DAYS) return {
            tone: 'warn',
            headline: `You’re live and quiet. ${plural(daysSinceLast, 'day', 'days')} since the last claim.`,
            support: 'Delivery is healthy and your listing is complete, so this isn’t plumbing — it’s reach.',
            action: { label: 'Review your listing', to: '/partner/rewards' },
            facts: [
                fact('Last claim', daysSinceLast.toLocaleString(), `days ago · ${plural(claims.length, 'claim', 'claims')} all-time`),
                fact('Live rewards', liveRewards.length.toLocaleString(), 'approved and visible now'),
                fact('POWR spent with you', spent.toLocaleString(), 'members earned this before spending it'),
            ],
        };

        return {
            tone: 'good',
            headline: `Everything’s running. ${plural(claimsIn30, 'claim', 'claims')} in the last 30 days.`,
            support: 'Codes are reaching members and nothing needs you today.',
            action: null,
            facts: [
                fact('Claims', claimsIn30.toLocaleString(), `in 30 days · ${plural(claims.length, 'claim', 'claims')} all-time`),
                fact('Live rewards', liveRewards.length.toLocaleString(), 'approved and visible now'),
                fact('POWR spent with you', spent.toLocaleString(), 'members earned this before spending it'),
            ],
        };
    })();

    // ── Everything else that needs them ───────────────────────────
    // Built independently of the verdict, then the item the verdict already
    // states is dropped so the page never says the same thing twice.
    const openItems = [
        ...rejected.map(s => ({
            key: `rejected-${s.id}`, kind: 'rejected', icon: CircleAlert,
            title: `Revise ${s.title || 'your reward request'}`,
            detail: s.partner_feedback || 'POWR has requested changes before review can continue.',
            to: '/partner/rewards',
        })),
        ...drafts.map(s => ({
            key: `draft-${s.id}`, kind: 'draft', icon: FilePenLine,
            title: `Finish ${s.title || 'your reward draft'}`,
            detail: 'Your draft is saved and ready to continue.',
            to: '/partner/rewards',
        })),
        ...dryRewards.map(r => ({
            key: `dry-${r.id}`, kind: 'dry', icon: Ticket,
            title: `Add codes for ${r.title || 'your reward'}`,
            detail: 'This live reward has no claimable codes left.',
            to: deliveryMethod && deliveryMethod !== 'manual' ? integrationPathFor(deliveryMethod) : '/partner/promo-codes',
        })),
        ...(deliveryMethod && !connected ? [{
            key: 'disconnected', kind: 'connection', icon: Plug,
            title: `Finish connecting ${method?.label ?? 'delivery'}`,
            detail: methodStatus?.line ?? 'Codes have no route to members until this is done.',
            to: integrationPathFor(deliveryMethod),
        }] : []),
        ...(rewards.length > 0 && liveRewards.length === 0 && pending.length === 0 && drafts.length === 0 && rejected.length === 0 ? [{
            key: 'nothing-live', kind: 'paused', icon: Send,
            title: 'Get a reward back in the app',
            detail: 'You have rewards, but none of them are live for members.',
            to: '/partner/rewards',
        }] : []),
    ];
    // The verdict IS the first item, so drop the one it already states — but
    // only that one. Each rung declares what its own headline covers, because
    // keying this off the verdict's colour swallowed problems the headline had
    // never actually mentioned: a quiet brand with a rejected submission was
    // shown neither the rejection nor a count of it.
    const covered = new Set();
    const rest = openItems.filter(item => {
        const claimed = verdict.covers ?? [];
        if (!claimed.includes(item.kind) || covered.has(item.kind)) return true;
        covered.add(item.kind);
        return false;
    });

    // ── The delivery chain ────────────────────────────────────────
    // Method-agnostic by construction: it answers "is the break plumbing or
    // demand", which a single sentence cannot. Grey is a route not yet
    // travelled, never an error.
    const poolBacked = rewards.some(r => r.active && r.integration_type === 'POOL');
    const chain = [
        {
            id: 'listed', label: 'Listed',
            state: liveRewards.length > 0 ? 'ok' : rewards.length > 0 ? 'bad' : 'idle',
            detail: liveRewards.length > 0
                ? `${plural(liveRewards.length, 'reward', 'rewards')} visible to members.`
                : 'Nothing of yours is in the app yet — everything downstream waits on this.',
        },
        {
            id: 'stocked', label: 'Stocked',
            state: !poolBacked ? (connected ? 'ok' : 'idle')
                : dryRewards.length > 0 ? 'bad'
                : liveRewards.length > 0 ? 'ok' : 'idle',
            detail: !poolBacked
                ? `${method?.label ?? 'Your integration'} mints a code on demand — there is no pool to keep stocked.`
                : dryRewards.length > 0 ? 'A live reward has run out of claimable codes.'
                : 'Your pool has codes ready to hand out.',
        },
        {
            id: 'connected', label: 'Connected',
            state: !deliveryMethod ? 'idle' : connected ? 'ok' : 'bad',
            detail: methodStatus?.line ?? 'Choose how codes reach members.',
        },
        {
            id: 'delivered', label: 'Delivered',
            state: claims.length > 0 ? 'ok' : 'idle',
            detail: claims.length > 0
                ? `${plural(claims.length, 'code has', 'codes have')} gone out to members.`
                : 'No member has claimed a code yet.',
        },
        {
            id: 'used', label: 'Used',
            state: anyCodeUsed ? 'ok' : 'idle',
            detail: anyCodeUsed
                ? 'Codes are being spent at checkout and confirmed back to POWR.'
                : claims.length > 0
                    ? 'Members hold codes they haven’t spent yet.'
                    : 'Nothing has been spent at checkout.',
        },
    ];
    // One detail line at a time — the first link that isn't running, else the last.
    const chainFocus = chain.find(n => n.state === 'bad') ?? chain.find(n => n.state === 'idle') ?? chain[chain.length - 1];

    // ── The 30-day strip ──────────────────────────────────────────
    // Ticks on a rule, not bars: at these volumes one claim must read as a
    // confident mark and a dead fortnight as an honest flat line.
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const dayCounts = Array.from({ length: SERIES_DAYS }, () => 0);
    for (const c of claims) {
        const idx = SERIES_DAYS - 1 - daysBetween(startOfToday.getTime(), new Date(c.redeemed_at).setHours(0, 0, 0, 0));
        if (idx >= 0 && idx < SERIES_DAYS) dayCounts[idx] += 1;
    }
    const busiestDay = Math.max(...dayCounts, 0);
    const stripStart = new Date(startOfToday.getTime() - (SERIES_DAYS - 1) * DAY)
        .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    const previewReward = liveRewards.length
        ? liveRewards[Math.min(previewIdx, liveRewards.length - 1)]
        : null;
    const previewClaims = previewReward ? claimsFor(previewReward.id) : 0;

    return (
        <div className="pt-4 pb-16 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-14 items-start">
                <div className="min-w-0">

                    {!ready ? (
                        <div className="flex items-center justify-center py-32">
                            <div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                        </div>
                    ) : loadError ? (
                        <>
                            <div className="flex items-center gap-3 mb-7">
                                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: TONE.warn.dot }} />
                                <span className="text-[9px] uppercase tracking-[0.4em] font-black text-[#BBBBBB]">Status</span>
                                <span className="flex-1 h-[1px] bg-[#E6E6E1]" />
                            </div>
                            <h1 className="text-4xl font-light tracking-tighter text-[#1A1A1A] leading-tight max-w-[17ch] mb-3">
                                We couldn’t reach your figures.
                            </h1>
                            <p className="text-[12.5px] text-[#888] leading-relaxed max-w-[46ch]">
                                Something went wrong loading this page. Nothing on your account has changed.
                            </p>
                            <button
                                type="button"
                                onClick={() => window.location.reload()}
                                className="inline-flex items-center gap-2 h-10 px-6 mt-6 bg-white border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600] transition-all"
                            >
                                Try again
                            </button>
                        </>
                    ) : (
                        <>
                            {/* ── The verdict — the page's voice, deliberately not a card ── */}
                            <div className="flex items-center gap-3 mb-7">
                                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: TONE[verdict.tone].dot }} />
                                <span className="text-[9px] uppercase tracking-[0.4em] font-black text-[#BBBBBB]">
                                    {partnerData?.name ? `${partnerData.name} — checked just now` : 'Checked just now'}
                                </span>
                                <span className="flex-1 h-[1px] bg-[#E6E6E1]" />
                            </div>

                            <h1 className="text-4xl font-light tracking-tighter text-[#1A1A1A] leading-[1.14] max-w-[17ch] mb-3">
                                {verdict.headline}
                            </h1>
                            <p className="text-[12.5px] text-[#888] leading-relaxed max-w-[48ch]">
                                {verdict.support}
                            </p>

                            {/* Exactly one yellow pill on the page, always here. Its
                                absence is itself the signal that nothing needs them. */}
                            {verdict.action && (
                                <Link to={verdict.action.to}
                                    className="inline-flex items-center gap-2 h-[34px] px-5 mt-5 bg-[#E8D200] text-[#080808] text-[9px] font-black uppercase tracking-[0.2em] rounded-full hover:brightness-95 transition-all">
                                    {verdict.action.label} <ChevronRight size={12} />
                                </Link>
                            )}

                            {/* ── Because — three facts chosen BY the verdict, so a
                                   column can never hold an irrelevant zero ── */}
                            <div className="mt-9 pt-4 border-t border-[#E6E6E1]">
                                <span className="text-[9px] uppercase tracking-[0.4em] font-black text-[#BBBBBB]">Because</span>
                                <div className="grid grid-cols-3 gap-0 mt-3">
                                    {verdict.facts.map((f, i) => (
                                        <div key={f.label} className={i < 2 ? 'pr-5 border-r border-[#E6E6E1]' : 'pl-5'}>
                                            <div className="text-[8px] uppercase tracking-[0.3em] font-black text-[#BBBBBB]">{f.label}</div>
                                            <div className="text-[26px] font-light tracking-tighter text-[#1A1A1A] leading-none mt-1.5 mb-1 tabular-nums">
                                                {f.value}
                                            </div>
                                            <div className="text-[10px] text-[#999] leading-relaxed">{f.qual}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* ── The rest — expanded by default; a collapsed list is
                                   how problems get quietly hidden ── */}
                            {rest.length > 0 && (
                                <div className="mt-7 pt-4 border-t border-[#E6E6E1]">
                                    <button type="button" onClick={() => setShowMore(v => !v)}
                                        className="flex items-center justify-between w-full group">
                                        <span className="text-[11.5px] font-bold text-[#333]">
                                            {rest.length === 1 ? '1 more thing needs you' : `${rest.length} more things need you`}
                                        </span>
                                        <ChevronRight size={14}
                                            className={`text-[#CCC] group-hover:text-[#8a7600] transition-all ${showMore ? 'rotate-90' : ''}`} />
                                    </button>
                                    {showMore && (
                                        <div className="mt-1">
                                            {rest.map(item => (
                                                <Link key={item.key} to={item.to}
                                                    className="flex items-center gap-4 py-3.5 border-b border-[#F4F4F1] last:border-0 group">
                                                    <item.icon size={14} className="text-[#BBB] group-hover:text-[#8a7600] transition-colors shrink-0" />
                                                    <span className="flex-1 min-w-0">
                                                        <span className="block text-[12px] font-bold text-[#333] truncate">{item.title}</span>
                                                        <span className="block text-[10px] text-[#999] truncate mt-0.5">{item.detail}</span>
                                                    </span>
                                                    <ChevronRight size={13} className="text-[#DDD] group-hover:text-[#8a7600] transition-colors shrink-0" />
                                                </Link>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── Delivery chain — is the break plumbing or demand? ── */}
                            <div className="mt-7 pt-4 border-t border-[#E6E6E1]">
                                <span className="text-[9px] uppercase tracking-[0.4em] font-black text-[#BBBBBB]">Delivery</span>
                                <div className="flex items-center mt-3.5">
                                    {chain.map((node, i) => (
                                        <React.Fragment key={node.id}>
                                            {i > 0 && <span className="flex-1 h-[1px] bg-[#E6E6E1] mx-2 min-w-[8px]" />}
                                            <span className="flex items-center gap-1.5 shrink-0">
                                                <span className="h-[7px] w-[7px] rounded-full shrink-0" style={{
                                                    background: node.state === 'ok' ? '#10B981'
                                                        : node.state === 'bad' ? '#E11D48' : '#D5D5D0',
                                                }} />
                                                <span className={`text-[8.5px] uppercase tracking-[0.16em] font-black ${
                                                    node.state === 'idle' ? 'text-[#BBB]' : 'text-[#333]'
                                                }`}>{node.label}</span>
                                            </span>
                                        </React.Fragment>
                                    ))}
                                </div>
                                <p className="text-[11px] text-[#999] leading-relaxed mt-3">{chainFocus.detail}</p>
                            </div>

                            {/* ── Shape — absent entirely when there is no history to
                                   draw, rather than thirty empty days ── */}
                            {claims.length > 0 && (
                                <div className="mt-7 pt-4 border-t border-[#E6E6E1]">
                                    <span className="text-[9px] uppercase tracking-[0.4em] font-black text-[#BBBBBB]">
                                        Last 30 days{truncated ? ' · showing up to 1,000 claims' : ''}
                                    </span>
                                    <div className="relative h-[26px] mt-4">
                                        <div className="absolute left-0 right-0 bottom-[6px] h-[1px] bg-[#DEDED8]" />
                                        {dayCounts.map((count, i) => count > 0 && (
                                            <span key={i}
                                                className="absolute bottom-[6px] w-[2px] rounded-[1px]"
                                                style={{
                                                    left: `${(i / (SERIES_DAYS - 1)) * 100}%`,
                                                    height: count >= busiestDay && busiestDay > 1 ? 17 : 11,
                                                    background: count >= busiestDay && busiestDay > 1 ? '#E8D200' : '#1A1A1A',
                                                }} />
                                        ))}
                                    </div>
                                    <div className="flex justify-between mt-1.5">
                                        <span className="text-[8.5px] uppercase tracking-[0.22em] font-black text-[#CCCCCC]">{stripStart}</span>
                                        <span className="text-[8.5px] uppercase tracking-[0.22em] font-black text-[#CCCCCC]">Today</span>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* ── The phone — kept, but carrying its own performance.
                       PartnerLayout's main is the scroll container so sticky works. ── */}
                <aside className={`hidden lg:block sticky top-4 transition-opacity ${ready && !loadError ? 'opacity-100' : 'opacity-0'}`}>
                    {previewReward ? (
                        <>
                            <RewardAppPreview key={previewReward.id} pageTheme="light"
                                {...previewFromReward(previewReward, partnerData?.name)} />
                            {liveRewards.length > 1 && (
                                <div className="flex items-center justify-center gap-2 mt-5">
                                    {liveRewards.map((r, i) => (
                                        <button key={r.id} type="button" onClick={() => setPreviewIdx(i)} title={r.title}
                                            aria-label={`Preview ${r.title}`}
                                            className={`h-2 rounded-full transition-all ${
                                                i === Math.min(previewIdx, liveRewards.length - 1)
                                                    ? 'w-6 bg-[#8a7600]' : 'w-2 bg-[#D5D5D0] hover:bg-[#BBBBBB]'
                                            }`} />
                                    ))}
                                </div>
                            )}
                            <div className="mt-4 text-center">
                                <div className="flex items-center justify-center gap-2">
                                    <span className="h-1.5 w-1.5 rounded-full bg-[#10B981] shadow-[0_0_10px_rgba(16,185,129,0.6)]" />
                                    <span className="text-[9px] uppercase tracking-[0.3em] font-black text-[#8a7600]">Live in app</span>
                                </div>
                                <p className="text-[10.5px] text-[#999] leading-relaxed mt-2">
                                    {claims.length === 0
                                        ? 'This is exactly what members see.'
                                        : previewClaims === 0
                                            ? claims.length === 1
                                                ? 'Your one claim came from a different reward.'
                                                : `All ${claims.length} claims came from your other rewards.`
                                            : previewClaims === claims.length
                                                ? claims.length === 1
                                                    ? 'Your only claim came from this one.'
                                                    : `All ${claims.length} claims came from this one.`
                                                : `${previewClaims} of your ${claims.length} claims came from this one.`}
                                </p>
                            </div>
                        </>
                    ) : (
                        <div className="border-2 border-dashed border-[#E6E6E1] rounded-3xl px-8 py-14 text-center">
                            <Smartphone size={24} className="text-[#DDDDDD] mx-auto mb-5" />
                            <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black leading-relaxed mb-3">
                                Nothing live yet
                            </p>
                            <p className="text-[11px] text-[#BBBBBB] leading-relaxed">
                                Approved rewards appear here exactly as members see them in the app.
                            </p>
                            {claims.length > 0 && (
                                <p className="text-[10.5px] text-[#BBBBBB] leading-relaxed mt-4 flex items-center justify-center gap-1.5">
                                    <Clock size={11} /> Your last listing took {plural(claims.length, 'claim', 'claims')}.
                                </p>
                            )}
                        </div>
                    )}
                </aside>
            </div>
        </div>
    );
}
