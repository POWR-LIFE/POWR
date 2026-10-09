import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, RotateCcw, MonitorPlay } from 'lucide-react';
import { raceThreshold } from '../../../../shared/liveBoard.ts';

/**
 * Every screen of the venue display, played inline. The real page runs in an
 * iframe at TV size (1920×1080, so it lays out exactly as on the screen) and
 * is scaled down to the card. Each tab pins one screen via ?preview= and
 * ?scene=; "Right now" is the real, unpinned screen.
 *
 * Previews open on THIS origin, so on localhost or a Vercel preview they show
 * the page as built there, not whatever powr.life currently serves.
 */

const TV_W = 1920;
const TV_H = 1080;

function tabsFor(ev) {
    const n = raceThreshold(ev.prizes?.length ?? 0);
    const hasPrizes = (ev.prizes?.length ?? 0) > 0;
    return [
        { group: 'Now', key: 'real', label: 'Right now', query: '', note: 'The real screen as the venue sees it this second — real scores, nothing pinned.' },
        { group: 'Before', key: 'countdown', label: 'Countdown', query: 'preview=countdown', note: 'Before the scoring window opens. The prizes, the clock and a code to get in early.' },
        { group: 'Warm-up', key: 'prizes', label: 'Up for grabs', query: 'preview=warmup&scene=prizes', note: `While fewer than ${n} people have points. Each prize shows who holds it right now, and the board filling up to ${n}.` },
        { group: 'Warm-up', key: 'enter', label: 'How to get in', query: 'preview=warmup&scene=enter', note: `Rotates with "Up for grabs" during the warm-up. Steps and a code big enough to scan from the floor.` },
        { group: 'Race', key: 'race', label: 'Race', query: 'preview=live&scene=race', note: `From ${n} people with points. The board, with the prize line under the last prize place.` },
        ...(hasPrizes ? [{ group: 'Race', key: 'fight', label: 'Prize line', query: 'preview=live&scene=fight', note: 'Rotates with the race: the last prize place against the first person outside the prizes.' }] : []),
        { group: 'Race', key: 'chasing', label: 'Chasing pack', query: 'preview=live&scene=chasing', note: 'Rotates with the race once more than 10 are on the board: everyone from 11th down.' },
        { group: 'After', key: 'sealed', label: 'Sealed', query: 'preview=locked', note: 'Once scores lock. A countdown to the reveal; nothing score-shaped is on the screen.' },
        { group: 'After', key: 'reveal', label: 'Reveal', query: 'preview=reveal', note: 'Plays when you press Reveal: 3rd, then 2nd, then 1st. Replays on every refresh.' },
        { group: 'After', key: 'settled', label: 'Winners', query: 'preview=settled', note: 'After the reveal, for the rest of the night: the podium with the prizes, and 4th to 10th.' },
    ];
}

export default function LiveScreenPreview({ ev }) {
    const tabs = tabsFor(ev);
    const [key, setKey] = useState('real');
    const [replay, setReplay] = useState(0);
    const tab = tabs.find((t) => t.key === key) ?? tabs[0];
    const src = `${window.location.origin}/live/${ev.slug}?k=${ev.display_token}${tab.query ? `&${tab.query}` : ''}`;

    // Scale the TV-sized frame to the card's width.
    const boxRef = useRef(null);
    const [scale, setScale] = useState(0.4);
    useEffect(() => {
        const el = boxRef.current;
        if (!el) return undefined;
        const fit = () => setScale(el.clientWidth / TV_W);
        fit();
        const ro = new ResizeObserver(fit);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const groups = [...new Set(tabs.map((t) => t.group))];

    return (
        <div className="mt-4">
            <div className="flex items-center gap-2 mb-3">
                <MonitorPlay size={13} className="text-[#888888]" />
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#888888]">Preview every screen</span>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3">
                {groups.map((g) => (
                    <div key={g} className="flex items-center gap-1.5">
                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#BBBBBB] mr-1">{g}</span>
                        {tabs.filter((t) => t.group === g).map((t) => (
                            <button
                                key={t.key}
                                type="button"
                                onClick={() => { setKey(t.key); setReplay(0); }}
                                className={`inline-flex items-center h-7 px-3 rounded-lg border text-[10px] font-bold uppercase tracking-[0.15em] transition-all ${t.key === key
                                    ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white'
                                    : 'bg-[#F4F4F1] border-[#E6E6E1] text-[#666666] hover:text-[#1A1A1A] hover:border-[#D8D8D2]'}`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                ))}
            </div>

            <div
                ref={boxRef}
                className="relative w-full max-w-[1100px] overflow-hidden rounded-xl border border-[#1A1A1A] bg-[#070707] shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
                style={{ height: TV_H * scale }}
            >
                <span className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-[0.3em] text-white/30">Loading the screen…</span>
                <iframe
                    key={`${src}#${replay}`}
                    src={src}
                    title={`Venue screen preview — ${tab.label}`}
                    width={TV_W}
                    height={TV_H}
                    className="absolute top-0 left-0 border-0 pointer-events-none"
                    style={{ width: TV_W, height: TV_H, transform: `scale(${scale})`, transformOrigin: '0 0' }}
                />
            </div>

            <div className="flex items-start justify-between gap-4 mt-2.5 max-w-[1100px]">
                <p className="text-[11px] text-[#888888] leading-relaxed">
                    <span className="font-bold text-[#555555]">{tab.label}.</span> {tab.note}
                    {tab.key !== 'real' && ' Sample people on your real prizes — never real scores.'}
                </p>
                <div className="flex items-center gap-2 shrink-0">
                    {tab.key === 'reveal' && (
                        <button
                            type="button"
                            onClick={() => setReplay((r) => r + 1)}
                            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-lg border text-[10px] font-bold uppercase tracking-[0.15em] bg-[#F4F4F1] border-[#E6E6E1] text-[#666666] hover:text-[#1A1A1A] hover:border-[#D8D8D2]"
                        >
                            <RotateCcw size={12} /> Replay
                        </button>
                    )}
                    <a
                        href={src}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 h-7 px-3 rounded-lg border text-[10px] font-bold uppercase tracking-[0.15em] bg-[#F4F4F1] border-[#E6E6E1] text-[#666666] hover:text-[#1A1A1A] hover:border-[#D8D8D2]"
                    >
                        <ExternalLink size={12} /> Open full screen
                    </a>
                </div>
            </div>
        </div>
    );
}
