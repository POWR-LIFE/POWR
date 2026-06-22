import React, { useEffect, useState } from 'react';
import { Minus, Plus, Gift, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../lib/toast';

const DEFAULT_LIMIT = 2;
const MAX_LIMIT = 100;

// ─── Brand Reward Limit counter (inline, single brand) ────────────────────────
// Embedded in the reward editor's "Partner & Access" tab. Sets how many rewards
// a brand may have live + in review at once (public.brand_reward_limits, admin
// RLS). This is only the admin control — the cap itself is enforced server-side
// by the enforce_brand_reward_limit() trigger on reward_submissions.
export default function BrandRewardLimit({ brandName }) {
    const toast = useToast();
    const brand = (brandName ?? '').trim();
    const key = brand.toLowerCase();
    const [limit, setLimit] = useState(DEFAULT_LIMIT);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        if (!key) { setLimit(DEFAULT_LIMIT); return; }
        setLoading(true);
        supabase
            .from('brand_reward_limits')
            .select('reward_limit')
            .eq('brand_key', key)
            .then(({ data }) => { if (!cancelled) setLimit(data?.[0]?.reward_limit ?? DEFAULT_LIMIT); })
            .then(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [key]);

    const persist = async (next) => {
        if (!brand || saving) return;
        const prev = limit;
        setLimit(next); // optimistic
        setSaving(true);
        const { data: { user } } = await supabase.auth.getUser();
        const { error } = await supabase.from('brand_reward_limits').upsert({
            brand_key: key,
            brand_name: brand,
            reward_limit: next,
            updated_at: new Date().toISOString(),
            updated_by: user?.id ?? null,
        }, { onConflict: 'brand_key' });
        setSaving(false);
        if (error) {
            setLimit(prev); // rollback
            toast.error(error.message);
        }
    };

    if (!brand) {
        return (
            <div className="bg-white border border-[#E6E6E1] rounded-[2rem] p-8 text-center">
                <p className="text-[10px] uppercase tracking-[0.4em] text-[#AAAAAA] font-black">
                    Set a brand name to manage its reward limit
                </p>
            </div>
        );
    }

    return (
        <div className="bg-white border border-[#E6E6E1] rounded-[2rem] p-8">
            <div className="flex items-center gap-4 mb-3">
                <Gift size={16} className="text-[#8a7600]" />
                <span className="text-[10px] uppercase tracking-[0.4em] text-[#333333] font-black">Reward Limit</span>
                <span className="text-[9px] uppercase tracking-[0.3em] text-[#AAAAAA] font-black ml-1">— {brand}</span>
            </div>
            <p className="text-[11px] text-[#AAAAAA] font-black leading-relaxed mb-6">
                How many rewards this brand can have live or in review at once. Raise it when a brand asks for more.
            </p>
            <div className="flex items-center gap-6">
                <button
                    type="button"
                    onClick={() => limit > 0 && persist(limit - 1)}
                    disabled={saving || loading || limit <= 0}
                    className="w-14 h-14 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#333] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <Minus size={18} />
                </button>
                <div className="w-20 text-center">
                    {loading
                        ? <Loader2 size={20} className="animate-spin text-[#BBB] mx-auto" />
                        : <span className="text-4xl font-light tracking-tighter text-[#1A1A1A] tabular-nums">{limit}</span>}
                </div>
                <button
                    type="button"
                    onClick={() => limit < MAX_LIMIT && persist(limit + 1)}
                    disabled={saving || loading || limit >= MAX_LIMIT}
                    className="w-14 h-14 rounded-2xl bg-[#F4F4F1] border border-[#E6E6E1] flex items-center justify-center text-[#333] hover:text-[#8a7600] hover:border-[#E8D200]/40 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <Plus size={18} />
                </button>
                {saving && <span className="text-[9px] uppercase tracking-[0.3em] text-[#BBB] font-black">Saving…</span>}
            </div>
        </div>
    );
}
