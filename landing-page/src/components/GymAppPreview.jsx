import React, { useEffect, useRef, useState } from 'react';
import { StatusBar, PreviewBackground, Ion, FONT, BEZEL, DEVICE_W, DEVICE_H } from './RewardAppPreview';
import { storageImage } from '../lib/storage';
import { teamHeading, teamLine } from '../../../shared/gymTeam.ts';

// ─────────────────────────────────────────────────────────────────────────────
// GymAppPreview: the gym's page in the POWR app, the sheet a member gets when
// they tap its pin on Discover (app/(tabs)/discover.tsx, "Partner detail
// modal" and TrainerCard), drawn from the gym's own details as they change.
// The sheet follows its RN source number for number at true device points
// (390×844); the whole phone then scales to fit.
//
// With `onSelect`, every part a gym can change is a tap target: the cover,
// the logo, the name and address, the hours, the about, each person on the
// team, plus the pin and Home Gym (which explain rather than edit). Dashed
// boxes for things not added yet are editing hints; members never see them.
// ─────────────────────────────────────────────────────────────────────────────

// discover.tsx's own tokens.
const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.25)';
const DIM = 'rgba(255,255,255,0.5)';
const HAIRLINE = 'rgba(255,255,255,0.08)';
// The sheet sets no fontFamily, so the phone draws it in its system font.
const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "system-ui", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const PHONE_W = DEVICE_W + BEZEL * 2;
const PHONE_H = DEVICE_H + BEZEL * 2;
const INSET_TOP = 50;
const INSET_BOTTOM = 34;
const MAP_HEIGHT = 320;
// The modal's tap-through spacer is MAP_HEIGHT + insets.top - 80 tall: the sheet starts there.
const SHEET_TOP = MAP_HEIGHT + INSET_TOP - 80;
const PIN_Y = INSET_TOP + (SHEET_TOP - INSET_TOP) / 2;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SAMPLE_DISTANCE = '0.4 mi';
const GYM_POINTS = 15;   // formatPartnerRows: pts is 15 for a gym

const oneLine = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const img = (url, max) => (url ? storageImage(url, max) : null);

// ── What the app computes (GeofenceContext.tsx / discover.tsx) ───────────────

