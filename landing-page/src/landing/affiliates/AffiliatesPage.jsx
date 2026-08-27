import { useEffect } from 'react';
import { motion, useScroll, useSpring, useTransform } from 'framer-motion';
import { pg, w } from '../theme';
import { LOGO_SRC } from '../LogoMorph';
import SiteFooter from '../SiteFooter';
import { useCompact } from '../stages/shared';
import { GhostButton, GoldButton, MAXW, rise, stagger } from '../partners/bits';
import HeroStage from './HeroStage';
import Deal from './sections/Deal';
import Loop from './sections/Loop';
import Ladder from './sections/Ladder';
import Toolkit from './sections/Toolkit';
import Audience from './sections/Audience';
import WayIn from './sections/WayIn';
import Cta from './sections/Cta';

/**
 * /affiliates — the affiliate programme pitch, on the homepage's canvas.
 *
 * Sister page to /partners (same furniture from partners/bits.jsx, same
 * canvas rule: #080808, grain, vignette, gold hairlines, extralight display
 * type; ordinary scrolling sections, not sticky film stages). The audience
 * is a coach, gym owner or athlete deciding whether their people are worth
 * a link — they read, they don't watch.
 *
 * ⚠ /affiliate (singular) is the PORTAL. This page is /affiliates. Keep the
 * nav's login link pointing at /affiliate/login and the CTAs at /app: the
 * programme has no web signup — the application is the app itself.
 */
const NAV_LINKS = [
  { label: 'The deal', href: '#deal' },
  { label: 'How it works', href: '#how' },
  { label: 'The ladder', href: '#ladder' },
  { label: 'Toolkit', href: '#toolkit' },
  { label: 'The way in', href: '#apply' },
];

const TITLE = 'POWR Affiliates — Get rewarded when your people train';
const DESCRIPTION =
  'Bring people into POWR and earn every time they show up. Points on every verified conversion, rewards at every step, and a portal that shows you all of it. Invite-only — earned in the app.';

export default function AffiliatesPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = TITLE;
    const meta = document.querySelector('meta[name="description"]');
    const previousDesc = meta?.getAttribute('content');
    meta?.setAttribute('content', DESCRIPTION);
    return () => {
      document.title = previous;
      if (meta && previousDesc != null) meta.setAttribute('content', previousDesc);
    };
  }, []);

  return (
    <div className="powr-affiliates" style={{ background: pg.bg, fontFamily: "'Outfit', system-ui, sans-serif", color: pg.text, minHeight: '100vh' }}>
      <GlobalStyles />
      <ScrollProgress />

      <div
        aria-hidden
        style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', opacity: 0.032,
          backgroundImage: pg.grain, backgroundSize: '180px 180px', zIndex: 1000,
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999,
          background: 'radial-gradient(130% 100% at 50% 50%, transparent 58%, rgba(0,0,0,0.5) 100%)',
        }}
      />

      <Nav />
      <Hero />

      <Deal />
      <Loop />
      <Ladder />
      <Audience />
      <Toolkit />
      <WayIn />
      <Cta />

      <SiteFooter />
    </div>
  );
}

