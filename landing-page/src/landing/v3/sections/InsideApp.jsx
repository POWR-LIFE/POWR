import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { pg, w } from '../../theme';
import PhoneFrame from '../../PhoneFrame';
import { useCompact } from '../../stages/shared';
import { DrawLine, Eyebrow, Title } from '../ui';

/**
 * Inside the app — the film's sticky filmstrip of REAL screens, on the
 * homepage. The plan above says what POWR does; this is where the visitor
 * sees what it looks like. Six phones travel right→left as the section
 * scrolls, each brightening as it crosses centre. The scroll stays native:
 * nothing is hijacked, the strip simply rides the page.
 *
 * Captures are 390×844 (2x) from scripts/capture-app-screens.cjs; `top` is
 * each screen's own header colour, which the frame's status strip wears.
 */
const GREEN = '#062b28';
export const SCREENS = [
  { src: '/app/home.webp', tag: 'HOME', title: 'Your day, scored live.', body: 'Streak, rings, level, the Series and what you can redeem. One glance.', top: GREEN },
  { src: '/app/series-start.webp', tag: 'THE SERIES', title: 'The start line fills.', body: 'A season of rounds on one board. Bring friends before the gun and Squad Builder is yours.', top: GREEN },
  { src: '/app/progress.webp', tag: 'PROGRESS', title: 'Every session, mapped.', body: 'Gym, run, walk, body and sleep, by day, week or month.', top: GREEN },
  { src: '/app/rewards.webp', tag: 'REWARDS', title: 'The vault, priced in points.', body: 'Real brands at real checkouts. Redeem in one tap.', top: GREEN },
  { src: '/app/wallet.webp', tag: 'WALLET', title: 'Codes, ready at checkout.', body: 'Every redeemed reward lives here until you use it.', top: '#181818' },
  { src: '/app/profile.webp', tag: 'PROFILE', title: 'Level, streak, honours.', body: 'Twenty levels to climb. Your POWR ID invites friends.', top: '#2e2e2e' },
];

export default function InsideApp() {
  const reduce = useReducedMotion();
  if (reduce) return <StaticStrip />;
  return <Strip />;
}

function Strip() {
  const ref = useRef(null);
  const compact = useCompact();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });

  // Sized so header + phone + caption fit an 844px-tall phone viewport and a
  // 900px-tall laptop without the strip running under the header
  // Compact: 184 wide at 25vh leaves the caption clear of the sticky Get-the-App bar on an 844px phone
  const phoneW = compact ? 184 : 226;
  const gap = compact ? 22 : 44;
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440));
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const stripW = SCREENS.length * phoneW + (SCREENS.length - 1) * gap;
  // First phone starts just right of centre; last phone ends just left of it
  const startX = vw / 2 + (compact ? 60 : 140);
  const endX = vw / 2 - stripW - (compact ? 60 : 140) + phoneW;
  const x = useTransform(scrollYProgress, [0.05, 0.95], [startX, endX]);
  const headOpacity = useTransform(scrollYProgress, [0, 0.05, 0.92, 1], [0, 1, 1, 0]);
  const headY = useTransform(scrollYProgress, [0, 0.05], [24, 0]);

  return (
    <section id="app" ref={ref} style={{ position: 'relative', height: compact ? '250vh' : '280vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        {/* Deep layer: a gold pool the focused phone stands in */}
        <div aria-hidden style={{ position: 'absolute', left: '50%', top: '52%', width: 900, height: 700, transform: 'translate(-50%,-50%)', background: 'radial-gradient(ellipse, rgba(232,210,0,0.06), transparent 60%)', pointerEvents: 'none' }} />

        <motion.div
          style={{
            position: 'absolute', top: compact ? 84 : 104, left: 'clamp(22px, 4vw, 72px)', right: 'clamp(22px, 4vw, 72px)',
            zIndex: 5, opacity: headOpacity, y: headY, pointerEvents: 'none',
          }}
        >
          <Eyebrow>Inside the app</Eyebrow>
          {/* Which phone is in focus — on the eyebrow's line, clear of the captions */}
          <div style={{ position: 'absolute', top: 3, right: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
            {SCREENS.map((s, i) => <Dot key={s.src} index={i} phoneW={phoneW} gap={gap} x={x} vw={vw} />)}
          </div>
          <Title size="m" style={{ marginTop: 14, maxWidth: 720 }}>This is what it looks like.</Title>
          <DrawLine width={72} height={2} delay={0.2} style={{ marginTop: 16 }} />
          <p style={{ margin: '12px 0 0', color: pg.textSec, fontSize: compact ? 13.5 : 15, lineHeight: 1.5, fontWeight: w.light, maxWidth: 440 }}>
            {compact ? 'Real screens from the shipped app.' : 'Real screens from the shipped app. Keep scrolling, the phones move.'}
          </p>
        </motion.div>

        <motion.div
          style={{
            position: 'absolute', left: 0, top: compact ? 'max(212px, 25vh)' : 'max(268px, 30vh)', x,
            display: 'flex', gap, alignItems: 'flex-start', willChange: 'transform',
          }}
        >
          {SCREENS.map((s, i) => (
            <Screen key={s.src} screen={s} index={i} phoneW={phoneW} gap={gap} x={x} vw={vw} compact={compact} />
          ))}
        </motion.div>

        {/* Edge fades so phones enter/exit through darkness, not a hard cut */}
        <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4, background: `linear-gradient(90deg, ${pg.bg} 0%, transparent 12%, transparent 88%, ${pg.bg} 100%)` }} />
      </div>
    </section>
  );
}

/* Where a phone's centre sits relative to the viewport centre, −1…1 → focus 0…1 */
function useFocus(x, index, phoneW, gap, vw) {
  const centre = useTransform(x, (v) => v + index * (phoneW + gap) + phoneW / 2 - vw / 2);
  return useTransform(centre, [-vw * 0.45, 0, vw * 0.45], [0, 1, 0]);
}

function Screen({ screen, index, phoneW, gap, x, vw, compact }) {
  const focus = useFocus(x, index, phoneW, gap, vw);
  const scale = useTransform(focus, [0, 1], [0.9, 1]);
  const opacity = useTransform(focus, [0, 1], [0.42, 1]);
  const y = useTransform(focus, [0, 1], [18, 0]);
  const captionOpacity = useTransform(focus, [0.55, 1], [0, 1]);
  const captionY = useTransform(focus, [0.55, 1], [10, 0]);
  const glow = useTransform(focus, [0.6, 1], [0, 0.55]);

  return (
    <motion.div style={{ width: phoneW, scale, opacity, y, position: 'relative', flexShrink: 0 }}>
      <motion.div
        aria-hidden
        style={{
          position: 'absolute', left: '50%', top: '40%', x: '-50%', y: '-50%', width: phoneW * 1.6, height: phoneW * 1.6, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(232,210,0,0.16) 0%, transparent 62%)', opacity: glow, pointerEvents: 'none',
        }}
      />
      <PhoneFrame src={screen.src} alt={`POWR app — ${screen.tag}`} width={phoneW} topColor={screen.top} />
      <motion.div style={{ marginTop: compact ? 18 : 24, opacity: captionOpacity, y: captionY, paddingLeft: 4 }}>
        <div style={{ color: pg.accent, fontSize: 11, fontWeight: w.semiBold, letterSpacing: 3 }}>{screen.tag}</div>
        <div style={{ marginTop: 6, color: pg.text, fontSize: compact ? 17 : 20, fontWeight: w.light, letterSpacing: -0.4, lineHeight: 1.15 }}>{screen.title}</div>
        <div style={{ marginTop: 6, color: pg.textSec, fontSize: compact ? 12 : 13.5, fontWeight: w.light, lineHeight: 1.45, maxWidth: phoneW + 40 }}>{screen.body}</div>
      </motion.div>
    </motion.div>
  );
}

