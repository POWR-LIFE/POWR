import React, { useEffect, useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../App';
import FeaturedCalendar from '../../components/FeaturedCalendar';

function atMidnight(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function formatWindow(starts, ends) {
    const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${fmt(starts)} → ${fmt(ends)}`;
}

function isActive(starts, ends) {
    const now = Date.now();
    return new Date(starts).getTime() <= now && new Date(ends).getTime() > now;
}

export default function PartnerFeatured() {
    const { partnerData } = useAuth();
    const myBrand = partnerData?.brand_name || null;

    const [schedule, setSchedule] = useState([]);
    const [loading, setLoading] = useState(true);
    const [month, setMonth] = useState(() => atMidnight(new Date()));

    useEffect(() => {
        let active = true;
        (async () => {
            setLoading(true);
            // Public-read RLS: every brand's featured window is visible here.
            const { data } = await supabase
                .from('featured_reward_schedule')
                .select('id, reward_id, starts_at, ends_at, rewards(title, brand_name, brand_color, image_url, partners(name, logo_url))')
                .order('starts_at', { ascending: true });
            if (active) {
                setSchedule(data || []);
                setLoading(false);
            }
        })();
        return () => { active = false; };
    }, []);

    const rewardLabel = (row) => {
        const r = row.rewards;
        if (!r) return 'Reward';
        return r.partners?.name || r.brand_name || r.title || 'Reward';
    };

    const slots = useMemo(() => schedule.map(s => ({
        id: s.id,
        reward_id: s.reward_id,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        label: rewardLabel(s),
        brand_name: s.rewards?.brand_name || s.rewards?.partners?.name || null,
        brandColor: s.rewards?.brand_color || null,
        logo: s.rewards?.image_url || s.rewards?.partners?.logo_url || null,
    })), [schedule]);

    const current = schedule.find(s => isActive(s.starts_at, s.ends_at));
    const isMine = (row) => myBrand && (row?.rewards?.brand_name || '').trim().toLowerCase() === myBrand.trim().toLowerCase();

    // The partner's own upcoming/active windows, for a quick "you're featured" cue.
    const myUpcoming = useMemo(
        () => schedule.filter(s => isMine(s) && new Date(s.ends_at).getTime() > Date.now())
            .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)),
        [schedule, myBrand],
    );

    const goMonth = (delta) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + delta, 1));

    return (
        <div className="animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {/* Header */}
            <div className="mb-12">
                <div className="flex items-center gap-3 mb-6">
                    <div className="h-[1px] w-12 bg-[#E8D200]" />
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">Featured Lineup</span>
                </div>
                <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-4">What's On</h1>
                <p className="text-[#888888] text-[11px] max-w-xl font-black uppercase tracking-[0.4em] leading-relaxed">
                    The reward featured at the top of the POWR rewards screen, scheduled by the POWR team. Your brand is outlined.
                </p>
            </div>

            {/* Live now */}
            {current && (
                <div className="mb-6 flex items-center gap-6 bg-[#E8D200]/5 border border-[#E8D200]/20 rounded-3xl px-10 py-7">
                    <div className="w-10 h-10 rounded-2xl bg-[#E8D200]/10 flex items-center justify-center shrink-0">
                        <Star size={18} className="text-[#8a7600]" />
                    </div>
                    <div className="flex-1">
                        <div className="text-[9px] uppercase tracking-[0.5em] text-[#8a7600] font-black mb-1">Featured Now</div>
                        <div className="text-base font-bold text-[#1A1A1A]">{rewardLabel(current)}{isMine(current) && <span className="ml-3 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.3em] bg-[#1A1A1A] text-white rounded-full align-middle">You</span>}</div>
                        <div className="text-[11px] text-[#888888] mt-0.5 font-black uppercase tracking-[0.2em]">{formatWindow(current.starts_at, current.ends_at)}</div>
                    </div>
                </div>
            )}

            {/* Partner's own upcoming windows */}
            {myUpcoming.length > 0 && (
                <div className="mb-10 bg-white border border-[#E6E6E1] rounded-3xl px-10 py-6">
                    <div className="text-[9px] uppercase tracking-[0.4em] text-[#999999] font-black mb-3">Your featured windows</div>
                    <div className="flex flex-wrap gap-3">
                        {myUpcoming.map(s => (
                            <span key={s.id} className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-[#E8D200]/10 border border-[#E8D200]/20 text-[10px] font-black uppercase tracking-[0.2em] text-[#8a7600]">
                                {formatWindow(s.starts_at, s.ends_at)}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex flex-col items-center justify-center py-48 gap-6">
                    <div className="w-12 h-12 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" />
                    <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Loading Calendar...</span>
                </div>
            ) : (
                <FeaturedCalendar
                    slots={slots}
                    month={month}
                    onPrevMonth={() => goMonth(-1)}
                    onNextMonth={() => goMonth(1)}
                    readOnly
                    highlightBrand={myBrand}
                />
            )}
        </div>
    );
}
