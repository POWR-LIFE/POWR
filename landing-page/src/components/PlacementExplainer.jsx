import React from 'react';
import { Eye, Footprints, Bell, Gift, Lock } from 'lucide-react';
import { GOLD, RED } from '../lib/placementGrid';
import { TEXT, DIM, MUTED, FONT } from './RewardAppPreview';

// ─────────────────────────────────────────────────────────────────────────────
// PlacementExplainer — the "what IS this" panel for the Placements page.
//
// A brand with no live campaign sees an empty list and has no way to picture
// what they'd be buying, so the page can't sell the thing it's selling. This
// walks the product in three beats — paint the ground → a member walks in →
// your reward leads — and ends on the funnel each campaign reports back.
//
// Beat 1 is a flat image of a real map, NOT a live one. A mounted Google map
// bills per load and drags a third-party script into a panel that only has to
// sit there and look like the editor — see placement-map.webp below. Beats 2
// and 3 are a faithful LIKENESS of the phone surfaces, not a port (same trick
// as preview/AppPreview.jsx):
//   • Push     → notifyNearbyOffer() in lib/notifications.ts — copy verbatim
//   • Vault    → the boosted row in app/(tabs)/rewards.tsx
// Tokens are imported rather than retyped so a brand-colour change can't leave
// the sales pitch showing an app that no longer exists.
//
// Personalised where we can: the brand's own name and first live reward go
// into the push and the vault row, so they see THEIR offer in the slot.
// ─────────────────────────────────────────────────────────────────────────────

const PANEL = 'relative h-[210px] rounded-2xl overflow-hidden bg-[#0b0b0b] border border-black/5';

// Beat 1's map: a pre-rendered 1200×440 image in public/, ~95 KB, served off
// our own origin — no API key, no per-load billing, no third-party script.
//
// It is OpenStreetMap, NOT Google: Google's Maps Platform terms don't allow
// storing their imagery as a permanent asset, whereas ODbL explicitly permits
// redistribution with attribution (rendered bottom-right, and required).
//
// The cells ARE real Web-Mercator tiles — z18 (~95 m, about a city block, a
// zoom the editor paints at), painted in the editor's own three layers (faint
// slate available-grid → GOLD @0.5 → RED @0.38) and centred in the frame so
// every object-cover crop keeps them. Regenerate with
// `node scripts/gen-placement-map.mjs` if the location or cell colours change.
const MAP_SRC = '/placement-map.webp';

// The "everyone else" rows behind the boosted one. Same brands RewardAppPreview
// uses, so both previews furnish the vault with the same neighbours.
const FILLER_ROWS = [
    { title: '25% off your bill', sub: 'Notto Pasta · Any branch', pts: '500', logo: 'NOTTO', o: 0.4 },
    { title: '3 months free', sub: 'Calm · Premium', pts: '600', logo: 'calm', o: 0.25 },
    { title: '£50 off mattress', sub: 'Eight Sleep · Any model', pts: '1,200', logo: 'eight', o: 0.15 },
];

