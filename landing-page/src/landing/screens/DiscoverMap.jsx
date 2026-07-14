import { motion, useTransform } from 'framer-motion';
import { t, w } from '../theme';
import Ion from '../Ionicon';

/**
 * The Discover page, deconstructed — no phone frame. The map is a large
 * floating surface; the app's real UI (filter chips + search + section label,
 * partner list rows, logo pins with geofence circles) floats around it as
 * separate components, every one a 1:1 port from app/(tabs)/discover.tsx.
 * Partner data is live (see discoverData.js).
 */

// Discover's own tokens (app/(tabs)/discover.tsx lines 34-40)
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER = 'rgba(255,255,255,0.08)';
const MUTED = 'rgba(255,255,255,0.25)';
const DIM = 'rgba(255,255,255,0.5)';

const FLOAT_CARD = {
  background: 'rgba(20,20,22,0.92)',
  backdropFilter: 'blur(14px)',
  border: `1px solid ${t.borderCard}`,
  borderRadius: 18,
  boxShadow: '0 30px 60px -18px rgba(0,0,0,0.7)',
};

/* ── The map surface: DARK_MAP_STYLE palette, real pins, geofence rings ── */

export function MapSurface({ progress, partners, target }) {
  const mapScale = useTransform(progress, [0.02, 0.26], [1.12, 1]);

  // User location glides to the target gym, stopping just beside the pin
  // (not under it) so the blue dot stays visible at the door
  const userLeft = useTransform(progress, [0.34, 0.48], ['20%', `${target.x - 3.5}%`]);
  const userTop = useTransform(progress, [0.34, 0.48], ['84%', `${target.y + 3.5}%`]);

  // Target geofence blooms as the user crosses it
  const ringScale = useTransform(progress, [0.35, 0.45], [0.4, 1]);
  const ringOpacity = useTransform(progress, [0.35, 0.44], [0, 1]);

  // Check-in pill drops in, then hands off to the push toast
  const pillY = useTransform(progress, [0.44, 0.50], [-16, 0]);
  const pillOpacity = useTransform(progress, [0.44, 0.50, 0.53, 0.57], [0, 1, 1, 0]);

  return (
    <div
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 28,
        fontFamily: t.font,
      }}
    >
      <motion.div style={{ position: 'absolute', inset: 0, scale: mapScale }}>
        <MapArt />
      </motion.div>

      {/* Target geofence: the 25m circle, bloomed */}
      <motion.div
        style={{
          position: 'absolute', left: `${target.x}%`, top: `${target.y}%`,
          width: 170, height: 170, marginLeft: -85, marginTop: -85, borderRadius: '50%',
          border: '1.5px solid rgba(232,210,0,0.5)',
          background: 'radial-gradient(circle, rgba(232,210,0,0.14), rgba(232,210,0,0.07) 55%, rgba(232,210,0,0) 72%)',
          scale: ringScale, opacity: ringOpacity, zIndex: 4,
        }}
      >
        <span
          style={{
            position: 'absolute', inset: -1, borderRadius: '50%',
            border: '1.5px solid rgba(232,210,0,0.5)', animation: 'powrPulse 2.4s ease-out infinite',
          }}
        />
      </motion.div>

      {/* Partner pins + their geofence circles, staggered */}
      {partners.map((p, i) => (
        <Pin key={`${p.name}-${i}`} partner={p} progress={progress} index={i} isTarget={p === target} />
      ))}

      {/* User location dot (the map's blue dot) */}
      <motion.div
        style={{
          position: 'absolute', left: userLeft, top: userTop, width: 18, height: 18,
          marginLeft: -9, marginTop: -9, borderRadius: '50%', background: t.blue,
          border: '2px solid #fff', boxShadow: `0 0 0 7px ${t.blue}33`, zIndex: 6,
        }}
      />

      {/* Auto check-in pill */}
      {/* right-of-centre so the floating header card never clips it */}
      <motion.div
        style={{
          position: 'absolute', top: 18, right: 24, y: pillY, opacity: pillOpacity,
          display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(14,14,14,0.92)',
          border: `1px solid ${t.accentMid}`, borderRadius: 100, padding: '8px 14px', zIndex: 8, whiteSpace: 'nowrap',
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.accent }} />
        <span style={{ color: t.text, fontSize: 12.5, fontWeight: w.medium }}>Checking you in…</span>
      </motion.div>
    </div>
  );
}

