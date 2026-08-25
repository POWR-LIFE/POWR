import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MousePointerClick, UserPlus, CheckCircle2, Coins, ArrowRight, Info } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';

const RANGES = [
    { days: 7,   label: '7D'  },
    { days: 30,  label: '30D' },
    { days: 90,  label: '90D' },
];

function Stat({ icon: Icon, label, value, hint, accent }) {
    return (
        <div className="bg-white border border-[#E6E6E1] rounded-3xl p-7">
            <div className="flex items-center gap-3 mb-5">
                <Icon size={15} className={accent ? 'text-[#8a7600]' : 'text-[#CCCCCC]'} strokeWidth={2.5} />
                <span className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">{label}</span>
            </div>
            <div className={`text-4xl font-light tracking-tighter tabular-nums ${accent ? 'text-[#1A1A1A]' : 'text-[#666]'}`}>
                {value}
            </div>
            {hint && <div className="text-[10px] text-[#BBBBBB] font-black mt-2 leading-relaxed">{hint}</div>}
        </div>
    );
}

export default function CreatorHome() {
    const { creatorData, isActingCreator } = useAuth();
    const [days, setDays] = useState(30);
    const [funnel, setFunnel] = useState(null);
    const [daily, setDaily] = useState([]);
    const [loading, setLoading] = useState(true);

    const creatorId = creatorData?.id;

    useEffect(() => {
        if (!creatorId) return;
        let cancelled = false;
        setLoading(true);

        const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

        Promise.all([
            // Admin preview passes the id explicitly; a real creator's own
            // binding always wins server-side, so this is safe either way.
            supabase.rpc('creator_funnel', {
                p_days: days,
                p_creator_id: isActingCreator ? creatorId : null,
            }),
            supabase
                .from('creator_click_daily')
                .select('day, clicks')
                .eq('creator_id', creatorId)
                .gte('day', since)
                .order('day', { ascending: true }),
        ]).then(([{ data: f }, { data: d }]) => {
            if (cancelled) return;
            setFunnel(f ?? null);
            // Several rows per day (platform × campaign) — fold them.
            const byDay = new Map();
            (d ?? []).forEach(r => byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.clicks));
            setDaily([...byDay.entries()].map(([day, clicks]) => ({ day, clicks })));
            setLoading(false);
        });

        return () => { cancelled = true; };
    }, [creatorId, days, isActingCreator]);

    const maxClicks = useMemo(() => Math.max(1, ...daily.map(d => d.clicks)), [daily]);

    const link = creatorData?.handle ? `powr.life/join/${creatorData.handle}` : null;
    const nothingYet = !loading && funnel && !funnel.error
        && !funnel.clicks && !funnel.signups;

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-2">
                        {creatorData?.display_name?.split(' ')[0] ?? 'Your'} numbers
                    </h1>
                    <p className="text-[11px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">
                        Last {days} days
                    </p>
                </div>
                <div className="flex gap-2">
                    {RANGES.map(r => (
                        <button
                            key={r.days}
                            onClick={() => setDays(r.days)}
                            className={`h-10 px-5 rounded-full text-[10px] uppercase tracking-[0.2em] font-black transition-all ${
                                days === r.days
                                    ? 'bg-[#1A1A1A] text-white'
                                    : 'bg-white border border-[#E6E6E1] text-[#BBBBBB] hover:text-[#666]'
                            }`}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-24">
                    <div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                </div>
            ) : funnel?.error ? (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl p-12 text-center">
                    <p className="text-sm text-[#888] font-light">
                        {funnel.error === 'not_a_creator'
                            ? "This account isn't linked to a creator profile yet."
                            : 'Pick a creator to preview.'}
                    </p>
                </div>
            ) : (
                <>
                    {/* The funnel, left to right */}
                    <div className="grid grid-cols-4 gap-5">
                        <Stat icon={MousePointerClick} label="Link taps" value={funnel?.clicks ?? 0} hint="People who tapped your link" />
                        <Stat icon={UserPlus} label="Signups" value={funnel?.signups ?? 0} hint="Entered your code" />
                        <Stat icon={CheckCircle2} label="Converted" value={funnel?.converted ?? 0} accent hint="Logged a verified workout" />
                        <Stat icon={Coins} label="Points earned" value={(funnel?.points_earned ?? 0).toLocaleString()} accent hint="All time" />
                    </div>

                    {/* First-run: the numbers are all zero and that's fine — say
                        what to do next instead of showing an empty chart. */}
                    {nothingYet ? (
                        <div className="bg-white border border-[#E6E6E1] rounded-3xl p-12 text-center">
                            <h2 className="text-2xl font-light tracking-tight text-[#1A1A1A] mb-3">Nothing's moved yet</h2>
                            <p className="text-sm text-[#888] font-light leading-relaxed max-w-md mx-auto mb-8">
                                Share your link and this page fills up. Every tap, signup and first workout lands here.
                            </p>
                            {link && (
                                <Link
                                    to="/creator/links"
                                    className="inline-flex items-center gap-3 h-12 px-8 bg-[#E8D200] text-[#080808] font-black uppercase tracking-widest text-[11px] rounded-full hover:translate-y-[-2px] transition-all"
                                >
                                    Get your link <ArrowRight size={15} />
                                </Link>
                            )}
                        </div>
                    ) : (
                        <>
                            {/* Daily taps */}
                            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8">
                                <div className="flex items-center justify-between mb-8">
                                    <h2 className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">Link taps per day</h2>
                                    <span className="text-[10px] text-[#CCCCCC] font-black tabular-nums">peak {maxClicks}</span>
                                </div>
                                {daily.length === 0 ? (
                                    <p className="text-center py-10 text-[10px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black">No taps in this window</p>
                                ) : (
                                    <div className="flex items-end gap-1.5 h-40">
                                        {/* maxWidth matters: with one or two days of data,
                                            flex-1 alone stretches a single bar across the
                                            whole card and it reads as a solid block, not a
                                            chart. Cap the width and let them pack left. */}
                                        {daily.map(d => (
                                            <div key={d.day} style={{ maxWidth: 44 }} className="flex-1 group relative flex flex-col justify-end h-full">
                                                <div
                                                    className="w-full bg-[#E8D200]/70 group-hover:bg-[#E8D200] rounded-t transition-all min-h-[2px]"
                                                    style={{ height: `${(d.clicks / maxClicks) * 100}%` }}
                                                />
                                                <div className="absolute -top-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap bg-[#1A1A1A] text-white text-[10px] font-black px-2 py-1 rounded">
                                                    {d.clicks} · {d.day.slice(5)}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* The honest caveat. This number is low for a real
                                reason and a creator deserves to know why before
                                they conclude their audience isn't converting. */}
                            {funnel?.click_to_signup != null && (
                                <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8">
                                    <div className="flex items-start gap-4">
                                        <Info size={16} className="text-[#8a7600] shrink-0 mt-1" />
                                        <div className="flex-1">
                                            <div className="flex items-baseline gap-3 mb-2">
                                                <span className="text-3xl font-light tracking-tighter text-[#1A1A1A] tabular-nums">
                                                    {funnel.click_to_signup}%
                                                </span>
                                                <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">
                                                    taps that became signups
                                                </span>
                                            </div>
                                            <p className="text-[12px] text-[#888] font-light leading-relaxed max-w-2xl">
                                                Expect this to look low. On iPhone, the App Store can't carry your code
                                                through an install — people have to enter it themselves after opening
                                                POWR. Plenty tap, install, and never type it. Telling people the code
                                                out loud, not just linking it, is what closes that gap.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </>
            )}
        </div>
    );
}
