import { pg, w } from '../../theme';
import { useCompact } from '../../stages/shared';
import PhoneFrame from '../../PhoneFrame';
import { LEVELS } from '../data';
import { CARD, Head, Reveal, Section, fmt } from '../ui';

/**
 * 06 — Together & Become. The social layer and the identity layer in one
 * screen: the League as it is in the app — friends on the same board, a
 * rival to chase — beside the level ladder (legend tier classified) and the
 * seven honours a member keeps for good.
 */
const TIERS = ['Recruit', 'Athlete', 'Elite', 'Legend'];

/* The honours as the app draws them (components/honours/HonourIcon.tsx and
   constants/honours.ts): 64-box line icons, each metal a gradient along the
   diagonal. Lines from series.json → honours. */
const METAL = {
  platinum: ['#FFFFFF', '#E3ECF5', '#A6B6C7', '#F2F7FC'],
  gold: ['#FFF1C2', '#E9C46A', '#B8862B', '#F7DF9A'],
  silver: ['#FFFFFF', '#C7CDD4', '#7E8792', '#E6EAEE'],
  bronze: ['#F8C9A8', '#C9825A', '#8A4B2C', '#E9A985'],
};
const HONOURS = [
  { kind: 'king', name: 'King', line: 'Win a round', tier: 'gold', paths: ['M10 46 L6 20 L21 31 L32 14 L43 31 L58 20 L54 46 Z', 'M10 54 H54'], dots: [[6, 16], [32, 9.5], [58, 16]] },
  { kind: 'power', name: 'Power', line: 'Move most days of the week', tier: 'silver', paths: ['M37 4 L13 36 H30 L26 60 L51 26 H34 Z'] },
  { kind: 'on_fire', name: 'On Fire', line: 'Move every week', tier: 'gold', paths: ['M32 5 C37 17 49 25 49 39 C49 50 41 58 32 58 C23 58 15 50 15 39 C15 30 20 24 24 18 C26 25 28 29 31 31 C34 23 34 13 32 5 Z'] },
  { kind: 'diamond', name: 'Diamond', line: 'Move every day of a round', tier: 'platinum', paths: ['M18 10 H46 L58 25 L32 57 L6 25 Z', 'M6 25 H58 M24 10 L20 25 L32 57 L44 25 L40 10'] },
  { kind: 'wings', name: 'Wings', line: 'Climb the board in a round', tier: 'bronze', rotate: -8, paths: ['M6 40 C10 22 32 10 60 6 C53 15 42 20 31 23 L55 21 C48 28 38 31 28 32 L49 34 C42 40 33 42 24 42 L41 46 C33 51 21 54 12 51 C7 49 5 45 6 40 Z', 'M12 42 C16 32 24 26 31 23'] },
  { kind: 'hive', name: 'The Hive', line: 'Bring friends in', tier: 'silver', paths: ['M46.20 23.80 L53.30 27.90 L53.30 36.10 L46.20 40.20 L39.10 36.10 L39.10 27.90 Z', 'M39.10 36.10 L46.20 40.20 L46.20 48.40 L39.10 52.50 L32.00 48.40 L32.00 40.20 Z', 'M24.90 36.10 L32.00 40.20 L32.00 48.40 L24.90 52.50 L17.80 48.40 L17.80 40.20 Z', 'M17.80 23.80 L24.90 27.90 L24.90 36.10 L17.80 40.20 L10.70 36.10 L10.70 27.90 Z', 'M24.90 11.50 L32.00 15.60 L32.00 23.80 L24.90 27.90 L17.80 23.80 L17.80 15.60 Z', 'M39.10 11.50 L46.20 15.60 L46.20 23.80 L39.10 27.90 L32.00 23.80 L32.00 15.60 Z', 'M32.00 23.80 L39.10 27.90 L39.10 36.10 L32.00 40.20 L24.90 36.10 L24.90 27.90 Z'] },
  { kind: 'strength', name: 'Strength', line: 'Strength sessions, all time', tier: 'gold', paths: ['M8 54 C22 57 38 56 50 53 V19 C49 15 45 12.5 31 10 L27.5 17.5 L30.5 22.5', 'M30.5 22.5 L37 19.5', 'M30.5 22.5 C34.5 24 38.5 24.2 42.5 23.6', 'M42.5 27 C42.3 33 39.5 38 35 42.5', 'M6 41.5 C16 34 30 35.5 38.5 47.5', 'M11.5 48 C16.5 49.5 21 49.6 25.5 49'] },
];

function HonourIcon({ h, size = 34 }) {
  const id = `hn-${h.kind}`;
  const [a, b, c, d] = METAL[h.tier];
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={a} /><stop offset="0.38" stopColor={b} /><stop offset="0.7" stopColor={c} /><stop offset="1" stopColor={d} />
        </linearGradient>
      </defs>
      <g stroke={`url(#${id})`} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" transform={h.rotate ? `rotate(${h.rotate} 32 32)` : undefined}>
        {h.paths.map((p) => <path key={p.slice(0, 12)} d={p} />)}
        {h.dots?.map(([cx, cy]) => <circle key={cx} cx={cx} cy={cy} r="2.6" />)}
      </g>
    </svg>
  );
}

