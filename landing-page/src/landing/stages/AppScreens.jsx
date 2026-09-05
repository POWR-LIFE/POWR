import { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { pg, w } from '../theme';
import PhoneFrame from '../PhoneFrame';
import { SectionTag, useCompact } from './shared';

/**
 * Inside the app — a sticky horizontal filmstrip of REAL screens (captured
 * from the shipped app, see /public/app). The five acts show what POWR does;
 * this is the one place the visitor sees what it looks like. Phones travel
 * right→left as the section scrolls; each one brightens as it crosses centre.
 */
const SCREENS = [
  { src: '/app/home.webp', tag: 'HOME', title: 'Your day, scored live.', body: 'Streak, rings, level and crew — one glance.' , top: '#2d2d2d' },
  { src: '/app/progress.webp', tag: 'PROGRESS', title: 'Every session, mapped.', body: 'Gym, run, walk, body and sleep, by day, week or month.', top: '#2d2d2d' },
  { src: '/app/spend.webp', tag: 'SPEND', title: 'The partner vault.', body: 'Real brands, priced in points. Redeem in one tap.', top: '#2d2d2d' },
  { src: '/app/wallet.webp', tag: 'WALLET', title: 'Codes, ready at checkout.', body: 'Every redeemed reward lives here until you use it.', top: '#171717' },
  { src: '/app/together.webp', tag: 'TOGETHER', title: 'Race your crew.', body: 'Shared challenges with a group bonus for finishing together.', top: '#171717' },
  { src: '/app/profile.webp', tag: 'PROFILE', title: 'Levels, streaks, achievements.', body: 'Twenty levels to climb. Your POWR ID invites friends.', top: '#2d2d2d' },
  { src: '/app/activity.webp', tag: 'ACTIVITY', title: 'Every point, receipted.', body: 'Level-ups, unlocks and rewards, as they happen.', top: '#171717' },
];

export default function AppScreens() {
  const ref = useRef(null);
  const compact = useCompact();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });

  // Sized so header + phone + caption fit an 844px-tall phone viewport and a
  // 900px-tall laptop without the strip running under the header
  const phoneW = compact ? 196 : 226;
  const gap = compact ? 26 : 44;
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
  const x = useTransform(scrollYProgress, [0.06, 0.94], [startX, endX]);

  const headOpacity = useTransform(scrollYProgress, [0, 0.06, 0.9, 1], [0, 1, 1, 0]);

  return (
    <section ref={ref} style={{ position: 'relative', height: compact ? '300vh' : '320vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        {/* Header — pinned top-left, reads over the strip */}
        <motion.div
          style={{
            position: 'absolute', top: compact ? 84 : 104, left: 'clamp(22px, 4vw, 72px)', right: 'clamp(22px, 4vw, 72px)',
            zIndex: 5, opacity: headOpacity, pointerEvents: 'none',
          }}
        >
          <SectionTag>INSIDE THE APP</SectionTag>
          <div
            style={{
              fontSize: compact ? 'clamp(24px, 6.4vw, 32px)' : 'clamp(30px, 3.2vw, 44px)', fontWeight: w.extraLight,
              letterSpacing: -1, lineHeight: 1.08, color: pg.text, maxWidth: 720,
            }}
          >
            Everything above, in your pocket.
          </div>
          <p style={{ marginTop: 10, color: pg.textSec, fontSize: compact ? 13.5 : 15, lineHeight: 1.5, fontWeight: w.light, maxWidth: 440 }}>
            {compact ? 'Real screens from the shipped app.' : 'Real screens from the shipped app. Keep scrolling — the phones move.'}
          </p>
        </motion.div>

        {/* The strip */}
        <motion.div
          style={{
            position: 'absolute', left: 0, top: compact ? 'max(236px, 27vh)' : 'max(268px, 30vh)', x,
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

function Screen({ screen, index, phoneW, gap, x, vw, compact }) {
  // Where this phone's centre sits relative to the viewport centre
  const centre = useTransform(x, (v) => v + index * (phoneW + gap) + phoneW / 2 - vw / 2);
  const focus = useTransform(centre, [-vw * 0.45, 0, vw * 0.45], [0, 1, 0]);
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
        <div style={{ marginTop: 6, color: pg.textSec, fontSize: compact ? 12.5 : 13.5, fontWeight: w.light, lineHeight: 1.45, maxWidth: phoneW + 40 }}>{screen.body}</div>
      </motion.div>
    </motion.div>
  );
}
