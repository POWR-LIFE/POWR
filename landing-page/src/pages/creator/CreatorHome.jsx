import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MousePointerClick, UserPlus, CheckCircle2, Coins, ArrowRight, Info, Trophy, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';
import { Page, Card, Micro, PageTitle, Spinner, Bar, fmtNum, BTN_GOLD } from './ui';
import { useCreatorProgram, stepName } from './useCreatorProgram';

const RANGES = [
    { days: 7,   label: '7D'  },
    { days: 30,  label: '30D' },
    { days: 90,  label: '90D' },
];

function Stat({ icon: Icon, label, value, hint, accent }) {
    return (
        <Card className="p-5 sm:p-7">
            <div className="flex items-center gap-3 mb-4 sm:mb-5">
                <Icon size={15} className={accent ? 'text-[#8a7600]' : 'text-[#BBBBBB]'} strokeWidth={2.5} />
                <Micro>{label}</Micro>
            </div>
            <div className={`text-3xl sm:text-4xl font-light tracking-tighter tabular-nums ${accent ? 'text-[#1A1A1A]' : 'text-[#666]'}`}>
                {value}
            </div>
            {hint && <div className="text-[10px] text-[#BBBBBB] font-black mt-2 leading-relaxed">{hint}</div>}
        </Card>
    );
}

