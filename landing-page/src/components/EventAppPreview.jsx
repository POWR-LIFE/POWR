import React, { useState } from 'react';
import { StatusBar, Ion, FONT, BEZEL, DEVICE_W, DEVICE_H, TAB_H } from './RewardAppPreview';
import HOME from './appPreviewHome.json';
import { storageImage } from '../lib/storage';

// ─────────────────────────────────────────────────────────────────────────────
// EventAppPreview: a live event as members see it in the POWR app, drawn from
// the gym's own fields as they type. Two screens:
//   On Home      the app's real Home screen, a capture of app/(tabs)/index.tsx
//                made by scripts/capture-app-home.cjs, with the event's card
//                (components/home/LiveEventCard.tsx) drawn into the space the
//                app gives it;
//   Tap to join  the register sheet the card opens
//                (components/events/EventRegisterFlow.tsx, the 'pitch' stage).
// Everything around the card is the app's own pixels. The card and the sheet
// are ports that follow their RN sources number for number, at true device
// points (390×844); the whole phone then scales to fit.
// ─────────────────────────────────────────────────────────────────────────────

// LiveEventCard.tsx / EventRegisterFlow.tsx / EventPrizeList.tsx, each file's own tokens.
const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const CARD_DIM = 'rgba(255,255,255,0.55)';
const SHEET_DIM = 'rgba(255,255,255,0.55)';
const SHEET_MUTED = 'rgba(255,255,255,0.3)';
const SHEET_BORDER = '#222222';
const PRIZE_DIM = 'rgba(255,255,255,0.5)';
const HAIRLINE = 'rgba(255,255,255,0.08)';
const SCORING = 'rgba(255,255,255,0.75)';

// The card and the sheet set no fontFamily, so the phone draws them in its
// system font (San Francisco on an iPhone). React Native for web falls back to
// this same stack, which on a Mac is San Francisco too.
const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "system-ui", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// EventLockup.tsx: the default POWR side, and two successive 5% trims on it.
const POWR_MARK = 'https://auth.powr.life/storage/v1/object/public/powr-level-logo/move-machine.png';
const MARK_SCALE = 0.95 * 0.95;

// _layout.tsx on iOS: sheets sit above the home indicator by insets.bottom.
const INSET_BOTTOM = 34;

const PHONE_W = DEVICE_W + BEZEL * 2;
const PHONE_H = DEVICE_H + BEZEL * 2;
const isVideo = (u) => /\.(mp4|m3u8|webm|mov)(\?|#|$)/i.test(u || '');

// lib/liveEventDisplay.ts: the same words on the same days (a UK phone).
function shortDate(iso) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
}
const lastDayOf = (iso) => shortDate(new Date(new Date(iso).getTime() - 60_000).toISOString());
const dateRange = (ev) => (ev.window_start_at && ev.window_end_at ? `${shortDate(ev.window_start_at)} – ${lastDayOf(ev.window_end_at)}` : 'Dates to come');
function scoringLine(ev) {
    if (!ev.window_start_at) return 'Scoring starts soon';
    return ev.status === 'scheduled' ? `Scoring starts ${shortDate(ev.window_start_at)}` : `Scoring ends ${lastDayOf(ev.window_end_at)}`;
}
function statusChip(ev) {
    if (ev.status !== 'scheduled') return 'LIVE NOW';
    if (!ev.window_start_at) return 'SCORING SOON';
    const days = Math.max(0, Math.ceil((new Date(ev.window_start_at).getTime() - Date.now()) / 86_400_000));
    if (days === 0) return 'SCORING TODAY';
    if (days === 1) return 'SCORING TOMORROW';
    return `SCORING IN ${days} DAYS`;
}
const rankLabel = (rank) => (rank === 1 ? '1ST' : rank === 2 ? '2ND' : rank === 3 ? '3RD' : `${rank}TH`);

// What members see once it's published: live from the moment scoring opens
// (the lifecycle clock does this, and get_live_event shows a draft's
// previewers the same), scheduled before.
function asMembersSeeIt(event) {
    const start = event.window_start_at ? Date.parse(event.window_start_at) : NaN;
    const live = event.status === 'live' || (Number.isFinite(start) && start <= Date.now());
    return { ...event, status: live ? 'live' : 'scheduled' };
}

