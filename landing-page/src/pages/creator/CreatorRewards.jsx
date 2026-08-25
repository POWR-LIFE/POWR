import React, { useEffect, useState } from 'react';
import { Coins, Package, Gift, Lock, Check, Truck, ShieldCheck, Zap, CalendarDays } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';

const SHIP_LABEL = {
    owed:      'Being sorted',
    approved:  'Approved — packing',
    shipped:   'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
};

function fmt(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function joinList(arr) {
    if (!arr?.length) return '';
    if (arr.length === 1) return arr[0];
    return `${arr.slice(0, -1).join(', ')} or ${arr[arr.length - 1]}`;
}

const VERIF_LABEL = { geofence: 'checked in at a gym', wearable: 'synced from a watch', gps: 'GPS-tracked', hr: 'heart-rate verified' };

export default function CreatorRewards() {
    const { creatorData, isActingCreator } = useAuth();
    const [program, setProgram] = useState(null);
    const [steps, setSteps] = useState([]);
    const [reached, setReached] = useState([]);
    const [earnings, setEarnings] = useState([]);
    const [counts, setCounts] = useState({ conversions: 0, signups: 0 });
    const [rewardTitles, setRewardTitles] = useState({});
    const [loading, setLoading] = useState(true);

    const creatorId = creatorData?.id;

    useEffect(() => {
        if (!creatorId) return;
        let cancelled = false;
        setLoading(true);

        (async () => {
            // The programme RLS resolves "mine or the default" server-side for a
            // creator. Admin preview can read every programme, so pin it to the
            // creator being previewed.
            let progQ = supabase.from('creator_programs').select('*');
            if (isActingCreator) {
                progQ = creatorData.program_id
                    ? progQ.eq('id', creatorData.program_id)
                    : progQ.eq('is_default', true);
            }
            const [{ data: progs }, { data: m }, { data: e }, conv, sign] = await Promise.all([
                progQ.limit(1),
                supabase.from('creator_milestones').select('*').eq('creator_id', creatorId),
                supabase.from('creator_earnings').select('*').eq('creator_id', creatorId).order('created_at', { ascending: false }).limit(100),
                supabase.from('referrals').select('id', { count: 'exact', head: true }).eq('creator_id', creatorId).not('converted_at', 'is', null),
                supabase.from('referrals').select('id', { count: 'exact', head: true }).eq('creator_id', creatorId),
            ]);
            if (cancelled) return;
            const prog = progs?.[0] ?? null;
            setProgram(prog);
            setReached(m ?? []);
            setEarnings(e ?? []);
            setCounts({ conversions: conv.count ?? 0, signups: sign.count ?? 0 });

            if (prog) {
                const { data: s } = await supabase.from('creator_program_steps').select('*, creator_rewards(name, description, image_url, value_label, kind)').eq('program_id', prog.id).eq('active', true).order('n');
                if (cancelled) return;
                setSteps(s ?? []);
                const ids = [...new Set((s ?? []).map(x => x.reward_id).filter(Boolean))];
                if (ids.length) {
                    const { data: r } = await supabase.from('rewards').select('id, title, brand_name').in('id', ids);
                    if (!cancelled) setRewardTitles(Object.fromEntries((r ?? []).map(x => [x.id, x.brand_name ? `${x.brand_name} — ${x.title}` : x.title])));
                }
            }
            setLoading(false);
        })();

        return () => { cancelled = true; };
    }, [creatorId, isActingCreator, creatorData?.program_id]);

    const totalPoints = earnings.reduce((sum, e) => sum + (e.points_amount ?? 0), 0);
    const reachedByStep = new Map(reached.map(m => [m.step_id, m]));
    const basis = program?.step_counting === 'signups' ? counts.signups : counts.conversions;
    const basisWord = program?.step_counting === 'signups' ? 'signups' : 'converted signups';
    const perConversion = creatorData?.conversion_points ?? program?.creator_conversion_points ?? 50;
    const nextStep = steps.find(s => !reachedByStep.has(s.id) && s.n > basis);

    if (loading) {
        return (
            <div className="flex justify-center py-24">
                <div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-2">Rewards</h1>
                <p className="text-[11px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">
                    {counts.conversions} converted · {totalPoints.toLocaleString()} points earned
                </p>
            </div>

            {/* How you earn — the deal, up front */}
            {program && (
                <div className="grid grid-cols-3 gap-5">
                    <div className="bg-[#1A1A1A] text-white rounded-3xl p-7">
                        <div className="flex items-center gap-2 mb-5 text-[#E8D200]"><Zap size={14} /><span className="text-[9px] uppercase tracking-[0.4em] font-black">Every conversion</span></div>
                        <div className="text-4xl font-light tracking-tighter tabular-nums">+{perConversion}</div>
                        <div className="text-[11px] text-white/50 font-black mt-2 leading-relaxed">points to you, +{program.invitee_bonus_points} to them</div>
                    </div>
                    {program.event_signup_points > 0 ? (
                        <div className="bg-white border border-[#E6E6E1] rounded-3xl p-7">
                            <div className="flex items-center gap-2 mb-5 text-[#8a7600]"><CalendarDays size={14} /><span className="text-[9px] uppercase tracking-[0.4em] font-black">Live events</span></div>
                            <div className="text-4xl font-light tracking-tighter tabular-nums text-[#1A1A1A]">+{program.event_signup_points}</div>
                            <div className="text-[11px] text-[#BBBBBB] font-black mt-2 leading-relaxed">each time one of your signups joins an event</div>
                        </div>
                    ) : (
                        <div className="bg-white border border-[#E6E6E1] rounded-3xl p-7">
                            <div className="flex items-center gap-2 mb-5 text-[#CCCCCC]"><Package size={14} /><span className="text-[9px] uppercase tracking-[0.4em] font-black">Next step</span></div>
                            {nextStep ? (
                                <>
                                    <div className="text-4xl font-light tracking-tighter tabular-nums text-[#1A1A1A]">{nextStep.n - basis}</div>
                                    <div className="text-[11px] text-[#BBBBBB] font-black mt-2 leading-relaxed">more to <span className="text-[#666]">{nextStep.label}</span></div>
                                </>
                            ) : (
                                <div className="text-[12px] text-[#BBBBBB] font-black mt-2">Every step reached</div>
                            )}
                        </div>
                    )}
                    <div className="bg-white border border-[#E6E6E1] rounded-3xl p-7">
                        <div className="flex items-center gap-2 mb-5 text-[#CCCCCC]"><ShieldCheck size={14} /><span className="text-[9px] uppercase tracking-[0.4em] font-black">What counts</span></div>
                        <p className="text-[12px] text-[#666] leading-relaxed">
                            A first workout that's {joinList(program.conversion_verifications.map(v => VERIF_LABEL[v] ?? v))}
                            {program.min_session_minutes > 0 && <>, at least {program.min_session_minutes} min</>}
                            {program.conversion_window_days && <>, within {program.conversion_window_days} days of signing up</>}.
                            Typed-in workouts never count.
                        </p>
                    </div>
                </div>
            )}

            {/* Step ladder */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8">
                <div className="flex items-baseline justify-between mb-8">
                    <h2 className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">Steps</h2>
                    <span className="text-[10px] text-[#BBBBBB] font-black tabular-nums">{basis} {basisWord}</span>
                </div>

                {steps.length === 0 ? (
                    <p className="text-center py-10 text-[10px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black">No steps set up yet</p>
                ) : (
                    <div className="space-y-4">
                        {steps.map(t => {
                            const hit = reachedByStep.get(t.id);
                            const pct = Math.min(100, (basis / t.n) * 100);
                            const cr = t.creator_rewards;
                            const hasThing = cr || t.product_name || t.product_sku || t.reward_id;
                            return (
                                <div key={t.id} className={`p-6 rounded-2xl border transition-all ${hit ? 'bg-[#E8D200]/5 border-[#E8D200]/30' : 'bg-[#F4F4F1] border-[#E6E6E1]'}`}>
                                    <div className="flex items-center gap-4 mb-4">
                                        {cr?.image_url ? (
                                            <img src={cr.image_url} alt="" className={`w-16 h-16 rounded-xl object-cover border shrink-0 ${hit ? 'border-[#E8D200]/40' : 'border-[#E6E6E1] grayscale-[35%]'}`} />
                                        ) : (
                                            <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${hit ? 'bg-[#E8D200] text-[#080808]' : 'bg-white border border-[#E6E6E1] text-[#CCCCCC]'}`}>
                                                {hit ? <Check size={16} strokeWidth={3} /> : <Lock size={14} />}
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[14px] font-bold text-[#1A1A1A]">{cr?.name ?? t.label}</div>
                                            <div className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mt-0.5">
                                                {t.n} {basisWord}{cr?.value_label ? ` · ${cr.value_label}` : ''}{hit ? ' · reached' : ''}
                                            </div>
                                            {(cr?.description || t.description) && <div className="text-[12px] text-[#888] font-light mt-1.5">{cr?.description ?? t.description}</div>}
                                        </div>
                                        <div className="text-right shrink-0 space-y-1">
                                            {t.points > 0 && (
                                                <div className="flex items-center gap-2 justify-end text-[#8a7600]"><Coins size={13} /><span className="text-[13px] font-black tabular-nums">{t.points.toLocaleString()}</span></div>
                                            )}
                                            {!cr && (t.product_name || t.product_sku) && (
                                                <div className="flex items-center gap-2 justify-end text-[#666]"><Package size={12} /><span className="text-[11px] font-black">{t.product_name || t.product_sku}</span></div>
                                            )}
                                            {t.reward_id && (
                                                <div className="flex items-center gap-2 justify-end text-[#666]"><Gift size={12} /><span className="text-[11px] font-black">{rewardTitles[t.reward_id] ?? 'Reward'}</span></div>
                                            )}
                                        </div>
                                    </div>

                                    {!hit && (
                                        <>
                                            <div className="h-1.5 bg-white rounded-full overflow-hidden border border-[#E6E6E1]">
                                                <div className="h-full bg-[#E8D200] transition-all" style={{ width: `${pct}%` }} />
                                            </div>
                                            <div className="text-[10px] text-[#BBBBBB] font-black mt-2 tabular-nums">{basis} / {t.n}</div>
                                        </>
                                    )}
                                    {hit && hasThing && SHIP_LABEL[hit.fulfilment_status] && (
                                        <div className="flex items-center gap-2 mt-1 text-[11px] font-black uppercase tracking-[0.2em] text-[#8a7600]">
                                            <Truck size={13} /> {SHIP_LABEL[hit.fulfilment_status]}
                                            {hit.tracking_number && <span className="font-mono normal-case tracking-normal text-[#888] ml-2">{hit.carrier ? `${hit.carrier} ` : ''}{hit.tracking_number}</span>}
                                        </div>
                                    )}
                                    {hit && hasThing && hit.fulfilment_status === 'owed' && !creatorData?.shipping_address && (
                                        <div className="text-[11px] text-amber-700 font-black mt-2">Add your address in Settings so we can send this.</div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Ledger */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                <div className="px-8 py-6 border-b border-[#E6E6E1]">
                    <h2 className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">Earnings</h2>
                </div>
                {earnings.length === 0 ? (
                    <div className="text-center py-20 px-8">
                        <p className="text-[10px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black mb-3">Nothing earned yet</p>
                        <p className="text-sm text-[#888] font-light">Points land here the moment a signup logs their first verified workout.</p>
                    </div>
                ) : (
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-[#E6E6E1]">
                                {['Date', 'What', 'Points'].map(h => (
                                    <th key={h} className="text-left px-8 py-5 text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {earnings.map(e => (
                                <tr key={e.id} className="border-b border-[#F0F0ED] last:border-0 hover:bg-[#FAFAF8] transition-colors">
                                    <td className="px-8 py-5 text-[13px] text-[#666] tabular-nums">{fmt(e.created_at)}</td>
                                    <td className="px-8 py-5 text-[13px] text-[#1A1A1A]">{e.note || e.kind}</td>
                                    <td className="px-8 py-5 text-[13px] font-black text-[#8a7600] tabular-nums">+{(e.points_amount ?? 0).toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {!creatorData?.member_user_id && totalPoints > 0 && (
                <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8">
                    <p className="text-[12px] text-[#888] font-light leading-relaxed max-w-2xl">
                        Your points are being held against your creator profile. Tell us the email on your POWR
                        app account and we'll move them across so you can actually spend them.
                    </p>
                </div>
            )}
        </div>
    );
}