export default function Identity() {
  const compact = useCompact(960);
  return (
    <Section id="identity">
      <Head
        n="06" tag="Together & Become"
        title="Bring your crew. Build your name."
        lede="Friends on the same board, a rival to chase, and an invite race before every round — bring the most friends and Squad Builder is yours. Twenty levels and seven honours turn what you've earned into who you are."
      />
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '0.8fr 1.2fr', gap: compact ? 36 : 56, alignItems: 'center' }}>
        <Reveal amount={0.2} style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ position: 'relative' }}>
            <div aria-hidden style={{ position: 'absolute', inset: '-20% -30%', background: 'radial-gradient(circle, rgba(1,62,55,0.5), transparent 60%)', filter: 'blur(20px)', pointerEvents: 'none' }} />
            <PhoneFrame src="/app/league.webp" alt="The League in POWR — the Autumn Series board, day 4 of 16, with a rival one run ahead" width={compact ? 220 : 250} topColor="#062b28" />
            <div style={{ position: 'absolute', right: compact ? -14 : -84, top: '63%', ...CARD, borderRadius: 14, padding: '10px 14px', background: 'rgba(14,14,14,0.9)', backdropFilter: 'blur(8px)' }}>
              <div style={{ fontSize: 10, letterSpacing: 2.2, color: pg.textMuted, fontWeight: w.semiBold }}>YOUR RIVAL</div>
              <div style={{ fontSize: 22, fontWeight: w.extraLight, color: pg.accent, letterSpacing: -0.6, marginTop: 2 }}>7 <span style={{ fontSize: 12, color: pg.textSec }}>pts ahead</span></div>
              <div style={{ fontSize: 11.5, color: pg.textSec, marginTop: 2 }}>Your friend. One run passes her.</div>
            </div>
          </div>
        </Reveal>

        <Reveal amount={0.2} delay={0.1} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ ...CARD, padding: 'clamp(22px, 2.2vw, 30px)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 11, letterSpacing: 2.6, color: pg.accent, fontWeight: w.semiBold }}>TWENTY LEVELS · FOUR TIERS</span>
              <span style={{ fontSize: 11, color: pg.textMuted }}>lifetime points</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)', gap: compact ? 14 : 10, marginTop: 22 }}>
              {LEVELS.map((l) => (
                <div key={l.level} style={{ textAlign: 'center' }}>
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '1', display: 'grid', placeItems: 'center' }}>
                    <div aria-hidden style={{ position: 'absolute', inset: '10%', borderRadius: '50%', background: `radial-gradient(circle, ${l.color}33, transparent 65%)`, filter: 'blur(10px)' }} />
                    <img
                      src={l.img} alt={l.name || `Level ${l.level}`} loading="lazy" decoding="async"
                      style={{ width: '82%', height: '82%', objectFit: 'contain', position: 'relative', filter: l.name ? 'none' : 'brightness(0.18) contrast(1.2) blur(1.2px)' }}
                    />
                    {!l.name && (
                      <span style={{ position: 'absolute', bottom: '8%', padding: '3px 8px', borderRadius: 999, background: 'rgba(0,0,0,0.7)', border: `1px solid ${l.color}66`, color: l.color, fontSize: 9, letterSpacing: 1.6, fontWeight: w.semiBold }}>CLASSIFIED</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, letterSpacing: 2, color: pg.textMuted, fontWeight: w.semiBold, marginTop: 6 }}>LEVEL {l.level}</div>
                  <div style={{ fontSize: 13, color: l.name ? l.color : pg.textMuted, fontWeight: w.medium, marginTop: 3, letterSpacing: l.name ? 0 : 3 }}>{l.name || '?????'}</div>
                  <div style={{ fontSize: 11, color: pg.textMuted, marginTop: 2 }}>{l.xp ? fmt(l.xp) : '0'} pts</div>
                </div>
              ))}
            </div>
            {/* tier rail */}
            <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: 'repeat(20, 1fr)', gap: 3 }}>
              {Array.from({ length: 20 }, (_, i) => {
                const tier = i < 5 ? 0 : i < 10 ? 1 : i < 15 ? 2 : 3;
                const c = ['rgba(255,255,255,0.35)', '#F2C230', '#4A9EFF', '#E8D200'][tier];
                return <span key={i} style={{ height: 3, borderRadius: 2, background: c, opacity: tier === 3 ? 0.9 : 0.55 }} />;
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              {TIERS.map((t) => <span key={t} style={{ fontSize: 10, letterSpacing: 2, color: pg.textMuted, fontWeight: w.semiBold, textTransform: 'uppercase' }}>{t}</span>)}
            </div>
            <div style={{ marginTop: 18, fontSize: 14, color: pg.textSec, fontWeight: w.light, lineHeight: 1.5 }}>
              Level 20 has a name. <span style={{ color: pg.accent }}>Earn it.</span>
            </div>
          </div>

          {/* The honours: kept for good, shown under your name on the board */}
          <div style={{ ...CARD, padding: 'clamp(18px, 2vw, 24px) clamp(22px, 2.2vw, 30px)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <span style={{ fontSize: 11, letterSpacing: 2.6, color: pg.accent, fontWeight: w.semiBold }}>SEVEN HONOURS · FOUR METALS</span>
              <span style={{ fontSize: 11, color: pg.textMuted, whiteSpace: 'nowrap' }}>under your name, for good</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(4, 1fr)' : 'repeat(7, 1fr)', gap: compact ? '16px 8px' : 8, marginTop: 18 }}>
              {HONOURS.map((h) => (
                <div key={h.kind} style={{ textAlign: 'center' }}>
                  <div style={{ display: 'grid', placeItems: 'center', height: 40 }}><HonourIcon h={h} /></div>
                  <div style={{ fontSize: 12.5, color: pg.text, fontWeight: w.medium, marginTop: 8 }}>{h.name}</div>
                  <div style={{ fontSize: 10.5, color: pg.textMuted, marginTop: 3, lineHeight: 1.35 }}>{h.line}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, fontSize: 12.5, color: pg.textSec, fontWeight: w.light, lineHeight: 1.5 }}>
              Bronze to platinum. Win a round and the crown is gold from the first.
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