// ── The lockup (EventLockup.tsx) ─────────────────────────────────────────────
function Lockup({ event, venue }) {
    const large = !!event.logo_only;
    const venueLogo = venue?.logo_url ? storageImage(venue.logo_url, 512) : null;
    const chip = !!venueLogo && venue?.logo_bg !== 'dark';
    const uploaded = event.logo_url ? storageImage(event.logo_url, 512) : null;
    const venueDims = large ? { width: 80, height: 28 } : { width: 64, height: 22 };
    const uploadedDims = large ? { width: 112, height: 40 } : { width: 88, height: 32 };
    const m = (n) => n * MARK_SCALE;
    const markDims = large
        ? { width: m(90), height: m(90), margin: `${m(-18)}px ${m(-14)}px` }
        : { width: m(64), height: m(64), margin: `${m(-13)}px ${m(-10)}px` };
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', alignSelf: 'flex-start', gap: 8 }}>
            {venueLogo && (
                <>
                    <div style={chip ? { background: '#FFFFFF', borderRadius: 10, padding: '6px 8px' } : undefined}>
                        <img src={venueLogo} alt="" style={{ ...venueDims, objectFit: 'contain', display: 'block' }} />
                    </div>
                    <div style={{ width: venueDims.width, height: 1, background: 'rgba(255,255,255,0.45)' }} />
                </>
            )}
            {uploaded
                ? <img src={uploaded} alt="" style={{ ...uploadedDims, objectFit: 'contain', display: 'block' }} />
                : <img src={POWR_MARK} alt="" style={{ ...markDims, objectFit: 'contain', display: 'block' }} />}
        </div>
    );
}