function nowIn(tz) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t)?.value;
    const day = DAY_KEYS[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))] ?? 'mon';
    return { day, mins: Number(get('hour')) * 60 + Number(get('minute')) };
}
/** checkIsOpenNow(): no hours means open; a 00:00 close is midnight. */
function isOpenNow(oh, tz) {
    if (!oh) return true;
    const { day, mins } = nowIn(tz);
    const h = oh[day];
    if (!h) return false;
    const [o1, o2] = h.open.split(':').map(Number);
    const [c1, c2] = h.close.split(':').map(Number);
    const close = c1 === 0 && c2 === 0 ? 1440 : c1 * 60 + c2;
    return mins >= o1 * 60 + o2 && mins < close;
}
/** formatHours() */
function todayLine(oh, tz) {
    if (!oh) return null;
    const h = oh[nowIn(tz).day];
    return h ? `Today ${h.open} – ${h.close}` : 'Closed today';
}
/** formatPartnerRows(): the logo stand-in, two words on two lines, 10 characters at most. */
function logoText(name) {
    const words = (name || '').split(' ');
    const t = words.length > 1 ? `${words[0]}\n${words[1]}`.toUpperCase() : (name || '').toUpperCase();
    return t.length > 10 ? t.substring(0, 10) : t;
}
/** monogram(): the pin without a logo. */
function monogram(name) {
    const words = (name || '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
}
const logoCardBg = (bg) => (bg === 'white' ? '#FFFFFF' : bg === 'black' ? '#000000' : 'rgba(20,20,20,0.85)');

// ── The map behind: the gym's real streets, centred on its pin ───────────────

// MapLibre is big: only the phone's map pulls it in, and only when it's drawn.
const GymPreviewMap = React.lazy(() => import('./GymPreviewMap'));
function MapBackdrop({ lat, lng }) {
    return (
        // Twice the pin's height, so the map's centre is where the pin sits.
        <div style={{ position: 'absolute', left: 0, top: 0, width: DEVICE_W, height: PIN_Y * 2, background: '#1c1c1e', overflow: 'hidden' }}>
            {lat != null && lng != null && (
                <React.Suspense fallback={null}><GymPreviewMap lat={lat} lng={lng} /></React.Suspense>
            )}
        </div>
    );
}

// ── Tap targets ──────────────────────────────────────────────────────────────

/**
 * A part of the page the gym can change. Hover and selection come from the
 * phone (one listener there finds the innermost [data-spot]), so the logo
 * inside the cover lights up on its own.
 */
function Spot({ id, label, ui, children, style, ring = 0, radius = 14, tag = 'in' }) {
    if (!ui.editable) return <div style={style}>{children}</div>;
    const on = ui.selected === id;
    const hot = ui.hover === id;
    const tagPos = tag === 'above' ? { top: -18, left: 0 } : tag === 'below' ? { bottom: -20, left: 0 } : tag === 'left' ? { top: 22, left: 14 } : { top: 10, right: 10 };
    return (
        <div data-spot={id} role="button" tabIndex={0} aria-label={label} aria-pressed={on}
            style={{ position: 'relative', cursor: 'pointer', outline: 'none', ...style }}>
            {children}
            <span aria-hidden className="gap-ring" style={{
                position: 'absolute', inset: -ring, borderRadius: radius, pointerEvents: 'none', zIndex: 4,
                border: `3px ${on ? 'solid' : 'dashed'} ${on ? GOLD : hot ? 'rgba(232,210,0,0.9)' : 'rgba(232,210,0,0)'}`,
                boxShadow: on ? '0 0 0 6px rgba(232,210,0,0.18)' : 'none',
                transition: 'border-color .15s, box-shadow .15s',
            }} />
            {(hot || on) && (
                <span aria-hidden style={{
                    position: 'absolute', ...tagPos, zIndex: 5, pointerEvents: 'none', whiteSpace: 'nowrap',
                    background: GOLD, color: '#0a0a0a', fontFamily: FONT, fontSize: 12, fontWeight: 800, lineHeight: 1,
                    letterSpacing: 1.2, textTransform: 'uppercase', padding: '6px 9px', borderRadius: 999,
                    boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
                }}>{label}</span>
            )}
        </div>
    );
}

/** A dashed box for something not added yet: an editing hint, never in the app. */
function Ghost({ children, style }) {
    return (
        <div style={{
            border: '2px dashed rgba(232,210,0,0.45)', borderRadius: 14, padding: '14px 16px',
            color: 'rgba(232,210,0,0.85)', fontSize: 13, fontWeight: 500, lineHeight: '18px', ...style,
        }}>{children}</div>
    );
}

// ── The header: cover with the logo on it, or the compact one ────────────────

function LogoCard({ gym, ui }) {
    const logo = img(gym.logo_url, 256);
    return (
        <Spot id="logo" label={logo ? 'Change logo' : 'Add your logo'} ui={ui} ring={4} radius={18} tag="above" style={{ flexShrink: 0 }}>
            <div style={{
                width: 72, height: 72, borderRadius: 14, padding: 8, boxSizing: 'border-box', overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: logoCardBg(gym.logo_bg), border: '1px solid rgba(255,255,255,0.1)',
            }}>
                {logo
                    ? <img src={logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    : <span style={{ fontSize: 12, fontWeight: 800, color: gym.logo_bg === 'white' ? '#1a1a1a' : 'rgba(255,255,255,0.6)', textAlign: 'center', letterSpacing: 0.5, whiteSpace: 'pre-line', lineHeight: '15px' }}>{logoText(gym.name)}</span>}
            </div>
        </Spot>
    );
}

function TitleBlock({ gym, ui }) {
    const name = gym.name || 'Your gym';
    // adjustsFontSizeToFit on one line: shrink long names into the 274pt beside the logo.
    const size = Math.max(14, Math.min(22, 274 / (Math.max(1, name.length) * 0.56)));
    return (
        <Spot id="name" label="Edit name" ui={ui} ring={6} radius={12} tag="above" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 4 }}>
                <div style={{ fontSize: size, fontWeight: 500, color: TEXT, letterSpacing: -0.2, ...oneLine }}>{name}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: 300, ...oneLine }}>{gym.address || gym.area || 'Local'}</div>
            </div>
        </Spot>
    );
}

