import { useEffect, useState } from 'react';
import { motion, useMotionValueEvent, useScroll, useSpring } from 'framer-motion';
import { pg, w } from '../theme';
import Hero from '../Hero';
import SiteFooter from '../SiteFooter';
import LogoMorph, { LOGO_SRC, NavBrand } from '../LogoMorph';
import { StoreBadges, useCompact } from '../stages/shared';
import { STATS_FALLBACK, fetchStats } from './data';
import { GhostWord, Item, Lede, Stagger, Title, fmt } from './ui';
import Claim from './sections/Claim';
import HowItWorks from './sections/HowItWorks';
import InsideApp from './sections/InsideApp';
import Worth from './sections/Worth';
import GymFinder from './sections/GymFinder';
import Series from './sections/Series';
import Identity from './sections/Identity';
import Proof from './sections/Proof';
import Faq from './sections/Faq';

/**
 * powr.life — the homepage, built for conversion on the film's canvas.
 *
 * The film (/story) tells the story beautifully and hides the product and
 * the offer for thirty viewports. This page keeps the canvas, the hero and
 * the film's signature moments — the logo that docks into the nav, the gold
 * reading line, ghost typography, the phones that travel sideways — and
 * reorders everything around the visitor's decision: what is it (hero) →
 * why it's different (claim) → how it works (plan) → what it looks like
 * (inside the app) → what it's worth (live vault, priced in sessions) →
 * does it work for ME (gym search) → the Series → crew & levels → proof →
 * questions → download. Nothing scroll-jacked, a CTA always within reach.
 */
export default function LandingV3() {
  const [stats, setStats] = useState({ ...STATS_FALLBACK, live: false });
  useEffect(() => { fetchStats().then(setStats); }, []);
  const compact = useCompact(900);

  return (
    <div style={{ background: pg.bg, fontFamily: "'Outfit', system-ui, sans-serif", color: pg.text, minHeight: '100vh', paddingBottom: compact ? 84 : 0 }}>
      <GlobalStyles />
      <ScrollProgress />
      <LogoMorph />

      {/* Film grain over everything, and a soft vignette so the edges fall away */}
      <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', opacity: 0.032, backgroundImage: pg.grain, backgroundSize: '180px 180px', zIndex: 1000 }} />
      <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999, background: 'radial-gradient(130% 100% at 50% 50%, transparent 64%, rgba(0,0,0,0.34) 100%)' }} />

      <Nav compact={compact} />

      <Hero
        kicker="Every move counts"
        footnote={<>Free on iOS &amp; Android · {fmt(stats.partners)} partner gyms · Verified automatically</>}
      />

      <Claim stats={stats} />
      <HowItWorks />
      <InsideApp />
      <Worth />
      <GymFinder stats={stats} />
      <Series />
      <Identity />
      <Proof stats={stats} />
      <Faq stats={stats} />
      <Marquee />
      <Cta />
      <SiteFooter />

      {compact && <StickyCta />}
    </div>
  );
}

const LINKS = [
  { label: 'How it works', href: '#how' },
  { label: 'The app', href: '#app' },
  { label: 'Rewards', href: '#worth' },
  { label: 'Gyms', href: '#gyms' },
  { label: 'Series', href: '#series' },
  { label: 'FAQ', href: '#faq' },
];

function Nav({ compact }) {
  return (
    <nav
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px clamp(18px, 3vw, 28px)',
        background: 'linear-gradient(180deg, rgba(8,8,8,0.9), rgba(8,8,8,0))', backdropFilter: 'blur(6px)',
      }}
    >
      {/* The brand here is the travelling logo (LogoMorph) docking onto this slot */}
      <a href="/" aria-label="POWR" style={{ display: 'flex', alignItems: 'center' }}>
        <NavBrand />
      </a>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(14px, 2vw, 26px)' }}>
        {!compact && LINKS.map((l) => <a key={l.href} className="powr-nav-secondary" href={l.href}>{l.label}</a>)}
        <a className="powr-nav-secondary" href="/partners">For Brands</a>
        <a
          href="#download"
          style={{ padding: '9px 18px', borderRadius: 100, background: pg.accent, color: pg.onAccent, fontSize: 12, fontWeight: w.semiBold, textDecoration: 'none', letterSpacing: 0.3, whiteSpace: 'nowrap' }}
        >
          Get the App
        </a>
      </div>
    </nav>
  );
}

/* Thin gold reading line — how far down the page you are */
function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });
  return (
    <motion.div aria-hidden style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 2, zIndex: 300, background: pg.accent, transformOrigin: '0 50%', scaleX }} />
  );
}

/* Slow typographic marquee — the whole page restated as one line of credits */
function Marquee() {
  const words = ['MOVE', 'EARN', 'SPEND', 'COMPETE', 'BECOME'];
  const Half = () => (
    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      {words.map((word) => (
        <span key={word} style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 'clamp(54px, 7vw, 96px)', fontWeight: w.extraLight, letterSpacing: 2, color: 'transparent', WebkitTextStroke: '1px rgba(255,255,255,0.22)', whiteSpace: 'nowrap' }}>
            {word}
          </span>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: pg.accent, margin: '0 34px', flexShrink: 0 }} />
        </span>
      ))}
    </div>
  );
  return (
    <div aria-hidden style={{ overflow: 'hidden', padding: '54px 0', whiteSpace: 'nowrap', borderTop: `1px solid ${pg.border}`, borderBottom: `1px solid ${pg.border}` }}>
      <div className="powr-marquee" style={{ display: 'flex', width: 'max-content' }}>
        <Half />
        <Half />
      </div>
    </div>
  );
}

