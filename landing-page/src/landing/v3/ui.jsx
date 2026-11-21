import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { pg, w } from '../theme';

/**
 * Primitives for the homepage. Same canvas as the film (#080808, grain,
 * gold hairlines, extralight Outfit) but built for reading, not scrubbing.
 *
 * Motion has a grammar here, so the page reads as one piece:
 *  - things ARRIVE from a direction (Reveal / Item): copy from the left,
 *    product from the right, lists from below, in cascades (Stagger);
 *  - things DRIFT with the scroll (Parallax, GhostNumeral): the deep layer
 *    moves slower than the page, so the black reads as depth, not void;
 *  - gold rules DRAW themselves (DrawLine) under every title.
 * Everything fires once and then holds still, and all of it collapses to a
 * plain fade when the visitor asks for reduced motion.
 */
export const EASE = [0.16, 1, 0.3, 1];
export const CARD = {
  background: '#121212',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 22,
};
export const GOLD_LINE = 'linear-gradient(90deg, rgba(232,210,0,0) 0%, rgba(232,210,0,0.6) 30%, rgba(232,210,0,0.6) 70%, rgba(232,210,0,0) 100%)';

const OFFSET = { up: { y: 30 }, down: { y: -30 }, left: { x: -48 }, right: { x: 48 }, none: {} };

function arrival(from, dist, scale, reduce) {
  if (reduce) return { hidden: { opacity: 0 }, show: { opacity: 1 } };
  const o = OFFSET[from] || OFFSET.up;
  return {
    hidden: { opacity: 0, x: (o.x || 0) * dist, y: (o.y || 0) * dist, scale: scale ?? 1 },
    show: { opacity: 1, x: 0, y: 0, scale: 1 },
  };
}

/* One element arriving from a direction, once, as it scrolls into view. */
export function Reveal({ children, delay = 0, from = 'up', dist = 1, y, scale, amount = 0.25, duration = 0.9, style, className }) {
  const reduce = useReducedMotion();
  const v = arrival(from, y != null ? y / 30 : dist, scale, reduce);
  return (
    <motion.div
      className={className}
      initial={v.hidden}
      whileInView={v.show}
      viewport={{ once: true, amount }}
      transition={{ duration, ease: EASE, delay }}
      style={style}
    >
      {children}
    </motion.div>
  );
}

/* A cascade: the container fires once in view, its Items follow in order. */
export function Stagger({ children, gap = 0.1, delay = 0, amount = 0.2, style, className, as = 'div' }) {
  const Tag = motion[as] || motion.div;
  return (
    <Tag
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: delay } } }}
      style={style}
    >
      {children}
    </Tag>
  );
}

export function Item({ children, from = 'up', dist = 1, scale, duration = 0.85, style, className, as = 'div' }) {
  const reduce = useReducedMotion();
  const Tag = motion[as] || motion.div;
  const v = arrival(from, dist, scale, reduce);
  return (
    <Tag className={className} variants={{ hidden: v.hidden, show: { ...v.show, transition: { duration, ease: EASE } } }} style={style}>
      {children}
    </Tag>
  );
}

/*
 * Scroll drift. The outer div is measured (no transform on it, so the
 * measurement never chases itself); the inner one moves from y[0] to y[1]
 * as the element crosses the viewport.
 */
export function Parallax({ children, y = [40, -40], x = [0, 0], style, inner, className }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const yv = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : y);
  const xv = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : x);
  return (
    <div ref={ref} className={className} style={style}>
      <motion.div style={{ y: yv, x: xv, willChange: 'transform', ...inner }}>{children}</motion.div>
    </div>
  );
}

/*
 * Giant outline numeral behind a section head — the film's ghost act
 * numbers, brought inline so they cost no scroll. Stroke only, gold at 7%,
 * drifting slower than the page.
 */
export function GhostNumeral({ n, center = false, size = 'clamp(150px, 22vw, 320px)', style }) {
  return (
    <Parallax
      y={[70, -70]}
      style={{
        position: 'absolute', top: '-0.22em', zIndex: 0, pointerEvents: 'none', userSelect: 'none',
        fontSize: size, lineHeight: 1,
        ...(center ? { left: '50%', transform: 'translateX(-50%)' } : { right: '-0.04em' }),
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'block', fontSize: 'inherit', fontWeight: w.extraLight, lineHeight: 1, letterSpacing: '-0.02em',
          color: 'transparent', WebkitTextStroke: '1px rgba(232,210,0,0.085)', whiteSpace: 'nowrap',
        }}
      >
        {n}
      </span>
    </Parallax>
  );
}

/* Outline word floating behind a stage, white at 5% — depth, never content. */
export function GhostWord({ children, top, left, right, bottom, drift = [50, -50], size = 'clamp(72px, 16vw, 220px)', gold = false, style }) {
  return (
    <Parallax y={drift} style={{ position: 'absolute', top, left, right, bottom, zIndex: 0, pointerEvents: 'none', userSelect: 'none', ...style }}>
      <span
        aria-hidden
        style={{
          display: 'block', fontSize: size, fontWeight: w.extraLight, letterSpacing: '0.02em', lineHeight: 0.9, whiteSpace: 'nowrap',
          color: 'transparent', WebkitTextStroke: gold ? '1px rgba(232,210,0,0.07)' : '1px rgba(255,255,255,0.05)',
        }}
      >
        {children}
      </span>
    </Parallax>
  );
}