/* Partner pin — pinWrap/pinCircle port, real logo, logo_bg-aware */
function Pin({ partner, progress, index, isTarget }) {
  const a = 0.14 + index * 0.022;
  const y = useTransform(progress, [a, a + 0.04, a + 0.07], [-44, 6, 0]);
  const opacity = useTransform(progress, [a, a + 0.03], [0, 1]);
  const ringIn = useTransform(progress, [a + 0.02, a + 0.07], [0, 1]);
  // The target pin picks up the active border once the geofence blooms
  const activeT = useTransform(progress, [0.42, 0.47], [0, 1]);
  const scale = useTransform(activeT, (v) => (isTarget ? 1 + v * 0.12 : 1));

  const bg = partner.logoBg === 'white' ? '#FFFFFF' : partner.logoBg === 'black' ? '#000000' : '#1a1a1a';

  return (
    <motion.div
      style={{
        position: 'absolute', left: `${partner.x}%`, top: `${partner.y}%`,
        x: '-50%', marginTop: -20, y, opacity, zIndex: isTarget ? 7 : 5,
      }}
    >
      {/* This pin's own geofence circle (real Circle props: gold 0.5 stroke / 0.07 fill) */}
      {!isTarget && (
        <motion.span
          style={{
            position: 'absolute', left: '50%', top: '50%', width: 54, height: 54,
            marginLeft: -27, marginTop: -27, borderRadius: '50%',
            border: '1.5px solid rgba(232,210,0,0.5)', background: 'rgba(232,210,0,0.07)',
            scale: ringIn, opacity: ringIn,
          }}
        />
      )}
      <motion.div
        style={{
          width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', scale,
        }}
      >
        <div
          style={{
            width: 36, height: 36, borderRadius: 18, background: bg,
            border: isTarget ? `2.5px solid ${t.accent}` : '1.5px solid rgba(232,210,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 5, overflow: 'hidden', boxSizing: 'border-box',
            boxShadow: isTarget ? `0 4px 18px ${t.accentMid}` : '0 4px 10px rgba(0,0,0,0.6)',
          }}
        >
          {partner.logo ? (
            <img src={partner.logo} alt={partner.name} style={{ width: 26, height: 26, objectFit: 'contain' }} />
          ) : (
            <span
              style={{
                fontSize: 8, fontWeight: w.bold, fontFamily: t.font, textAlign: 'center',
                color: partner.logoBg === 'white' ? '#000' : '#fff',
              }}
            >
              {partner.name[0]}
            </span>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── Floating header: filter chips + search + section label (listHeader port) ── */

export function DiscoverHeader({ progress, count, compact = false }) {
  const y = useTransform(progress, [0.09, 0.17], [-34, 0]);
  const opacity = useTransform(progress, [0.09, 0.15], [0, 1]);
  return (
    <motion.div
      style={{
        ...(compact
          ? { top: -24, left: '50%', x: '-50%', width: 'min(88vw, 356px)' }
          : { top: -28, left: -48, width: 356 }),
        position: 'absolute', y, opacity, zIndex: 20,
        ...FLOAT_CARD, padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
        fontFamily: t.font,
      }}
    >
      <div style={{ display: 'flex', gap: 8, overflow: 'hidden' }}>
        <Chip label="Open Now" />
        <Chip label="Visited" icon="checkmark-circle" />
        <Chip label="Nearest" trailing="▾" />
        {!compact && <Chip label="Filters" icon="options-outline" />}
      </div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10, background: 'transparent',
          border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 14px',
        }}
      >
        <span style={{ flex: 1, fontSize: 14, fontWeight: w.light, color: MUTED }}>Search gyms, classes...</span>
        <Ion name="search-outline" size={16} color={MUTED} />
      </div>
      <div style={{ fontSize: 9, fontWeight: w.medium, letterSpacing: 2, color: MUTED, textTransform: 'uppercase', paddingLeft: 2 }}>
        {count.toLocaleString()} PARTNERS · NEAREST
      </div>
    </motion.div>
  );
}

function Chip({ label, icon, trailing }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 5, padding: '9px 14px', borderRadius: 20,
        border: `1px solid ${BORDER}`, background: CARD_BG, whiteSpace: 'nowrap',
      }}
    >
      {icon && <Ion name={icon} size={13} color={DIM} />}
      <span style={{ fontSize: 12, fontWeight: w.regular, color: DIM }}>{label}</span>
      {trailing && <span style={{ fontSize: 10, color: DIM }}>{trailing}</span>}
    </div>
  );
}

/* ── Floating partner list: three real PartnerListRow ports ── */

