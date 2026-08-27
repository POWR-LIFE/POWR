import React, { useMemo, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Copy, Check, Download, Megaphone, Share2 } from 'lucide-react';
import { useAuth } from '../../App';
import { Page, Card, Micro, PageTitle, INPUT, BTN_GOLD, BTN_GHOST } from './ui';

const SITE = 'https://powr.life';

function useCopy() {
    const [copied, setCopied] = useState(false);
    const copy = async (value) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        } catch { /* clipboard blocked — the value is on screen anyway */ }
    };
    return [copied, copy];
}

function CopyRow({ label, value, hint, mono }) {
    const [copied, copy] = useCopy();
    return (
        <div>
            <Micro className="mb-3">{label}</Micro>
            <div className="flex items-stretch gap-2 sm:gap-3">
                <div className="flex-1 min-w-0 flex items-center px-4 sm:px-5 py-4 bg-[#F4F4F1] border border-[#E6E6E1] rounded-2xl">
                    <span className={`break-all text-[#1A1A1A] ${mono ? 'text-[13px] font-mono' : 'text-[13px] font-light leading-relaxed'}`}>
                        {value}
                    </span>
                </div>
                <button
                    onClick={() => copy(value)}
                    className="flex-none w-14 flex items-center justify-center bg-[#1A1A1A] text-white rounded-2xl hover:bg-[#333] transition-all active:scale-95"
                    aria-label={`Copy ${label}`}
                >
                    {copied ? <Check size={17} className="text-[#8a7600]" /> : <Copy size={17} />}
                </button>
            </div>
            {hint && <p className="text-[11px] text-[#AAAAAA] font-light mt-3 leading-relaxed">{hint}</p>}
        </div>
    );
}

// The code is the product. Big, glowing, unmissable — it's what they say out
// loud in a video, and on a phone it should fill the card.
function CodeHero({ code }) {
    const [copied, copy] = useCopy();
    return (
        <Card glow dark className="p-6 sm:p-10">
            <Micro gold onDark className="mb-4">Your code</Micro>
            <button
                onClick={() => copy(code)}
                className="w-full text-left group"
                aria-label="Copy your code"
            >
                <div
                    className="text-[clamp(2.6rem,11vw,5.5rem)] font-black tracking-[0.14em] leading-none text-white break-all"
                    style={{ textShadow: '0 0 40px rgba(232,210,0,0.25)' }}
                >
                    {code}
                </div>
                <div className="flex items-center gap-2 mt-5 text-[10px] uppercase tracking-[0.3em] font-black text-white/40 group-hover:text-[#E8D200] transition-colors">
                    {copied ? <><Check size={13} className="text-[#E8D200]" /> <span className="text-[#E8D200]">Copied</span></> : <><Copy size={13} /> Tap to copy</>}
                </div>
            </button>
            <p className="text-[12px] text-white/50 font-light mt-6 leading-relaxed max-w-xl">
                Say it out loud in videos and put it in captions. On iPhone the App Store can't carry it
                through an install, so people type it in themselves — the ones who remember it are the ones who count.
            </p>
        </Card>
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

    // Mobile: the OS share sheet is the whole point of being on a phone —
    // straight into Instagram, WhatsApp, Notes. Hidden where it isn't supported.
    const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    const share = async () => {
        try {
            await navigator.share({ title: 'POWR', text: shareText });
        } catch { /* user dismissed the sheet */ }
    };

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
        <Page>
            <PageTitle
                eyebrow="Share it anywhere"
                title="Your link"
                sub="Every tap is counted"
                right={canShare ? (
                    <button onClick={share} className={BTN_GOLD}>
                        <Share2 size={15} /> Share
                    </button>
                ) : null}
            />

            <CodeHero code={code ?? ''} />

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5 sm:gap-6 items-start">
                <div className="space-y-5 sm:space-y-6">
                    <Card className="p-5 sm:p-8 space-y-7">
                        <CopyRow
                            label="Your link"
                            value={fullLink}
                            mono
                            hint="Opens POWR if they already have it, otherwise sends them to the store with your code on screen."
                        />
                        <CopyRow
                            label="Ready-made message"
                            value={shareText}
                        />
                        {canShare && (
                            <button onClick={share} className={`${BTN_GHOST} w-full sm:w-auto`}>
                                <Share2 size={14} /> Send it somewhere
                            </button>
                        )}
                    </Card>

                    {/* Campaign builder */}
                    <Card className="p-5 sm:p-8">
                        <div className="flex items-center gap-3 mb-2">
                            <Megaphone size={15} className="text-[#8a7600]" />
                            <Micro>Track a campaign</Micro>
                        </div>
                        <p className="text-[12px] text-[#888] font-light leading-relaxed mb-6 max-w-xl">
                            Add a tag to tell your posts apart. Use a different one for each place you share —
                            <span className="text-[#444] font-normal"> story</span>,
                            <span className="text-[#444] font-normal"> bio</span>,
                            <span className="text-[#444] font-normal"> newsletter</span> — and you'll see which
                            actually brings people in.
                        </p>
                        <input
                            type="text"
                            value={campaign}
                            onChange={e => setCampaign(e.target.value)}
                            placeholder="e.g. story"
                            maxLength={64}
                            autoCapitalize="none"
                            autoCorrect="off"
                            className={INPUT}
                        />
                        {campaign && cleanCampaign !== campaign.trim() && (
                            <p className="text-[11px] text-[#AAAAAA] font-light mt-3">
                                Tidied to <span className="font-mono text-[#666]">{cleanCampaign || '(empty)'}</span> — letters, numbers, dashes only.
                            </p>
                        )}
                    </Card>
                </div>

                {/* QR */}
                <Card className="p-5 sm:p-8 text-center lg:sticky lg:top-4">
                    <Micro className="mb-6">Scan code</Micro>
                    <div ref={qrRef} className="flex justify-center mb-6">
                        <div className="p-3 bg-white rounded-2xl">
                            <QRCodeCanvas
                                value={fullLink}
                                size={180}
                                level="M"
                                marginSize={1}
                                fgColor="#080808"
                                bgColor="#FFFFFF"
                            />
                        </div>
                    </div>
                    <button onClick={downloadQr} className={`${BTN_GHOST} w-full`}>
                        <Download size={15} /> Download PNG
                    </button>
                    <p className="text-[10px] text-[#BBBBBB] font-light leading-relaxed mt-5">
                        Good for gym posters, event stands and business cards.
                    </p>
                </Card>
            </div>
        </Page>
    );
}
