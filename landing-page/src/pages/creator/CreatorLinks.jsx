import React, { useMemo, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Copy, Check, Download, Megaphone } from 'lucide-react';
import { useAuth } from '../../App';

const SITE = 'https://powr.life';

function CopyRow({ label, value, hint, big }) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        } catch { /* clipboard blocked — the value is on screen anyway */ }
    };

    return (
        <div>
            <div className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mb-3">{label}</div>
            <div className="flex items-stretch gap-3">
                <div className={`flex-1 min-w-0 flex items-center px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl ${big ? 'py-5' : 'py-4'}`}>
                    <span className={`truncate text-[#1A1A1A] ${big ? 'text-2xl font-black tracking-[0.2em]' : 'text-sm font-mono'}`}>
                        {value}
                    </span>
                </div>
                <button
                    onClick={copy}
                    className="flex-none w-14 flex items-center justify-center bg-[#1A1A1A] text-white rounded-2xl hover:bg-[#333] transition-all"
                    aria-label={`Copy ${label}`}
                >
                    {copied ? <Check size={17} className="text-[#E8D200]" /> : <Copy size={17} />}
                </button>
            </div>
            {hint && <p className="text-[11px] text-[#AAAAAA] font-light mt-3 leading-relaxed">{hint}</p>}
        </div>
    );
}

export default function CreatorLinks() {
    const { creatorData } = useAuth();
    const qrRef = useRef(null);
    const [campaign, setCampaign] = useState('');

    const handle = creatorData?.handle;
    const code = creatorData?.code;

    const baseLink = handle ? `${SITE}/join/${handle}` : '';
    const cleanCampaign = campaign.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    const fullLink = cleanCampaign ? `${baseLink}?c=${cleanCampaign}` : baseLink;

    const shareText = useMemo(() => (
        `Get paid to train. Download POWR and use my code ${code ?? ''} — ${fullLink}`
    ), [code, fullLink]);

    const downloadQr = () => {
        const canvas = qrRef.current?.querySelector('canvas');
        if (!canvas) return;
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `powr-${handle}${cleanCampaign ? `-${cleanCampaign}` : ''}.png`;
        a.click();
    };

    if (!creatorData) return null;

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-5xl font-light tracking-tighter text-[#1A1A1A] mb-2">Your link</h1>
                <p className="text-[11px] uppercase tracking-[0.3em] text-[#BBBBBB] font-black">
                    Share it anywhere — every tap is counted
                </p>
            </div>

            <div className="grid grid-cols-[1fr_300px] gap-6 items-start">
                <div className="space-y-8">
                    {/* Code + link */}
                    <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8 space-y-8">
                        <CopyRow
                            label="Your code"
                            value={code ?? ''}
                            big
                            hint="Say this out loud in videos and put it in captions. On iPhone the App Store can't carry it through an install, so people type it in themselves — the ones who remember it are the ones who count."
                        />
                        <CopyRow
                            label="Your link"
                            value={fullLink}
                            hint="Opens POWR if they already have it, otherwise sends them to the store with your code on screen."
                        />
                        <CopyRow
                            label="Ready-made message"
                            value={shareText}
                        />
                    </div>

                    {/* Campaign builder */}
                    <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8">
                        <div className="flex items-center gap-3 mb-2">
                            <Megaphone size={15} className="text-[#8a7600]" />
                            <h2 className="text-[10px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black">Track a campaign</h2>
                        </div>
                        <p className="text-[12px] text-[#888] font-light leading-relaxed mb-6 max-w-xl">
                            Add a tag to tell your posts apart. Use a different one for each place you share —
                            <span className="text-[#666] font-normal"> story</span>,
                            <span className="text-[#666] font-normal"> bio</span>,
                            <span className="text-[#666] font-normal"> newsletter</span> — and you'll see which
                            actually brings people in.
                        </p>
                        <input
                            type="text"
                            value={campaign}
                            onChange={e => setCampaign(e.target.value)}
                            placeholder="e.g. story"
                            maxLength={64}
                            className="w-full h-12 px-5 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-sm text-[#1A1A1A] placeholder-[#CCCCCC] focus:border-[#E8D200]/40 outline-none transition-all"
                        />
                        {campaign && cleanCampaign !== campaign.trim() && (
                            <p className="text-[11px] text-[#AAAAAA] font-light mt-3">
                                Tidied to <span className="font-mono text-[#666]">{cleanCampaign || '(empty)'}</span> — letters, numbers, dashes only.
                            </p>
                        )}
                    </div>
                </div>

                {/* QR */}
                <div className="bg-white border border-[#E6E6E1] rounded-3xl p-8 text-center sticky top-4">
                    <div className="text-[9px] uppercase tracking-[0.4em] text-[#BBBBBB] font-black mb-6">Scan code</div>
                    <div ref={qrRef} className="flex justify-center mb-6">
                        <QRCodeCanvas
                            value={fullLink}
                            size={200}
                            level="M"
                            marginSize={2}
                            fgColor="#1A1A1A"
                            bgColor="#FFFFFF"
                        />
                    </div>
                    <button
                        onClick={downloadQr}
                        className="w-full h-12 flex items-center justify-center gap-3 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl text-[10px] uppercase tracking-[0.2em] font-black text-[#666] hover:border-[#E8D200]/40 hover:text-[#8a7600] transition-all"
                    >
                        <Download size={15} /> Download PNG
                    </button>
                    <p className="text-[10px] text-[#BBBBBB] font-light leading-relaxed mt-5">
                        Good for gym posters, event stands and business cards.
                    </p>
                </div>
            </div>
        </div>
    );
}
