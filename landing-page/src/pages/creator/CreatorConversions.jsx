import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';
import { Page, Card, Micro, PageTitle, Spinner, Empty, fmtDate, BTN_GHOST } from './ui';

const PAGE = 50;

function StatusPill({ converted }) {
    return converted ? (
        <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#E8D200]/10 border border-[#E8D200]/30 rounded-full text-[10px] uppercase tracking-[0.15em] font-black text-[#8a7600] whitespace-nowrap">
            <CheckCircle2 size={12} /> Converted
        </span>
    ) : (
        <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] uppercase tracking-[0.15em] font-black text-[#AAAAAA] whitespace-nowrap">
            <Clock size={12} /> Awaiting workout
        </span>
    );
}

export default function CreatorConversions() {
    const { creatorData } = useAuth();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(0);
    const [total, setTotal] = useState(0);

    const creatorId = creatorData?.id;

    useEffect(() => {
        if (!creatorId) return;
        let cancelled = false;
        setLoading(true);

        // Deliberately NO names, usernames or ids. A creator is told THAT a
        // signup happened and whether it converted — never who it was. Same
        // privacy line the brand portal's redemptions page holds.
        supabase
            .from('referrals')
            .select('id, created_at, converted_at, source, campaign', { count: 'exact' })
            .eq('creator_id', creatorId)
            .order('created_at', { ascending: false })
            .range(page * PAGE, page * PAGE + PAGE - 1)
            .then(({ data, count }) => {
                if (cancelled) return;
                setRows(data ?? []);
                setTotal(count ?? 0);
                setLoading(false);
            });

        return () => { cancelled = true; };
    }, [creatorId, page]);

    const converted = rows.filter(r => r.converted_at).length;
    const pages = Math.ceil(total / PAGE);

    const pager = pages > 1 && (
        <div className="flex items-center justify-between px-5 sm:px-8 py-5 border-t border-[#E6E6E1]">
            <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">
                Page {page + 1} of {pages}
            </span>
            <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className={`${BTN_GHOST} h-10 px-4`}>Previous</button>
                <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} className={`${BTN_GHOST} h-10 px-4`}>Next</button>
            </div>
        </div>
    );

    return (
        <Page>
            <PageTitle
                eyebrow="People you brought in"
                title="Signups"
                sub={`${total} total${total > 0 ? ` · ${converted} converted on this page` : ''}`}
            />

            {/* What "converted" means, stated once, where the word is used. */}
            <Card className="p-5 sm:p-7">
                <div className="flex items-start gap-4">
                    <ShieldCheck size={16} className="text-[#8a7600] shrink-0 mt-0.5" />
                    <p className="text-[12px] text-[#888] font-light leading-relaxed max-w-3xl">
                        A signup <span className="text-[#1A1A1A] font-normal">converts</span> when the person
                        logs their first workout that POWR could actually verify — checked in at a gym, or
                        synced from a watch. Manually typed workouts never count, for anyone. That's what
                        keeps the programme worth being part of.
                    </p>
                </div>
            </Card>

            <Card>
                {loading ? (
                    <Spinner />
                ) : rows.length === 0 ? (
                    <Empty title="No signups yet">When someone uses your code, they'll show up here.</Empty>
                ) : (
                    <>
                        {/* Phone: a card per signup. */}
                        <ul className="md:hidden divide-y divide-[#F0F0ED]">
                            {rows.map(r => (
                                <li key={r.id} className="px-5 py-4 flex items-center justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="text-[13px] text-[#1A1A1A] tabular-nums">{fmtDate(r.created_at)}</div>
                                        <div className="text-[10px] text-[#BBBBBB] font-black mt-1 truncate">
                                            {r.converted_at ? `Converted ${fmtDate(r.converted_at)}` : 'Signed up'}
                                            {r.campaign ? <span className="font-mono normal-case"> · {r.campaign}</span> : null}
                                        </div>
                                    </div>
                                    <StatusPill converted={!!r.converted_at} />
                                </li>
                            ))}
                        </ul>

                        {/* Wider: the table. */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-[#E6E6E1]">
                                        {['Signed up', 'Status', 'Converted', 'Campaign'].map(h => (
                                            <th key={h} className="text-left px-8 py-5"><Micro>{h}</Micro></th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(r => (
                                        <tr key={r.id} className="border-b border-[#E6E6E1] last:border-0 hover:bg-[#FAFAF8] transition-colors">
                                            <td className="px-8 py-5 text-[13px] text-[#666] tabular-nums">{fmtDate(r.created_at)}</td>
                                            <td className="px-8 py-5"><StatusPill converted={!!r.converted_at} /></td>
                                            <td className="px-8 py-5 text-[13px] text-[#666] tabular-nums">{fmtDate(r.converted_at)}</td>
                                            <td className="px-8 py-5 text-[12px] text-[#AAAAAA] font-mono">{r.campaign || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {pager}
                    </>
                )}
            </Card>
        </Page>
    );
}
