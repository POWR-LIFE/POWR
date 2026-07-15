import { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { pg, t, w } from '../theme';
import Ion from '../Ionicon';
import { MapSurface, DiscoverHeader, PartnerList } from '../screens/DiscoverMap';
import { fetchDiscover, fallbackDiscover } from '../screens/discoverData';
import { SectionTag, CopyPanel, GhostWord, MobileCopyDock, useCompact } from './shared';

/**
 * Act I — Move. No phone: the Discover map itself is the stage. A large
 * floating map surface rises out of the hero and docks left; the app's real
 * discover UI (filter/search header, partner rows) and the story outputs
 * (push, verified session, points) float and dock around it. Partner pins,
 * geofence circles and the check-in target are live data.
 */
const PANELS = [
  { range: [0.20, 0.26, 0.36, 0.40], title: 'Every verified gym, on one map.',
    body: 'Thousands of partner gyms, pinned and ready. POWR knows exactly where your points live.' },
  { range: [0.42, 0.48, 0.55, 0.59], title: 'Just show up. We do the rest.',
    body: 'Cross the door and POWR checks you in automatically — no buttons, no QR codes, nothing to fumble with.' },
  { range: [0.61, 0.66, 0.74, 0.78], title: 'Every visit, genuinely counted.',
    body: 'A live, geofence-verified session — real presence at the gym, not a self-reported guess.' },
  { range: [0.80, 0.85, 0.93, 0.97], title: 'Walk out already rewarded.',
    body: 'The session locks and the points land on their own. Your workout finally pays you back.' },
];

export default function MoveStage() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const [discover, setDiscover] = useState(fallbackDiscover);
  const compact = useCompact();

  useEffect(() => {
    fetchDiscover()
      .then(setDiscover)
      .catch(() => { /* keep fallback */ });
  }, []);

  // The map surface rises from the hero seam, then docks left (desktop only —
  // on compact it stays centred with the copy docked beneath it)
  const panelY = useTransform(scrollYProgress, [0, 0.10], [160, 0]);
  const panelScale = useTransform(scrollYProgress, [0, 0.10], [0.94, 1]);
  const panelX = useTransform(scrollYProgress, [0.14, 0.26], [0, compact ? 0 : -230]);

  const copyOpacity = useTransform(scrollYProgress, [0.18, 0.24], [0, 1]);

  // Release everything for the hand-off to the Earn track
  const stageOpacity = useTransform(scrollYProgress, [0.96, 1], [1, 0.4]);

  return (
    <section ref={ref} style={{ position: 'relative', height: '520vh' }}>
      <motion.div
        style={{
          position: 'sticky', top: 0, height: '100vh', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: stageOpacity,
        }}
      >
        {/* Ghost act word — deep background, slower than everything else */}
        <GhostWord progress={scrollYProgress} top="6%" right="-2%" drift={[70, -70]}>MOVE</GhostWord>

        {/* Ambient glow follows the docked map */}
        <motion.div
          style={{
            position: 'absolute', width: compact ? 520 : 860, height: compact ? 520 : 860, borderRadius: '50%', x: panelX,
            background: 'radial-gradient(circle, rgba(232,210,0,0.07), rgba(232,210,0,0) 65%)',
            filter: 'blur(20px)', pointerEvents: 'none',
          }}
        />

        {/* Beat copy — side column on desktop, bottom dock on compact */}
        {compact ? (
          <MobileCopyDock tag="01 — MOVE" tagOpacity={copyOpacity}>
            {PANELS.map((p, i) => (
              <CopyPanel key={i} panel={p} progress={scrollYProgress} compact />
            ))}
          </MobileCopyDock>
        ) : (
          <motion.div
            style={{
              position: 'absolute', right: '8%', top: '50%', y: '-50%', width: 380, maxWidth: '32vw',
              opacity: copyOpacity, zIndex: 30,
            }}
          >
            <SectionTag>01 — MOVE</SectionTag>
            <div style={{ position: 'relative', height: 230 }}>
              {PANELS.map((p, i) => (
                <CopyPanel key={i} panel={p} progress={scrollYProgress} />
              ))}
            </div>
          </motion.div>
        )}

        {/* Map surface + everything docked around it */}
        <motion.div
          style={{
            position: 'relative', x: panelX, y: panelY, scale: panelScale, zIndex: 10,
            width: compact ? 'min(86vw, 430px)' : 'min(44vw, 600px)',
            height: compact ? 'min(52vh, 540px)' : 'min(78vh, 760px)',
            marginTop: compact ? '-14vh' : 0,
          }}
        >
          <div
            style={{
              position: 'absolute', inset: 0, borderRadius: 28,
              border: '1px solid rgba(255,255,255,0.10)',
              boxShadow: '0 50px 90px -28px rgba(0,0,0,0.9), 0 0 90px -18px rgba(232,210,0,0.12)',
            }}
          >
            <MapSurface progress={scrollYProgress} partners={discover.partners} target={discover.target} />
          </div>

          <DiscoverHeader progress={scrollYProgress} count={discover.count} compact={compact} />
          {!compact && <PartnerList progress={scrollYProgress} partners={discover.partners} />}

          <PushToast progress={scrollYProgress} target={discover.target} compact={compact} />
          <SessionCard progress={scrollYProgress} target={discover.target} compact={compact} />
          <PointsBurst progress={scrollYProgress} compact={compact} />
        </motion.div>
      </motion.div>
    </section>
  );
}