// ── The card (LiveEventCard.tsx), at the size Home gives it ──────────────────
function HomeCard({ event, venue }) {
    const media = event.promo_media_url;
    const headline = (event.promo_headline || '').trim();
    const oneLine = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
    return (
        <div style={{ width: '100%', height: '100%', borderRadius: 20, overflow: 'hidden', background: '#141414', position: 'relative' }}>
            {media && (isVideo(media)
                ? <video src={media} muted autoPlay loop playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={storageImage(media, 800)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />)}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(10,10,10,0.25) 0%, rgba(10,10,10,0.1) 35%, rgba(10,10,10,0.55) 70%, rgba(10,10,10,0.9) 100%)' }} />
            <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: GOLD, letterSpacing: 2.5, textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>LIVE EVENT</span>
                <span style={{ display: 'flex', alignItems: 'center', flexShrink: 1, gap: 6, background: 'rgba(0,0,0,0.4)', padding: '6px 10px', borderRadius: 12 }}>
                    {event.status === 'live' && <span style={{ width: 6, height: 6, borderRadius: 3, background: GOLD }} />}
                    <span style={{ fontSize: 9, fontWeight: 700, color: TEXT, letterSpacing: 1.5, ...oneLine }}>{statusChip(event)}</span>
                </span>
            </div>
            <div style={{ position: 'absolute', left: 16, right: 16, bottom: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Lockup event={event} venue={venue} />
                {!event.logo_only && (
                    <div style={{ fontSize: 26, fontWeight: 200, color: TEXT, letterSpacing: -0.5, ...oneLine }}>{event.name}</div>
                )}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {headline && <div style={{ fontSize: 12, fontWeight: 300, color: CARD_DIM, lineHeight: '16px', ...oneLine }}>{headline}</div>}
                        <div style={{ fontSize: 12, fontWeight: 500, color: SCORING, lineHeight: '16px', ...oneLine }}>{scoringLine(event)}</div>
                    </div>
                    <div style={{ display: 'flex', background: GOLD, borderRadius: 100, padding: '9px 16px', flexShrink: 0 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: '#0a0a0a', letterSpacing: 1.5 }}>REGISTER</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Home: the real screen, the card in its place ─────────────────────────────
function HomeScreen({ event, venue }) {
    const c = HOME.card;
    return (
        <div style={{ position: 'absolute', left: 0, top: 0, width: DEVICE_W, height: HOME.height }}>
            <img src={HOME.image} alt="" draggable={false} style={{ width: DEVICE_W, height: HOME.height, display: 'block' }} />
            <div style={{ position: 'absolute', left: c.x, top: c.y, width: c.w, height: c.h }}>
                <HomeCard event={event} venue={venue} />
            </div>
        </div>
    );
}

// ── The tab bar (app/(tabs)/_layout.tsx on iOS), Home selected ───────────────
function TabBar() {
    const items = [['home', true], ['bar-chart-outline', false], ['trophy-outline', false], ['bag-outline', false], ['compass-outline', false]];
    return (
        <div style={{ position: 'absolute', left: 0, right: 0, top: HOME.height, height: TAB_H, background: '#222222', borderTop: '1px solid #303030', display: 'flex', paddingTop: 8, boxSizing: 'border-box' }}>
            {items.map(([name, active]) => (
                <div key={name} style={{ flex: 1, height: TAB_H - 8 - INSET_BOTTOM, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 2 }}>
                    <Ion name={name} size={26} color={active ? GOLD : 'rgba(255,255,255,0.25)'} />
                </div>
            ))}
        </div>
    );
}

// ── The prize list (EventPrizeList.tsx, size 'sheet') ────────────────────────
function PrizeList({ prizes }) {
    const rows = (prizes || []).slice(0, 3);
    if (!rows.length) return null;
    if (!rows.some((p) => !!p.image_url)) {
        return (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {rows.map((p) => (
                    <div key={p.rank} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 32, flexShrink: 0, fontSize: 9, fontWeight: 700, color: GOLD, opacity: 0.7, letterSpacing: 1 }}>{rankLabel(p.rank)}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 300, color: PRIZE_DIM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label}</span>
                    </div>
                ))}
            </div>
        );
    }
    return (
        <div style={{ marginTop: 18 }}>
            {rows.map((p, i) => (
                <div key={p.rank} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', borderTop: i > 0 ? `0.5px solid ${HAIRLINE}` : 'none' }}>
                    <div style={{ width: 56, height: 56, borderRadius: 14, overflow: 'hidden', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(232,210,0,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxSizing: 'border-box', position: 'relative' }}>
                        {p.image_url
                            ? <img src={storageImage(p.image_url, 256)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
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
function Sheet({ event, venue }) {
    const rules = event.rules || [];
    const shown = rules.length > 4 ? rules.slice(0, 3) : rules;
    const more = rules.length - shown.length;
    const headline = (event.promo_headline || '').trim();
    // consentLine() in lib/liveEventDisplay.ts: shown whenever there's a venue.
    const consent = venue?.name ? `By registering, your name and email are shared with ${venue.name} to arrange your booking.` : null;
    return (
        <div style={{ position: 'absolute', inset: 0, zIndex: 3 }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />
            <div style={{
                position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '90%', display: 'flex', flexDirection: 'column',
                background: '#141414', borderTopLeftRadius: 24, borderTopRightRadius: 24, border: `1px solid ${SHEET_BORDER}`,
                paddingBottom: INSET_BOTTOM + 20, boxSizing: 'border-box',
            }}>
                <div style={{ padding: '12px 24px 4px', flexShrink: 0 }}>
                    <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)', margin: '0 auto 14px' }} />
                    <div style={{ fontSize: 9, fontWeight: 800, color: GOLD, opacity: 0.7, letterSpacing: 2.5 }}>LIVE EVENT</div>
                    <div style={{ fontSize: 28, fontWeight: 200, color: TEXT, letterSpacing: -0.5, marginTop: 4 }}>{event.name}</div>
                    <div style={{ fontSize: 13, fontWeight: 300, color: SHEET_DIM, marginTop: 2 }}>{dateRange(event)}</div>
                </div>
                <div style={{ padding: '0 24px 4px', overflowY: 'auto', minHeight: 0 }}>
                    {headline && <div style={{ fontSize: 14, fontWeight: 300, color: TEXT, marginTop: 14, lineHeight: '20px' }}>{headline}</div>}
                    <PrizeList prizes={event.prizes} />
                    {shown.length > 0 && (
                        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ fontSize: 8, fontWeight: 800, color: GOLD, opacity: 0.6, letterSpacing: 2.5 }}>THE RULES</div>
                            {shown.map((r, i) => (
                                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                    <span style={{ fontSize: 12, lineHeight: '17px', color: GOLD }}>•</span>
                                    <span style={{ flex: 1, fontSize: 12, fontWeight: 300, color: SHEET_DIM, lineHeight: '17px' }}>{r}</span>
                                </div>
                            ))}
                            {more > 0 && <div style={{ fontSize: 11, fontWeight: 400, color: SHEET_MUTED, marginTop: 2 }}>+{more} more once you’re in</div>}
                        </div>
                    )}
                    <div style={{ fontSize: 11, fontWeight: 400, color: SHEET_DIM, marginTop: 16, lineHeight: '16px' }}>Everyone starts from zero — only points earned during the event window count.</div>
                    {consent && <div style={{ fontSize: 10, fontWeight: 400, color: SHEET_MUTED, marginTop: 10, lineHeight: '14px' }}>{consent}</div>}
                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18, borderRadius: 100, background: GOLD, padding: '14px 0' }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: '#0a0a0a', letterSpacing: 1.5 }}>COUNT ME IN</span>
                    </div>
                    <div style={{ textAlign: 'center', padding: '14px 0', fontSize: 13, fontWeight: 400, color: SHEET_DIM }}>Not now</div>
                </div>
            </div>
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
    const ev = asMembersSeeIt(event);

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
                    <div style={{ width: PHONE_W, height: PHONE_H, background: '#0a0a0a', borderRadius: 56, padding: BEZEL, boxShadow: '0 40px 90px rgba(0,0,0,0.35)', boxSizing: 'border-box' }}>
                        <div style={{ position: 'relative', width: DEVICE_W, height: DEVICE_H, borderRadius: 44, overflow: 'hidden', background: '#0d0d0d', fontFamily: SYSTEM_FONT, lineHeight: 'normal', textAlign: 'left' }}>
                            <HomeScreen event={ev} venue={venue} />
                            <TabBar />
                            {screen === 'sheet' && <Sheet event={ev} venue={venue} />}
                            {/* The system's own layer: status bar, island, home indicator. */}
                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5 }}><StatusBar /></div>
                            <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', width: 120, height: 34, background: '#000', borderRadius: 18, zIndex: 6 }} />
                            <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', width: 140, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.45)', zIndex: 6 }} />
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
