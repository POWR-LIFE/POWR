import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Printer } from 'lucide-react';
import { useAuth } from '../../App';
import { fetchInStoreOverview } from '../../lib/inStore';
import { standUrl } from '../../../../shared/inStore.ts';

// The A5 counter stand for one shop. Its QR carries the shop's static stand
// key; a member scans it in the POWR app before opening a voucher (when the
// brand asks for that). Printing a new stand after "New stand" in the portal
// is the only way to replace a lost or copied one.
export default function PartnerStandPrint() {
    const { siteId } = useParams();
    const { partnerData } = useAuth();
    const brand = partnerData?.brand_name;
    const [site, setSite] = useState(undefined);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!brand) return;
        fetchInStoreOverview(brand)
            .then((d) => setSite(d.sites.find((s) => s.id === siteId && s.active) ?? null))
            .catch((err) => setError(err.message));
    }, [brand, siteId]);

    useEffect(() => {
        if (site) document.title = `POWR stand · ${site.name}`;
    }, [site]);

    if (error || site === null) {
        return <div className="min-h-screen flex items-center justify-center font-['Outfit'] text-[#666] p-8 text-center">{error ?? 'This shop has been removed, or it belongs to another brand.'}</div>;
    }
    if (!site) {
        return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-[#E8D200]/20 border-t-[#E8D200] rounded-full animate-spin" /></div>;
    }

    return (
        <div className="min-h-screen bg-[#F4F4F1] print:bg-white font-['Outfit'] flex flex-col items-center py-10 print:py-0">
            <style>{'@page { size: A5 portrait; margin: 0 } @media print { .no-print { display: none !important } }'}</style>
            <div className="no-print mb-6 flex items-center gap-3">
                <button type="button" onClick={() => window.print()} className="h-11 px-7 bg-[#E8D200] text-[#080808] text-[10px] font-black uppercase tracking-[0.2em] rounded-full inline-flex items-center gap-2">
                    <Printer size={14} /> Print
                </button>
                <span className="text-[12px] text-[#777]">A5, portrait. Use thick card if you can.</span>
            </div>

            <div className="bg-white w-[148mm] h-[210mm] flex flex-col overflow-hidden shadow-[0_10px_40px_rgba(0,0,0,0.08)] print:shadow-none text-[#0a0a0a]">
                <div className="h-[4mm] bg-[#E8D200]" />
                <div className="flex-1 flex flex-col items-center px-[12mm] pt-[10mm] pb-[8mm] gap-[6mm]">
                    <img src="/powr-logo-black.png" alt="POWR" className="h-[8mm] w-auto" />
                    <div className="text-center leading-[1.05]">
                        <div className="text-[30pt] font-extralight tracking-[-0.03em]">Got a POWR reward?</div>
                        <div className="text-[30pt] font-extrabold tracking-[-0.03em]">Scan here at the till.</div>
                    </div>
                    <div className="p-[4mm] border-[0.6mm] border-[#0a0a0a] rounded-[6mm]">
                        <QRCodeSVG value={standUrl(site.stand_code, site.stand_key)} size={256} level="M" fgColor="#0a0a0a" bgColor="#FFFFFF" style={{ width: '68mm', height: '68mm', display: 'block' }} />
                    </div>
                    <div className="flex items-center justify-center gap-[5mm] text-[11pt] font-medium">
                        {['Open POWR', 'Wallet', 'Use in store'].map((t, i) => (
                            <span key={t} className="flex items-center gap-[2mm]">
                                <span className="w-[6.5mm] h-[6.5mm] rounded-full bg-[#0a0a0a] text-[#E8D200] text-[9pt] font-extrabold flex items-center justify-center">{i + 1}</span>{t}
                            </span>
                        ))}
                    </div>
                    <div className="flex-1" />
                    <div className="w-full border-t border-[#E6E6E1] pt-[4mm] flex items-center justify-between">
                        <span className="text-[11pt] font-semibold">{brand} · {site.name}</span>
                        <span className="text-[7pt] font-black tracking-[0.2em] text-[#666]">STAND {site.stand_code} · POWR.LIFE</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