/* ── Push notification: drops in over the map's top edge after check-in ── */
function PushToast({ progress, target, compact }) {
  const y = useTransform(progress, [0.48, 0.55], [-170, 0]);
  // Compact: hand off to the session card before it lands in the same spot
  const opacity = useTransform(progress, compact ? [0.48, 0.52, 0.56, 0.60] : [0.48, 0.52, 0.62, 0.67], [0, 1, 1, 0]);
  return (
    <motion.div
      style={{
        // Compact: below the floating header, inside the map surface
        ...(compact
          ? { top: 122, left: '50%', x: '-50%', width: 'min(80vw, 320px)' }
          : { top: -18, right: 26, width: 320 }),
        position: 'absolute', y, opacity, zIndex: 21,
        display: 'flex', gap: 11, alignItems: 'center', padding: 12,
        background: 'rgba(20,20,22,0.92)', backdropFilter: 'blur(14px)',
        border: `1px solid ${t.borderCard}`, borderRadius: 18,
        boxShadow: '0 20px 40px -12px rgba(0,0,0,0.6)',
      }}
    >
      <div style={{ width: 38, height: 38, borderRadius: 9, background: t.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Ion name="flame" size={20} color={t.onAccent} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: w.bold, letterSpacing: 0.5, color: pg.text }}>POWR</span>
          <span style={{ fontSize: 11, color: pg.textMuted }}>now</span>
        </div>
        <div style={{ fontSize: 13, color: pg.text, fontWeight: w.light, lineHeight: 1.3 }}>
          Checked in at <b style={{ fontWeight: w.semiBold }}>{target.name}</b> — session started.
        </div>
      </div>
    </motion.div>
  );
}

/* ── Verified session card: docks over the map's right edge ── */
function SessionCard({ progress, target, compact }) {
  const x = useTransform(progress, [0.56, 0.66], [560, 0]);
  const opacity = useTransform(progress, [0.56, 0.61], [0, 1]);
  const rot = useTransform(progress, [0.56, 0.66], [7, 0]);

  const timer = useTransform(progress, [0.60, 0.90], [0, 47 * 60 + 12]);
  const timerText = useTransform(timer, (s) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`);

  const stampScale = useTransform(progress, [0.70, 0.78], [1.5, 1]);
  const stampOpacity = useTransform(progress, [0.70, 0.76], [0, 1]);
  const stampRot = useTransform(progress, [0.70, 0.78], [-14, -7]);

  const logoBg = target.logoBg === 'white' ? '#FFFFFF' : target.logoBg === 'black' ? '#000000' : '#1a1a1a';

  return (
    <motion.div
      style={{
        ...(compact
          ? { bottom: 86, left: '50%', marginLeft: 'max(-40vw, -152px)', width: 'min(80vw, 304px)' }
          : { bottom: 120, right: -44, width: 304 }),
        position: 'absolute', x, opacity, rotate: rot, zIndex: 22,
        background: 'rgba(24,24,26,0.88)', backdropFilter: 'blur(12px)', border: `1px solid ${t.borderCard}`,
        borderRadius: 18, padding: 16, boxShadow: '0 30px 60px -18px rgba(0,0,0,0.7)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <div
          style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0, overflow: 'hidden',
            background: target.logo ? logoBg : t.accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {target.logo ? (
            <img src={target.logo} alt={target.name} style={{ width: 32, height: 32, objectFit: 'contain' }} />
          ) : (
            <span style={{ color: t.onAccent, fontWeight: w.bold, fontSize: 19 }}>{target.name[0]}</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: pg.text, fontSize: 15, fontWeight: w.semiBold, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {target.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.success }} />
            <span style={{ color: t.success, fontSize: 11, fontWeight: w.medium, letterSpacing: 0.5 }}>SESSION ACTIVE</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <motion.div style={{ color: pg.text, fontSize: 22, fontWeight: w.light, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>
            {timerText}
          </motion.div>
          <div style={{ color: pg.textMuted, fontSize: 9, letterSpacing: 1, fontWeight: w.medium }}>ELAPSED</div>
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${t.borderCard}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: pg.textSec, fontSize: 11, fontWeight: w.light }}>Geofence verified · 25m</span>
        <motion.div
          style={{
            display: 'flex', alignItems: 'center', gap: 6, scale: stampScale, opacity: stampOpacity, rotate: stampRot,
            transformOrigin: 'center', color: t.success, border: `1.5px solid ${t.success}`, borderRadius: 6, padding: '4px 9px',
          }}
        >
          <Ion name="shield-checkmark" size={13} color={t.success} />
          <span style={{ fontSize: 11, fontWeight: w.bold, letterSpacing: 1 }}>VERIFIED</span>
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ── Points burst: pops in at the map's lower-right as the session pays out ── */
function PointsBurst({ progress, compact }) {
  const x = useTransform(progress, [0.80, 0.89], [300, 0]);
  const y = useTransform(progress, [0.80, 0.89], [120, 0]);
  const opacity = useTransform(progress, [0.80, 0.84], [0, 1]);
  const scale = useTransform(progress, [0.80, 0.86, 0.90], [0.7, 1.06, 1]);
  return (
    <motion.div
      style={{
        ...(compact ? { bottom: 14, right: 12 } : { bottom: 30, right: -20 }),
        position: 'absolute', x, y, opacity, scale, zIndex: 23,
        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px',
        background: t.accent, color: t.onAccent, borderRadius: 18,
        boxShadow: '0 24px 50px -14px rgba(232,210,0,0.5)',
      }}
    >
      <Ion name="flame" size={28} color={t.onAccent} />
      <div>
        <div style={{ fontSize: 30, fontWeight: w.bold, lineHeight: 1, letterSpacing: -1 }}>+20</div>
        <div style={{ fontSize: 10, fontWeight: w.bold, letterSpacing: 2, opacity: 0.7 }}>POINTS EARNED</div>
      </div>
    </motion.div>
  );
}
