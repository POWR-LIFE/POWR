import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AFFILIATE_TERMS, AFFILIATE_TERMS_VERSION } from '../../../../shared/affiliateTerms.ts';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';
import { CreatorShell } from './CreatorShell';
import { BTN_GOLD } from './ui';

function TermsBody() {
    return (
        <div className="space-y-7">
            {AFFILIATE_TERMS.map((s, i) => (
                <section key={s.title}>
                    <div className="flex items-baseline gap-3 mb-2">
                        <span className="text-[10px] font-black tracking-widest text-[#8a7600] tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                        <h2 className="text-[17px] font-semibold text-[#1A1A1A]">{s.title}</h2>
                    </div>
                    {s.body.map((p, j) => <p key={j} className="text-[14px] text-[#666] font-light leading-relaxed mb-2">{p}</p>)}
                </section>
            ))}
        </div>
    );
}

/** /affiliate/terms — public reference copy. */
export default function AffiliateTermsPage() {
    return (
        <div className="min-h-screen bg-[#F4F4F1] text-[#1A1A1A] font-['Outfit']">
            <div className="max-w-2xl mx-auto px-5 sm:px-8 py-10 sm:py-16">
                <div className="text-[10px] uppercase tracking-[0.4em] text-[#8a7600] font-black mb-3">POWR Affiliate Programme · {AFFILIATE_TERMS_VERSION}</div>
                <h1 className="text-4xl sm:text-5xl font-light tracking-tighter mb-4">Affiliate terms</h1>
                <p className="text-[15px] text-[#888] font-light leading-relaxed mb-10">Eight short sections. The two that matter most: play fair, and tell people it’s an affiliate link.</p>
                <TermsBody />
                <div className="mt-12 pt-8 border-t border-[#E6E6E1] flex flex-wrap gap-6">
                    <Link to="/affiliate" className="text-[10px] uppercase tracking-[0.3em] font-black"><span className="text-[#BBBBBB] hover:text-[#8a7600]">Affiliate portal</span></Link>
                    <Link to="/privacy" className="text-[10px] uppercase tracking-[0.3em] font-black"><span className="text-[#BBBBBB] hover:text-[#8a7600]">Privacy policy</span></Link>
                </div>
            </div>
        </div>
    );
}

/** The one-time gate the portal shows a signed-in affiliate who hasn't accepted yet. */
export function AffiliateTermsGate() {
    const { refreshCreator } = useAuth();
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);

    const accept = async () => {
        setBusy(true); setErr(null);
        const { error } = await supabase.rpc('accept_affiliate_terms', { p_version: AFFILIATE_TERMS_VERSION });
        if (error) { setErr(error.message); setBusy(false); return; }
        await refreshCreator?.();
        setBusy(false);
    };

    return (
        <div className="min-h-screen bg-[#F4F4F1] text-[#1A1A1A] font-['Outfit']">
            <div className="max-w-2xl mx-auto px-5 sm:px-8 py-10 sm:py-16 pb-40">
                <div className="text-[10px] uppercase tracking-[0.4em] text-[#8a7600] font-black mb-3">Before you start</div>
                <h1 className="text-4xl sm:text-5xl font-light tracking-tighter mb-4">The affiliate terms</h1>
                <p className="text-[15px] text-[#888] font-light leading-relaxed mb-10">One read, one tick, and your link is live. The two that matter most: play fair, and tell people it’s an affiliate link.</p>
                <TermsBody />
            </div>
            <div className="fixed bottom-0 left-0 right-0 bg-[#F4F4F1]/90 backdrop-blur-xl border-t border-[#E6E6E1] p-5 pb-[max(20px,env(safe-area-inset-bottom))]">
                <div className="max-w-2xl mx-auto">
                    {err && <div className="text-red-500 text-xs bg-red-500/5 p-3 border border-red-500/20 rounded-xl mb-3">{err}</div>}
                    <button onClick={accept} disabled={busy} className={`${BTN_GOLD} w-full`}>{busy ? 'Saving…' : 'I’ve read these — I agree'}</button>
                    <p className="text-[11px] text-[#AAAAAA] text-center mt-3">You’re confirming you’re 18 or over and will label your posts as affiliate links.</p>
                </div>
            </div>
        </div>
    );
}