/* A gold rule that draws itself from the left (or the centre) as it enters. */
export function DrawLine({ width = '100%', height = 1, origin = 'left', delay = 0, duration = 1.2, soft = false, style }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      aria-hidden
      initial={{ scaleX: reduce ? 1 : 0, opacity: reduce ? 1 : 0.4 }}
      whileInView={{ scaleX: 1, opacity: 1 }}
      viewport={{ once: true, amount: 0.6 }}
      transition={{ duration, ease: EASE, delay }}
      style={{
        width, height, transformOrigin: origin === 'center' ? '50% 50%' : '0 50%',
        background: soft ? GOLD_LINE : 'linear-gradient(90deg, rgba(232,210,0,0.85), rgba(232,210,0,0.25))',
        ...style,
      }}
    />
  );
}

export function Section({ id, children, style, inner, tight = false }) {
  return (
    <section
      id={id}
      style={{
        position: 'relative', overflowX: 'clip',
        padding: tight ? 'clamp(48px, 6vw, 84px) clamp(20px, 4vw, 48px)' : 'clamp(80px, 10vw, 150px) clamp(20px, 4vw, 48px)',
        ...style,
      }}
    >
      <div style={{ maxWidth: 1200, margin: '0 auto', position: 'relative', ...inner }}>{children}</div>
    </section>
  );
}

export function Eyebrow({ children, style }) {
  return (
    <div style={{ color: pg.accent, fontSize: 12, fontWeight: w.semiBold, letterSpacing: 3.2, textTransform: 'uppercase', ...style }}>
      {children}
    </div>
  );
}

export function Title({ children, size = 'l', style, as: Tag = 'h2' }) {
  const fs = size === 'xl'
    ? 'clamp(40px, 5.6vw, 76px)'
    : size === 'l'
      ? 'clamp(32px, 4vw, 56px)'
      : 'clamp(26px, 2.8vw, 40px)';
  return (
    <Tag style={{ margin: 0, fontSize: fs, fontWeight: w.extraLight, letterSpacing: -1.2, lineHeight: 1.04, color: pg.text, ...style }}>
      {children}
    </Tag>
  );
}

export function Lede({ children, style }) {
  return (
    <p style={{ margin: 0, color: pg.textSec, fontSize: 'clamp(15px, 1.3vw, 18px)', lineHeight: 1.55, fontWeight: w.light, maxWidth: 560, ...style }}>
      {children}
    </p>
  );
}

/*
 * Section header: "02 — THE PLAN" / title / a short gold rule that draws /
 * lede, cascading in; the section's numeral ghosts behind it.
 */
export function Head({ n, tag, title, lede, center = false, style, titleSize = 'l' }) {
  return (
    <div style={{ position: 'relative', marginBottom: 'clamp(40px, 5vw, 64px)', ...style }}>
      {n && <GhostNumeral n={n} center={center} />}
      <Stagger
        gap={0.12}
        amount={0.4}
        style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: center ? 'center' : 'flex-start', textAlign: center ? 'center' : 'left', gap: 18 }}
      >
        <Item from={center ? 'up' : 'left'} dist={0.6}><Eyebrow>{n ? `${n} — ${tag}` : tag}</Eyebrow></Item>
        <Item from="up"><Title size={titleSize} style={{ maxWidth: 820 }}>{title}</Title></Item>
        <DrawLine width={center ? 120 : 72} height={2} origin={center ? 'center' : 'left'} delay={0.35} />
        {lede && <Item from="up"><Lede style={center ? { textAlign: 'center' } : undefined}>{lede}</Lede></Item>}
      </Stagger>
    </div>
  );
}

export function Hairline({ style }) {
  return <div aria-hidden style={{ height: 1, background: GOLD_LINE, ...style }} />;
}

/* Gold pill — the app's own "+20 PTS" chip */
export function Pts({ children, size = 13, style }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'baseline', gap: 3, padding: `${size * 0.35}px ${size * 0.8}px`, borderRadius: 999,
        background: 'rgba(232,210,0,0.12)', border: '1px solid rgba(232,210,0,0.35)', color: pg.accent,
        fontSize: size, fontWeight: w.semiBold, letterSpacing: 0.3, whiteSpace: 'nowrap', ...style,
      }}
    >
      {children}
    </span>
  );
}

export function Check({ size = 14, color = pg.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

export function Search({ size = 18, color = pg.textSec }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export function Chevron({ size = 16, color = pg.textSec, open = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s' }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-GB'));

/* A number that counts up to its value as it enters, eased out. */
export function CountUp({ to, duration = 1400, prefix = '', suffix = '' }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  const [v, setV] = useState(() => (reduce ? to : 0));
  useEffect(() => {
    if (!inView) return undefined;
    if (reduce) { setV(to); return undefined; }
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.round(to * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration, reduce]);
  return <span ref={ref}>{prefix}{fmt(v)}{suffix}</span>;
}
