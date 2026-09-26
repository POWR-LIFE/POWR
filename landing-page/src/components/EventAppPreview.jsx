import React, { useState } from 'react';
import {
    StatusBar, PreviewBackground, Ion,
    GOLD, TEXT, DIM, MUTED, BORDER, FONT,
    BEZEL, DEVICE_W, DEVICE_H, TAB_H,
} from './RewardAppPreview';
import { storageImage } from '../lib/storage';

// ─────────────────────────────────────────────────────────────────────────────
// EventAppPreview — a live event as the POWR app shows it, drawn from the
// event builder as the gym types. Two screens: the card on Home
// (components/home/LiveEventCard.tsx) and the register sheet it opens
// (components/events/EventRegisterFlow.tsx), with the lockup
// (components/events/EventLockup.tsx) and the prize list
// (components/events/EventPrizeList.tsx) at their real sizes.
//
// Fidelity follows RewardAppPreview: the phone renders at true device pixels
// (390×844) with the RN sources' numbers, then the whole device is CSS-scaled.
// It shares that file's tokens and chrome so the two previews cannot drift
// into showing different apps. A likeness for the gym's eye, not a port.
// ─────────────────────────────────────────────────────────────────────────────

const POWR_MARK = 'https://auth.powr.life/storage/v1/object/public/powr-level-logo/move-machine.png';
const TEXT75 = 'rgba(255,255,255,0.75)';
const PHONE_W = DEVICE_W + BEZEL * 2;
const PHONE_H = DEVICE_H + BEZEL * 2;
const HOME_PAD = 16;
// EventLockup: two successive 5% trims on the mark's canvas.
const MARK_SCALE = 0.95 * 0.95;

const isVideo = (u) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u || '');
const DAY = 86_400_000;

// lib/liveEventDisplay.ts, for the same words on the same days.
function shortDate(iso) {
    if (!iso) return '';
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
}
const lastDayOf = (iso) => (iso ? shortDate(new Date(new Date(iso).getTime() - 60_000).toISOString()) : '');
function scoringLine(ev) {
    if (!ev.window_start_at) return 'Scoring starts soon';
    return ev.status === 'scheduled' ? `Scoring starts ${shortDate(ev.window_start_at)}` : `Scoring ends ${lastDayOf(ev.window_end_at)}`;
}
function statusChip(ev) {
    if (ev.status !== 'scheduled') return 'LIVE NOW';
    if (!ev.window_start_at) return 'SCORING SOON';
    const days = Math.max(0, Math.ceil((new Date(ev.window_start_at).getTime() - Date.now()) / DAY));
    if (days === 0) return 'SCORING TODAY';
    if (days === 1) return 'SCORING TOMORROW';
    return `SCORING IN ${days} DAYS`;
}
const dateRange = (ev) => (ev.window_start_at ? `${shortDate(ev.window_start_at)} – ${lastDayOf(ev.window_end_at)}` : 'Dates to come');
const rankLabel = (rank) => (rank === 1 ? '1ST' : rank === 2 ? '2ND' : rank === 3 ? '3RD' : `${rank}TH`);

// ── The lockup (EventLockup.tsx, size 'normal') ──────────────────────────────
function Lockup({ event, venue }) {
    const venueLogo = venue?.logo_url ? storageImage(venue.logo_url, 512) : null;
    const chip = !!venueLogo && venue?.logo_bg !== 'dark';
    const uploaded = event.logo_url ? storageImage(event.logo_url, 512) : null;
    const mark = 64 * MARK_SCALE;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
            {venueLogo && (
                <>
                    <div style={chip ? { background: '#FFFFFF', borderRadius: 10, padding: '6px 8px' } : undefined}>
                        <img src={venueLogo} alt="" style={{ width: 64, height: 22, objectFit: 'contain', display: 'block' }} />
                    </div>
                    <div style={{ width: 64, height: 1, background: 'rgba(255,255,255,0.45)' }} />
                </>
            )}
            {uploaded
                ? <img src={uploaded} alt="" style={{ width: 88, height: 32, objectFit: 'contain', display: 'block' }} />
                : <img src={POWR_MARK} alt="" style={{ width: mark, height: mark, margin: `${-13 * MARK_SCALE}px ${-10 * MARK_SCALE}px`, display: 'block' }} />}
        </div>
    );
}

