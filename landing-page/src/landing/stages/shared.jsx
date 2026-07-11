import { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { pg, w } from '../theme';

/*
 * Compact = the stage can't afford side columns (phones / narrow tablets).
 * Every act reads this and swaps its side-column layout for a bottom copy
 * dock + centred stage, so mobile gets the full film, not a cut-down one.
 */
export function useCompact(bp = 1080) {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${bp}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const onChange = (e) => setCompact(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [bp]);
  return compact;
}

/* Small gold section tag, e.g. "01 — MOVE" */
export function SectionTag({ children, style }) {
  return (
    <div style={{ color: pg.accent, fontSize: 12, fontWeight: w.semiBold, letterSpacing: 3, marginBottom: 16, ...style }}>
      {children}
    </div>
  );
}

/* A crossfading copy block tied to a scroll range [in, peakIn, peakOut, out] */
export function CopyPanel({ panel, progress, compact = false }) {
  const [a, b, c, d] = panel.range;
  const opacity = useTransform(progress, [a, b, c, d], [0, 1, 1, 0]);
  const y = useTransform(progress, [a, d], [22, -22]);
  return (
    <motion.div style={{ position: 'absolute', opacity, y, width: '100%' }}>
      <div
        style={{
          fontSize: compact ? 'clamp(21px, 5.6vw, 26px)' : 'clamp(26px, 2.8vw, 38px)',
          fontWeight: w.light, letterSpacing: compact ? -0.6 : -1, lineHeight: 1.12, color: pg.text,
        }}
      >
        {panel.title}
      </div>
      <p style={{ marginTop: compact ? 8 : 16, color: pg.textSec, fontSize: compact ? 13.5 : 15, lineHeight: 1.5, fontWeight: w.light }}>
        {panel.body}
      </p>
    </motion.div>
  );
}

/*
 * Mobile copy dock — the compact stand-in for the desktop side columns.
 * Sits over the bottom of the sticky stage with its own scrim so the beat
 * copy stays readable over whatever is animating behind it.
 */
export function MobileCopyDock({ tag, tagOpacity, children, height = 148 }) {
  return (
    <>
      {/* Scrim so copy reads over the stage */}
      <div
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: height + 110,
          background: `linear-gradient(180deg, rgba(8,8,8,0) 0%, rgba(8,8,8,0.82) 45%, ${pg.bg} 100%)`,
          zIndex: 34, pointerEvents: 'none',
        }}
      />
      <motion.div
        style={{
          position: 'absolute', left: 22, right: 22, bottom: 'max(20px, env(safe-area-inset-bottom))',
          zIndex: 35, opacity: tagOpacity,
        }}
      >
        <SectionTag style={{ marginBottom: 10, fontSize: 10.5, letterSpacing: 2.6 }}>{tag}</SectionTag>
        <div style={{ position: 'relative', height }}>{children}</div>
      </motion.div>
    </>
  );
}

/*
 * Chapter break — a film title card between acts. The act number ghosts
 * behind, the word lands solid, a gold hairline draws underneath. Gives the
 * scroll a breath between dense stages and makes the acts read as chapters.
 */
