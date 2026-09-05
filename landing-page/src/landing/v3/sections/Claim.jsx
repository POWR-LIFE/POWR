import { motion } from 'framer-motion';
import { pg, w } from '../../theme';
import { useCompact } from '../../stages/shared';
import { CARD, EASE, Eyebrow, Lede, Reveal, Section, fmt } from '../ui';

/**
 * 01 — The claim. The master positioning line, set as four lines that land
 * one after another, beside the proof of it: every partner gym in the UK
 * as a gold dot. The country draws itself out of the data.
 */
const LINES = [
  { text: 'Strava owns the road.', tone: 'dim' },
  { text: 'Sweatcoin owns the pavement.', tone: 'dim' },
  { text: 'Nobody owns the gym floor.', tone: 'text' },
  { text: 'Until now.', tone: 'gold' },
];

export default function Claim({ stats }) {
  const compact = useCompact(960);
  return (
    <Section
      id="claim"
      style={{ overflow: 'hidden' }}
      inner={{
        display: 'grid', gridTemplateColumns: compact ? '1fr' : '1.15fr 0.85fr',
        gap: compact ? 44 : 64, alignItems: 'center',
      }}
    >
      <div>
        <Reveal><Eyebrow>01 — The claim</Eyebrow></Reveal>
        <div style={{ marginTop: 24 }}>
          {LINES.map((l, i) => (
            <motion.div
              key={l.text}
              initial={{ opacity: 0, y: 26 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.6 }}
              transition={{ duration: 0.9, ease: EASE, delay: 0.14 * i }}
              style={{
                fontSize: compact ? 'clamp(28px, 7.4vw, 40px)' : 'clamp(28px, 3.1vw, 46px)', fontWeight: w.extraLight, letterSpacing: -1.3, lineHeight: 1.12,
                whiteSpace: compact ? 'normal' : 'nowrap',
                color: l.tone === 'gold' ? pg.accent : l.tone === 'text' ? pg.text : 'rgba(255,255,255,0.36)',
                fontStyle: l.tone === 'gold' ? 'italic' : 'normal',
              }}
            >
              {l.text}
            </motion.div>
          ))}
        </div>
        <Reveal delay={0.55} style={{ marginTop: 30 }}>
          <Lede>
            Running has Strava. Steps have Sweatcoin. The place people actually train had nothing.
            POWR verifies you were <em style={{ color: pg.text, fontStyle: 'normal' }}>in the gym</em> — by presence, not a screenshot —
            at {fmt(stats.partners)} partner gyms across the UK. Then it pays.
          </Lede>
        </Reveal>
      </div>

      <Reveal delay={0.2}>
        <MapPanel count={stats.partners} compact={compact} />
      </Reveal>
    </Section>
  );
}

const CITIES = [
  { name: 'Glasgow', x: 40.1, y: 30.4 },
  { name: 'Edinburgh', x: 49.3, y: 29.4 },
  { name: 'Belfast', x: 25.5, y: 45.0 },
  { name: 'Newcastle', x: 62.9, y: 40.6 },
  { name: 'Leeds', x: 63.5, y: 54.2 },
  { name: 'Manchester', x: 57.5, y: 57.8 },
  { name: 'Birmingham', x: 60.5, y: 69.3 },
  { name: 'Cardiff', x: 49.4, y: 80.8 },
  { name: 'London', x: 75.8, y: 80.5 },
];

function MapPanel({ count, compact }) {
  // /gym-map.webp is 1400×1800: every active partner location, rendered
  // 2026-09-05 (scripts in the session scratchpad; re-render when the
  // partner table grows materially). London sits at 75.8% / 80.5%.
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: compact ? 400 : 540, margin: '0 auto', aspectRatio: '7 / 9' }}>
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: '-8%', borderRadius: '50%', pointerEvents: 'none',
          background: 'radial-gradient(circle at 60% 70%, rgba(232,210,0,0.11), transparent 62%)', filter: 'blur(28px)',
        }}
      />
      <img
        src="/gym-map.webp"
        alt={`${fmt(count)} POWR partner gyms across the UK, one dot each`}
        width={1400}
        height={1800}
        loading="lazy"
        decoding="async"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', maxWidth: 'none' }}
      />
      {/* City labels — same projection as the render, so the clusters read as a map */}
      {CITIES.map((c) => (
        <span
          key={c.name}
          aria-hidden
          style={{
            position: 'absolute', left: `${c.x}%`, top: `${c.y}%`, transform: 'translate(8px, -50%)',
            fontSize: compact ? 9 : 10.5, letterSpacing: 1.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.42)', fontWeight: w.medium, whiteSpace: 'nowrap',
          }}
        >
          {c.name}
        </span>
      ))}
      {/* London */}
      <div aria-hidden style={{ position: 'absolute', left: '75.8%', top: '80.5%' }}>
        <span style={{ position: 'absolute', left: -14, top: -14, width: 28, height: 28, borderRadius: '50%', border: '1px solid rgba(232,210,0,0.7)', animation: 'powrPulse 2.6s ease-out infinite' }} />
        <span style={{ position: 'absolute', left: -4, top: -4, width: 8, height: 8, borderRadius: '50%', background: pg.accent, boxShadow: '0 0 14px rgba(232,210,0,0.9)' }} />
      </div>
      <div
        style={{
          position: 'absolute', left: 0, bottom: compact ? -8 : 12, ...CARD, borderRadius: 16, padding: '12px 16px 12px 14px',
          display: 'flex', gap: 14, alignItems: 'center', background: 'rgba(12,12,12,0.86)', backdropFilter: 'blur(8px)',
        }}
      >
        <span style={{ fontSize: 30, fontWeight: w.extraLight, color: pg.text, letterSpacing: -1, lineHeight: 1 }}>{fmt(count)}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10.5, letterSpacing: 2.4, color: pg.accent, fontWeight: w.semiBold }}>PARTNER GYMS</span>
          <span style={{ fontSize: 11.5, color: pg.textSec, fontWeight: w.light }}>Every one pinned. Every one pays.</span>
        </span>
      </div>
    </div>
  );
}
