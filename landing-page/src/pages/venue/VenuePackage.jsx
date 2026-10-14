import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useAuth } from '../../App';
import { serverErrorText } from '../../lib/serverErrors';
import { useToast } from '../../lib/toast';
import { Page, Card, Micro, PageTitle, Spinner, Empty, BTN_GOLD, BTN_GHOST } from '../../components/portal/ui';
import { requestGymPackage } from './venueApi';
import { PACKAGES, PACKAGE_LABEL, usePackage, trialDaysLeft, fmtDate } from './packages';

// The gym's package and the four on offer (Gym Clash packages, 2026-09-24).
// POWR sets the package and invoices; an owner asks to switch from here and
// POWR gets a Slack line. What a package unlocks is decided server-side.

export default function VenuePackage() {
    const { t } = useTranslation();
    const { gym, isActingGym } = useAuth();
    const toast = useToast();
    const { pkg, refresh } = usePackage();
    const [busy, setBusy] = useState(null);

    if (!pkg) return <Spinner />;
    if (pkg.unknown) return <Empty title={t('venueShell:package.loadFailed')}>{t('venueShell:package.tryAgainSoon')}</Empty>;

    const canAsk = gym?.role === 'owner' || gym?.role === 'admin';
    const days = trialDaysLeft(pkg);
    const current = PACKAGE_LABEL[pkg.package];
    const foundingLimit = pkg.founding_limit ?? 10;
    const foundingLeft = Math.max(0, foundingLimit - (pkg.founding_taken ?? 0));
    const shown = PACKAGES.filter((p) => p.key !== 'founding' || pkg.on_trial || pkg.package === 'founding');

    const ask = async (p) => {
        // Admin preview only: stays English.
        if (isActingGym) { toast.error('Preview only. Set a gym’s package from the admin pages.'); return; }
        if (!window.confirm(t('venueShell:package.confirmAsk', { gym: gym.name, name: p.name }))) return;
        setBusy(p.key);
        try {
            await requestGymPackage(gym.partner_id, p.key);
            toast.success(t('venueShell:package.asked', { name: p.name }));
            refresh();
        } catch (err) {
            toast.error(serverErrorText(err));
        } finally {
            setBusy(null);
        }
    };

    return (
        <Page>
            <PageTitle eyebrow={t('venueShell:nav.package')} title={t('venueShell:package.title')} sub={gym.name} />

            <Card className="p-6 sm:p-10" glow={pkg.on_trial}>
                {pkg.on_trial ? (
                    <>
                        <Micro gold>{days === 0 ? t('venueShell:package.trialEnded') : t('venueShell:package.freeTrial')}</Micro>
                        <div className="mt-3 flex items-baseline gap-3 flex-wrap">
                            <span className="text-5xl sm:text-6xl font-extralight tracking-tighter text-[#1A1A1A]">{days}</span>
                            <span className="text-[11px] uppercase tracking-[0.3em] font-black text-[#BBBBBB]">{t('venueShell:package.daysLeft', { count: days })}</span>
                        </div>
                        <p className="text-[14px] text-[#777] leading-relaxed mt-4 max-w-2xl">
                            {t(days === 0
                                ? (pkg.package === 'clash' ? 'venueShell:package.endedBodyFree' : 'venueShell:package.endedBody')
                                : (pkg.package === 'clash' ? 'venueShell:package.trialBodyFree' : 'venueShell:package.trialBody'),
                            { date: fmtDate(pkg.trial_ends_at), gym: gym.name, name: current })}
                        </p>
                        {pkg.package === 'clash' && (
                            <p className="text-[12px] text-[#888] leading-relaxed mt-3 max-w-2xl">
                                <Trans i18nKey="venueShell:package.whatChanges" components={{ b: <b className="text-[#1A1A1A]" /> }} />
                            </p>
                        )}
                    </>
                ) : (
                    <>
                        <Micro gold>{t('venueShell:package.title')}</Micro>
                        <div className="mt-3 text-4xl sm:text-5xl font-light tracking-tighter text-[#1A1A1A]">{current}</div>
                        <p className="text-[14px] text-[#777] leading-relaxed mt-3">
                            {pkg.package === 'clash'
                                ? t('venueShell:package.freeBody')
                                : t(pkg.billing === 'annual' ? 'venueShell:package.billedYearly' : pkg.billing === 'monthly' ? 'venueShell:package.billedMonthly' : 'venueShell:package.setUpByPowr')}
                        </p>
                    </>
                )}
                {pkg.requested && (
                    <p className="text-[12px] font-bold text-[#0B7A57] mt-4">
                        {t('venueShell:package.requested', { name: PACKAGE_LABEL[pkg.requested], date: fmtDate(pkg.requested_at) })}
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
                                        {isCurrent ? t('venueShell:package.yours') : t(p.tag)}
                                    </span>
                                )}
                            </div>
                            <p className="text-[12px] text-[#999] mt-1 leading-snug">{t(p.line)}</p>
                            <div className="mt-5 flex items-baseline gap-1.5">
                                <span className={`text-4xl font-extralight tracking-tighter ${p.key === 'founding' ? 'text-[#8a7600]' : 'text-[#1A1A1A]'}`}>{p.priceKey ? t(p.priceKey) : p.price}</span>
                                {p.per && <span className="text-[11px] text-[#AAAAAA]">{t(p.perKey)}</span>}
                            </div>
                            <div className="text-[11px] text-[#AAAAAA] mt-1">{t(p.note)}</div>
                            {p.key === 'founding' && pkg.package !== 'founding' && (
                                <div className="text-[11px] font-bold text-[#8a7600] mt-2">
                                    {foundingGone
                                        ? t('venueShell:package.foundingGone', { limit: foundingLimit })
                                        : t('venueShell:package.foundingLeft', { count: foundingLeft, limit: foundingLimit })}
                                </div>
                            )}
                            <ul className="mt-5 pt-5 border-t border-[#F0F0EC] space-y-2.5 flex-1">
                                {p.items.map((it) => (
                                    <li key={it} className="flex gap-2.5 text-[12px] leading-snug text-[#444]">
                                        <span className="mt-[5px] w-1.5 h-1.5 shrink-0 bg-[#E8D200]" />{t(it)}
                                    </li>
                                ))}
                            </ul>
                            <div className="mt-6">
                                {isCurrent ? (
                                    <div className="text-[10px] uppercase tracking-[0.25em] font-black text-[#8a7600]">{t('venueShell:package.title')}</div>
                                ) : asked ? (
                                    <div className="text-[11px] font-bold text-[#0B7A57]">{t('venueShell:package.askedOn', { date: fmtDate(pkg.requested_at) })}</div>
                                ) : !canAsk ? (
                                    <div className="text-[11px] text-[#AAAAAA]">{t('venueShell:package.ownerCanAsk')}</div>
                                ) : (
                                    <button type="button" onClick={() => ask(p)} disabled={!!busy || foundingGone}
                                        className={`${p.key === 'founding' || p.key === 'pro' ? BTN_GOLD : BTN_GHOST} w-full`}>
                                        {busy === p.key ? t('venueShell:package.asking') : t(pkg.on_trial ? 'venueShell:package.choose' : 'venueShell:package.switchTo', { name: p.name })}
                                    </button>
                                )}
                            </div>
                        </Card>
                    );
                })}
            </div>

            <p className="text-[12px] text-[#AAAAAA] leading-relaxed max-w-2xl">
                {t('venueShell:package.footer')}
            </p>
        </Page>
    );
}