export function ChapterBreak({ n, word, kicker }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });

  const opacity = useTransform(scrollYProgress, [0.22, 0.42, 0.58, 0.78], [0, 1, 1, 0]);
  const scale = useTransform(scrollYProgress, [0.22, 0.5, 0.78], [0.94, 1, 1.05]);
  const ghostY = useTransform(scrollYProgress, [0, 1], [70, -70]);
  const lineScaleX = useTransform(scrollYProgress, [0.3, 0.52], [0, 1]);
  const kickerOpacity = useTransform(scrollYProgress, [0.36, 0.5, 0.6, 0.78], [0, 1, 1, 0]);

  return (
    <section
      ref={ref}
      style={{
        height: '110vh', position: 'relative', display: 'flex', alignItems: 'center',
        justifyContent: 'center', overflow: 'hidden',
      }}
    >
      {/* Giant ghost act number */}
      <motion.div
        aria-hidden
        style={{
          position: 'absolute', y: ghostY, fontSize: 'clamp(280px, 44vw, 620px)', fontWeight: w.extraLight,
          lineHeight: 1, color: 'transparent', WebkitTextStroke: '1px rgba(232,210,0,0.07)',
          userSelect: 'none', pointerEvents: 'none',
        }}
      >
        {n}
      </motion.div>

      <motion.div style={{ opacity, scale, textAlign: 'center', position: 'relative', padding: '0 24px' }}>
        <div style={{ fontSize: 11, fontWeight: w.semiBold, letterSpacing: 5, color: pg.accent, marginBottom: 18 }}>
          ACT {n}
        </div>
        <div style={{ fontSize: 'clamp(52px, 9vw, 110px)', fontWeight: w.extraLight, letterSpacing: 4, lineHeight: 1, color: pg.text }}>
          {word}
        </div>
        <motion.div
          style={{
            height: 1, background: 'linear-gradient(90deg, transparent, rgba(232,210,0,0.7), transparent)',
            margin: '26px auto 0', width: 'min(320px, 60vw)', scaleX: lineScaleX,
          }}
        />
        {kicker && (
          <motion.div style={{ marginTop: 20, fontSize: 'clamp(13px, 1.4vw, 15px)', color: pg.textSec, fontWeight: w.light, opacity: kickerOpacity }}>
            {kicker}
          </motion.div>
        )}
      </motion.div>
    </section>
  );
}

/*
 * Giant outline "ghost" typography floating behind a stage. Parallaxes at a
 * different rate to the foreground so the black void reads as deep space,
 * not an empty page. Stroke-only so it never competes with real content.
 */
export function GhostWord({ progress, children, top, left, right, bottom, drift = [40, -40], size = 'clamp(150px, 20vw, 300px)', gold = false }) {
  const y = useTransform(progress, [0, 1], drift);
  return (
    <motion.div
      aria-hidden
      style={{
        position: 'absolute', top, left, right, bottom, y, zIndex: 1, pointerEvents: 'none',
        fontSize: size, fontWeight: w.extraLight, letterSpacing: '0.02em', lineHeight: 0.9,
        color: 'transparent', userSelect: 'none', whiteSpace: 'nowrap',
        WebkitTextStroke: gold ? '1px rgba(232,210,0,0.07)' : '1px rgba(255,255,255,0.055)',
      }}
    >
      {children}
    </motion.div>
  );
}

/* Real store badges (ported from index.html hero) */
const APP_STORE = 'https://apps.apple.com/gb/app/powr/id6766784336';
const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.powr.life&pcampaignid=web_share';

export function StoreBadges({ size = 1 }) {
  // Never stack: on narrow screens the pair shrinks to stay side by side
  const tight = useCompact(480);
  const s = size * (tight ? 0.78 : 1);
  return (
    <div style={{ display: 'flex', gap: tight ? 10 : 14, flexWrap: 'nowrap' }}>
      <StoreBadge href={APP_STORE} small="Download on the" large="App Store" size={s}>
        <svg width={24 * s} height={24 * s} viewBox="0 0 384 512" fill="#F2F2F2" aria-hidden>
          <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
        </svg>
      </StoreBadge>
      <StoreBadge href={PLAY_STORE} small="Get it on" large="Google Play" size={s}>
        <svg width={22 * s} height={22 * s} viewBox="0 0 24 24" fill="#F2F2F2" aria-hidden>
          <path d="M7 4v16l13-8z" />
        </svg>
      </StoreBadge>
    </div>
  );
}

function StoreBadge({ href, small, large, size, children }) {
  return (
    <a
      href={href} target="_blank" rel="noopener"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 12,
        padding: `${10 * size}px ${20 * size}px`,
        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: 14, textDecoration: 'none',
      }}
    >
      {children}
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
        <span style={{ fontSize: 9 * size, fontWeight: w.medium, letterSpacing: 0.8, color: pg.textSec, textTransform: 'uppercase' }}>
          {small}
        </span>
        <span style={{ fontSize: 15 * size, fontWeight: w.semiBold, color: pg.text }}>{large}</span>
      </span>
    </a>
  );
}
