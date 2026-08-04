import { motion } from 'framer-motion';
import { pg, w } from '../theme';

/**
 * Shared furniture for the partners page.
 *
 * The homepage is a scroll-driven film: sticky stages, choreographed travel,
 * one idea per viewport. A brand manager evaluating POWR is not watching a
 * film — they are looking for facts and an email address. So this page keeps
 * the film's canvas (#080808, grain, gold hairlines, ghost typography,
 * extralight display type) but pays it out in ordinary scrolling sections
 * that reveal on entry. Same house, different room.
 */

export const EASE = [0.16, 1, 0.3, 1];

/* One reveal used everywhere, so the whole page moves in the same accent */
export const rise = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } },
};
export const stagger = (children = 0.09) => ({
  hidden: {},
  show: { transition: { staggerChildren: children } },
});

export const MAXW = 1200;

/* A page section: the standard gutter, max width, and in-view reveal. */
export function Section({ id, children, style, tight = false }) {
  return (
    <section
      id={id}
      style={{
        position: 'relative',
        padding: `${tight ? 60 : 86}px clamp(20px, 4vw, 32px)`,
        ...style,
      }}
    >
      <motion.div
        variants={stagger()}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.15 }}
        style={{ maxWidth: MAXW, margin: '0 auto', position: 'relative', zIndex: 2 }}
      >
        {children}
      </motion.div>
    </section>
  );
}

/* Section number + label on a gold hairline — the page's chapter marker,
   standing in for the homepage's full-screen ChapterBreak cards. */
export function SectionHead({ n, label, title, body, align = 'left', maxWidth = 620 }) {
  const centred = align === 'center';
  return (
    <motion.div
      variants={rise}
      style={{
        marginBottom: 48,
        textAlign: centred ? 'center' : 'left',
        marginLeft: centred ? 'auto' : 0,
        marginRight: centred ? 'auto' : 0,
        maxWidth: centred ? maxWidth : 'none',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22,
          justifyContent: centred ? 'center' : 'flex-start',
        }}
      >
        <span style={{ height: 1, width: 34, background: pg.accent, opacity: 0.8 }} />
        <span style={{ fontSize: 10.5, fontWeight: w.semiBold, letterSpacing: 4, color: pg.accent }}>
          {n} — {label}
        </span>
      </div>
      <h2
        style={{
          fontSize: 'clamp(30px, 4vw, 52px)', fontWeight: w.extraLight, letterSpacing: -1.4,
          lineHeight: 1.06, color: pg.text, margin: 0, maxWidth,
          marginLeft: centred ? 'auto' : 0, marginRight: centred ? 'auto' : 0,
        }}
      >
        {title}
      </h2>
      {body && (
        <p
          style={{
            marginTop: 20, color: pg.textSec, fontSize: 'clamp(14px, 1.5vw, 16.5px)',
            fontWeight: w.light, lineHeight: 1.6, maxWidth: 560,
            marginLeft: centred ? 'auto' : 0, marginRight: centred ? 'auto' : 0,
          }}
        >
          {body}
        </p>
      )}
    </motion.div>
  );
}

/* The page's one card shape. Gold-lit variant for the piece we want read. */
export function Panel({ children, style, lit = false, as = 'div', ...rest }) {
  const Tag = motion[as] || motion.div;
  return (
    <Tag
      variants={rise}
      style={{
        position: 'relative',
        background: lit ? 'linear-gradient(160deg, rgba(232,210,0,0.055), rgba(15,15,15,0.6))' : pg.surface1,
        border: `1px solid ${lit ? 'rgba(232,210,0,0.28)' : pg.border}`,
        borderRadius: 20,
        overflow: 'hidden',
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/* Gold pill CTA — the page's single loud element, used sparingly */
export function GoldButton({ href, children, onClick, type, disabled, style }) {
  const s = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    padding: '14px 30px', borderRadius: 100, border: 'none',
    background: disabled ? 'rgba(232,210,0,0.35)' : pg.accent,
    color: pg.onAccent, fontFamily: 'inherit',
    fontSize: 13.5, fontWeight: w.semiBold, letterSpacing: 0.4,
    textDecoration: 'none', cursor: disabled ? 'default' : 'pointer',
    ...style,
  };
  if (type) return <button type={type} onClick={onClick} disabled={disabled} style={s}>{children}</button>;
  return <a href={href} onClick={onClick} style={s}>{children}</a>;
}

export function GhostButton({ href, children, style }) {
  return (
    <a
      href={href}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        padding: '13px 28px', borderRadius: 100,
        border: `1px solid rgba(255,255,255,0.18)`, background: 'rgba(255,255,255,0.03)',
        color: pg.text, fontSize: 13.5, fontWeight: w.medium, textDecoration: 'none',
        ...style,
      }}
    >
      {children}
    </a>
  );
}

/* Small letterspaced caps label, e.g. a category or status */
export function Kicker({ children, color = pg.textSec, style }) {
  return (
    <span
      style={{
        fontSize: 10, fontWeight: w.semiBold, letterSpacing: 2.6,
        textTransform: 'uppercase', color, ...style,
      }}
    >
      {children}
    </span>
  );
}

/* Giant outline word floating behind a section — the homepage's GhostWord,
   restated for a non-sticky section (no scroll progress to drive it). */
export function GhostLabel({ children, top, left, right, bottom, size = 'clamp(72px, 15vw, 210px)', gold = false }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute', top, left, right, bottom, zIndex: 0, pointerEvents: 'none',
        fontSize: size, fontWeight: w.extraLight, letterSpacing: '0.02em', lineHeight: 0.9,
        color: 'transparent', userSelect: 'none', whiteSpace: 'nowrap',
        WebkitTextStroke: gold ? '1px rgba(232,210,0,0.06)' : '1px rgba(255,255,255,0.045)',
      }}
    >
      {children}
    </div>
  );
}
