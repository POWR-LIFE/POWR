import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { pg, w } from './theme';
import { StoreBadges } from './stages/shared';
import { LOGO_SRC } from './LogoMorph';

/**
 * The live landing page's video hero, made cinematic:
 *  - entrance: badge → logo → headline words → copy → badges stagger in
 *  - exit: scroll-driven push-in on the video while the content lifts away,
 *    so the hero hands off to the Move act instead of just ending.
 */
const VIDEO_SRC = 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/landing_hero.mp4';

const EASE = [0.16, 1, 0.3, 1];

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.25 } },
};
const rise = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 1.0, ease: EASE } },
};
const word = {
  hidden: { opacity: 0, y: '0.6em' },
  show: { opacity: 1, y: 0, transition: { duration: 0.9, ease: EASE } },
};

function Words({ text, style }) {
  const parts = text.split(' ');
  return parts.map((part, i) => (
    // Trailing spaces collapse inside the overflow-hidden mask, so word
    // separation comes from a margin instead
    <span
      key={i}
      style={{
        display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom',
        marginRight: i < parts.length - 1 ? '0.26em' : 0,
      }}
    >
      <motion.span variants={word} style={{ display: 'inline-block', ...style }}>
        {part}
      </motion.span>
    </span>
  ));
}

export default function Hero() {
  const ref = useRef(null);
  // How far the hero has scrolled off the top of the viewport
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });

  const videoScale = useTransform(scrollYProgress, [0, 1], [1.15, 1.32]);
  const videoOpacity = useTransform(scrollYProgress, [0.55, 1], [1, 0.35]);
  const contentY = useTransform(scrollYProgress, [0, 1], [0, -160]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.55], [1, 0]);

  return (
    <section ref={ref} style={{ position: 'relative', height: '100vh', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
      <motion.video
        autoPlay muted loop playsInline preload="auto"
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover', scale: videoScale, opacity: videoOpacity, zIndex: 0,
        }}
      >
        <source src={VIDEO_SRC} type="video/mp4" />
      </motion.video>

      {/* Overlay into the page bg */}
      <div
        style={{
          position: 'absolute', inset: 0, zIndex: 1,
          background: `linear-gradient(to bottom, rgba(8,8,8,0.5) 0%, rgba(8,8,8,0.35) 40%, rgba(8,8,8,0.85) 85%, ${pg.bg} 100%)`,
        }}
      />

      {/* Crown glow */}
      <div
        style={{
          position: 'absolute', top: -200, left: '50%', width: 800, height: 800, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(232,210,0,0.1) 0%, transparent 70%)',
          pointerEvents: 'none', zIndex: 2, animation: 'powrGlow 6s ease-in-out infinite alternate',
        }}
      />

      {/* Content */}
      <motion.div
        variants={stagger} initial="hidden" animate="show"
        style={{
          position: 'relative', zIndex: 3, width: '100%', maxWidth: 1200, margin: '0 auto', padding: '0 clamp(22px, 3vw, 28px)',
          y: contentY, opacity: contentOpacity,
        }}
      >
        <motion.div
          variants={rise}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 12,
            background: 'rgba(232,210,0,0.03)', border: '1px solid rgba(232,210,0,0.35)',
            borderRadius: 40, padding: '10px 24px 10px 18px',
            fontSize: 11, fontWeight: w.semiBold, letterSpacing: 2, textTransform: 'uppercase',
            color: pg.accent, marginBottom: 30,
          }}
        >
          <span
            style={{
              width: 7, height: 7, borderRadius: '50%', background: pg.accent,
              boxShadow: '0 0 0 0 rgba(232,210,0,0.5)', animation: 'powrDot 2s ease-out infinite',
            }}
          />
          Live now
        </motion.div>

        {/* Layout slot only — the visible logo is LogoMorph's fixed img,
            which starts here and docks into the nav on scroll */}
        <img
          id="powr-hero-logo-slot"
          src={LOGO_SRC}
          alt=""
          aria-hidden
          style={{ height: 'clamp(72px, 14vw, 120px)', width: 'auto', display: 'block', marginBottom: 28, visibility: 'hidden' }}
        />

        <h1 style={{ fontSize: 'clamp(40px, 5.5vw, 64px)', fontWeight: w.extraLight, letterSpacing: -1.5, lineHeight: 1.06, color: pg.text, margin: 0 }}>
          <Words text="Your last workout" />
          <br />
          <Words text="earned you nothing." style={{ fontStyle: 'italic', color: pg.textSec }} />
        </h1>

        <motion.p variants={rise} style={{ marginTop: 22, fontSize: 'clamp(15px, 1.6vw, 19px)', color: pg.textSec, fontWeight: w.light, maxWidth: 480 }}>
          POWR makes sure it counts. Every gym session, run, walk and ride — rewarded.
        </motion.p>

        <motion.div variants={rise} style={{ marginTop: 34 }}>
          <StoreBadges />
        </motion.div>
      </motion.div>

      {/* Scroll indicator */}
      <motion.div
        style={{
          position: 'absolute', bottom: 30, left: '50%', x: '-50%', zIndex: 3, opacity: contentOpacity,
          width: 22, height: 36, borderRadius: 12, border: `1.5px solid ${pg.textMuted}`,
          display: 'flex', justifyContent: 'center', paddingTop: 7,
        }}
      >
        <div style={{ width: 3, height: 7, borderRadius: 2, background: pg.accent, animation: 'powrBob 1.6s ease-in-out infinite' }} />
      </motion.div>
    </section>
  );
}
