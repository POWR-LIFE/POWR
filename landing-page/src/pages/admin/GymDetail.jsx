import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/toast';
import { ChevronLeft, MapPin, Dumbbell } from 'lucide-react';
import PartnerPerformancePanel from './PartnerPerformancePanel';

export default function GymDetail() {
    const { partnerId } = useParams();
    const toast = useToast();
    const [loading, setLoading] = useState(true);
    const [partner, setPartner] = useState(null);

    useEffect(() => {
        if (partnerId) fetchPartner();
    }, [partnerId]);

    const fetchPartner = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('partners')
                .select('*')
                .eq('id', partnerId)
                .single();
            if (error) throw error;
            setPartner(data);
        } catch (e) {
            toast.error('Failed to load gym data');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center py-48 gap-6">
            <div className="w-12 h-12 border-2 border-[#0EA5E9]/20 border-t-[#0EA5E9] rounded-full animate-spin" />
            <span className="text-[10px] uppercase tracking-[0.6em] text-[#666666] font-black">Loading Venue Data...</span>
        </div>
    );

    if (!partner) return (
        <div className="py-20 text-center">
            <h2 className="text-2xl font-light text-[#1A1A1A] mb-4">Venue Not Found</h2>
            <Link to="/admin/performance" className="text-[#0EA5E9] text-sm uppercase tracking-widest font-black">Back to Performance</Link>
        </div>
    );

    return (
        <div className="px-4 lg:px-0 py-20 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {/* Breadcrumb */}
            <Link to="/admin/performance" className="group flex items-center gap-3 mb-12 text-[#666666] hover:text-[#1A1A1A] transition-colors">
                <ChevronLeft size={16} />
                <span className="text-[10px] uppercase tracking-[0.4em] font-black">Back to Performance</span>
            </Link>

            {/* Header */}
            <header className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-10 mb-16">
                <div className="flex items-center gap-10">
                    <div className="w-20 h-20 rounded-[2rem] bg-white border border-[#E6E6E1] flex items-center justify-center overflow-hidden shadow-2xl shrink-0">
                        {partner.logo_url ? (
                            <img src={partner.logo_url} alt="" className="w-full h-full object-contain p-3" />
                        ) : (
                            <Dumbbell size={32} className="text-[#888888]" />
                        )}
                    </div>
                    <div>
                        <div className="flex items-center gap-3 mb-3">
                            <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.2em] ${partner.active ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-[#EFEFEC] text-[#BBB]'}`}>
                                {partner.active ? 'Live' : 'Inactive'}
                            </span>
                            <span className="px-3 py-1 rounded-full bg-[#F4F4F1] border border-[#E6E6E1] text-[9px] font-black uppercase tracking-[0.2em] text-[#555555] capitalize">
                                {partner.category}
                            </span>
                        </div>
                        <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-2">{partner.name}</h1>
                        {partner.address && (
                            <div className="flex items-center gap-2 text-[#888888] text-xs">
                                <MapPin size={12} />
                                <span className="font-black uppercase tracking-[0.2em] text-[10px]">{partner.address}</span>
                            </div>
                        )}
                    </div>
                </div>

                <Link
                    to={`/admin/partners/${partner.id}`}
                    className="h-9 px-5 rounded-full text-[9px] font-black uppercase tracking-[0.3em] bg-white border border-[#E6E6E1] text-[#666666] hover:text-[#1A1A1A] transition-all flex items-center shrink-0"
                >
                    Open Partner Profile
                </Link>
            </header>

            <PartnerPerformancePanel partner={partner} />
        </div>
    );
}