function Handle() {
    return <div style={{ position: 'absolute', top: 10, left: '50%', marginLeft: -18, width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.45)' }} />;
}
function Close() {
    return (
        <div style={{ position: 'absolute', top: 14, right: 14, width: 32, height: 32, borderRadius: 16, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
            <Ion name="close" size={18} color="rgba(255,255,255,0.9)" />
        </div>
    );
}

function Header({ gym, ui }) {
    const cover = img(gym.image_url, 900);
    if (cover) {
        return (
            <Spot id="cover" label="Change cover photo" ui={ui} ring={-3} radius={24} tag="left">
                <div style={{ height: 260, position: 'relative', overflow: 'hidden', borderTopLeftRadius: 24, borderTopRightRadius: 24, background: 'rgba(255,255,255,0.03)' }}>
                    <img src={cover} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: '35%', background: 'linear-gradient(180deg, transparent 0%, rgba(18,18,18,0.7) 50%, #121212 100%)' }} />
                    <Handle />
                    <Close />
                    <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <LogoCard gym={gym} ui={ui} />
                        <TitleBlock gym={gym} ui={ui} />
                    </div>
                </div>
            </Spot>
        );
    }
    // No cover: the app's compact header. While editing, the empty band above
    // the logo says where a cover would go.
    return (
        <Spot id="cover" label="Add a cover photo" ui={ui} ring={-3} radius={24} tag="left">
            <div style={{ position: 'relative', padding: '20px 16px 16px' }}>
                <Handle />
                <Close />
                {ui.editable && (
                    <div style={{ position: 'absolute', top: 22, left: 16, right: 56, height: 22, display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(232,210,0,0.75)', fontSize: 11, fontWeight: 600, letterSpacing: 0.3 }}>
                        <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> Add a cover photo
                    </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 28 }}>
                    <LogoCard gym={gym} ui={ui} />
                    <TitleBlock gym={gym} ui={ui} />
                </div>
            </div>
        </Spot>
    );
}

// ── Open now, today's hours, how far, and the +15 ────────────────────────────

function InfoRow({ gym, ui, tz }) {
    const open = isOpenNow(gym.opening_hours, tz);
    const today = todayLine(gym.opening_hours, tz);
    const item = { display: 'flex', alignItems: 'center', gap: 6 };
    const text = { fontSize: 13, color: DIM, fontWeight: 300 };
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 0', gap: 16 }}>
            <Spot id="hours" label={today ? 'Edit hours' : 'Add opening hours'} ui={ui} ring={6} radius={12} style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
                    <div style={item}>
                        <span style={{ width: 6, height: 6, borderRadius: 3, background: open ? '#4ade80' : '#f87171' }} />
                        <span style={{ ...text, color: open ? '#4ade80' : '#f87171' }}>{open ? 'Open now' : 'Closed'}</span>
                    </div>
                    {today && (
                        <div style={item}><Ion name="time-outline" size={13} color={DIM} /><span style={text}>{today}</span></div>
                    )}
                    <div style={item}><Ion name="location-sharp" size={13} color={DIM} /><span style={{ ...text, ...oneLine }}>{SAMPLE_DISTANCE} · {gym.area || 'Local'}</span></div>
                </div>
            </Spot>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 20, padding: '6px 12px', border: `0.5px solid ${GOLD}`, minWidth: 58, boxSizing: 'border-box' }}>
                <Ion name="flash" size={10} color={GOLD} />
                <span style={{ fontSize: 13, color: GOLD, fontWeight: 600 }}>+{GYM_POINTS}</span>
            </div>
        </div>
    );
}

// ── A person on the team (TrainerCard) ───────────────────────────────────────