// ── The card on Home (LiveEventCard.tsx) ─────────────────────────────────────
function HomeCard({ event, venue }) {
    const media = event.promo_media_url;
    const headline = (event.promo_headline || '').trim();
    return (
        <div style={{ borderRadius: 20, overflow: 'hidden', background: '#141414' }}>
            <div style={{ height: 220, position: 'relative', background: '#1a1a1a' }}>
                {media && (isVideo(media)
                    ? <video src={media} muted autoPlay loop playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <img src={storageImage(media, 800)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />)}
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(10,10,10,0.25) 0%, rgba(10,10,10,0.1) 35%, rgba(10,10,10,0.55) 70%, rgba(10,10,10,0.9) 100%)' }} />
                <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: GOLD, letterSpacing: 2.5, textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>LIVE EVENT</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.4)', padding: '6px 10px', borderRadius: 12 }}>
                        {event.status !== 'scheduled' && <span style={{ width: 6, height: 6, borderRadius: 3, background: GOLD }} />}
                        <span style={{ fontSize: 9, fontWeight: 700, color: TEXT, letterSpacing: 1.5, whiteSpace: 'nowrap' }}>{statusChip(event)}</span>
                    </span>
                </div>
                <div style={{ position: 'absolute', left: 16, right: 16, bottom: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Lockup event={event} venue={venue} />
                    {!event.logo_only && (
                        <div style={{ fontSize: 26, fontWeight: 200, color: TEXT, letterSpacing: -0.5, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.name}</div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {headline && <div style={{ fontSize: 12, fontWeight: 300, color: DIM, lineHeight: '16px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{headline}</div>}
                            <div style={{ fontSize: 12, fontWeight: 500, color: TEXT75, lineHeight: '16px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scoringLine(event)}</div>
                        </div>
                        <div style={{ background: GOLD, borderRadius: 100, padding: '9px 16px', flexShrink: 0 }}>
                            <span style={{ fontSize: 10, fontWeight: 800, color: '#0a0a0a', letterSpacing: 1.5 }}>REGISTER</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Home around the card (a likeness: header and streak, app/(tabs)/index.tsx) ─
function HomeScreen({ event, venue, dim }) {
    return (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', opacity: dim ? 0.35 : 1, transition: 'opacity .2s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: `4px ${HOME_PAD}px 0` }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontSize: 34, fontWeight: 200, color: GOLD, letterSpacing: -1 }}>415</span>
                    <span style={{ fontSize: 13, color: GOLD, opacity: 0.7 }}>pts</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={TEXT} strokeWidth="1.6"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
                    <div style={{ width: 34, height: 34, borderRadius: 17, background: GOLD, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#0a0a0a' }}>{(venue?.name || 'P').trim().charAt(0).toUpperCase()}</span>
                    </div>
                </div>
            </div>
            <div style={{ padding: `18px ${HOME_PAD}px 0` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', color: TEXT }}>YOUR STREAK</span>
                    <span style={{ border: `1px solid ${BORDER}`, borderRadius: 999, padding: '4px 10px', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: TEXT }}>ON A ROLL</span>
                </div>
                <div style={{ display: 'flex', gap: 14, marginTop: 12, alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        <span style={{ fontSize: 44, fontWeight: 200, color: GOLD, lineHeight: 1 }}>3</span>
                        <span style={{ fontSize: 13, color: TEXT }}>WEEKS</span>
                    </div>
                    <div style={{ display: 'flex', gap: 5, marginLeft: 'auto' }}>
                        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                                <span style={{ fontSize: 8, color: i < 3 ? TEXT : MUTED }}>{d}</span>
                                <div style={{ width: 22, height: 22, borderRadius: 11, border: `1px solid ${i < 3 ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.12)'}` }} />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <div style={{ padding: `22px ${HOME_PAD}px 0` }}>
                <HomeCard event={event} venue={venue} />
            </div>
            <div style={{ margin: `14px ${HOME_PAD}px 0`, height: 64, borderRadius: 16, background: 'rgba(40,40,40,0.85)', border: `1px solid ${BORDER}` }} />
        </div>
    );
}

// ── The prize list (EventPrizeList.tsx, size 'sheet') ────────────────────────
function PrizeList({ prizes }) {
    const rows = (prizes || []).slice(0, 3);
    if (!rows.length) return null;
    const imagery = rows.some((p) => !!p.image_url);
    if (!imagery) {
        return (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {rows.map((p) => (
                    <div key={p.rank} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 32, fontSize: 9, fontWeight: 700, color: GOLD, opacity: 0.7, letterSpacing: 1 }}>{rankLabel(p.rank)}</span>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 300, color: DIM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label}</span>
                    </div>
                ))}
            </div>
        );
    }
    return (
        <div style={{ marginTop: 18 }}>
            {rows.map((p, i) => (
                <div key={p.rank} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none' }}>
                    <div style={{ width: 56, height: 56, borderRadius: 14, overflow: 'hidden', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(232,210,0,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {p.image_url
                            ? <img src={storageImage(p.image_url, 256)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <span style={{ fontSize: 20, fontWeight: 200, color: GOLD, letterSpacing: -0.5 }}>{p.rank}</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: GOLD, opacity: 0.7, letterSpacing: 1.5 }}>{rankLabel(p.rank)}</span>
                        <span style={{ fontSize: 14.5, fontWeight: 300, color: TEXT, lineHeight: '19px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.label}</span>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ── The register sheet (EventRegisterFlow.tsx, stage 'pitch') ────────────────
function Sheet({ event }) {
    const rules = event.rules || [];
    const shown = rules.length > 4 ? rules.slice(0, 3) : rules;
    const more = rules.length - shown.length;
    const headline = (event.promo_headline || '').trim();
    return (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 96, background: '#141414', borderRadius: '24px 24px 0 0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 24px 4px' }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)', margin: '0 auto 14px' }} />
                <div style={{ fontSize: 9, fontWeight: 800, color: GOLD, opacity: 0.7, letterSpacing: 2.5 }}>LIVE EVENT</div>
                <div style={{ fontSize: 28, fontWeight: 200, color: TEXT, letterSpacing: -0.5, marginTop: 4, lineHeight: 1.15 }}>{event.name}</div>
                <div style={{ fontSize: 13, fontWeight: 300, color: DIM, marginTop: 2 }}>{dateRange(event)}</div>
            </div>
            <div style={{ padding: '0 24px 24px', overflow: 'hidden' }}>
                {headline && <div style={{ fontSize: 14, fontWeight: 300, color: TEXT, marginTop: 14, lineHeight: '20px' }}>{headline}</div>}
                <PrizeList prizes={event.prizes} />
                {shown.length > 0 && (
                    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ fontSize: 8, fontWeight: 800, color: GOLD, opacity: 0.6, letterSpacing: 2.5 }}>THE RULES</div>
                        {shown.map((r, i) => (
                            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                <span style={{ fontSize: 12, lineHeight: '17px', color: GOLD }}>•</span>
                                <span style={{ flex: 1, fontSize: 12, fontWeight: 300, color: DIM, lineHeight: '17px' }}>{r}</span>
                            </div>
                        ))}
                        {more > 0 && <div style={{ fontSize: 11, fontWeight: 400, color: MUTED, marginTop: 2 }}>+{more} more once you’re in</div>}
                    </div>
                )}
                <div style={{ fontSize: 11, fontWeight: 400, color: DIM, marginTop: 16, lineHeight: '16px' }}>Everyone starts from zero — only points earned during the event window count.</div>
                <div style={{ marginTop: 18, borderRadius: 100, background: GOLD, padding: '16px 0', textAlign: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#0a0a0a', letterSpacing: 1.5 }}>COUNT ME IN</span>
                </div>
                <div style={{ textAlign: 'center', padding: '14px 0', fontSize: 13, fontWeight: 400, color: DIM }}>Not now</div>
            </div>
        </div>
    );
}

function NavBar() {
    const items = [['home-outline', true], ['bar-chart-outline', false], ['trophy-outline', false], ['bag', false], ['compass-outline', false]];
    return (
        <div style={{ height: TAB_H, background: '#222222', borderTop: '1px solid #303030', display: 'flex', paddingTop: 8, flexShrink: 0 }}>
            {items.map(([name, active], i) => (
                <div key={i} style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 4 }}>
                    <Ion name={name} size={26} color={active ? GOLD : 'rgba(255,255,255,0.25)'} />
                </div>
            ))}
        </div>
    );
}

/**
 * @param event  { name, promo_headline, promo_media_url, logo_url, logo_only,
 *                 status, window_start_at, window_end_at, prizes[{rank,label,image_url}], rules[] }
 * @param venue  { name, logo_url, logo_bg }
 * @param width  on-screen width of the phone, px (the device scales to fit)
 */
export default function EventAppPreview({ event, venue, width = 300, pageTheme = 'light', initial = 'home', caption = true }) {
    const [screen, setScreen] = useState(initial); // 'home' | 'sheet'
    const scale = width / PHONE_W;
    const lightPage = pageTheme === 'light';
    const tabIdleBorder = lightPage ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.12)';
    const tabIdleColor = lightPage ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.4)';
    const captionColor = lightPage ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.3)';
    if (!event) return null;

    return (
        <div style={{ fontFamily: FONT, width: '100%', maxWidth: width, margin: '0 auto' }}>
            <style>{`@font-face { font-family: 'PreviewIonicons'; src: url('/Ionicons.ttf') format('truetype'); font-display: block; }`}</style>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 14 }}>
                {[['home', 'On Home'], ['sheet', 'Tap to join']].map(([key, label]) => (
                    <button key={key} type="button" onClick={() => setScreen(key)} aria-pressed={screen === key} style={{
                        cursor: 'pointer', borderRadius: 999, padding: '6px 12px', fontFamily: FONT,
                        fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
                        border: `1px solid ${screen === key ? 'rgba(232,210,0,0.6)' : tabIdleBorder}`,
                        background: screen === key ? 'rgba(232,210,0,0.12)' : 'transparent',
                        color: screen === key ? '#8a7600' : tabIdleColor, transition: 'all .2s',
                    }}>{label}</button>
                ))}
            </div>
            <div style={{ width, height: PHONE_H * scale, margin: '0 auto', position: 'relative' }}>
                <div style={{ width: PHONE_W, height: PHONE_H, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
                    <div style={{ width: PHONE_W, height: PHONE_H, background: '#0a0a0a', borderRadius: 56, padding: BEZEL, boxShadow: '0 40px 90px rgba(0,0,0,0.35)' }}>
                        <div style={{ position: 'relative', width: DEVICE_W, height: DEVICE_H, borderRadius: 44, overflow: 'hidden', background: '#060606' }}>
                            <PreviewBackground />
                            <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', width: 120, height: 34, background: '#000', borderRadius: 18, zIndex: 5 }} />
                            <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', width: 140, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.45)', zIndex: 6 }} />
                            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
                                <StatusBar />
                                <HomeScreen event={event} venue={venue} dim={screen === 'sheet'} />
                                <NavBar />
                            </div>
                            {screen === 'sheet' && <div style={{ position: 'absolute', inset: 0, zIndex: 3 }}><Sheet event={event} /></div>}
                        </div>
                    </div>
                </div>
            </div>
            {caption && (
                <p style={{ textAlign: 'center', fontSize: 10, color: captionColor, marginTop: 12, fontFamily: FONT, letterSpacing: '0.05em' }}>
                    How it looks in the app · true-to-scale iPhone render
                </p>
            )}
        </div>
    );
}
