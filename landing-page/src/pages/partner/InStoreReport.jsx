import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, Clock, Store } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { fetchInStoreReport, formatPence, formatPounds } from '../../lib/inStore';
import { formatLocale } from '../../lib/i18n';

// In-store section of the partner Redemptions page.
//
// One row per claimed reward, however many times the member opened the
// voucher (partner_in_store_report). Two numbers stay apart on purpose:
// "confirmed" means the shop scanned it (or reconciled the till barcode),
// "swiped" means staff swiped it on the member's phone. We count a swipe, but
// it doesn't prove the discount was given. Same rule as online codes, where
// only the brand can make a code "used".
//
// Outcome colours were run through the dataviz palette validator against the
// white card (lightness band, chroma, CVD separation, contrast): all pass.
const OUTCOME = {
    confirmed: { labelKey: 'brandInStore:report.outcome.confirmed', bar: '#0B7A4B', pill: 'bg-[#E7F6EE] text-[#0B7A4B]', icon: Check },
    swiped: { labelKey: 'brandInStore:report.outcome.swiped', bar: '#D97706', pill: 'bg-[#FDEDE3] text-[#A93A08]', icon: ArrowRight },
    closed: { labelKey: 'brandInStore:report.outcome.closed', bar: '#4A6FC2', pill: 'bg-[#EAF0FB] text-[#2F4F99]', icon: Clock },
    open: { labelKey: 'brandInStore:report.outcome.open', bar: '#E8D200', pill: 'bg-[#FFFCE5] text-[#6b5c00]', icon: Clock },
};

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
// "42%" in English, "42 %" in French and Spanish.
const percent = (whole) => new Intl.NumberFormat(formatLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(whole / 100);
const when = (iso) => {
    const d = new Date(iso);
    const today = new Date();
    const time = d.toLocaleTimeString(formatLocale(), { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === today.toDateString() ? time : `${d.toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short' })} ${time}`;
};

export default function InStoreReport({ brand, days }) {
    const { t: tr } = useTranslation();
    const [report, setReport] = useState(null);
    const [error, setError] = useState(false);
    const [hover, setHover] = useState(null);

    useEffect(() => {
        if (!brand) return;
        let cancelled = false;
        setError(false);
        fetchInStoreReport(brand, Number(days))
            .then((r) => { if (!cancelled) setReport(r); })
            .catch(() => { if (!cancelled) setError(true); });
        return () => { cancelled = true; };
    }, [brand, days]);

    if (error) {
        return <p className="text-[12px] text-[#999] mb-10">{tr('brandInStore:report.loadFailed')}</p>;
    }
    if (!report) return null;
    const t = report.totals;
    const barcode = report.barcode ?? { issued: 0, used: 0 };
    if (!t.opened && !barcode.issued) return null;

    const segments = ['confirmed', 'swiped', 'closed', 'open']
        .map(k => ({ key: k, n: t[k === 'open' ? 'open_now' : k] ?? 0 }))
        .filter(s => s.n > 0);
    const tip = hover ? tr('brandInStore:report.tip', { label: tr(OUTCOME[hover.key].labelKey), n: hover.n, total: t.opened, pct: percent(pct(hover.n, t.opened)) }) : null;

    return (
        <section className="mb-10">
            <div className="flex items-center gap-3 mb-6">
                <Store size={16} className="text-[#8a7600]" />
                <h2 className="text-[10px] uppercase tracking-[0.5em] font-black text-[#8a7600]">{tr('brandInStore:report.title')}</h2>
            </div>

            {t.opened > 0 && (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <Tile label={tr('brandInStore:report.opened')} value={t.opened} sub={tr('brandInStore:report.openedSub')} />
                        <Tile label={tr('brandInStore:report.confirmed')} value={t.confirmed} sub={tr('brandInStore:report.confirmedSub', { pct: percent(pct(t.confirmed, t.opened)) })} />
                        <Tile label={tr('brandInStore:report.swiped')} value={t.swiped} sub={tr('brandInStore:report.swipedSub')} />
                        <Tile label={tr('brandInStore:report.spend')} value={formatPounds(t.spend_pence)}
                            sub={t.spend_visits ? tr('brandInStore:report.spendSub', { count: t.spend_visits, average: formatPence(Math.round(t.spend_pence / t.spend_visits)) }) : tr('brandInStore:report.spendNone')} />
                    </div>

                    <div className="bg-white border border-[#E6E6E1] rounded-3xl p-7 mb-6">
                        <h3 className="text-[10px] uppercase tracking-[0.4em] font-black text-[#999] mb-4">{tr('brandInStore:report.breakdown', { count: t.opened })}</h3>
                        <div className="relative pt-11">
                            {tip && <div role="status" className="absolute top-0 left-0 px-3 py-2 rounded-xl bg-[#1A1A1A] text-white text-[12px] whitespace-nowrap">{tip}</div>}
                            <div className="flex gap-[2px] h-5">
                                {segments.map((s, i) => (
                                    <button key={s.key} type="button" aria-label={tr('brandInStore:report.segmentA11y', { label: tr(OUTCOME[s.key].labelKey), n: s.n, total: t.opened, pct: percent(pct(s.n, t.opened)) })}
                                        onMouseEnter={() => setHover(s)} onFocus={() => setHover(s)} onMouseLeave={() => setHover(null)} onBlur={() => setHover(null)}
                                        className="h-5 min-w-[6px] cursor-default"
                                        style={{
                                            flex: `${s.n} 1 0`, background: OUTCOME[s.key].bar,
                                            borderRadius: `${i === 0 ? 4 : 0}px ${i === segments.length - 1 ? 4 : 0}px ${i === segments.length - 1 ? 4 : 0}px ${i === 0 ? 4 : 0}px`,
                                        }} />
                                ))}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-x-7 gap-y-2.5 mt-4">
                            {segments.map(s => (
                                <span key={s.key} className="flex items-center gap-2 text-[13px]">
                                    <span className="w-3 h-3 rounded-[3px]" style={{ background: OUTCOME[s.key].bar }} />
                                    <span className="font-bold">{tr(OUTCOME[s.key].labelKey)}</span>
                                    <span className="text-[#666]">{s.n} · {percent(pct(s.n, t.opened))}</span>
                                </span>
                            ))}
                        </div>
                    </div>

                    {report.by_site.length > 0 && (
                        <div className="bg-white border border-[#E6E6E1] rounded-3xl p-7 mb-6">
                            <h3 className="text-[10px] uppercase tracking-[0.4em] font-black text-[#999] mb-4">{tr('brandInStore:report.byShop')}</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[640px] text-[14px] border-collapse">
                                    <thead>
                                        <tr className="text-[9px] uppercase tracking-[0.2em] text-[#888]">
                                            {['brandInStore:report.columns.shop', 'brandInStore:report.columns.opened', 'brandInStore:report.columns.confirmed', 'brandInStore:report.columns.swiped',
                                                'brandInStore:report.columns.closed', 'brandInStore:report.columns.rate', 'brandInStore:report.columns.spend'].map((h, i) => (
                                                <th key={h} scope="col" className={`font-black pb-3 border-b border-[#E6E6E1] ${i === 0 ? 'text-left pr-3' : 'text-right px-3'}`}>{tr(h)}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {report.by_site.map(r => (
                                            <tr key={r.site_id ?? 'none'} className="border-b border-[#EFEFEC] last:border-0">
                                                <th scope="row" className="text-left font-bold py-3.5 pr-3">{r.site_name}</th>
                                                <td className="text-right px-3">{r.opened}</td>
                                                <td className="text-right px-3">{r.confirmed}</td>
                                                <td className="text-right px-3">{r.swiped}</td>
                                                <td className="text-right px-3">{r.closed}</td>
                                                <td className="text-right px-3">{percent(pct(r.confirmed, r.opened))}</td>
                                                <td className="text-right pl-3">{r.spend_visits ? formatPounds(r.spend_pence) : '–'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {report.latest.length > 0 && (
                        <div className="bg-white border border-[#E6E6E1] rounded-3xl p-7 mb-6">
                            <h3 className="text-[10px] uppercase tracking-[0.4em] font-black text-[#999] mb-2">{tr('brandInStore:report.latest')}</h3>
                            {report.latest.slice(0, 10).map((row, i) => {
                                const o = OUTCOME[row.result] ?? OUTCOME.closed;
                                const detail = [row.site_name, row.result === 'confirmed' && row.staff_name ? tr('brandInStore:report.scannedBy', { name: row.staff_name }) : null,
                                    row.result === 'swiped' ? tr('brandInStore:report.swipedOnPhone') : null,
                                    row.spend_pence != null ? formatPence(row.spend_pence) : null].filter(Boolean).join(' · ');
                                return (
                                    <div key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3.5 border-t border-[#EFEFEC] first:border-0">
                                        <span className="w-24 text-[13px] text-[#666]">{when(row.at)}</span>
                                        <div className="flex-[1_1_220px] min-w-0">
                                            <div className="text-[14px] font-bold truncate">{row.member} · {row.reward}</div>
                                            {detail && <div className="text-[12px] text-[#666] truncate">{detail}</div>}
                                        </div>
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.12em] ${o.pill}`}>
                                            <o.icon size={11} strokeWidth={3} />{tr(o.labelKey)}
                                        </span>
                                    </div>
                                );
                            })}
                            <p className="text-[12px] text-[#777] leading-relaxed mt-4 pt-4 border-t border-[#EFEFEC]">
                                {tr('brandInStore:report.footnote')}
                            </p>
                        </div>
                    )}
                </>
            )}

            {barcode.issued > 0 && (
                <p className="text-[13px] text-[#555] bg-white border border-[#E6E6E1] rounded-2xl px-5 py-4">
                    <Trans i18nKey="brandInStore:report.barcodes" values={{ issued: barcode.issued, used: barcode.used }} components={{ strong: <strong /> }} />
                    {barcode.used < barcode.issued && <>{' '}{tr('brandInStore:report.barcodesReconcile')}</>}
                </p>
            )}
        </section>
    );
}

function Tile({ label, value, sub }) {
    return (
        <div className="bg-white border border-[#E6E6E1] rounded-3xl p-6">
            <div className="text-[10px] uppercase tracking-[0.3em] font-black text-[#888] mb-2">{label}</div>
            <div className="text-4xl font-light tracking-tighter text-[#1A1A1A]">{typeof value === 'number' ? value.toLocaleString(formatLocale()) : value}</div>
            <div className="text-[12px] text-[#666] mt-1">{sub}</div>
        </div>
    );
}
