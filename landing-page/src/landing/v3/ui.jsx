import { motion } from 'framer-motion';
import { pg, w } from '../theme';

/**
 * Primitives for the v3 homepage. Same canvas as the film (#080808, grain,
 * gold hairlines, extralight Outfit) but built for reading, not scrubbing:
 * sections reveal once as they enter, then hold still.
 */
export const EASE = [0.16, 1, 0.3, 1];
export const CARD = {
  background: '#121212',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 22,
};
export const GOLD_LINE = 'linear-gradient(90deg, rgba(232,210,0,0) 0%, rgba(232,210,0,0.6) 30%, rgba(232,210,0,0.6) 70%, rgba(232,210,0,0) 100%)';

export function Reveal({ children, delay = 0, y = 26, amount = 0.25, style, className }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount }}
      transition={{ duration: 0.9, ease: EASE, delay }}
      style={style}
    >
      {children}
    </motion.div>
  );
}

export function Section({ id, children, style, inner, tight = false }) {
  return (
    <section
      id={id}
      style={{
        position: 'relative',
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

/* Section header: "02 — THE PLAN" / title / lede, left-aligned by default */
export function Head({ n, tag, title, lede, center = false, style, titleSize = 'l' }) {
  return (
    <Reveal style={{ display: 'flex', flexDirection: 'column', alignItems: center ? 'center' : 'flex-start', textAlign: center ? 'center' : 'left', gap: 18, marginBottom: 'clamp(40px, 5vw, 64px)', ...style }}>
      <Eyebrow>{n ? `${n} — ${tag}` : tag}</Eyebrow>
      <Title size={titleSize} style={{ maxWidth: 820 }}>{title}</Title>
      {lede && <Lede style={center ? { textAlign: 'center' } : undefined}>{lede}</Lede>}
    </Reveal>
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