export default function PlacementExplainer({ brandName, rewardTitle, logoUrl, points }) {
    const brand = (brandName || '').trim() || 'Your brand';
    const reward = (rewardTitle || '').trim() || 'Your reward';
    const cost = Number.isFinite(Number(points)) && Number(points) > 0 ? Number(points) : 800;

    const beats = [
        {
            n: '01',
            title: 'Paint the ground',
            copy: 'Draw straight onto the map — a high street, the park everyone runs in, the blocks around a gym. Then set the days and hours it should run.',
            visual: <MapVisual />,
        },
        {
            n: '02',
            title: 'A member walks in',
            copy: 'When a POWR member is physically inside your squares during those hours, their phone knows. No beacon, no scan, nothing for them to do.',
            visual: <PushVisual brand={brand} reward={reward} />,
        },
        {
            n: '03',
            title: 'Your reward leads',
            copy: 'Your offer jumps the queue — straight to the top of their vault, in the hero slot, priced in points they have already earned.',
            visual: <VaultVisual brand={brand} reward={reward} logoUrl={logoUrl} cost={cost} />,
        },
    ];

    return (
        <section className="bg-white border border-[#E6E6E1] rounded-3xl overflow-hidden">
            <div className="px-8 pt-10 pb-8 md:px-10">
                <div className="flex items-center gap-3 mb-5">
                    <div className="h-[1px] w-10 bg-[#E8D200]" />
                    <span className="text-[10px] uppercase tracking-[0.5em] text-[#8a7600] font-black">How it works</span>
                </div>
                <h2 className="text-4xl md:text-5xl font-light tracking-tighter text-[#1A1A1A] max-w-2xl leading-[1.05]">
                    Your reward, waiting in the street.
                </h2>
                <p className="text-sm text-[#777] leading-relaxed mt-4 max-w-xl">
                    A placement buys a piece of the real world. Members inside it get your offer pushed to the
                    front of their rewards — at the moment they are stood in the place you care about.
                </p>
            </div>

            <div className="grid md:grid-cols-3 gap-px bg-[#EDEDE8] border-y border-[#E6E6E1]">
                {beats.map((b) => (
                    <div key={b.n} className="bg-white p-6 md:p-7">
                        <div className={PANEL}>{b.visual}</div>
                        <div className="flex items-baseline gap-3 mt-6">
                            <span className="text-[10px] font-black tracking-[0.2em] text-[#E8D200]">{b.n}</span>
                            <h3 className="text-lg font-medium tracking-tight text-[#1A1A1A]">{b.title}</h3>
                        </div>
                        <p className="text-[13px] text-[#888] leading-relaxed mt-2">{b.copy}</p>
                    </div>
                ))}
            </div>

            <div className="px-8 py-7 md:px-10 flex flex-wrap items-center justify-between gap-x-10 gap-y-6">
                <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] font-black text-[#666] mb-4">Every campaign reports back</p>
                    <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
                        {[
                            [Eye, 'Seen', 'in-app'],
                            [Footprints, 'Visited', 'in your squares'],
                            [Bell, 'Pushed', 'notified'],
                            [Gift, 'Redeemed', 'points spent'],
                        ].map(([Icon, label, sub], i) => (
                            <div key={label} className="flex items-center gap-2.5">
                                <Icon size={15} className={i === 3 ? 'text-[#8a7600]' : 'text-[#BBB]'} />
                                <span className="text-[11px]">
                                    <span className={`font-black uppercase tracking-[0.12em] ${i === 3 ? 'text-[#8a7600]' : 'text-[#555]'}`}>{label}</span>
                                    <span className="text-[#BBB] ml-1.5">{sub}</span>
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="flex items-start gap-3 max-w-xs">
                    <Lock size={14} className="text-[#8a7600] shrink-0 mt-0.5" />
                    <p className="text-[11px] text-[#999] leading-relaxed">
                        <span className="text-[#555] font-bold">One brand per square.</span> While your campaign holds
                        a square for a time slot, no other brand can book it.
                    </p>
                </div>
            </div>
        </section>
    );
}

// ── 01 · Paint the ground ────────────────────────────────────────────────────
// Just the image plus its overlays. The cells are already painted into it (in
// the editor's own colours) — nothing here loads, computes or costs anything.
function MapVisual() {
    return (
        <>
            <img
                src={MAP_SRC}
                alt="A map of central London with six squares painted gold, and one square another brand has already booked in red."
                className="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
                draggable={false}
            />

            {/* Stacked, not in opposite corners: side by side they collide at the
                ~250px panel width three columns give on a laptop. */}
            <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
                <span className="px-2.5 py-1.5 rounded-full bg-black/60 backdrop-blur-sm text-[9px] font-black uppercase tracking-[0.12em] text-white/70">
                    6 squares · Mon–Fri · 6–10am
                </span>
                <span className="flex items-center gap-1.5 px-2 py-1.5 rounded-full bg-black/60 backdrop-blur-sm text-[8px] font-black uppercase tracking-[0.12em] text-white/50">
                    <span className="w-2 h-2 rounded-[2px]" style={{ background: RED, opacity: 0.7 }} /> Booked
                </span>
            </div>

            {/* ODbL requires the credit to be visible wherever the tiles are. */}
            <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer noopener"
                className="absolute right-2.5 bottom-2 text-[8px] text-white/35 hover:text-white/60 transition-colors"
            >
                © OpenStreetMap
            </a>
        </>
    );
}

// ── 02 · A member walks in ───────────────────────────────────────────────────
// Title + body are the literal strings notifyNearbyOffer() schedules, so what
// we promise here is what their members actually receive.
function PushVisual({ brand, reward }) {
    return (
        <div className="absolute inset-0 flex flex-col" style={{ fontFamily: FONT }}>
            <div
                className="absolute inset-0"
                style={{ background: 'radial-gradient(120% 90% at 50% 0%, rgba(232,210,0,0.10), rgba(0,0,0,0) 60%), #0b0b0b' }}
            />
            <div className="relative pt-6 text-center">
                <div style={{ fontSize: 40, fontWeight: 200, color: TEXT, letterSpacing: '-1px', lineHeight: '42px' }}>9:41</div>
                <div style={{ fontSize: 10, fontWeight: 400, color: MUTED, letterSpacing: '0.5px', marginTop: 2 }}>Tuesday 12 August</div>
            </div>

            <div className="relative mt-auto p-3">
                <div
                    className="rounded-2xl p-3"
                    style={{ background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.14)', backdropFilter: 'blur(12px)' }}
                >
                    <div className="flex items-center gap-2 mb-1.5">
                        <img src="/powr-avatar.png" alt="" className="w-4 h-4 rounded-[5px] object-cover shrink-0" />
                        <span style={{ fontSize: 9, fontWeight: 700, color: DIM, letterSpacing: '0.5px' }}>POWR</span>
                        <span style={{ fontSize: 9, fontWeight: 400, color: MUTED, marginLeft: 'auto' }}>now</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: TEXT, letterSpacing: '-0.1px' }}>{brand} is nearby</div>
                    <div style={{ fontSize: 11, fontWeight: 300, color: DIM, lineHeight: '15px', marginTop: 1 }}>
                        {reward} is boosted where you are right now — open to redeem.
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── 03 · Your reward leads ───────────────────────────────────────────────────
// A crop of the rewards vault: their row first, everyone else dimmed behind it.
// Clipped at the bottom on purpose — the list carries on below the fold.
// NB the live app also renders a small "AD" tag on a paid row (the disclosure
// settled with the placements product); it is left out here deliberately, so
// this mock is one element lighter than the real screen.
function VaultVisual({ brand, reward, logoUrl, cost }) {
    const fallback = brand.replace(/^your /i, '').slice(0, 5).toLowerCase();
    // Drop a filler row that happens to be this brand — a partner seeing their
    // own name in the "everyone else" pile reads as a bug, not a mock.
    const fillers = FILLER_ROWS.filter((s) => !s.sub.toLowerCase().startsWith(brand.toLowerCase()));
    return (
        <div className="absolute inset-0 px-3.5 pt-3" style={{ fontFamily: FONT }}>
            <div className="flex items-center justify-between">
                <span style={{ fontSize: 17, fontWeight: 200, color: TEXT, letterSpacing: '-0.3px' }}>Rewards</span>
                <img src="/powr-avatar.png" alt="" className="w-[22px] h-[22px] rounded-full object-cover" style={{ border: '1px solid rgba(255,255,255,0.1)' }} />
            </div>

            <div className="flex items-end gap-1.5 mt-1.5">
                <span style={{ fontSize: 26, fontWeight: 100, color: GOLD, letterSpacing: '-1px', lineHeight: '26px' }}>1,650</span>
                <span style={{ fontSize: 8, fontWeight: 500, color: DIM, letterSpacing: '1.5px', marginBottom: 3 }}>POINTS</span>
            </div>

            {/* Boosted row — the placement's reward, held at the top. */}
            <div
                className="flex items-center gap-3 mt-3 px-2 py-2.5 rounded-lg"
                style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.13), rgba(0,0,0,0))' }}
            >
                <div
                    className="w-9 h-9 rounded-[10px] shrink-0 flex items-center justify-center overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
                >
                    {logoUrl
                        ? <img src={logoUrl} alt="" className="w-full h-full object-contain p-1" />
                        : <span style={{ fontSize: 9, fontWeight: 700, color: DIM }}>{fallback}</span>}
                </div>
                <div className="flex-1 min-w-0">
                    <div style={{ fontSize: 12, fontWeight: 400, color: TEXT, letterSpacing: '-0.1px' }} className="truncate">{reward}</div>
                    <div style={{ fontSize: 9.5, fontWeight: 300, color: DIM }} className="truncate">{brand}</div>
                </div>
                <div className="text-center shrink-0">
                    <div style={{ fontSize: 16, fontWeight: 200, color: GOLD, letterSpacing: '-0.5px', lineHeight: '17px' }}>{cost.toLocaleString()}</div>
                    <div style={{ fontSize: 7, fontWeight: 500, color: GOLD, opacity: 0.7, letterSpacing: '1px' }}>PTS</div>
                </div>
            </div>

            {fillers.map((s) => (
                <div key={s.logo} className="flex items-center gap-3 px-2 py-2.5" style={{ opacity: s.o, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <div
                        className="w-9 h-9 rounded-[10px] shrink-0 flex items-center justify-center"
                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
                    >
                        <span style={{ fontSize: 8, fontWeight: 700, color: DIM }}>{s.logo}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                        <div style={{ fontSize: 12, fontWeight: 400, color: TEXT }} className="truncate">{s.title}</div>
                        <div style={{ fontSize: 9.5, fontWeight: 300, color: DIM }} className="truncate">{s.sub}</div>
                    </div>
                    <div className="text-center shrink-0">
                        <div style={{ fontSize: 16, fontWeight: 200, color: GOLD, letterSpacing: '-0.5px', lineHeight: '17px' }}>{s.pts}</div>
                        <div style={{ fontSize: 7, fontWeight: 500, color: GOLD, opacity: 0.7, letterSpacing: '1px' }}>PTS</div>
                    </div>
                </div>
            ))}
        </div>
    );
}
