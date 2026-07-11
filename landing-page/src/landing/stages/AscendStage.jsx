import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { pg, w } from '../theme';
import Ion from '../Ionicon';
import { SectionTag, GhostWord, useCompact } from './shared';

/**
 * Act V — Become. The 20-level identity system as a cinematic procession:
 * the real level artwork (Supabase powr-level-logo bucket — 3D POWR marks
 * in holo chrome, neon, glass, cloud, gold) travels HORIZONTALLY through a
 * centre spotlight one level at a time — in from the right, seated, out to
 * the left, matching the film's travel motif — name + tier + threshold
 * landing under each. The LEGEND tier stays classified — silhouettes
 * against their own glow — so the top of the ladder is something you earn,
 * not something we show you.
 *
 * Levels mirror constants/levels.ts (names, tiers, xpMin, textColor) — do
 * not drift.
 *
 * Artwork lives in public/levels/ — true-alpha versions of the bucket art
 * (the originals sit on near-opaque black plates that ghost against the
 * canvas; scratch unpremult.py bakes alpha = max(r,g,b), unpremultiplied).
 */
const IMG = '/levels/';

const BEATS = [
  { level: 1,  name: 'Touching Grass',   tier: 'RECRUIT', img: 'touching-grass-1.png',  color: '#FFFFFF', pts: 0 },
  { level: 5,  name: 'Heavy Hitter',     tier: 'RECRUIT', img: 'heavy-hit.png',         color: '#FF6A2C', pts: 4500 },
  { level: 9,  name: 'Step Collector',   tier: 'ATHLETE', img: 'step-collector.png',    color: '#E85CD8', pts: 19000 },
  { level: 15, name: 'Momentum Monster', tier: 'ELITE',   img: 'momentum-monster.png',  color: '#4A9EFF', pts: 77000 },
  { level: 17, name: null,               tier: 'LEGEND',  img: 'diesel-mode.png',       color: '#F5334F', pts: 111000, mystery: true },
  { level: 20, name: null,               tier: 'LEGEND',  img: 'goggins.png',           color: '#E8D200', pts: 182000, mystery: true, final: true },
];

// Tier pill styling — constants/levels.ts R/A/E/L_PILL
const PILL = {
  RECRUIT: { bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.18)', text: 'rgba(255,255,255,0.65)' },
  ATHLETE: { bg: 'rgba(251,146,60,0.12)',  border: 'rgba(251,146,60,0.35)',  text: '#fb923c' },
  ELITE:   { bg: 'rgba(232,210,0,0.14)',   border: 'rgba(232,210,0,0.40)',   text: '#E8D200' },
  LEGEND:  { bg: 'rgba(232,210,0,0.22)',   border: 'rgba(232,210,0,0.60)',   text: '#E8D200' },
};

// Scroll windows: intro beat, then one window per level, final one holds
const INTRO = [0.02, 0.06, 0.10, 0.135];
const FIRST = 0.14;
const WIN = 0.13;
const beatWindow = (i) => {
  const start = FIRST + i * WIN;
  const end = i === BEATS.length - 1 ? 1.0 : start + WIN;
  return [start, end];
};