function Photo({ url, size, border, icon }) {
    const src = img(url, 360);
    return (
        <div style={{ width: size, height: size, borderRadius: size / 2, border, boxSizing: 'border-box', overflow: 'hidden', position: 'relative', flexShrink: 0, background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {src ? <img src={src} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : <Ion name="person-outline" size={icon} color="rgba(255,255,255,0.12)" />}
        </div>
    );
}

function Member({ m, line, expanded }) {
    const specialties = m.specialties || [];
    if (!expanded) {
        return (
            <div style={{ borderRadius: 18, padding: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 0' }}>
                    <Photo url={m.photo_url} size={68} border="1.5px solid rgba(232,210,0,0.3)" icon={26} />
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 2 }}>
                        <div style={{ fontSize: 16, fontWeight: 500, color: TEXT, letterSpacing: 0.2, ...oneLine }}>{m.name || 'Their name'}</div>
                        {line && <div style={{ fontSize: 12, fontWeight: 300, color: DIM }}>{line}</div>}
                        {m.bio && <div style={{ fontSize: 13, fontWeight: 300, color: DIM, lineHeight: '19px', marginTop: 3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.bio}</div>}
                    </div>
                    <Ion name="chevron-down" size={16} color={DIM} style={{ marginLeft: 8, flexShrink: 0 }} />
                </div>
            </div>
        );
    }
    return (
        <div style={{ borderRadius: 18, padding: '8px 4px 12px', margin: '4px 0' }}>
            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, position: 'relative' }}>
                <Photo url={m.photo_url} size={110} border={`2px solid ${GOLD}`} icon={40} />
                <div style={{ position: 'absolute', top: 0, right: 0, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ion name="chevron-up" size={16} color={GOLD} /></div>
                <div style={{ fontSize: 20, fontWeight: 600, color: TEXT, letterSpacing: -0.2, textAlign: 'center', maxWidth: '100%', ...oneLine }}>{m.name || 'Their name'}</div>
                {line && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <Ion name="ribbon-outline" size={12} color={GOLD} />
                        <span style={{ fontSize: 12, fontWeight: 500, color: GOLD, letterSpacing: 0.3, textTransform: 'uppercase' }}>{line}</span>
                    </div>
                )}
                {specialties.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 2 }}>
                        {specialties.map((s) => <span key={s} style={{ padding: '4px 10px', borderRadius: 12, background: 'rgba(232,210,0,0.08)', fontSize: 11, fontWeight: 500, color: GOLD }}>{s}</span>)}
                    </div>
                )}
                {m.bio && <div style={{ fontSize: 13, fontWeight: 300, color: 'rgba(255,255,255,0.75)', lineHeight: '20px', marginTop: 6, alignSelf: 'stretch', textAlign: 'center' }}>{m.bio}</div>}
                {(m.booking_url || m.profile_url) && (
                    <div style={{ display: 'flex', gap: 10, marginTop: 10, alignSelf: 'stretch' }}>
                        {m.booking_url && (
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: GOLD, borderRadius: 12, padding: '12px 0' }}>
                                <Ion name="calendar" size={15} color="#0d0d0d" /><span style={{ fontSize: 14, fontWeight: 600, color: '#0d0d0d' }}>Book Session</span>
                            </div>
                        )}
                        {m.profile_url && (
                            <div style={{ flex: m.booking_url ? undefined : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, padding: '12px 16px', border: '0.5px solid rgba(255,255,255,0.2)' }}>
                                <Ion name="open-outline" size={14} color={TEXT} /><span style={{ fontSize: 13, fontWeight: 500, color: TEXT }}>View Profile</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function Team({ team, ui, expandedId }) {
    // The app lists active people only; someone hidden shows here while they're being edited.
    const shown = team.filter((m) => m.active !== false || m.id === expandedId);
    const members = shown.filter((m) => m.active !== false);
    if (!shown.length && !ui.editable) return null;
    const section = { display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 };
    if (!shown.length) {
        return (
            <Spot id="member:new" label="Add someone" ui={ui} radius={16} ring={4} style={section}>
                <div style={{ height: 0.5, background: HAIRLINE, marginBottom: 4 }} />
                <Ghost>+ Add your trainers and coaches. Members see them here, and can book a session straight from the app.</Ghost>
            </Spot>
        );
    }
    return (
        <div style={section}>
            <div style={{ height: 0.5, background: HAIRLINE, marginBottom: 4 }} />
            <div style={{ fontSize: 13, fontWeight: 300, letterSpacing: 1.5, color: MUTED, textTransform: 'uppercase', marginBottom: 4 }}>{teamHeading(members.length ? members : shown)}</div>
            {shown.map((m) => (
                <Spot key={m.id} id={`member:${m.id}`} label={m.id === 'new' ? 'New' : 'Edit'} ui={ui} radius={18} ring={2}>
                    <div style={{ opacity: m.active === false ? 0.45 : 1 }}>
                        <Member m={m} line={teamLine(m, members.length ? members : shown)} expanded={m.id === expandedId} />
                    </div>
                    {m.active === false && (
                        <span style={{ position: 'absolute', top: 8, left: 8, fontFamily: FONT, fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#0a0a0a', background: 'rgba(255,255,255,0.85)', padding: '4px 8px', borderRadius: 999 }}>Hidden from members</span>
                    )}
                </Spot>
            ))}
            {ui.editable && !team.some((m) => m.id === 'new') && (
                <Spot id="member:new" label="Add someone" ui={ui} radius={16} ring={2}>
                    <Ghost style={{ textAlign: 'center' }}>+ Add a trainer, coach or staff</Ghost>
                </Spot>
            )}
        </div>
    );
}

// ── The sheet ────────────────────────────────────────────────────────────────

function Sheet({ gym, team, ui, tz, expandedId, scrollRef }) {
    return (
        <div style={{ position: 'absolute', left: 0, right: 0, top: SHEET_TOP, bottom: 0, background: '#121212', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', boxShadow: '0 -4px 20px rgba(0,0,0,0.4)', zIndex: 2 }}>
            <PreviewBackground />
            <div ref={scrollRef} className="gap-scroll" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: INSET_BOTTOM, overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'none' }}>
                <div style={{ position: 'relative', paddingBottom: 8 }}>
                    <Header gym={gym} ui={ui} />
                    <InfoRow gym={gym} ui={ui} tz={tz} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '18px 20px 16px' }}>
                        {gym.description
                            ? <Spot id="about" label="Edit about" ui={ui} ring={6} radius={12}><div style={{ fontSize: 13, color: DIM, lineHeight: '19px', fontWeight: 300, whiteSpace: 'pre-line' }}>{gym.description}</div></Spot>
                            : ui.editable && <Spot id="about" label="Add about" ui={ui} radius={14}><Ghost>+ A line or two about your gym: what it’s like, who it’s for.</Ghost></Spot>}
                        <Team team={team} ui={ui} expandedId={expandedId} />
                        <Spot id="home" label="Home Gym" ui={ui} radius={14} style={{ marginTop: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px 0' }}>
                                <Ion name="star-outline" size={16} color={DIM} />
                                <span style={{ fontSize: 15, fontWeight: 400, color: DIM }}>Set as Home Gym</span>
                            </div>
                        </Spot>
                        <Spot id="pin" label="Your pin" ui={ui} radius={16} ring={3}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: GOLD, padding: '14px 0', borderRadius: 14, marginTop: 8 }}>
                                <Ion name="navigate" size={18} color="#0d0d0d" />
                                <span style={{ fontSize: 16, fontWeight: 600, color: '#0d0d0d' }}>Get Directions</span>
                            </div>
                        </Spot>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Pin({ gym, ui }) {
    const logo = img(gym.logo_url, 128);
    const bg = logo ? (gym.logo_bg === 'white' ? '#FFFFFF' : gym.logo_bg === 'black' ? '#000000' : '#1a1a1a') : '#000000';
    return (
        <div style={{ position: 'absolute', left: DEVICE_W / 2 - 20, top: PIN_Y - 20, zIndex: 1 }}>
            <Spot id="pin" label="Your pin" ui={ui} radius={24} ring={6} tag="below">
                <div style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 18, background: bg, border: '1.5px solid rgba(232,210,0,0.6)', boxSizing: 'border-box', padding: 5, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {logo
                            ? <img src={logo} alt="" style={{ width: 26, height: 26, objectFit: 'contain' }} />
                            : <span style={{ fontSize: 12, fontWeight: 700, color: '#FFFFFF', letterSpacing: 0.3 }}>{monogram(gym.name)}</span>}
                    </div>
                </div>
            </Spot>
        </div>
    );
}

/**
 * @param gym        { name, address, area, description, logo_url, logo_bg, image_url, opening_hours, lat, lng }
 * @param team       [{ id, name, role, photo_url, experience, specialties[], bio, booking_url, profile_url, active }]
 * @param selected   the part being changed: 'cover' | 'logo' | 'name' | 'hours' | 'about' | 'member:<id>' | 'member:new' | 'home' | 'pin'
 * @param expandedId the person shown opened up, as a member who tapped them sees it
 * @param onSelect   (part) => void; without it the phone is just a picture
 * @param width      on-screen width of the phone, px
 */
export default function GymAppPreview({ gym, team = [], selected = null, expandedId = null, onSelect = null, width = 320, tz = 'Europe/London', caption = true }) {
    const [hover, setHover] = useState(null);
    const scrollRef = useRef(null);
    const boxRef = useRef(null);
    // `width` at most: on a narrow screen the phone shrinks to its column.
    const [fit, setFit] = useState(width);
    useEffect(() => {
        const el = boxRef.current;
        if (!el) return undefined;
        const ro = new ResizeObserver(() => setFit(Math.min(width, el.clientWidth || width)));
        ro.observe(el);
        return () => ro.disconnect();
    }, [width]);
    const scale = fit / PHONE_W;
    const ui = { editable: !!onSelect, hover, selected };

    // Bring what's being changed into view inside the phone's own scroll.
    useEffect(() => {
        const sc = scrollRef.current;
        if (!sc || !selected) return;
        if (['cover', 'logo', 'name'].includes(selected)) { sc.scrollTo({ top: 0, behavior: 'smooth' }); return; }
        const el = sc.querySelector(`[data-spot="${CSS.escape(selected)}"]`);
        if (!el) return;
        const s = sc.getBoundingClientRect().height / sc.clientHeight || 1;
        const top = (el.getBoundingClientRect().top - sc.getBoundingClientRect().top) / s + sc.scrollTop;
        const bottom = top + el.getBoundingClientRect().height / s;
        if (top < sc.scrollTop + 12 || bottom > sc.scrollTop + sc.clientHeight - 12) {
            sc.scrollTo({ top: Math.max(0, top - 24), behavior: 'smooth' });
        }
    }, [selected, expandedId]);

    const spotOf = (e) => e.target.closest?.('[data-spot]')?.getAttribute('data-spot') ?? null;
    const handlers = onSelect ? {
        onMouseOver: (e) => setHover(spotOf(e)),
        onMouseLeave: () => setHover(null),
        onClick: (e) => { const id = spotOf(e); if (id) onSelect(id); },
        onKeyDown: (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const id = spotOf(e);
            if (id) { e.preventDefault(); onSelect(id); }
        },
        onFocus: (e) => setHover(spotOf(e)),
    } : {};

    return (
        <div ref={boxRef} style={{ fontFamily: FONT, width: '100%', maxWidth: width, margin: '0 auto' }}>
            <style>{`
                @font-face { font-family: 'PreviewIonicons'; src: url('/Ionicons.ttf') format('truetype'); font-display: block; }
                .gap-scroll::-webkit-scrollbar { display: none; }
                .gap-hint .gap-ring { animation: gap-hint 2.2s ease-in-out .5s 1; }
                @keyframes gap-hint { 0%, 100% { border-color: rgba(232,210,0,0); } 35%, 65% { border-color: rgba(232,210,0,0.8); } }
            `}</style>
            <div style={{ width: fit, height: PHONE_H * scale, margin: '0 auto', position: 'relative' }}>
                <div style={{ width: PHONE_W, height: PHONE_H, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
                    <div style={{ width: PHONE_W, height: PHONE_H, background: '#0a0a0a', borderRadius: 56, padding: BEZEL, boxShadow: '0 40px 90px rgba(0,0,0,0.35)', boxSizing: 'border-box' }}>
                        <div className={onSelect ? 'gap-hint' : undefined} {...handlers}
                            style={{ position: 'relative', width: DEVICE_W, height: DEVICE_H, borderRadius: 44, overflow: 'hidden', background: '#0d0d0d', fontFamily: SYSTEM_FONT, lineHeight: 'normal', textAlign: 'left', userSelect: 'none' }}>
                            <MapBackdrop lat={gym.lat} lng={gym.lng} />
                            <Pin gym={gym} ui={ui} />
                            <Sheet gym={gym} team={team} ui={ui} tz={tz} expandedId={expandedId} scrollRef={scrollRef} />
                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5, pointerEvents: 'none' }}><StatusBar /></div>
                            <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', width: 120, height: 34, background: '#000', borderRadius: 18, zIndex: 6 }} />
                            <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', width: 140, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.45)', zIndex: 6 }} />
                        </div>
                    </div>
                </div>
            </div>
            {caption && (
                <p style={{ textAlign: 'center', fontSize: 10, color: 'rgba(0,0,0,0.4)', marginTop: 12, fontFamily: FONT, letterSpacing: '0.05em' }}>
                    {onSelect ? 'Tap anything to change it · ' : ''}true-to-scale iPhone render
                    <span style={{ display: 'block', marginTop: 3, fontSize: 9, opacity: 0.8 }}>Map © OpenStreetMap contributors © CARTO</span>
                </p>
            )}
        </div>
    );
}
