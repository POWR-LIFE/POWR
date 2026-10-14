import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, Clock, Store } from 'lucide-react';
import { fetchInStoreReport, formatPence, formatPounds } from '../../lib/inStore';

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
    confirmed: { label: 'Confirmed', bar: '#0B7A4B', pill: 'bg-[#E7F6EE] text-[#0B7A4B]', icon: Check },
    swiped: { label: 'Swiped, not confirmed', bar: '#D97706', pill: 'bg-[#FDEDE3] text-[#A93A08]', icon: ArrowRight },
    closed: { label: 'Closed unused', bar: '#4A6FC2', pill: 'bg-[#EAF0FB] text-[#2F4F99]', icon: Clock },
    open: { label: 'Open now', bar: '#E8D200', pill: 'bg-[#FFFCE5] text-[#6b5c00]', icon: Clock },
};

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const when = (iso) => {
    const d = new Date(iso);
    const today = new Date();
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === today.toDateString() ? time : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
};

export default function InStoreReport({ brand, days }) {
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
        return <p className="text-[12px] text-[#999] mb-10">Couldn't load in-store figures just now.</p>;
    }
    if (!report) return null;
    const t = report.totals;
    const barcode = report.barcode ?? { issued: 0, used: 0 };
    if (!t.opened && !barcode.issued) return null;

    const segments = ['confirmed', 'swiped', 'closed', 'open']
        .map(k => ({ key: k, n: t[k === 'open' ? 'open_now' : k] ?? 0 }))
        .filter(s => s.n > 0);
    const tip = hover ? `${OUTCOME[hover.key].label} · ${hover.n} of ${t.opened} · ${pct(hover.n, t.opened)}%` : null;

    return (
        <section className="mb-10">
            <div className="flex items-center gap-3 mb-6">
                <Store size={16} className="text-[#8a7600]" />
                <h2 className="text-[10px] uppercase tracking-[0.5em] font-black text-[#8a7600]">In store</h2>
            </div>

            {t.opened > 0 && (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <Tile label="Opened at the till" value={t.opened} sub="Rewards members opened in your shops" />
                        <Tile label="Confirmed" value={t.confirmed} sub={`${pct(t.confirmed, t.opened)}% of opened · scanned by staff`} />
                        <Tile label="Swiped, not confirmed" value={t.swiped} sub="Shown and swiped, never scanned" />
                        <Tile label="Spend recorded" value={formatPounds(t.spend_pence)}
                            sub={t.spend_visits ? `On ${t.spend_visits} visit${t.spend_visits === 1 ? '' : 's'} · average ${formatPence(Math.round(t.spend_pence / t.spend_visits))}` : 'Staff can add the spend when they scan'} />
                    </div>

                    <div className="bg-white border border-[#E6E6E1] rounded-3xl p-7 mb-6">
                        <h3 className="text-[10px] uppercase tracking-[0.4em] font-black text-[#999] mb-4">What happened to the {t.opened} opened</h3>
                        <div className="relative pt-11">
                            {tip && <div role="status" className="absolute top-0 left-0 px-3 py-2 rounded-xl bg-[#1A1A1A] text-white text-[12px] whitespace-nowrap">{tip}</div>}
                            <div className="flex gap-[2px] h-5">
                                {segments.map((s, i) => (
                                    <button key={s.key} type="button" aria-label={`${OUTCOME[s.key].label}: ${s.n} of ${t.opened}, ${pct(s.n, t.opened)}%`}
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
                                    <span className="font-bold">{OUTCOME[s.key].label}</span>
                                    <span className="text-[#666]">{s.n} · {pct(s.n, t.opened)}%</span>
                                </span>
                            ))}
                        </div>
                    </div>

                    {report.by_site.length > 0 && (
                        <div className="bg-white border border-[#E6E6E1] rounded-3xl p-7 mb-6">
                            <h3 className="text-[10px] uppercase tracking-[0.4em] font-black text-[#999] mb-4">By shop</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[640px] text-[14px] border-collapse">
                                    <thead>
                                        <tr className="text-[9px] uppercase tracking-[0.2em] text-[#888]">
                                            {['Shop', 'Opened', 'Confirmed', 'Swiped only', 'Closed unused', 'Confirm rate', 'Spend'].map((h, i) => (
                                                <th key={h} scope="col" className={`font-black pb-3 border-b border-[#E6E6E1] ${i === 0 ? 'text-left pr-3' : 'text-right px-3'}`}>{h}</th>
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
                                                <td className="text-right px-3">{pct(r.confirmed, r.opened)}%</td>
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
                            <h3 className="text-[10px] uppercase tracking-[0.4em] font-black text-[#999] mb-2">Latest in store</h3>
                            {report.latest.slice(0, 10).map((row, i) => {
                                const o = OUTCOME[row.result] ?? OUTCOME.closed;
                                const detail = [row.site_name, row.result === 'confirmed' && row.staff_name ? `scanned by ${row.staff_name}` : null,
                                    row.result === 'swiped' ? 'swiped on the member’s phone' : null,
                                    row.spend_pence != null ? formatPence(row.spend_pence) : null].filter(Boolean).join(' · ');
                                return (
                                    <div key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3.5 border-t border-[#EFEFEC] first:border-0">
                                        <span className="w-24 text-[13px] text-[#666]">{when(row.at)}</span>
                                        <div className="flex-[1_1_220px] min-w-0">
                                            <div className="text-[14px] font-bold truncate">{row.member} · {row.reward}</div>
                                            {detail && <div className="text-[12px] text-[#666] truncate">{detail}</div>}
                                        </div>
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.12em] ${o.pill}`}>
                                            <o.icon size={11} strokeWidth={3} />{o.label}
                                        </span>
                                    </div>
                                );
                            })}
                            <p className="text-[12px] text-[#777] leading-relaxed mt-4 pt-4 border-t border-[#EFEFEC]">
                                Confirmed means your staff scanned the voucher. Swiped means staff swiped it on the member's phone: we count it, but it doesn't prove the discount was given.
                            </p>
                        </div>
                    )}
                </>
            )}

            {barcode.issued > 0 && (
                <p className="text-[13px] text-[#555] bg-white border border-[#E6E6E1] rounded-2xl px-5 py-4">
                    Till barcodes: <strong>{barcode.issued}</strong> handed out, <strong>{barcode.used}</strong> confirmed from your till report.
                    {barcode.used < barcode.issued && ' Upload your used list in Promo Codes › Reconcile to update this.'}
                </p>
            )}
        </section>
    );
}

function Tile({ label, value, sub }) {
    return (
        <div className="bg-white border border-[#E6E6E1] rounded-3xl p-6">
            <div className="text-[10px] uppercase tracking-[0.3em] font-black text-[#888] mb-2">{label}</div>
            <div className="text-4xl font-light tracking-tighter text-[#1A1A1A]">{typeof value === 'number' ? value.toLocaleString() : value}</div>
            <div className="text-[12px] text-[#666] mt-1">{sub}</div>
        </div>
    );
}
