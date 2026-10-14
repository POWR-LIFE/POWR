import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { Copy, ExternalLink } from 'lucide-react';
import { useAuth } from '../../App';
import { useToast } from '../../lib/toast';
import { Page, Card, Micro, PageTitle, Spinner, Empty, BTN_GOLD, BTN_GHOST } from '../../components/portal/ui';
import { storageImage } from '../../lib/storage';
import { formatLocale } from '../../lib/i18n';
import { serverErrorText } from '../../lib/serverErrors';
import { claimPartnerCode, fetchPartnerDiscounts } from './venueApi';

// Partner discounts (Clash+): the discounts POWR members get from our brand
// partners, for the gym to buy prizes and kit. The gym takes one code per
// brand when it needs one (gym_claim_partner_code): a shared code as it is,
// one code from the brand's pool held for the gym, or the brand's link. The
// same code comes back for a week, so no gym drains a pool. A discount is
// never a prize itself; the event builder can also send everyone who took
// part a code at the reveal, picked from this same list.

// How it works: [title, body] keys, translated where they render.
const STEPS = [
    ['venueGrowth:partners.how.steps.pick.title', 'venueGrowth:partners.how.steps.pick.body'],
    ['venueGrowth:partners.how.steps.code.title', 'venueGrowth:partners.how.steps.code.body'],
    ['venueGrowth:partners.how.steps.shop.title', 'venueGrowth:partners.how.steps.shop.body'],
];

const KIND = { pool: 'venueGrowth:partners.kind.pool', shared: 'venueGrowth:partners.kind.shared', link: 'venueGrowth:partners.kind.link' };

const fmtShort = (iso) => new Intl.DateTimeFormat(formatLocale(), { timeZone: 'Europe/London', day: 'numeric', month: 'short' }).format(new Date(iso));
const hostOf = (url) => { try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; } };
// The gym's code for this week, if it has one.
const current = (claim) => (claim && (!claim.next_at || new Date(claim.next_at) > new Date()) ? claim : null);

/** A brand's logo as the app shows it: on a dark tile (the art is made for the dark app). */
export function BrandTile({ d, className = 'w-12 h-12 rounded-2xl' }) {
    return (
        <span className={`${className} shrink-0 bg-[#141414] flex items-center justify-center overflow-hidden`}>
            {d.image_url
                ? <img src={storageImage(d.image_url, 160)} alt="" className="w-[74%] h-[74%] object-contain" />
                : <span className="text-[10px] font-black uppercase text-white/60">{(d.brand_name ?? '?').slice(0, 3)}</span>}
        </span>
    );
}

function CodeBox({ d, claim, onCopy }) {
    const { t } = useTranslation();
    return (
        <div>
            <div className="rounded-2xl bg-[#1A1A1A] p-4">
                <div className="text-[9px] uppercase tracking-[0.4em] font-black text-white/40">{claim.code ? t('venueGrowth:partners.code.yourCode') : t('venueGrowth:partners.code.yourLink')}</div>
                <div className="mt-2 flex items-center gap-3">
                    {claim.code
                        ? <code className="flex-1 min-w-0 font-mono text-[17px] tracking-wider text-[#E8D200] break-all">{claim.code}</code>
                        : <span className="flex-1 min-w-0 text-[14px] text-white/85 truncate">{hostOf(claim.url)}</span>}
                    <button type="button" onClick={() => onCopy(claim.code ?? claim.url)} aria-label={claim.code ? t('venueGrowth:partners.code.copyCode') : t('venueGrowth:partners.code.copyLink')}
                        className="w-10 h-10 shrink-0 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center text-white transition-colors">
                        <Copy size={15} />
                    </button>
                </div>
                <div className="text-[11px] text-white/45 mt-3 leading-relaxed">
                    {d.kind === 'pool' && t('venueGrowth:partners.code.pool', { date: fmtShort(claim.next_at) })}
                    {d.kind === 'shared' && t('venueGrowth:partners.code.shared')}
                    {d.kind === 'link' && t('venueGrowth:partners.code.link')}
                </div>
            </div>
            {claim.url && (
                <a href={claim.url} target="_blank" rel="noopener noreferrer" className={`${BTN_GHOST} w-full mt-3`}>
                    <span className="inline-flex items-center gap-2 text-[#666]">{t('venueGrowth:partners.code.shopAt', { brand: d.brand_name })} <ExternalLink size={12} /></span>
                </a>
            )}
        </div>
    );
}