export default function AscendStage() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const compact = useCompact();

  return (
    <section ref={ref} data-act="become" style={{ position: 'relative', height: '640vh' }}>
      <div
        style={{
          position: 'sticky', top: 0, height: '100vh', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <GhostWord progress={scrollYProgress} top="5%" left="-2%" drift={[80, -80]} gold>
          BECOME
        </GhostWord>

        <IntroBeat progress={scrollYProgress} compact={compact} />

        {BEATS.map((b, i) => (
          <LevelBeat key={b.level} beat={b} window={beatWindow(i)} progress={scrollYProgress} compact={compact} />
        ))}

        <TierRail progress={scrollYProgress} compact={compact} />
      </div>
    </section>
  );
}

/* ── Intro beat — sets up the act before the first badge climbs through ── */
function IntroBeat({ progress, compact }) {
  const [a, b, c, d] = INTRO;
  const opacity = useTransform(progress, [a, b, c, d], [0, 1, 1, 0]);
  const y = useTransform(progress, [a, d], [30, -46]);
  return (
    <motion.div style={{ position: 'absolute', textAlign: 'center', opacity, y, zIndex: 10, padding: '0 26px', maxWidth: 760 }}>
      <SectionTag style={{ letterSpacing: 4, marginBottom: 22 }}>05 — BECOME</SectionTag>
      <div style={{ fontSize: compact ? 'clamp(30px, 8vw, 40px)' : 'clamp(36px, 4.4vw, 58px)', fontWeight: w.extraLight, letterSpacing: -1, lineHeight: 1.12, color: pg.text }}>
        You&rsquo;re not collecting points.
        <br />
        <span style={{ fontStyle: 'italic', color: pg.textSec }}>You&rsquo;re becoming someone.</span>
      </div>
      <p style={{ marginTop: 18, fontSize: compact ? 14 : 16, color: pg.textSec, fontWeight: w.light }}>
        Twenty levels. Four tiers. Every point you ever earn counts towards the climb.
      </p>
    </motion.div>
  );
}

/* ── One level climbing through the spotlight ── */
function LevelBeat({ beat, window: [start, end], progress, compact }) {
  const span = end - start;
  const mid = start + span * 0.5;
  // The final beat parks in the spotlight instead of exiting
  const holdIn = beat.final ? start + span * 0.34 : mid;

  // In from the right, out to the left — the film's horizontal travel
  const travel = compact ? [320, -320] : [440, -440];
  const fin = beat.final;
  const x = useTransform(
    progress,
    fin ? [start, holdIn] : [start, mid, end],
    fin ? [travel[0], 0] : [travel[0], 0, travel[1]],
  );
  const opacity = useTransform(
    progress,
    fin ? [start, start + span * 0.24] : [start, start + span * 0.16, end - span * 0.16, end],
    fin ? [0, 1] : [0, 1, 1, 0],
  );
  const scale = useTransform(
    progress,
    fin ? [start, holdIn] : [start, mid, end],
    fin ? [0.5, 1] : [0.5, 1, 0.5],
  );

  // Caption lands once the badge is seated in the spotlight
  const capA = fin ? holdIn : start + span * 0.3;
  const capOpacity = useTransform(
    progress,
    fin ? [capA, capA + span * 0.12] : [capA, capA + span * 0.1, end - span * 0.26, end - span * 0.16],
    fin ? [0, 1] : [0, 1, 1, 0],
  );
  const capY = useTransform(
    progress,
    fin ? [capA, capA + span * 0.12] : [capA, end - span * 0.16],
    fin ? [18, 0] : [18, -12],
  );

  // Spotlight glow breathes in with the badge, tinted by the level's colour
  const glowOpacity = useTransform(
    progress,
    fin ? [start + span * 0.14, holdIn] : [start + span * 0.14, mid, end - span * 0.14],
    fin ? [0, 1] : [0, 1, 0],
  );

  // Ghost level number counter-drifts against the badge — depth
  const ghostX = useTransform(progress, [start, end], fin ? [-160, 30] : [-200, 200]);
  const ghostOpacity = useTransform(
    progress,
    fin ? [start, mid] : [start + span * 0.1, mid, end - span * 0.1],
    fin ? [0, 1] : [0, 1, 0],
  );

  // Final-beat closing copy, after the classified card lands
  const outroA = start + span * 0.62;
  const outroOpacity = useTransform(progress, [outroA, outroA + span * 0.14], fin ? [0, 1] : [0, 0]);
  const outroY = useTransform(progress, [outroA, outroA + span * 0.14], [16, 0]);

  const badgeSize = compact ? 'min(58vw, 250px)' : 'clamp(240px, 26vw, 330px)';
  const pill = PILL[beat.tier];
  const glowColor = beat.mystery && beat.final ? '#E8D200' : beat.color;

  return (
    <>
      {/* Ghost number, behind everything */}
      <motion.div
        aria-hidden
        style={{
          position: 'absolute', x: ghostX, opacity: ghostOpacity, zIndex: 2, pointerEvents: 'none',
          fontSize: compact ? 'clamp(200px, 58vw, 300px)' : 'clamp(280px, 30vw, 460px)',
          fontWeight: w.extraLight, lineHeight: 1, userSelect: 'none',
          color: 'transparent', WebkitTextStroke: '1px rgba(255,255,255,0.05)',
        }}
      >
        {String(beat.level).padStart(2, '0')}
      </motion.div>

      {/* The badge in its spotlight — flex-centred by the stage, x offsets from there */}
      <motion.div
        style={{
          position: 'absolute', x, opacity, scale, zIndex: 8,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}
      >
        <div style={{ position: 'relative', width: badgeSize, aspectRatio: '1' }}>
          {/* Tinted spotlight behind the badge */}
          <motion.div
            style={{
              position: 'absolute', inset: beat.mystery ? '-58%' : '-42%', borderRadius: '50%',
              opacity: glowOpacity, pointerEvents: 'none',
              background: `radial-gradient(circle, ${glowColor}${beat.mystery ? (beat.final ? '5C' : '42') : '24'}, transparent 62%)`,
              filter: 'blur(8px)',
            }}
          />
          <img
            src={IMG + beat.img}
            alt={beat.name ? `Level ${beat.level} — ${beat.name}` : `Level ${beat.level} — classified`}
            loading="lazy"
            style={{
              position: 'relative', width: '100%', height: '100%', objectFit: 'contain',
              // Classified levels: a smoked silhouette against their own glow
              filter: beat.mystery ? 'brightness(0.07) blur(5px)' : 'none',
            }}
          />
        </div>

        {/* Caption block */}
        <motion.div style={{ opacity: capOpacity, y: capY, textAlign: 'center', marginTop: compact ? 6 : 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 100,
                background: pill.bg, border: `1px solid ${pill.border}`,
                fontSize: 10, fontWeight: w.bold, letterSpacing: 2, color: pill.text,
              }}
            >
              {beat.mystery && <Ion name="lock-closed" size={10} color={pill.text} />}
              {beat.tier}
            </span>
            <span style={{ fontSize: 11, fontWeight: w.medium, letterSpacing: 2.5, color: pg.textMuted }}>
              LEVEL {beat.level}
            </span>
          </div>
          <div
            style={{
              marginTop: 10, fontSize: compact ? 'clamp(26px, 7vw, 34px)' : 'clamp(30px, 3.4vw, 44px)',
              fontWeight: w.light, letterSpacing: beat.mystery ? 10 : -0.8, lineHeight: 1.05,
              color: beat.mystery ? 'rgba(255,255,255,0.38)' : beat.color,
            }}
          >
            {beat.name ?? '?????'}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, fontWeight: w.medium, letterSpacing: 2, color: pg.textMuted, fontVariantNumeric: 'tabular-nums' }}>
            {beat.pts === 0 ? 'WHERE EVERYONE STARTS' : `FROM ${beat.pts.toLocaleString()} PTS`}
          </div>

          {/* The act's closing line, under the final classified badge */}
          {beat.final && (
            <motion.div style={{ opacity: outroOpacity, y: outroY, marginTop: compact ? 18 : 26 }}>
              <div style={{ fontSize: compact ? 16 : 19, fontWeight: w.light, color: pg.text }}>
                Level 20 has a name.
                <span style={{ fontStyle: 'italic', color: pg.accent }}> Earn it.</span>
              </div>
            </motion.div>
          )}
        </motion.div>
      </motion.div>
    </>
  );
}

