import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { pg, w } from './theme';
import { StoreBadges, useCompact } from './stages/shared';
import { LOGO_SRC } from './LogoMorph';
import PhoneFrame from './PhoneFrame';

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
    // Trailing spaces collapse inside the rise mask, so word separation
    // comes from a margin instead. The mask clips only the bottom edge —
    // the word rises from below — because italic overhangs (the terminal
    // "d" in "earned") extend past the box sides and must not be cut
    <span
      key={i}
      style={{
        display: 'inline-block', clipPath: 'inset(-0.3em -0.35em 0)', verticalAlign: 'bottom',
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
  // The phone lifts faster than the copy and outlives it a touch — parallax
  // depth, and it hands the frame to the Move act's map rather than vanishing
  const phoneY = useTransform(scrollYProgress, [0, 1], [0, -300]);
  const phoneOpacity = useTransform(scrollYProgress, [0.25, 0.7], [1, 0]);
  const compact = useCompact(900);

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

      {/* The app, in hand — the first thing that says "this is a product" */}
      <motion.div
        initial={{ opacity: 0, y: 60, rotate: 0 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.4, ease: EASE, delay: 0.55 }}
        style={
          compact
            ? { position: 'absolute', zIndex: 3, left: '50%', x: '-50%', bottom: '-34vh', y: phoneY, opacity: phoneOpacity }
            : { position: 'absolute', zIndex: 3, right: 'clamp(24px, 7vw, 140px)', top: '50%', y: phoneY, opacity: phoneOpacity }
        }
      >
        <motion.div
          style={{
            perspective: 1600,
            y: compact ? 0 : '-50%',
          }}
        >
          <motion.div
            animate={{ y: [0, -12, 0] }}
            transition={{ duration: 6.5, ease: 'easeInOut', repeat: Infinity }}
            style={{ transformStyle: 'preserve-3d', rotateY: compact ? 0 : -16, rotateX: compact ? 0 : 4, rotate: compact ? 0 : 3 }}
          >
            <PhoneFrame src="/app/home.webp" alt="POWR home screen" width={compact ? 250 : 322} topColor="#2d2d2d" priority />
          </motion.div>
        </motion.div>
        {/* Gold underlight so the phone reads as lit by the product, not the video */}
        <div
          aria-hidden
          style={{
            position: 'absolute', left: '50%', top: compact ? '20%' : '50%', transform: 'translate(-50%, -50%)', width: 640, height: 640, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(232,210,0,0.14) 0%, transparent 60%)', pointerEvents: 'none', zIndex: -1,
          }}
        />
      </motion.div>

      {/* Content */}
      <motion.div
        variants={stagger} initial="hidden" animate="show"
        style={{
          position: 'relative', zIndex: 3, width: '100%', maxWidth: 1200, margin: '0 auto', padding: '0 clamp(22px, 3vw, 28px)',
          y: contentY, opacity: contentOpacity,
          // Copy owns the left ~55% on desktop; the phone owns the right
          paddingRight: compact ? undefined : 'clamp(360px, 38vw, 560px)',
          alignSelf: compact ? 'flex-start' : 'center',
          marginTop: compact ? 'clamp(88px, 14vh, 130px)' : 0,
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