function DiscountCard({ d, busy, onClaim, onCopy }) {
    const { t } = useTranslation();
    const claim = current(d.claim);
    const low = d.kind === 'pool' && d.available > 0 && d.available <= 20;
    // A title or terms that only repeat the brand or the value say nothing new.
    const same = (x) => [d.brand_name, d.value].some(y => (y ?? '').trim().toLowerCase() === (x ?? '').trim().toLowerCase());
    const blurb = d.offer || (d.title && !same(d.title) ? d.title : null);
    const terms = d.terms && !same(d.terms) ? d.terms : null;
    return (
        <Card className="flex flex-col">
            <div className="relative h-32 sm:h-36 bg-[#141414]">
                {d.hero_image_url && <img src={storageImage(d.hero_image_url, 720)} alt="" className="absolute inset-0 w-full h-full object-cover object-top" />}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/0" />
                <div className="absolute left-4 right-4 bottom-3 flex items-end justify-between gap-3">
                    {d.image_url
                        ? <img src={storageImage(d.image_url, 240)} alt={d.brand_name} className="h-11 w-24 object-contain object-left" />
                        : <span className="text-white text-lg font-bold">{d.brand_name}</span>}
                    <span className="h-6 px-2.5 inline-flex items-center rounded-full bg-black/55 border border-white/15 text-[8px] font-black uppercase tracking-[0.2em] text-white/80 shrink-0">
                        {KIND[d.kind] ? t(KIND[d.kind]) : null}
                    </span>
                </div>
            </div>
            <div className="p-5 sm:p-6 flex-1 flex flex-col">
                <Micro>{d.brand_name}</Micro>
                <div className="text-3xl font-light tracking-tight text-[#1A1A1A] mt-2 leading-none">{d.value}</div>
                {blurb && <p className="text-[12px] text-[#777] leading-relaxed mt-2.5 line-clamp-3 whitespace-pre-line">{blurb}</p>}
                {terms && (
                    <details className="mt-3">
                        <summary className="text-[10px] uppercase tracking-[0.2em] font-black text-[#AAAAAA] cursor-pointer select-none hover:text-[#8a7600]">{t('venueGrowth:partners.card.terms')}</summary>
                        <p className="text-[11px] text-[#888] leading-relaxed mt-2 whitespace-pre-line">{terms}</p>
                    </details>
                )}
                <div className="mt-auto pt-5">
                    {claim ? (
                        <CodeBox d={d} claim={claim} onCopy={onCopy} />
                    ) : !d.in_stock ? (
                        <p className="text-[12px] text-[#888] leading-relaxed">{t('venueGrowth:partners.card.soldOut')}</p>
                    ) : (
                        <>
                            <button type="button" onClick={() => onClaim(d)} disabled={busy} className={`${BTN_GOLD} w-full`}>
                                {busy ? t('venueGrowth:partners.card.getting') : d.kind === 'link' ? t('venueGrowth:partners.card.getLink') : t('venueGrowth:partners.card.getCode')}
                            </button>
                            <p className="text-[11px] text-[#AAAAAA] mt-2 text-center">
                                {d.kind === 'pool' && (low ? t('venueGrowth:partners.card.poolLow', { count: d.available }) : t('venueGrowth:partners.card.pool'))}
                                {d.kind === 'shared' && t('venueGrowth:partners.card.shared')}
                                {d.kind === 'link' && t('venueGrowth:partners.card.link')}
                            </p>
                            {d.claim?.code && d.claim.expires_at && new Date(d.claim.expires_at) > new Date() && (
                                <p className="text-[11px] text-[#AAAAAA] mt-1 text-center">
                                    <Trans i18nKey="venueGrowth:partners.card.lastCode" values={{ code: d.claim.code, date: fmtShort(d.claim.expires_at) }}
                                        components={{ code: <code className="font-mono text-[#666]" /> }} />
                                </p>
                            )}
                        </>
                    )}
                </div>
            </div>
        </Card>
    );
}