function Dot({ index, phoneW, gap, x, vw }) {
  const focus = useFocus(x, index, phoneW, gap, vw);
  const width = useTransform(focus, [0, 1], [5, 18]);
  const opacity = useTransform(focus, [0, 1], [0.25, 1]);
  const background = useTransform(focus, [0.5, 1], ['rgba(255,255,255,1)', 'rgba(232,210,0,1)']);
  return <motion.span aria-hidden style={{ height: 5, borderRadius: 999, width, opacity, background }} />;
}

/* Reduced motion: the same six screens as a row the visitor scrolls sideways. */
function StaticStrip() {
  const compact = useCompact();
  const phoneW = compact ? 196 : 226;
  return (
    <section id="app" style={{ position: 'relative', padding: 'clamp(80px, 10vw, 150px) 0' }}>
      <div style={{ padding: '0 clamp(22px, 4vw, 72px)', maxWidth: 1200, margin: '0 auto 40px' }}>
        <Eyebrow>Inside the app</Eyebrow>
        <Title size="m" style={{ marginTop: 14 }}>This is what it looks like.</Title>
        <p style={{ margin: '12px 0 0', color: pg.textSec, fontSize: 15, lineHeight: 1.5, fontWeight: w.light, maxWidth: 440 }}>Real screens from the shipped app.</p>
      </div>
      <div style={{ display: 'flex', gap: 32, overflowX: 'auto', padding: '0 clamp(22px, 4vw, 72px) 20px', scrollSnapType: 'x mandatory' }}>
        {SCREENS.map((s) => (
          <div key={s.src} style={{ width: phoneW, flexShrink: 0, scrollSnapAlign: 'center' }}>
            <PhoneFrame src={s.src} alt={`POWR app — ${s.tag}`} width={phoneW} topColor={s.top} />
            <div style={{ marginTop: 18, color: pg.accent, fontSize: 11, fontWeight: w.semiBold, letterSpacing: 3 }}>{s.tag}</div>
            <div style={{ marginTop: 6, color: pg.text, fontSize: 18, fontWeight: w.light, letterSpacing: -0.4 }}>{s.title}</div>
            <div style={{ marginTop: 6, color: pg.textSec, fontSize: 13, fontWeight: w.light, lineHeight: 1.45 }}>{s.body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
