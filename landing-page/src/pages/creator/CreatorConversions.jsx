import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';

const PAGE = 50;

function fmt(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-2">Signups</h1>
                <p className="text-[11px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">
                    {total} total{total > 0 ? ` · ${converted} converted on this page` : ''}
                </p>
            </div>

            {/* What "converted" means, stated once, where the word is used. */}
            <div className="bg-white border border-[#E6E6E1] rounded-3xl p-7">
                <div className="flex items-start gap-4">
                    <ShieldCheck size={16} className="text-[#8a7600] shrink-0 mt-0.5" />
                    <p className="text-[12px] text-[#888] font-light leading-relaxed max-w-3xl">
                        A signup <span className="text-[#1A1A1A] font-normal">converts</span> when the person
                        logs their first workout that POWR could actually verify — checked in at a gym, or
                        synced from a watch. Manually typed workouts never count, for anyone. That's what
                        keeps the programme worth being part of.
                    </p>
                </div>
            </div>

            <div className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
                {loading ? (
                    <div className="flex justify-center py-24">
                        <div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                    </div>
                ) : rows.length === 0 ? (
                    <div className="text-center py-24 px-8">
                        <p className="text-[10px] uppercase tracking-[0.3em] text-[#CCCCCC] font-black mb-3">No signups yet</p>
                        <p className="text-sm text-[#888] font-light">
                            When someone uses your code, they'll show up here.
                        </p>
                    </div>
                ) : (
                    <>
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-[#E6E6E1]">
                                    {['Signed up', 'Status', 'Converted', 'Campaign'].map(h => (
                                        <th key={h} className="text-left px-8 py-5 text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(r => (
                                    <tr key={r.id} className="border-b border-[#F0F0ED] last:border-0 hover:bg-[#FAFAF8] transition-colors">
                                        <td className="px-8 py-5 text-[13px] text-[#666] tabular-nums">{fmt(r.created_at)}</td>
                                        <td className="px-8 py-5">
                                            {r.converted_at ? (
                                                <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#E8D200]/10 border border-[#E8D200]/30 rounded-full text-[10px] uppercase tracking-[0.15em] font-black text-[#8a7600]">
                                                    <CheckCircle2 size={12} /> Converted
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] uppercase tracking-[0.15em] font-black text-[#BBBBBB]">
                                                    <Clock size={12} /> Awaiting first workout
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-8 py-5 text-[13px] text-[#666] tabular-nums">{fmt(r.converted_at)}</td>
                                        <td className="px-8 py-5 text-[12px] text-[#AAAAAA] font-mono">{r.campaign || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {pages > 1 && (
                            <div className="flex items-center justify-between px-8 py-5 border-t border-[#E6E6E1]">
                                <span className="text-[10px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">
                                    Page {page + 1} of {pages}
                                </span>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setPage(p => Math.max(0, p - 1))}
                                        disabled={page === 0}
                                        className="h-10 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] uppercase tracking-[0.2em] font-black text-[#666] disabled:opacity-30 hover:border-[#E8D200]/40 transition-all"
                                    >
                                        Previous
                                    </button>
                                    <button
                                        onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
                                        disabled={page >= pages - 1}
                                        className="h-10 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-full text-[10px] uppercase tracking-[0.2em] font-black text-[#666] disabled:opacity-30 hover:border-[#E8D200]/40 transition-all"
                                    >
                                        Next
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
