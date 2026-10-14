import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, FilePenLine, CircleAlert, Ticket, Send, Plug, Smartphone, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatLocale } from '../../lib/i18n';
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

// Counts go into the copy as { count, n }: count picks the plural form,
// n is the same number formatted for the reader ("1,000" / "1 000").
const fmt = (n) => n.toLocaleString(formatLocale());
const counted = (n) => ({ count: n, n: fmt(n) });
const daysBetween = (a, b) => Math.floor((a - b) / DAY);

// Tone drives the status dot, the chain and nothing else — the verdict is a
// sentence first, a colour second.
const TONE = {
    good: { dot: '#10B981', label: 'text-[#10B981]' },
    warn: { dot: '#D97706', label: 'text-[#D97706]' },
    bad: { dot: '#E11D48', label: 'text-[#E11D48]' },
};

export default function PartnerHome() {
    const { t } = useTranslation();
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
                const [rewardRes, subRes, limitRes] = await Promise.all([
                    supabase.from('rewards')
                        .select('id, title, active, reward_kind, integration_type, promo_code, brand_name, description, partner_blurb, offer, value_label, discount_type, discount_value, powr_cost, image_url, hero_image_url, hero_video_url, created_at')
                        .ilike('brand_name', brand)
                        .order('created_at', { ascending: false }),
                    supabase.from('reward_submissions')
                        .select('id, title, status, partner_feedback, updated_at')
                        .ilike('brand_name', brand),
                    supabase.from('brand_reward_limits')
                        .select('reward_limit').eq('brand_key', brand.trim().toLowerCase()),
                ]);
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
                        // A refunded claim never reached the brand (points went
                        // back, no code was honoured), so it is not a claim
                        // here — Healthspan's first overview read "took 1
                        // claim" off a refunded test redemption.
                        .neq('status', 'refunded')
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

    // The method's name (API, Shopify, Promo Codes) comes from
    // integrationShared; each sentence that names it has a fallback key for
    // when no method resolves.
    const methodLabel = method?.label;
    const finishConnecting = () => (methodLabel
        ? t('brandHome:actions.finishConnecting', { method: methodLabel })
        : t('brandHome:actions.finishConnectingFallback'));
    const notFinished = () => (methodLabel
        ? t('brandHome:method.notFinished', { method: methodLabel })
        : t('brandHome:method.notFinishedFallback'));
    const mostRecent = () => t('brandHome:qual.mostRecent', { count: daysSinceLast });
    const slots = (used) => t('brandHome:values.slots', { used, limit: rewardLimit });

    // ── The verdict ladder ────────────────────────────────────────
    // Ordered, first match wins. Rung 1-3 mean a member is blocked RIGHT NOW;
    // 4-9 mean something needs the brand but nobody is stuck; 10 is clear.
    // A dead webhook deliberately sits in "more things" rather than up here —
    // it stops the brand being notified, it blocks no member.
    const verdict = (() => {
        const fact = (label, value, qual) => ({ label, value, qual });

        if (rewards.length > 0 && liveRewards.length === 0) return {
            tone: 'bad',
            headline: t('brandHome:verdict.paused.headline'),
            covers: ['paused'],
            // An approved-but-inactive reward is almost always waiting on a
            // code route, so point at that first — "get a reward live" sends
            // the brand to a page where nothing they can do makes it live.
            support: claims.length
                ? t('brandHome:verdict.paused.supportHadClaims', counted(claims.length))
                : !deliveryMethod
                    ? t('brandHome:verdict.paused.supportNoMethod')
                    : !connected
                        ? t('brandHome:verdict.paused.supportNotConnected', { status: methodStatus?.line ?? notFinished() })
                        : t('brandHome:verdict.paused.supportConnected'),
            action: !deliveryMethod
                ? { label: t('brandHome:actions.chooseDelivery'), to: integrationPathFor(null) }
                : !connected
                    ? { label: finishConnecting(), to: integrationPathFor(deliveryMethod) }
                    : { label: t('brandHome:actions.getRewardLive'), to: '/partner/rewards' },
            facts: [
                fact(t('brandHome:facts.liveRewards'), '0', t('brandHome:qual.pausedCount', counted(rewards.length))),
                claims.length
                    ? fact(t('brandHome:facts.claimsBeforeStop'), fmt(claims.length), mostRecent())
                    : fact(t('brandHome:facts.rewardSlots'), slots(rewards.length), t('brandHome:qual.submitToGoLive')),
                fact(t('brandHome:facts.delivery'), connected ? (methodLabel ?? t('brandHome:values.ready')) : (methodLabel ?? t('brandHome:values.notChosen')),
                    connected ? t('brandHome:qual.connectedReady') : (methodStatus?.line ?? t('brandHome:qual.chooseHow'))),
            ],
        };

        if (dryRewards.length > 0) return {
            tone: 'bad',
            // The reward's title is the brand's own words, quoted as written.
            headline: t('brandHome:verdict.dry.headline', { reward: dryRewards[0].title }),
            // For a manual brand "no codes" and "not connected" are the same
            // fact, so the headline covers both. For Shopify or API they are
            // genuinely separate failures and both deserve saying.
            covers: deliveryMethod === 'manual' ? ['dry', 'connection'] : ['dry'],
            support: dryRewards.length > 1
                ? t('brandHome:verdict.dry.supportMany', { n: dryRewards.length })
                : t('brandHome:verdict.dry.supportOne'),
            action: { label: t('brandHome:actions.topUp'), to: deliveryMethod && deliveryMethod !== 'manual' ? integrationPathFor(deliveryMethod) : '/partner/promo-codes' },
            facts: [
                fact(t('brandHome:facts.outOfStock'), fmt(dryRewards.length), t('brandHome:qual.emptyPool')),
                fact(t('brandHome:facts.stillLive'), fmt(liveRewards.length), t('brandHome:qual.visibleNow')),
                fact(t('brandHome:facts.claimsAllTime'), fmt(claims.length), daysSinceLast === null ? t('brandHome:qual.noneYet') : mostRecent()),
            ],
        };

        if (liveRewards.length > 0 && deliveryMethod && !connected) return {
            tone: 'bad',
            headline: methodLabel
                ? t('brandHome:verdict.disconnected.headline', { method: methodLabel })
                : t('brandHome:verdict.disconnected.headlineFallback'),
            covers: ['connection'],
            support: t('brandHome:verdict.disconnected.support', { status: methodStatus?.line ?? t('brandHome:verdict.disconnected.connectionDown') }),
            action: {
                label: methodLabel ? t('brandHome:actions.reconnect', { method: methodLabel }) : t('brandHome:actions.reconnectFallback'),
                to: integrationPathFor(deliveryMethod),
            },
            facts: [
                fact(t('brandHome:facts.liveRewards'), fmt(liveRewards.length), t('brandHome:qual.undeliverable')),
                fact(t('brandHome:facts.delivery'), methodLabel ?? '—', methodStatus?.line ?? t('brandHome:qual.notConnected')),
                fact(t('brandHome:facts.claimsAllTime'), fmt(claims.length), daysSinceLast === null ? t('brandHome:qual.noneYet') : mostRecent()),
            ],
        };

        if (rewards.length === 0 && authored.length === 0) return {
            tone: 'warn',
            headline: connected ? t('brandHome:verdict.empty.headlineConnected') : t('brandHome:verdict.empty.headline'),
            covers: ['connection'],
            support: connected
                ? (methodLabel
                    ? t('brandHome:verdict.empty.supportConnected', { method: methodLabel })
                    : t('brandHome:verdict.empty.supportConnectedFallback'))
                : deliveryMethod
                    // They have already chosen — don't send them back to choose again.
                    ? t('brandHome:verdict.empty.supportNotConnected', { status: methodStatus?.line ?? notFinished() })
                    : t('brandHome:verdict.empty.supportNoMethod'),
            action: connected
                ? { label: t('brandHome:actions.createFirst'), to: '/partner/rewards' }
                : { label: deliveryMethod ? finishConnecting() : t('brandHome:actions.chooseDelivery'), to: integrationPathFor(deliveryMethod) },
            facts: [
                fact(t('brandHome:facts.rewardSlotsUsed'), slots(0), t('brandHome:qual.nothingSubmitted')),
                fact(t('brandHome:facts.delivery'), methodLabel ?? t('brandHome:values.notChosen'), methodStatus?.line ?? t('brandHome:qual.howCodesReach')),
                fact(t('brandHome:facts.reviewTime'), t('brandHome:values.reviewTime'), t('brandHome:qual.typicalOnceSubmit')),
            ],
        };

        // Submission problems only take the headline when nothing is live.
        // A brand whose rewards are up and selling should hear that first —
        // the rejection is real, but it drops to the list below rather than
        // becoming the whole story.
        if (rejected.length > 0 && liveRewards.length === 0) return {
            tone: 'warn',
            headline: t('brandHome:verdict.rejected.headline'),
            covers: ['rejected'],
            // partner_feedback is written by POWR staff and shown as written.
            support: rejected[0].partner_feedback || t('brandHome:verdict.rejected.support'),
            action: { label: t('brandHome:actions.revise'), to: '/partner/rewards' },
            facts: [
                fact(t('brandHome:facts.needsChanges'), fmt(rejected.length), t('brandHome:qual.sentBack')),
                fact(t('brandHome:facts.liveRewards'), fmt(liveRewards.length), liveRewards.length ? t('brandHome:qual.unaffected') : t('brandHome:qual.nothingMeantime')),
                fact(t('brandHome:facts.rewardSlots'), slots(rewards.length), t('brandHome:qual.usedByApproved')),
            ],
        };

        if (drafts.length > 0 && liveRewards.length === 0) return {
            tone: 'warn',
            headline: t('brandHome:verdict.draft.headline'),
            covers: ['draft'],
            support: t('brandHome:verdict.draft.support'),
            action: { label: t('brandHome:actions.finishDraft'), to: '/partner/rewards' },
            facts: [
                fact(t('brandHome:facts.drafts'), fmt(drafts.length), t('brandHome:qual.savedWaiting')),
                fact(t('brandHome:facts.rewardSlots'), slots(rewards.length), t('brandHome:qual.roomToSubmit')),
                fact(t('brandHome:facts.delivery'), connected ? (methodLabel ?? t('brandHome:values.ready')) : (methodLabel ?? t('brandHome:values.notChosen')),
                    connected ? t('brandHome:qual.connectedReady') : (methodStatus?.line ?? t('brandHome:qual.stillToConnect'))),
            ],
        };

        if (pending.length > 0 && liveRewards.length === 0) return {
            tone: 'warn',
            headline: t('brandHome:verdict.pending.headline'),
            support: t('brandHome:verdict.pending.support'),
            action: null,
            facts: [
                fact(t('brandHome:facts.withPowr'), fmt(pending.length), t('brandHome:qual.inReview')),
                fact(t('brandHome:facts.delivery'), connected ? (methodLabel ?? t('brandHome:values.ready')) : (methodLabel ?? t('brandHome:values.notChosen')),
                    connected ? t('brandHome:qual.connectedGoLive') : (methodStatus?.line ?? t('brandHome:qual.connectBeforeApproval'))),
                fact(t('brandHome:facts.reviewTime'), t('brandHome:values.reviewTime'), t('brandHome:qual.typical')),
            ],
        };

        if (liveRewards.length > 0 && claims.length === 0) return {
            tone: 'warn',
            headline: t('brandHome:verdict.unclaimed.headline'),
            support: t('brandHome:verdict.unclaimed.support'),
            action: { label: t('brandHome:actions.reviewListing'), to: '/partner/rewards' },
            facts: [
                fact(t('brandHome:facts.liveRewards'), fmt(liveRewards.length), daysLive > 0 ? t('brandHome:qual.listedFor', counted(daysLive)) : t('brandHome:qual.listedToday')),
                fact(t('brandHome:facts.delivery'), methodLabel ?? t('brandHome:values.ready'), t('brandHome:qual.connectedReady')),
                fact(t('brandHome:facts.price'), t('brandHome:values.price', { cost: fmt(Math.min(...liveRewards.map(r => r.powr_cost ?? 0))) }), t('brandHome:qual.cheapest')),
            ],
        };

        if (liveRewards.length > 0 && daysSinceLast !== null && daysSinceLast > QUIET_AFTER_DAYS) return {
            tone: 'warn',
            headline: t('brandHome:verdict.quiet.headline', counted(daysSinceLast)),
            support: t('brandHome:verdict.quiet.support'),
            action: { label: t('brandHome:actions.reviewListing'), to: '/partner/rewards' },
            facts: [
                fact(t('brandHome:facts.lastClaim'), fmt(daysSinceLast), t('brandHome:qual.lastClaim', counted(claims.length))),
                fact(t('brandHome:facts.liveRewards'), fmt(liveRewards.length), t('brandHome:qual.approvedVisible')),
                fact(t('brandHome:facts.powrSpent'), fmt(spent), t('brandHome:qual.earnedFirst')),
            ],
        };

        return {
            tone: 'good',
            headline: t('brandHome:verdict.good.headline', counted(claimsIn30)),
            support: t('brandHome:verdict.good.support'),
            action: null,
            facts: [
                fact(t('brandHome:facts.claims'), fmt(claimsIn30), t('brandHome:qual.in30', counted(claims.length))),
                fact(t('brandHome:facts.liveRewards'), fmt(liveRewards.length), t('brandHome:qual.approvedVisible')),
                fact(t('brandHome:facts.powrSpent'), fmt(spent), t('brandHome:qual.earnedFirst')),
            ],
        };
    })();

    // ── Everything else that needs them ───────────────────────────
    // Built independently of the verdict, then the item the verdict already
    // states is dropped so the page never says the same thing twice.
    // Titles and partner_feedback are the brand's and POWR staff's own words.
    const openItems = [
        ...rejected.map(s => ({
            key: `rejected-${s.id}`, kind: 'rejected', icon: CircleAlert,
            title: s.title ? t('brandHome:items.revise', { title: s.title }) : t('brandHome:items.reviseFallback'),
            detail: s.partner_feedback || t('brandHome:items.reviseDetail'),
            to: '/partner/rewards',
        })),
        ...drafts.map(s => ({
            key: `draft-${s.id}`, kind: 'draft', icon: FilePenLine,
            title: s.title ? t('brandHome:items.finish', { title: s.title }) : t('brandHome:items.finishFallback'),
            detail: t('brandHome:items.finishDetail'),
            to: '/partner/rewards',
        })),
        ...dryRewards.map(r => ({
            key: `dry-${r.id}`, kind: 'dry', icon: Ticket,
            title: r.title ? t('brandHome:items.addCodes', { title: r.title }) : t('brandHome:items.addCodesFallback'),
            detail: t('brandHome:items.addCodesDetail'),
            to: deliveryMethod && deliveryMethod !== 'manual' ? integrationPathFor(deliveryMethod) : '/partner/promo-codes',
        })),
        ...(deliveryMethod && !connected ? [{
            key: 'disconnected', kind: 'connection', icon: Plug,
            title: finishConnecting(),
            detail: methodStatus?.line ?? t('brandHome:items.connectDetail'),
            to: integrationPathFor(deliveryMethod),
        }] : []),
        ...(rewards.length > 0 && liveRewards.length === 0 && pending.length === 0 && drafts.length === 0 && rejected.length === 0 ? [{
            key: 'nothing-live', kind: 'paused', icon: Send,
            title: t('brandHome:items.backInApp'),
            detail: t('brandHome:items.backInAppDetail'),
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
            id: 'listed', label: t('brandHome:chain.listed'),
            state: liveRewards.length > 0 ? 'ok' : rewards.length > 0 ? 'bad' : 'idle',
            detail: liveRewards.length > 0
                ? t('brandHome:chain.listedSome', counted(liveRewards.length))
                : t('brandHome:chain.listedNone'),
        },
        {
            id: 'stocked', label: t('brandHome:chain.stocked'),
            state: !poolBacked ? (connected ? 'ok' : 'idle')
                : dryRewards.length > 0 ? 'bad'
                : liveRewards.length > 0 ? 'ok' : 'idle',
            detail: !poolBacked
                ? (methodLabel
                    ? t('brandHome:chain.stockedOnDemand', { method: methodLabel })
                    : t('brandHome:chain.stockedOnDemandFallback'))
                : dryRewards.length > 0 ? t('brandHome:chain.stockedDry')
                : t('brandHome:chain.stockedOk'),
        },
        {
            id: 'connected', label: t('brandHome:chain.connected'),
            state: !deliveryMethod ? 'idle' : connected ? 'ok' : 'bad',
            detail: methodStatus?.line ?? t('brandHome:chain.connectedNone'),
        },
        {
            id: 'delivered', label: t('brandHome:chain.delivered'),
            state: claims.length > 0 ? 'ok' : 'idle',
            detail: claims.length > 0
                ? t('brandHome:chain.deliveredSome', counted(claims.length))
                : t('brandHome:chain.deliveredNone'),
        },
        {
            id: 'used', label: t('brandHome:chain.used'),
            state: anyCodeUsed ? 'ok' : 'idle',
            detail: anyCodeUsed
                ? t('brandHome:chain.usedSome')
                : claims.length > 0
                    ? t('brandHome:chain.usedHeld')
                    : t('brandHome:chain.usedNone'),
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
        .toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short' });

    // The phone shows what members see. An approved reward that is merely
    // paused (waiting on a code route) is still real and already looks the
    // way it will in the app — show it, and say what it is waiting on, rather
    // than an empty dashed box that reads as "nothing exists".
    const previewRewards = liveRewards.length ? liveRewards : rewards;
    const previewIsLive = liveRewards.length > 0;
    const previewReward = previewRewards.length
        ? previewRewards[Math.min(previewIdx, previewRewards.length - 1)]
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
                                <span className="text-[9px] uppercase tracking-[0.4em] font-black text-[#BBBBBB]">{t('brandHome:page.status')}</span>
                                <span className="flex-1 h-[1px] bg-[#E6E6E1]" />
                            </div>
                            <h1 className="text-4xl font-light tracking-tighter text-[#1A1A1A] leading-tight max-w-[17ch] mb-3">
                                {t('brandHome:page.loadErrorTitle')}
                            </h1>
                            <p className="text-[12.5px] text-[#888] leading-relaxed max-w-[46ch]">
                                {t('brandHome:page.loadErrorBody')}
                            </p>
                            <button
                                type="button"
                                onClick={() => window.location.reload()}
                                className="inline-flex items-center gap-2 h-10 px-6 mt-6 bg-white border border-[#E6E6E1] rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600] transition-all"
                            >
                                {t('common:actions.retry')}
                            </button>
                        </>
                    ) : (
                        <>
                            {/* ── The verdict — the page's voice, deliberately not a card ── */}
                            <div className="flex items-center gap-3 mb-7">
                                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: TONE[verdict.tone].dot }} />
                                <span className="text-[9px] uppercase tracking-[0.4em] font-black text-[#BBBBBB]">
                                    {partnerData?.name ? t('brandHome:page.checkedNamed', { name: partnerData.name }) : t('brandHome:page.checked')}
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
                                <span className="text-[9px] uppercase tracking-[0.4em] font-black text-[#BBBBBB]">{t('brandHome:page.because')}</span>
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
                                            {t('brandHome:page.moreThings', { count: rest.length })}
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
                                <span className="text-[9px] uppercase tracking-[0.4em] font-black text-[#BBBBBB]">{t('brandHome:page.delivery')}</span>
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
                                        {truncated ? t('brandHome:page.last30Truncated', { max: fmt(1000) }) : t('brandHome:page.last30')}
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
                                        <span className="text-[8.5px] uppercase tracking-[0.22em] font-black text-[#CCCCCC]">{t('brandHome:page.today')}</span>
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
                            {previewRewards.length > 1 && (
                                <div className="flex items-center justify-center gap-2 mt-5">
                                    {previewRewards.map((r, i) => (
                                        <button key={r.id} type="button" onClick={() => setPreviewIdx(i)} title={r.title}
                                            aria-label={t('brandHome:preview.aria', { title: r.title })}
                                            className={`h-2 rounded-full transition-all ${
                                                i === Math.min(previewIdx, previewRewards.length - 1)
                                                    ? 'w-6 bg-[#8a7600]' : 'w-2 bg-[#D5D5D0] hover:bg-[#BBBBBB]'
                                            }`} />
                                    ))}
                                </div>
                            )}
                            {!previewIsLive ? (
                                // Approved, paused. The verdict's pill above is the
                                // page's ONE yellow CTA — this is a plain text link to
                                // the same place, so the phone points at the fix too.
                                <div className="mt-4 text-center">
                                    <div className="flex items-center justify-center gap-2">
                                        <span className="h-1.5 w-1.5 rounded-full bg-[#F59E0B] shadow-[0_0_10px_rgba(245,158,11,0.6)]" />
                                        <span className="text-[9px] uppercase tracking-[0.3em] font-black text-[#8a7600]">{t('brandHome:preview.needsFinishing')}</span>
                                    </div>
                                    <p className="text-[10.5px] text-[#999] leading-relaxed mt-2">
                                        {t('brandHome:preview.needsFinishingBody')}
                                    </p>
                                    {verdict.action && (
                                        <Link to={verdict.action.to}
                                            className="inline-flex items-center gap-1 mt-3 text-[10.5px] font-bold text-[#8a7600] underline decoration-[#E3D26A] underline-offset-4 hover:decoration-[#8a7600]">
                                            {verdict.action.label} <ChevronRight size={12} />
                                        </Link>
                                    )}
                                </div>
                            ) : (
                            <div className="mt-4 text-center">
                                <div className="flex items-center justify-center gap-2">
                                    <span className="h-1.5 w-1.5 rounded-full bg-[#10B981] shadow-[0_0_10px_rgba(16,185,129,0.6)]" />
                                    <span className="text-[9px] uppercase tracking-[0.3em] font-black text-[#8a7600]">{t('brandHome:preview.liveInApp')}</span>
                                </div>
                                <p className="text-[10.5px] text-[#999] leading-relaxed mt-2">
                                    {claims.length === 0
                                        ? t('brandHome:preview.exact')
                                        : previewClaims === 0
                                            ? claims.length === 1
                                                ? t('brandHome:preview.oneOther')
                                                : t('brandHome:preview.allOther', { n: claims.length })
                                            : previewClaims === claims.length
                                                ? claims.length === 1
                                                    ? t('brandHome:preview.oneThis')
                                                    : t('brandHome:preview.allThis', { n: claims.length })
                                                : t('brandHome:preview.someThis', { count: previewClaims, total: claims.length })}
                                </p>
                            </div>
                            )}
                        </>
                    ) : (
                        <div className="border-2 border-dashed border-[#E6E6E1] rounded-3xl px-8 py-14 text-center">
                            <Smartphone size={24} className="text-[#DDDDDD] mx-auto mb-5" />
                            <p className="text-[10px] uppercase tracking-[0.4em] text-[#CCCCCC] font-black leading-relaxed mb-3">
                                {t('brandHome:preview.nothingLive')}
                            </p>
                            <p className="text-[11px] text-[#BBBBBB] leading-relaxed">
                                {t('brandHome:preview.nothingLiveBody')}
                            </p>
                            {claims.length > 0 && (
                                <p className="text-[10.5px] text-[#BBBBBB] leading-relaxed mt-4 flex items-center justify-center gap-1.5">
                                    <Clock size={11} /> {t('brandHome:preview.lastListing', counted(claims.length))}
                                </p>
                            )}
                        </div>
                    )}
                </aside>
            </div>
        </div>
    );
}