export default function VenuePartners() {
    const { t } = useTranslation();
    const { gym, isActingGym } = useAuth();
    const toast = useToast();
    const [rows, setRows] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null);

    const load = useCallback(() => {
        setError(null);
        fetchPartnerDiscounts(gym.partner_id).then(setRows).catch(err => setError(err));
    }, [gym.partner_id]);
    useEffect(() => { load(); }, [load]);

    const claim = async (d) => {
        // Admin preview only, so it stays English (POWR staff).
        if (isActingGym) { toast.error('Preview only: codes are for the gym’s own team.'); return; }
        setBusy(d.reward_id);
        try {
            const row = await claimPartnerCode(gym.partner_id, d.reward_id);
            setRows(list => list.map(x => (x.reward_id === row.reward_id ? row : x)));
        } catch (err) {
            toast.error(serverErrorText(err));
        } finally {
            setBusy(null);
        }
    };
    const copy = (text) => {
        navigator.clipboard?.writeText(text)
            .then(() => toast.success(t('venueGrowth:partners.toast.copied')))
            .catch(() => toast.error(t('venueGrowth:partners.toast.copyFailed')));
    };

    if (error) {
        return <Empty title={t('venueGrowth:partners.loadError')} action={<button type="button" onClick={load} className={BTN_GHOST}>{t('common:actions.retry')}</button>}>{serverErrorText(error)}</Empty>;
    }
    if (!rows) return <Spinner />;

    // Brands with something to give first; the order is otherwise the server's (by brand).
    const list = [...rows].sort((a, b) => Number(b.in_stock) - Number(a.in_stock));

    return (
        <Page>
            <PageTitle eyebrow={t('venueGrowth:partners.eyebrow')} title={t('venueGrowth:partners.title')} sub={gym.name} />

            <Card className="p-6 sm:p-10" glow>
                <Micro gold>{t('venueGrowth:partners.how.eyebrow')}</Micro>
                <h2 className="text-2xl sm:text-3xl font-light tracking-tight text-[#1A1A1A] mt-3 max-w-2xl leading-snug">
                    {t('venueGrowth:partners.how.title')}
                </h2>
                <ol className="grid grid-cols-1 sm:grid-cols-3 gap-5 sm:gap-8 mt-8">
                    {STEPS.map(([title, body], i) => (
                        <li key={title} className="flex gap-4">
                            <span className="w-8 h-8 shrink-0 rounded-full bg-[#E8D200] text-[#080808] text-[12px] font-black flex items-center justify-center">{i + 1}</span>
                            <span className="min-w-0">
                                <span className="block text-[14px] font-bold text-[#1A1A1A]">{t(title)}</span>
                                <span className="block text-[12px] text-[#777] leading-relaxed mt-1">{t(body)}</span>
                            </span>
                        </li>
                    ))}
                </ol>
                <p className="text-[12px] text-[#888] leading-relaxed mt-8 pt-6 border-t border-[#F0F0EC] max-w-2xl">
                    {t('venueGrowth:partners.how.events')}{' '}
                    <Link to="/venue/events" className="font-bold underline underline-offset-2"><span className="text-[#8a7600]">{t('venueGrowth:partners.how.eventsLink')}</span></Link>
                </p>
            </Card>

            {list.length === 0 ? (
                <Card className="p-8"><Empty title={t('venueGrowth:partners.empty.title')}>{t('venueGrowth:partners.empty.body')}</Empty></Card>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 items-stretch">
                    {list.map(d => (
                        <DiscountCard key={d.reward_id} d={d} busy={busy === d.reward_id} onClaim={claim} onCopy={copy} />
                    ))}
                </div>
            )}

            <p className="text-[12px] text-[#AAAAAA] leading-relaxed max-w-2xl">
                {t('venueGrowth:partners.footer')}
            </p>
        </Page>
    );
}