export function PartnerList({ progress, partners }) {
  const x = useTransform(progress, [0.17, 0.27], [-90, 0]);
  const opacity = useTransform(progress, [0.17, 0.25], [0, 1]);
  const rows = partners.slice(0, 3);
  return (
    <motion.div
      style={{
        position: 'absolute', bottom: -34, left: -60, width: 384, x, opacity, zIndex: 20,
        ...FLOAT_CARD, padding: '2px 16px', fontFamily: t.font,
      }}
    >
      {rows.map((p, i) => (
        <div
          key={`${p.name}-${i}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 14, padding: '14px 4px',
            borderBottom: i < rows.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
          }}
        >
          <div
            style={{
              width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden',
              // white-bg logos vanish on the dark card — give them the app's white logo-card chip
              background: p.logo && p.logoBg === 'white' ? '#FFFFFF' : 'transparent',
              borderRadius: p.logo && p.logoBg === 'white' ? 12 : 0,
            }}
          >
            {p.logo ? (
              <img src={p.logo} alt={p.name} style={{ width: '78%', height: '78%', objectFit: 'contain' }} />
            ) : (
              <span style={{ fontSize: 12, fontWeight: w.bold, color: DIM, textAlign: 'center' }}>{p.name.split(' ')[0]}</span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ fontSize: 15, fontWeight: w.regular, color: t.text, letterSpacing: -0.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {p.name}
            </div>
            <div style={{ fontSize: 11, fontWeight: w.light, color: DIM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {p.openNow ? 'Open now' : 'Closed'} · {p.area}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, minWidth: 52, gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: w.regular, color: t.text, letterSpacing: -0.2 }}>{p.distance}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Ion name={i === 0 ? 'star' : 'star-outline'} size={15} color={i === 0 ? t.accent : DIM} />
              <Ion name="chevron-forward" size={14} color={DIM} />
            </span>
          </div>
        </div>
      ))}
    </motion.div>
  );
}

/* ── Map art — the app's DARK_MAP_STYLE palette on a stylised central London ──
   geometry #1c1c1e · water #131314 · road #282828 · highway #2e2e2e/#383838 */

function MapArt() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 620 760" preserveAspectRatio="xMidYMid slice" style={{ display: 'block', background: '#1c1c1e' }}>
      {/* Thames — sweeping S through the middle */}
      <path
        d="M-30 420 C 90 470, 170 380, 290 400 S 480 480, 660 430 L 660 510 C 500 560, 400 470, 290 478 S 90 550, -30 500 Z"
        fill="#131314"
      />
      {/* City blocks */}
      <g fill="#212124">
        <rect x="40" y="46" width="110" height="84" rx="6" />
        <rect x="190" y="60" width="128" height="70" rx="6" />
        <rect x="360" y="40" width="96" height="102" rx="6" />
        <rect x="492" y="70" width="100" height="86" rx="6" />
        <rect x="60" y="180" width="94" height="92" rx="6" />
        <rect x="196" y="170" width="120" height="76" rx="6" />
        <rect x="352" y="184" width="118" height="88" rx="6" />
        <rect x="508" y="196" width="84" height="72" rx="6" />
        <rect x="44" y="310" width="122" height="70" rx="6" />
        <rect x="210" y="292" width="96" height="84" rx="6" />
        <rect x="348" y="306" width="104" height="66" rx="6" />
        <rect x="60" y="560" width="104" height="80" rx="6" />
        <rect x="206" y="548" width="128" height="92" rx="6" />
        <rect x="384" y="560" width="96" height="76" rx="6" />
        <rect x="516" y="548" width="76" height="88" rx="6" />
        <rect x="90" y="672" width="130" height="70" rx="6" />
        <rect x="300" y="680" width="110" height="62" rx="6" />
        <rect x="452" y="668" width="120" height="74" rx="6" />
      </g>
      <g fill="#1f1f22">
        <rect x="330" y="86" width="20" height="48" rx="4" />
        <rect x="166" y="196" width="22" height="52" rx="4" />
        <rect x="476" y="310" width="90" height="58" rx="6" />
        <rect x="172" y="310" width="26" height="60" rx="4" />
        <rect x="340" y="600" width="30" height="40" rx="4" />
      </g>

      {/* Highways — #2e2e2e with #383838 edges */}
      <g strokeLinecap="round" fill="none">
        <path d="M-20 160 C 140 150, 420 168, 640 152" stroke="#383838" strokeWidth="13" />
        <path d="M-20 160 C 140 150, 420 168, 640 152" stroke="#2e2e2e" strokeWidth="9" />
        <path d="M330 -20 C 336 200, 322 520, 336 780" stroke="#383838" strokeWidth="13" />
        <path d="M330 -20 C 336 200, 322 520, 336 780" stroke="#2e2e2e" strokeWidth="9" />
      </g>

      {/* Primary roads */}
      <g stroke="#282828" strokeWidth="6" strokeLinecap="round" fill="none">
        <path d="M-20 290 C 160 300, 430 282, 640 296" />
        <path d="M-20 650 C 180 640, 420 660, 640 646" />
        <path d="M120 -20 C 112 240, 128 540, 116 780" />
        <path d="M500 -20 C 508 240, 492 520, 504 780" />
      </g>

      {/* Secondary roads */}
      <g stroke="#232325" strokeWidth="2.5" fill="none">
        <line x1="220" y1="-10" x2="226" y2="770" />
        <line x1="420" y1="-10" x2="414" y2="770" />
        <line x1="60" y1="-10" x2="54" y2="770" />
        <line x1="574" y1="-10" x2="580" y2="770" />
        <path d="M-10 92 L 630 86" />
        <path d="M-10 226 L 630 232" />
        <path d="M-10 360 L 630 352" />
        <path d="M-10 540 L 630 546" />
        <path d="M-10 706 L 630 712" />
      </g>

      {/* Bridges over the river */}
      <g stroke="#282828" strokeWidth="5" strokeLinecap="round">
        <line x1="120" y1="430" x2="118" y2="512" />
        <line x1="332" y1="398" x2="334" y2="482" />
        <line x1="502" y1="438" x2="500" y2="512" />
      </g>
    </svg>
  );
}