function Nav() {
  const compact = useCompact(960);
  return (
    <nav
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, padding: '16px clamp(18px, 3vw, 28px)',
        background: 'linear-gradient(180deg, rgba(8,8,8,0.9), rgba(8,8,8,0))', backdropFilter: 'blur(4px)',
      }}
    >
      <a href="/" style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <img src={LOGO_SRC} alt="POWR" style={{ height: 30, width: 'auto', display: 'block' }} />
      </a>

      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
          {NAV_LINKS.map((l) => (
            <a key={l.label} className="powr-nav-link" href={l.href}>{l.label}</a>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {!compact && <GhostButton href="/affiliate/login" style={{ padding: '9px 18px', fontSize: 12 }}>Affiliate login</GhostButton>}
        <GoldButton href="/app" style={{ padding: '9px 18px', fontSize: 12 }}>Get the app</GoldButton>
      </div>
    </nav>
  );
}

function Hero() {
  const compact = useCompact(960);
  const { scrollY } = useScroll();
  const contentY = useTransform(scrollY, [0, 700], [0, -90]);
  const contentOpacity = useTransform(scrollY, [0, 620], [1, 0]);
  const stageY = useTransform(scrollY, [0, 700], [0, -40]);

  return (
    <section style={{ position: 'relative', minHeight: compact ? 'auto' : '100vh', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
      {/* Glow crown + a faint grid so the empty canvas reads as a stage, not a gap */}
      <div
        aria-hidden
        style={{
          position: 'absolute', top: -260, left: '50%', width: 1000, height: 900, borderRadius: '50%',
          transform: 'translateX(-50%)',
          background: 'radial-gradient(circle, rgba(232,210,0,0.09) 0%, transparent 62%)',
          pointerEvents: 'none', zIndex: 0, animation: 'powrGlow 6s ease-in-out infinite alternate',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', opacity: 0.35,
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
          maskImage: 'radial-gradient(70% 60% at 50% 40%, #000 20%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(70% 60% at 50% 40%, #000 20%, transparent 100%)',
        }}
      />

      <div
        style={{
          position: 'relative', zIndex: 3, width: '100%', maxWidth: MAXW, margin: '0 auto',
          padding: compact ? '120px clamp(20px, 4vw, 32px) 70px' : '140px clamp(20px, 4vw, 32px) 80px',
          display: 'grid',
          gridTemplateColumns: compact ? '1fr' : 'minmax(0, 1.05fr) minmax(0, 0.95fr)',
          gap: compact ? 56 : 48, alignItems: 'center',
        }}
      >
        <motion.div variants={stagger(0.11)} initial="hidden" animate="show" style={{ y: compact ? 0 : contentY, opacity: compact ? 1 : contentOpacity }}>
          <motion.div
            variants={rise}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 12,
              background: 'rgba(232,210,0,0.03)', border: '1px solid rgba(232,210,0,0.35)',
              borderRadius: 40, padding: '9px 22px 9px 16px',
              fontSize: 10.5, fontWeight: w.semiBold, letterSpacing: 2, textTransform: 'uppercase',
              color: pg.accent, marginBottom: 30,
            }}
          >
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: pg.accent, animation: 'powrDot 2s ease-out infinite' }} />
            POWR Affiliates · Invite-only
          </motion.div>

          <motion.h1
            variants={rise}
            style={{ fontSize: 'clamp(40px, 5.6vw, 72px)', fontWeight: w.extraLight, letterSpacing: -2, lineHeight: 1.02, color: pg.text, margin: 0 }}
          >
            You bring them in.
            <br />
            Their effort
            <span style={{ fontStyle: 'italic', color: pg.textSec }}> pays you back.</span>
          </motion.h1>

          <motion.p
            variants={rise}
            style={{ marginTop: 24, fontSize: 'clamp(15px, 1.6vw, 19px)', color: pg.textSec, fontWeight: w.light, maxWidth: 520, lineHeight: 1.55 }}
          >
            Coaches, gym owners, athletes — the people whose people already train. Share your
            code, and every person who joins and logs a session POWR can verify — at the gym, on a walk, on a run, off their phone or their watch — pays you both.
            Points on every one. Rewards at every step. No cap.
          </motion.p>

          <motion.div variants={rise} style={{ marginTop: 34, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <GoldButton href="/app">Get the app</GoldButton>
            <GhostButton href="#apply">How you get in</GhostButton>
          </motion.div>

          <motion.div
            variants={rise}
            style={{ marginTop: 36, display: 'flex', flexWrap: 'wrap', gap: '8px 28px', fontSize: 12, color: pg.textMuted, fontWeight: w.light }}
          >
            <span><span style={{ color: pg.accent }}>●</span>&nbsp; Verified sessions only</span>
            <span><span style={{ color: pg.accent }}>●</span>&nbsp; Points + rewards, no cash</span>
            <span><span style={{ color: pg.accent }}>●</span>&nbsp; Earned in the app</span>
          </motion.div>
        </motion.div>

        <motion.div style={{ y: compact ? 0 : stageY, paddingTop: compact ? 24 : 0 }}>
          <HeroStage compact={compact} />
        </motion.div>
      </div>

      {!compact && (
        <div
          aria-hidden
          style={{
            position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)', zIndex: 3,
            width: 22, height: 36, borderRadius: 12, border: `1.5px solid ${pg.textMuted}`,
            display: 'flex', justifyContent: 'center', paddingTop: 7,
          }}
        >
          <div style={{ width: 3, height: 7, borderRadius: 2, background: pg.accent, animation: 'powrBob 1.6s ease-in-out infinite' }} />
        </div>
      )}
    </section>
  );
}

function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });
  return (
    <motion.div
      aria-hidden
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 2, zIndex: 300,
        background: pg.accent, transformOrigin: '0 50%', scaleX,
      }}
    />
  );
}

function GlobalStyles() {
  return (
    <style>{`
      @keyframes powrBob { 0%, 100% { transform: translateY(0); opacity: 1; } 50% { transform: translateY(9px); opacity: 0.4; } }
      @keyframes powrGlow { 0% { opacity: 0.4; transform: translateX(-50%) scale(1); } 100% { opacity: 0.7; transform: translateX(-50%) scale(1.1); } }
      @keyframes powrDot { 0% { box-shadow: 0 0 0 0 rgba(232,210,0,0.45); } 70% { box-shadow: 0 0 0 9px rgba(232,210,0,0); } 100% { box-shadow: 0 0 0 0 rgba(232,210,0,0); } }
      @keyframes powrPulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.6); opacity: 0.55; } }
      @keyframes powrRing { 0% { transform: scale(0.6); opacity: 0; } 30% { opacity: 1; } 100% { transform: scale(1.25); opacity: 0; } }
      section[id] { scroll-margin-top: 78px; }
      .powr-nav-link { font-size: 12.5px; color: ${pg.textSec}; font-weight: 300; text-decoration: none; transition: color 0.2s; white-space: nowrap; }
      .powr-nav-link:hover { color: ${pg.text}; }
      @media (prefers-reduced-motion: reduce) {
        .powr-affiliates * { animation-duration: 0.001s !important; animation-iteration-count: 1 !important; }
      }
    `}</style>
  );
}
