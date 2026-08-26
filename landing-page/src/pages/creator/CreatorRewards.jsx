import React from 'react';
import { Coins, Package, Gift, Lock, Check, Truck, ShieldCheck, Zap, CalendarDays, MapPin } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../App';
import { Page, Card, Micro, PageTitle, Spinner, Empty, Bar, fmtDate, fmtNum } from './ui';
import { useCreatorProgram, stepName } from './useCreatorProgram';

const SHIP_LABEL = {
    owed:      'Being sorted',
    approved:  'Approved — packing',
    shipped:   'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
};

function joinList(arr) {
    if (!arr?.length) return '';
    if (arr.length === 1) return arr[0];
    return `${arr.slice(0, -1).join(', ')} or ${arr[arr.length - 1]}`;
}

const VERIF_LABEL = { geofence: 'checked in at a gym', wearable: 'synced from a watch', gps: 'GPS-tracked', hr: 'heart-rate verified' };

// One rung of the ladder. Three states: reached (gold, lit), current (the one
// they're climbing — progress bar, brightest border), locked (dimmed, but the
// reward is still SHOWN — that's the point of the ladder).
function Step({ step, hit, isNext, basis, basisWord, from, rewardTitles, needsAddress }) {
    const cr = step.creator_rewards;
    const hasThing = cr || step.product_name || step.product_sku || step.reward_id;
    const pct = isNext ? ((basis - from) / Math.max(1, step.n - from)) * 100 : 0;

    const tone = hit
        ? 'bg-[#E8D200]/[0.06] border-[#E8D200]/35'
        : isNext
            ? 'bg-[#F4F4F1] border-[#CFCFC8]'
            : 'bg-[#F4F4F1] border-[#E6E6E1]';

    return (
        <li className={`relative p-5 sm:p-6 rounded-2xl border transition-all ${tone}`}>
            {isNext && (
                <div aria-hidden className="absolute -inset-px rounded-2xl pointer-events-none" style={{ boxShadow: '0 0 60px rgba(232,210,0,0.12)' }} />
            )}
            <div className="relative flex items-start gap-4">
                {cr?.image_url ? (
                    <img
                        src={cr.image_url}
                        alt=""
                        className={`w-16 h-16 sm:w-20 sm:h-20 rounded-xl object-cover border shrink-0 ${hit ? 'border-[#E8D200]/40' : isNext ? 'border-[#CFCFC8]' : 'border-[#E6E6E1] grayscale-[60%] opacity-60'}`}
                    />
                ) : (
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${hit ? 'bg-[#E8D200] text-[#080808]' : 'bg-[#F4F4F1] border border-[#E6E6E1] text-[#BBBBBB]'}`}>
                        {hit ? <Check size={16} strokeWidth={3} /> : <Lock size={14} />}
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <div className={`text-[15px] sm:text-[16px] font-bold ${hit || isNext ? 'text-[#1A1A1A]' : 'text-[#666]'}`}>{stepName(step)}</div>
                        {hit && <span className="text-[9px] uppercase tracking-[0.3em] font-black text-[#8a7600]">Reached</span>}
                        {isNext && <span className="text-[9px] uppercase tracking-[0.3em] font-black text-[#888]">You're here</span>}
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black mt-1">
                        {step.n} {basisWord}{cr?.value_label ? ` · ${cr.value_label}` : ''}
                    </div>
                    {(cr?.description || step.description) && (
                        <div className="text-[12px] text-[#888] font-light mt-2 leading-relaxed">{cr?.description ?? step.description}</div>
                    )}

                    <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3">
                        {step.points > 0 && (
                            <div className="flex items-center gap-2 text-[#8a7600]"><Coins size={13} /><span className="text-[12px] font-black tabular-nums">+{fmtNum(step.points)} pts</span></div>
                        )}
                        {!cr && (step.product_name || step.product_sku) && (
                            <div className="flex items-center gap-2 text-[#666]"><Package size={12} /><span className="text-[11px] font-black">{step.product_name || step.product_sku}</span></div>
                        )}
                        {step.reward_id && (
                            <div className="flex items-center gap-2 text-[#666]"><Gift size={12} /><span className="text-[11px] font-black">{rewardTitles[step.reward_id] ?? 'Reward'}</span></div>
                        )}
                    </div>

                    {isNext && (
                        <div className="mt-4">
                            <Bar pct={pct} />
                            <div className="text-[10px] text-[#BBBBBB] font-black mt-2 tabular-nums">{basis} / {step.n} · {step.n - basis} to go</div>
                        </div>
                    )}
                    {hit && hasThing && SHIP_LABEL[hit.fulfilment_status] && (
                        <div className="flex flex-wrap items-center gap-2 mt-3 text-[11px] font-black uppercase tracking-[0.2em] text-[#8a7600]">
                            <Truck size={13} /> {SHIP_LABEL[hit.fulfilment_status]}
                            {hit.tracking_number && <span className="font-mono normal-case tracking-normal text-[#888]">{hit.carrier ? `${hit.carrier} ` : ''}{hit.tracking_number}</span>}
                        </div>
                    )}
                    {hit && hasThing && hit.fulfilment_status === 'owed' && needsAddress && (
                        <Link to="/affiliate/settings" className="inline-flex items-center gap-2 mt-3 text-[11px] font-black">
                            <MapPin size={12} className="text-amber-700" />
                            <span className="text-amber-700 underline underline-offset-4">Add your address so we can send this</span>
                        </Link>
                    )}
                </div>
            </div>
        </li>
    );
}

export default function CreatorRewards() {
    const { creatorData } = useAuth();
    const {
        loading, program, steps, reachedByStep, earnings, counts,
        rewardTitles, basis, basisWord, nextStep, lastReached, perConversion, totalPoints,
    } = useCreatorProgram();

    if (loading) return <Spinner />;

    const needsAddress = !creatorData?.shipping_address;

    return (
        <Page>
            <PageTitle
                eyebrow="What you're working towards"
                title="Rewards"
                sub={`${counts.conversions} converted · ${fmtNum(totalPoints)} points earned`}
            />

            {/* How you earn — the deal, up front */}
            {program && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
                    <Card glow dark className="p-6 sm:p-7">
                        <div className="flex items-center gap-2 mb-4 sm:mb-5 text-[#E8D200]"><Zap size={14} /><Micro gold onDark>Every conversion</Micro></div>
                        <div className="text-4xl font-light tracking-tighter tabular-nums text-white">+{perConversion}</div>
                        <div className="text-[11px] text-white/50 font-black mt-2 leading-relaxed">points to you, +{program.invitee_bonus_points} to them</div>
                    </Card>
                    {program.event_signup_points > 0 ? (
                        <Card className="p-6 sm:p-7">
                            <div className="flex items-center gap-2 mb-4 sm:mb-5 text-[#8a7600]"><CalendarDays size={14} /><Micro>Live events</Micro></div>
                            <div className="text-4xl font-light tracking-tighter tabular-nums text-[#1A1A1A]">+{program.event_signup_points}</div>
                            <div className="text-[11px] text-[#AAAAAA] font-black mt-2 leading-relaxed">each time one of your signups joins an event</div>
                        </Card>
                    ) : (
                        <Card className="p-6 sm:p-7">
                            <div className="flex items-center gap-2 mb-4 sm:mb-5 text-[#BBBBBB]"><Package size={14} /><Micro>Next step</Micro></div>
                            {nextStep ? (
                                <>
                                    <div className="text-4xl font-light tracking-tighter tabular-nums text-[#1A1A1A]">{nextStep.n - basis}</div>
                                    <div className="text-[11px] text-[#AAAAAA] font-black mt-2 leading-relaxed">more to <span className="text-[#1A1A1A]">{stepName(nextStep)}</span></div>
                                </>
                            ) : (
                                <div className="text-[12px] text-[#AAAAAA] font-black mt-2">Every step reached</div>
                            )}
                        </Card>
                    )}
                    <Card className="p-6 sm:p-7">
                        <div className="flex items-center gap-2 mb-4 sm:mb-5 text-[#BBBBBB]"><ShieldCheck size={14} /><Micro>What counts</Micro></div>
                        <p className="text-[12px] text-[#666] leading-relaxed">
                            A first workout that's {joinList(program.conversion_verifications.map(v => VERIF_LABEL[v] ?? v))}
                            {program.min_session_minutes > 0 && <>, at least {program.min_session_minutes} min</>}
                            {program.conversion_window_days && <>, within {program.conversion_window_days} days of signing up</>}.
                            Typed-in workouts never count.
                        </p>
                    </Card>
                </div>
            )}

            {/* Step ladder */}
            <Card className="p-5 sm:p-8">
                <div className="flex items-baseline justify-between mb-6 sm:mb-8">
                    <Micro>The ladder</Micro>
                    <span className="text-[10px] text-[#BBBBBB] font-black tabular-nums">{basis} {basisWord}</span>
                </div>

                {steps.length === 0 ? (
                    <p className="text-center py-10 text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">No steps set up yet</p>
                ) : (
                    <ol className="space-y-3 sm:space-y-4">
                        {steps.map(t => (
                            <Step
                                key={t.id}
                                step={t}
                                hit={reachedByStep.get(t.id)}
                                isNext={nextStep?.id === t.id}
                                basis={basis}
                                basisWord={basisWord}
                                from={lastReached?.n ?? 0}
                                rewardTitles={rewardTitles}
                                needsAddress={needsAddress}
                            />
                        ))}
                    </ol>
                )}
            </Card>

            {/* Ledger */}
            <Card>
                <div className="px-5 sm:px-8 py-5 sm:py-6 border-b border-[#E6E6E1]">
                    <Micro>Earnings</Micro>
                </div>
                {earnings.length === 0 ? (
                    <Empty title="Nothing earned yet">Points land here the moment a signup logs their first verified workout.</Empty>
                ) : (
                    <>
                        <ul className="md:hidden divide-y divide-[#F0F0ED]">
                            {earnings.map(e => (
                                <li key={e.id} className="px-5 py-4 flex items-center justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="text-[13px] text-[#1A1A1A] truncate">{e.note || e.kind}</div>
                                        <div className="text-[10px] text-[#BBBBBB] font-black mt-1 tabular-nums">{fmtDate(e.created_at)}</div>
                                    </div>
                                    <div className="text-[14px] font-black text-[#8a7600] tabular-nums shrink-0">+{fmtNum(e.points_amount)}</div>
                                </li>
                            ))}
                        </ul>
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-[#E6E6E1]">
                                        {['Date', 'What', 'Points'].map(h => (
                                            <th key={h} className="text-left px-8 py-5"><Micro>{h}</Micro></th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {earnings.map(e => (
                                        <tr key={e.id} className="border-b border-[#E6E6E1] last:border-0 hover:bg-[#FAFAF8] transition-colors">
                                            <td className="px-8 py-5 text-[13px] text-[#666] tabular-nums">{fmtDate(e.created_at)}</td>
                                            <td className="px-8 py-5 text-[13px] text-[#1A1A1A]">{e.note || e.kind}</td>
                                            <td className="px-8 py-5 text-[13px] font-black text-[#8a7600] tabular-nums">+{fmtNum(e.points_amount)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </Card>

            {!creatorData?.member_user_id && totalPoints > 0 && (
                <Card className="p-5 sm:p-8">
                    <p className="text-[12px] text-[#888] font-light leading-relaxed max-w-2xl">
                        Your points are being held against your affiliate profile. Tell us the email on your POWR
                        app account and we'll move them across so you can actually spend them.
                    </p>
                </Card>
            )}
        </Page>
    );
}
