import React, { useState } from 'react';
import { useAuth } from '../../App';
import { useToast } from '../../lib/toast';
import { Page, Card, Micro, PageTitle, Spinner, Empty, BTN_GOLD, BTN_GHOST } from '../../components/portal/ui';
import { requestGymPackage } from './venueApi';
import { PACKAGES, PACKAGE_LABEL, usePackage, trialDaysLeft, fmtDate } from './packages';

// The gym's package and the four on offer (Gym Clash packages, 2026-09-24).
// POWR sets the package and invoices; an owner asks to switch from here and
// POWR gets a Slack line. What a package unlocks is decided server-side.

export default function VenuePackage() {
    const { gym } = useAuth();
    const toast = useToast();
    const { pkg, refresh } = usePackage();
    const [busy, setBusy] = useState(null);

    if (!pkg) return <Spinner />;
    if (pkg.unknown) return <Empty title="Couldn’t load your package">Try again in a minute.</Empty>;

    const canAsk = gym?.role === 'owner' || gym?.role === 'admin';
    const days = trialDaysLeft(pkg);
    const current = PACKAGE_LABEL[pkg.package];
    const foundingLeft = Math.max(0, (pkg.founding_limit ?? 10) - (pkg.founding_taken ?? 0));
    const shown = PACKAGES.filter((p) => p.key !== 'founding' || pkg.on_trial || pkg.package === 'founding');

    const ask = async (p) => {
        if (!window.confirm(`Ask POWR to switch ${gym.name} to ${p.name}? We’ll get in touch to set it up and invoice you. Nothing is charged here.`)) return;
        setBusy(p.key);
        try {
            await requestGymPackage(gym.partner_id, p.key);
            toast.success(`Asked for ${p.name}. POWR will be in touch.`);
            refresh();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy(null);
        }
    };

    return (
        <Page>
            <PageTitle eyebrow="Package" title="Your package" sub={gym.name} />

            <Card className="p-6 sm:p-10" glow={pkg.on_trial}>
                {pkg.on_trial ? (
                    <>
                        <Micro gold>Free trial</Micro>
                        <div className="mt-3 flex items-baseline gap-3 flex-wrap">
                            <span className="text-5xl sm:text-6xl font-extralight tracking-tighter text-[#1A1A1A]">{days}</span>
                            <span className="text-[11px] uppercase tracking-[0.3em] font-black text-[#BBBBBB]">day{days === 1 ? '' : 's'} left</span>
                        </div>
                        <p className="text-[14px] text-[#777] leading-relaxed mt-4 max-w-2xl">
                            Everything is switched on until {fmtDate(pkg.trial_ends_at)}. After that {gym.name} runs
                            on {current}{pkg.package === 'clash' ? ', the free package,' : ''} unless you choose another.
                        </p>
                    </>
                ) : (
                    <>
                        <Micro gold>Your package</Micro>
                        <div className="mt-3 text-4xl sm:text-5xl font-light tracking-tighter text-[#1A1A1A]">{current}</div>
                        <p className="text-[14px] text-[#777] leading-relaxed mt-3">
                            {pkg.package === 'clash'
                                ? 'The free package: your gym on the area leaderboard, its own board and screens.'
                                : `${pkg.billing === 'annual' ? 'Billed yearly' : pkg.billing === 'monthly' ? 'Billed monthly' : 'Set up by POWR'}.`}
                        </p>
                    </>
                )}
                {pkg.requested && (
                    <p className="text-[12px] font-bold text-[#0B7A57] mt-4">
                        You asked for {PACKAGE_LABEL[pkg.requested]} on {fmtDate(pkg.requested_at)}. POWR will be in touch to set it up.
                    </p>
                )}
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-stretch">
                {shown.map((p) => {
                    const isCurrent = !pkg.on_trial && pkg.package === p.key;
                    const asked = pkg.requested === p.key;
                    const foundingGone = p.key === 'founding' && foundingLeft === 0 && pkg.package !== 'founding';
                    return (
                        <Card key={p.key} className="p-6 flex flex-col" glow={isCurrent}
                            style={p.key === 'founding' ? { borderColor: 'rgba(232,210,0,0.55)' } : undefined}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="text-xl font-bold text-[#1A1A1A] leading-tight">{p.name}</div>
                                {(isCurrent || p.tag) && (
                                    <span className={`shrink-0 inline-flex items-center h-6 px-2.5 rounded-full text-[8px] font-black uppercase tracking-[0.2em] ${isCurrent || p.key === 'founding' ? 'bg-[#E8D200] text-[#080808]' : 'border border-[#E6E6E1] text-[#888]'}`}>
                                        {isCurrent ? 'Yours' : p.tag}
                                    </span>
                                )}
                            </div>
                            <p className="text-[12px] text-[#999] mt-1 leading-snug">{p.line}</p>
                            <div className="mt-5 flex items-baseline gap-1.5">
                                <span className={`text-4xl font-extralight tracking-tighter ${p.key === 'founding' ? 'text-[#8a7600]' : 'text-[#1A1A1A]'}`}>{p.price}</span>
                                {p.per && <span className="text-[11px] text-[#AAAAAA]">{p.per}</span>}
                            </div>
                            <div className="text-[11px] text-[#AAAAAA] mt-1">{p.note}</div>
                            {p.key === 'founding' && pkg.package !== 'founding' && (
                                <div className="text-[11px] font-bold text-[#8a7600] mt-2">
                                    {foundingGone ? 'All 10 places have gone' : `${foundingLeft} of 10 places left · only during your trial`}
                                </div>
                            )}
                            <ul className="mt-5 pt-5 border-t border-[#F0F0EC] space-y-2.5 flex-1">
                                {p.items.map((it) => (
                                    <li key={it} className="flex gap-2.5 text-[12px] leading-snug text-[#444]">
                                        <span className="mt-[5px] w-1.5 h-1.5 shrink-0 bg-[#E8D200]" />{it}
                                    </li>
                                ))}
                            </ul>
                            <div className="mt-6">
                                {isCurrent ? (
                                    <div className="text-[10px] uppercase tracking-[0.25em] font-black text-[#8a7600]">Your package</div>
                                ) : asked ? (
                                    <div className="text-[11px] font-bold text-[#0B7A57]">Asked on {fmtDate(pkg.requested_at)}</div>
                                ) : !canAsk ? (
                                    <div className="text-[11px] text-[#AAAAAA]">Your gym’s owner can ask to switch.</div>
                                ) : (
                                    <button type="button" onClick={() => ask(p)} disabled={!!busy || foundingGone}
                                        className={`${p.key === 'founding' || p.key === 'pro' ? BTN_GOLD : BTN_GHOST} w-full`}>
                                        {busy === p.key ? 'Asking…' : pkg.on_trial ? `Choose ${p.name}` : `Switch to ${p.name}`}
                                    </button>
                                )}
                            </div>
                        </Card>
                    );
                })}
            </div>

            <p className="text-[12px] text-[#AAAAAA] leading-relaxed max-w-2xl">
                Every gym starts with three months free, with everything switched on. POWR sets up your package and
                invoices you; nothing is charged in the portal.
            </p>
        </Page>
    );
}