/* ── Tier rail — 20 ticks lighting up as the climb passes them ── */
const TIERS = [
  { label: 'RECRUIT', from: 1,  to: 5 },
  { label: 'ATHLETE', from: 6,  to: 10 },
  { label: 'ELITE',   from: 11, to: 15 },
  { label: 'LEGEND',  from: 16, to: 20 },
];

function TierRail({ progress, compact }) {
  const railOpacity = useTransform(progress, [INTRO[2], FIRST + 0.02, 0.96, 1], [0, 1, 1, 0]);
  return (
    <motion.div
      style={{
        position: 'absolute', bottom: compact ? 18 : '5.5%', left: '50%', translateX: '-50%',
        zIndex: 12, display: 'flex', alignItems: 'flex-end', gap: compact ? 14 : 26,
        opacity: railOpacity, pointerEvents: 'none',
      }}
    >
      {TIERS.map((tier) => (
        <div key={tier.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: compact ? 5 : 8 }}>
            {Array.from({ length: 5 }, (_, j) => (
              <RailTick key={j} level={tier.from + j} progress={progress} compact={compact} />
            ))}
          </div>
          {!compact && (
            <span style={{ fontSize: 9, fontWeight: w.semiBold, letterSpacing: 2, color: pg.textMuted }}>
              {tier.label}
            </span>
          )}
        </div>
      ))}
    </motion.div>
  );
}

function RailTick({ level, progress, compact }) {
  // A tick lights once the climb has passed its level; classified ticks never fully light
  const litAt = levelToProgress(level);
  const lit = useTransform(progress, [litAt - 0.015, litAt], [0, 1]);
  const classified = level >= 16;
  const bg = useTransform(lit, (v) => {
    const base = classified ? '232,210,0' : '255,255,255';
    const alpha = 0.14 + v * (classified ? 0.55 : 0.7);
    return `rgba(${base},${alpha})`;
  });
  const scaleY = useTransform(lit, [0, 1], [1, 1.8]);
  return <motion.div style={{ width: 2, height: compact ? 10 : 14, borderRadius: 1, background: bg, scaleY, transformOrigin: '50% 100%' }} />;
}

/* Map a level number onto the act's scroll progress via the featured beats */
function levelToProgress(level) {
  const marks = BEATS.map((b, i) => ({ level: b.level, at: beatWindow(i)[0] + WIN * 0.5 }));
  if (level <= marks[0].level) return marks[0].at;
  for (let i = 1; i < marks.length; i++) {
    if (level <= marks[i].level) {
      const lo = marks[i - 1], hi = marks[i];
      return lo.at + ((level - lo.level) / (hi.level - lo.level)) * (hi.at - lo.at);
    }
  }
  return marks[marks.length - 1].at;
}