// The thing they're working towards. Sits above the numbers because the
// numbers are the means and this is the end — a creator opening the portal on
// their phone should see "3 more to the hoodie" before anything else.
function Journey({ prog }) {
    const { loading, nextStep, lastReached, basis, basisWord, steps } = prog;
    if (loading || steps.length === 0) return null;

    if (!nextStep) {
        return (
            <Card glow className="p-6 sm:p-10">
                <div className="flex items-start gap-5">
                    <div className="w-12 h-12 rounded-full bg-[#E8D200] text-[#080808] flex items-center justify-center shrink-0">
                        <Trophy size={20} strokeWidth={2.5} />
                    </div>
                    <div>
                        <Micro gold className="mb-2">Every step reached</Micro>
                        <h2 className="text-2xl sm:text-3xl font-light tracking-tight text-[#1A1A1A]">You've cleared the ladder.</h2>
                        <p className="text-sm text-[#888] font-light mt-2">Every conversion still earns points. Keep going.</p>
                    </div>
                </div>
            </Card>
        );
    }

    const from = lastReached?.n ?? 0;
    const pct = ((basis - from) / Math.max(1, nextStep.n - from)) * 100;
    const remaining = nextStep.n - basis;
    const cr = nextStep.creator_rewards;

    return (
        <Card glow className="p-6 sm:p-10">
            <div className="flex flex-col sm:flex-row sm:items-center gap-6 sm:gap-10">
                {cr?.image_url ? (
                    <div className="relative shrink-0 w-24 h-24 sm:w-36 sm:h-36">
                        <div className="absolute inset-0 rounded-3xl blur-2xl" style={{ background: 'rgba(232,210,0,0.25)' }} />
                        <img src={cr.image_url} alt="" className="relative w-full h-full rounded-3xl object-cover border border-[#E8D200]/30" />
                    </div>
                ) : (
                    <div className="shrink-0 w-24 h-24 sm:w-36 sm:h-36 rounded-3xl bg-[#E8D200]/10 border border-[#E8D200]/25 flex items-center justify-center">
                        <Sparkles size={34} className="text-[#8a7600]" />
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <Micro gold className="mb-3">Next up</Micro>
                    <h2 className="text-3xl sm:text-4xl lg:text-5xl font-light tracking-tighter text-[#1A1A1A] leading-[0.95] mb-2">
                        {stepName(nextStep)}
                    </h2>
                    <p className="text-sm text-[#888] font-light mb-6">
                        <span className="text-[#1A1A1A] font-normal tabular-nums">{remaining}</span> more {remaining === 1 ? basisWord.replace(/s$/, '') : basisWord} to unlock
                        {cr?.value_label ? <> · <span className="text-[#666]">{cr.value_label}</span></> : null}
                        {nextStep.points > 0 ? <> · <span className="text-[#8a7600]">+{fmtNum(nextStep.points)} pts</span></> : null}
                    </p>
                    <Bar pct={pct} tall />
                    <div className="flex justify-between mt-2 text-[10px] font-black tabular-nums">
                        <span className="text-[#BBBBBB]">{basis} {basisWord}</span>
                        <span className="text-[#8a7600]">{nextStep.n}</span>
                    </div>
                </div>
            </div>
        </Card>
    );
}

export default function CreatorHome() {
    const { creatorData, isActingCreator } = useAuth();
    const prog = useCreatorProgram();
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

    const first = creatorData?.display_name?.split(' ')[0];

    return (
        <Page>
            <PageTitle
                eyebrow={first ? `Welcome back, ${first}` : 'Welcome back'}
                title="Your numbers"
                sub={`Last ${days} days`}
                right={
                    <div className="flex gap-2">
                        {RANGES.map(r => (
                            <button
                                key={r.days}
                                onClick={() => setDays(r.days)}
                                className={`h-10 px-4 sm:px-5 rounded-full text-[10px] uppercase tracking-[0.2em] font-black transition-all ${
                                    days === r.days
                                        ? 'bg-[#1A1A1A] text-white'
                                        : 'bg-[#F4F4F1] border border-[#E6E6E1] text-[#AAAAAA] hover:text-[#444]'
                                }`}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>
                }
            />

            <Journey prog={prog} />

            {loading ? (
                <Spinner />
            ) : funnel?.error ? (
                <Card className="p-12 text-center">
                    <p className="text-sm text-[#888] font-light">
                        {funnel.error === 'not_a_creator'
                            ? "This account isn't linked to a creator profile yet."
                            : 'Pick a creator to preview.'}
                    </p>
                </Card>
            ) : (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
                    <Stat icon={MousePointerClick} label="Link taps" value={fmtNum(funnel?.clicks)} hint="People who tapped your link" />
                    <Stat icon={UserPlus} label="Signups" value={fmtNum(funnel?.signups)} hint="Entered your code" />
                    <Stat icon={CheckCircle2} label="Converted" value={fmtNum(funnel?.converted)} accent hint="Logged a verified workout" />
                    <Stat icon={Coins} label="Points" value={fmtNum(funnel?.points_earned)} accent hint="Earned, all time" />
                </div>
            )}

            {/* First-run: the numbers are all zero and that's fine — say
                what to do next instead of showing an empty chart. */}
            {!loading && !funnel?.error && nothingYet && (
                <Card className="p-8 sm:p-12 text-center">
                    <h2 className="text-2xl sm:text-3xl font-light tracking-tight text-[#1A1A1A] mb-3">Nothing's moved yet</h2>
                    <p className="text-sm text-[#888] font-light leading-relaxed max-w-md mx-auto mb-8">
                        Share your link and this page fills up. Every tap, signup and first workout lands here.
                    </p>
                    {link && (
                        <Link to="/creator/links" className={BTN_GOLD} style={{ color: '#080808' }}>
                            <span className="flex items-center gap-3">Get your link <ArrowRight size={15} /></span>
                        </Link>
                    )}
                </Card>
            )}

            {!loading && !funnel?.error && !nothingYet && (
                <Card className="p-5 sm:p-8">
                    <div className="flex items-center justify-between mb-6 sm:mb-8">
                        <Micro>Link taps per day</Micro>
                        <span className="text-[10px] text-[#BBBBBB] font-black tabular-nums">peak {maxClicks}</span>
                    </div>
                    {daily.length === 0 ? (
                        <p className="text-center py-10 text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">No taps in this window</p>
                    ) : (
                        <div className="flex items-end gap-1 sm:gap-1.5 h-32 sm:h-40">
                            {/* maxWidth matters: with one or two days of data,
                                flex-1 alone stretches a single bar across the
                                whole card and it reads as a solid block, not a
                                chart. Cap the width and let them pack left. */}
                            {daily.map(d => (
                                <div key={d.day} style={{ maxWidth: 44 }} className="flex-1 group relative flex flex-col justify-end h-full">
                                    <div
                                        className="w-full rounded-t transition-all min-h-[2px] bg-[#E8D200]/80 group-hover:bg-[#E8D200] group-hover:shadow-[0_0_16px_rgba(232,210,0,0.5)]"
                                        style={{ height: `${(d.clicks / maxClicks) * 100}%` }}
                                    />
                                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap bg-[#1A1A1A] text-white text-[10px] font-black px-2 py-1 rounded z-10">
                                        {d.clicks} · {d.day.slice(5)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            )}

            {/* The honest caveat. This number is low for a real reason and a
                creator deserves to know why before they conclude their
                audience isn't converting. */}
            {!loading && !funnel?.error && !nothingYet && funnel?.click_to_signup != null && (
                <Card className="p-5 sm:p-8">
                    <div className="flex items-start gap-4">
                        <Info size={16} className="text-[#8a7600] shrink-0 mt-1" />
                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
                                <span className="text-3xl font-light tracking-tighter text-[#1A1A1A] tabular-nums">
                                    {funnel.click_to_signup}%
                                </span>
                                <Micro>taps that became signups</Micro>
                            </div>
                            <p className="text-[12px] text-[#888] font-light leading-relaxed max-w-2xl">
                                Expect this to look low. On iPhone, the App Store can't carry your code
                                through an install — people have to enter it themselves after opening
                                POWR. Plenty tap, install, and never type it. Telling people the code
                                out loud, not just linking it, is what closes that gap.
                            </p>
                        </div>
                    </div>
                </Card>
            )}
        </Page>
    );
}
