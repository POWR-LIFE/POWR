import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { LOGO_SRC } from '../landing/LogoMorph';
import { storageImage } from '../lib/storage';
import MediaVideo from '../components/MediaVideo';
import { eventRegisterUrl } from '../lib/eventRegisterUrl';

/**
 * Shareable event promo page — powr.life/promo/<slug>.
 *
 * The thing we send out before an event: a full-bleed video or image
 * background with the event name huge in the middle and a branding bar
 * along the bottom — venue logo · registration QR · POWR logo. Data comes
 * from the public event-promo edge fn (slug-only; nothing score-shaped
 * ever leaves it). ?k=<display_token> previews a draft event so the page
 * can be checked before comms go out.
 *
 * The QR deep-links into the app's League tab (where the event card and
 * join flow live) via the store-fallback smart-link, so one code serves
 * both installed and new users.
 */

const GOLD = '#E8D200';
const FN_BASE = `${import.meta.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/event-promo`;

const VIDEO_EXT = /\.(mp4|m3u8|webm|mov)(\?|#|$)/i;

const fmtDay = (iso) =>
    new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

// The scoring window is half-open — show the last day that counts.
const lastDay = (endIso) => fmtDay(new Date(new Date(endIso).getTime() - 60_000).toISOString());

const medal = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`);

export default function EventPromo() {
    const { slug } = useParams();
    const [params] = useSearchParams();
    const previewKey = params.get('k');

    const [event, setEvent] = useState(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let alive = true;
        const load = async (attempt = 0) => {
            try {
                const key = previewKey ? `&k=${encodeURIComponent(previewKey)}` : '';
                const res = await fetch(`${FN_BASE}?slug=${encodeURIComponent(slug)}${key}`);
                if (!alive) return;
                if (res.status === 404 || res.status === 400) { setFailed(true); return; }
                if (!res.ok) throw new Error('transient');
                setEvent(await res.json());
            } catch {
                // Transient network blip — a shared promo link deserves a retry.
                if (alive && attempt < 3) setTimeout(() => load(attempt + 1), 1500 * (attempt + 1));
                else if (alive) setFailed(true);
            }
        };
        load();
        return () => { alive = false; };
    }, [slug, previewKey]);

    if (failed) {
        return (
            <Shell>
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
                    <div className="text-5xl font-extralight tracking-tighter">POWR</div>
                    <div className="text-lg text-white/45 font-light">This event page isn't available.</div>
                </div>
            </Shell>
        );
    }

    if (!event) {
        return (
            <Shell>
                <div className="flex-1 flex items-center justify-center">
                    <motion.div
                        className="text-5xl font-extralight tracking-tighter"
                        animate={{ opacity: [0.35, 1, 0.35] }}
                        transition={{ duration: 2, repeat: Infinity }}
                    >
                        POWR
                    </motion.div>
                </div>
            </Shell>
        );
    }

    return (
        <Shell media={event.media_url}>
            {/* Eyebrow */}
            <div className="shrink-0 pt-[6vh] flex justify-center">
                <motion.span
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7 }}
                    className="text-[clamp(10px,1.4vw,14px)] font-black uppercase tracking-[0.65em] pl-[0.65em]"
                    style={{ color: GOLD }}
                >
                    POWR · Live event
                </motion.span>
            </div>

            {/* Headline block */}
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center px-6 gap-5">
                <motion.h1
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.9, delay: 0.15 }}
                    className="font-extralight tracking-tighter leading-[0.95] text-[clamp(2.8rem,9vw,7.5rem)]"
                >
                    {event.name}
                </motion.h1>

                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.9, delay: 0.35 }}
                    className="text-[clamp(14px,2vw,20px)] font-light text-white/75"
                >
                    {fmtDay(event.window_start_at)} — {lastDay(event.window_end_at)}
                    {event.venue?.name ? <span className="text-white/45"> · {event.venue.name}</span> : null}
                </motion.div>

                {event.headline && (
                    <motion.p
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.9, delay: 0.5 }}
                        className="max-w-2xl text-[clamp(15px,2.2vw,22px)] font-light text-white/85 leading-relaxed"
                    >
                        {event.headline}
                    </motion.p>
                )}

                {event.prizes?.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.9, delay: 0.65 }}
                        className="flex items-center justify-center gap-x-7 gap-y-2 flex-wrap mt-2"
                    >
                        {event.prizes.slice(0, 3).map((p) => (
                            <span key={p.rank} className="flex items-center gap-2 text-[clamp(13px,1.6vw,17px)] font-light text-white/70">
                                <span>{medal(p.rank)}</span>{p.label}
                            </span>
                        ))}
                    </motion.div>
                )}
            </div>

            {/* Branding bar: venue logo · QR · POWR logo */}
            <motion.div
                initial={{ opacity: 0, y: 28 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.9, delay: 0.55 }}
                className="shrink-0 grid grid-cols-3 items-end px-[5vw] pb-[4.5vh] gap-4"
            >
                <div className="flex justify-start">
                    {event.venue?.logo_url && <VenueLogo venue={event.venue} />}
                </div>

                <div className="flex flex-col items-center gap-3 -mb-1">
                    <div className="bg-white rounded-2xl p-2.5 sm:p-3 shadow-[0_8px_40px_rgba(0,0,0,0.5)]">
                        <QRCodeSVG
                            value={eventRegisterUrl(slug)}
                            size={128}
                            fgColor="#0a0a0a"
                            bgColor="#FFFFFF"
                            level="M"
                            className="w-[clamp(88px,12vw,144px)] h-[clamp(88px,12vw,144px)]"
                        />
                    </div>
                    <div className="text-center">
                        <div className="text-[clamp(11px,1.3vw,14px)] font-semibold text-white/90 uppercase tracking-[0.25em]">Scan to register</div>
                        <div className="text-[clamp(10px,1.1vw,12px)] text-white/45 font-light mt-0.5">Free with the POWR app</div>
                    </div>
                </div>

                <div className="flex justify-end">
                    {/* The lockup is a square P-mark + wordmark — it needs venue-logo
                        scale, not wordmark scale, to read at all. */}
                    <img src={LOGO_SRC} alt="POWR" className="h-[clamp(48px,8vw,92px)] w-auto opacity-95" />
                </div>
            </motion.div>
        </Shell>
    );
}

// ─── Chrome ──────────────────────────────────────────────────────

function Shell({ media, children }) {
    const isVideo = media && VIDEO_EXT.test(media);
    return (
        <div
            className="fixed inset-0 bg-[#080808] text-[#F2F2F2] flex flex-col overflow-hidden select-none"
            style={{ fontFamily: "'Outfit', 'Helvetica Neue', sans-serif" }}
        >
            {/* Background media (video or image), covered + scrimmed for legibility */}
            {media && (isVideo ? (
                <MediaVideo
                    src={media}
                    referrerPolicy="no-referrer"
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="auto"
                    className="absolute inset-0 w-full h-full object-cover"
                />
            ) : (
                <img
                    src={storageImage(media, 1920)}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                />
            ))}
            {media ? (
                <div
                    className="absolute inset-0"
                    style={{
                        background:
                            'linear-gradient(180deg, rgba(8,8,8,0.55) 0%, rgba(8,8,8,0.25) 38%, rgba(8,8,8,0.5) 62%, rgba(8,8,8,0.9) 80%, rgba(8,8,8,0.97) 100%)',
                    }}
                />
            ) : (
                // No media configured — the LiveBoard look: near-black + gold glow.
                <div
                    className="pointer-events-none absolute -top-64 left-1/2 -translate-x-1/2 w-[70vw] h-[55vh] rounded-full opacity-[0.09]"
                    style={{ background: `radial-gradient(closest-side, ${GOLD}, transparent)` }}
                />
            )}
            <div className="relative flex-1 min-h-0 flex flex-col">{children}</div>
        </div>
    );
}

// Partner logos are uploaded against a stated backdrop (logo_bg): 'dark'
// means the art works straight on this page; anything else gets a white
// chip so light-backdrop logos don't vanish into the scrim.
function VenueLogo({ venue }) {
    const src = storageImage(venue.logo_url, 320);
    return venue.logo_bg === 'dark' ? (
        <img src={src} alt={venue.name} className="h-[clamp(44px,8vw,88px)] w-auto max-w-[26vw] object-contain" />
    ) : (
        <div className="bg-white rounded-xl px-3.5 py-2.5 shadow-[0_8px_40px_rgba(0,0,0,0.4)]">
            <img src={src} alt={venue.name} className="h-[clamp(30px,5.5vw,60px)] w-auto max-w-[22vw] object-contain" />
        </div>
    );
}