function Cta() {
  return (
    <section id="download" style={{ position: 'relative', overflow: 'hidden', padding: 'clamp(100px, 14vw, 180px) 24px', textAlign: 'center' }}>
      <div aria-hidden style={{ position: 'absolute', bottom: -320, left: '50%', transform: 'translateX(-50%)', width: 1000, height: 640, borderRadius: '50%', pointerEvents: 'none', background: 'radial-gradient(circle, rgba(232,210,0,0.10), transparent 62%)' }} />
      {[420, 640, 880].map((d, i) => (
        <div key={d} aria-hidden style={{ position: 'absolute', left: '50%', top: '50%', width: d, height: d, marginLeft: -d / 2, marginTop: -d / 2, borderRadius: '50%', pointerEvents: 'none', border: '1px solid rgba(232,210,0,0.06)', animation: `powrRing 5s ease-out ${i * 1.6}s infinite` }} />
      ))}
      <GhostWord top="8%" left="50%" drift={[60, -60]} size="clamp(140px, 26vw, 380px)" gold style={{ transform: 'translateX(-50%)' }}>POWR</GhostWord>
      <Stagger gap={0.14} amount={0.5} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        <Item>
          <Title size="xl" style={{ maxWidth: 900 }}>
            Start earning from<br />your next workout.
          </Title>
        </Item>
        <Item><Lede style={{ textAlign: 'center' }}>Download POWR, walk into your gym tonight, and let the session pay you back.</Lede></Item>
        <Item scale={0.9}><div style={{ marginTop: 14 }}><StoreBadges size={1.1} /></div></Item>
        <Item><div style={{ fontSize: 12.5, color: pg.textMuted, fontWeight: w.light }}>Free to download. Free to earn.</div></Item>
      </Stagger>
    </section>
  );
}

/* Mobile: a single gold action pinned to the thumb once the hero has gone */
function StickyCta() {
  const { scrollY } = useScroll();
  const [show, setShow] = useState(false);
  useMotionValueEvent(scrollY, 'change', (y) => setShow(y > window.innerHeight * 0.85));
  return (
    <motion.div
      initial={false}
      animate={{ y: show ? 0 : 110, opacity: show ? 1 : 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: 'fixed', left: 12, right: 12, bottom: 'calc(12px + env(safe-area-inset-bottom))', zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 10px 10px 16px',
        borderRadius: 999, background: 'rgba(14,14,14,0.92)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(12px)',
        boxShadow: '0 20px 50px -20px rgba(0,0,0,0.9)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <img src={LOGO_SRC} alt="" style={{ height: 20, width: 'auto' }} />
        <span style={{ fontSize: 12.5, color: pg.textSec, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Free on iOS &amp; Android</span>
      </span>
      <a href="/app.html" style={{ padding: '11px 18px', borderRadius: 999, background: pg.accent, color: pg.onAccent, fontSize: 13, fontWeight: w.semiBold, textDecoration: 'none', whiteSpace: 'nowrap' }}>
        Get the App
      </a>
    </motion.div>
  );
}

function GlobalStyles() {
  return (
    <style>{`
      html { scroll-padding-top: 84px; }
      @keyframes powrPulse { 0% { transform: scale(0.6); opacity: 0.9; } 100% { transform: scale(1.8); opacity: 0; } }
      @keyframes powrBob { 0%, 100% { transform: translateY(0); opacity: 1; } 50% { transform: translateY(9px); opacity: 0.4; } }
      @keyframes powrGlow { 0% { opacity: 0.4; transform: translateX(-50%) scale(1); } 100% { opacity: 0.7; transform: translateX(-50%) scale(1.1); } }
      @keyframes powrDot { 0% { box-shadow: 0 0 0 0 rgba(232,210,0,0.45); } 70% { box-shadow: 0 0 0 9px rgba(232,210,0,0); } 100% { box-shadow: 0 0 0 0 rgba(232,210,0,0); } }
      @keyframes powrRing { 0% { transform: scale(0.85); opacity: 0; } 30% { opacity: 1; } 100% { transform: scale(1.25); opacity: 0; } }
      @keyframes powrSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes powrMarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      @keyframes powrSheen { 0% { transform: translateX(-140%) skewX(-18deg); } 32% { transform: translateX(240%) skewX(-18deg); } 100% { transform: translateX(240%) skewX(-18deg); } }
      @keyframes powrBreathe { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
      .powr-marquee { animation: powrMarquee 36s linear infinite; }
      .powr-nav-secondary { font-size: 12px; font-weight: 300; color: ${pg.textSec}; text-decoration: none; white-space: nowrap; transition: color 0.2s; }
      .powr-nav-secondary:hover { color: ${pg.text}; }
      @media (max-width: 380px) { .powr-nav-secondary { display: none; } }
      @media (prefers-reduced-motion: reduce) {
        .powr-marquee { animation: none; }
        [style*="powrRing"], [style*="powrPulse"], [style*="powrGlow"], [style*="powrSheen"] { animation: none !important; }
      }
      details > summary::-webkit-details-marker { display: none; }
      input::placeholder { color: rgba(255,255,255,0.3); }
    `}</style>
  );
}
