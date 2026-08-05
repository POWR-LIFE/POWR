import { useEffect, useMemo, useState } from 'react';
import { motion, useScroll, useSpring, useTransform } from 'framer-motion';
import { pg, w } from '../theme';
import { LOGO_SRC } from '../LogoMorph';
import SiteFooter from '../SiteFooter';
import { useCompact } from '../stages/shared';
import { GhostButton, GoldButton, MAXW, rise, stagger } from './bits';
import { FALLBACK_BRANDS, fetchLiveBrands } from './data';
import Vault from './sections/Vault';
import Loop from './sections/Loop';
import Listing from './sections/Listing';
import Delivery from './sections/Delivery';
import Placements from './sections/Placements';
import Portal from './sections/Portal';
import Apply from './sections/Apply';

/**
 * /partners — the reward-brand pitch, on the homepage's canvas.
 *
 * It replaces the standalone static partners.html, which predated the v2
 * homepage and had drifted: a hand-typed logo wall, a launch date that has
 * been and gone, an anchor into a waitlist section that no longer exists, and
 * not one mention of the portal, the three delivery methods, or placements —
 * i.e. everything a brand actually gets.
 *
 * Design rule: same canvas as the homepage film (#080808, grain, vignette,
 * gold hairlines, extralight display type), different pacing. The homepage
 * is watched; this page is read by someone deciding whether to email us.
 */
const HERO_VIDEO = 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/partners_hero.mp4';

const NAV_LINKS = [
  { label: 'Partners', href: '#partners' },
  { label: 'How it works', href: '#how' },
  { label: 'Delivery', href: '#delivery' },
  { label: 'Placements', href: '#placements' },
  { label: 'Docs', href: '/docs' },
];

const TITLE = 'POWR — Partner With Us';
const DESCRIPTION =
  'Put your brand where the habit lives. POWR members earn points for verified training and spend them with partner brands — listed in a day, delivered by promo pool, Shopify or API.';

export default function PartnersPage() {
  const [brands, setBrands] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchLiveBrands()
      .then((rows) => { if (alive) setBrands(rows); })
      .catch(() => { if (alive) setBrands(FALLBACK_BRANDS); });
    return () => { alive = false; };
  }, []);

  /* The SPA shares one index.html head, so the tab title has to be set here.
     Crawlers that don't run JS still get the site-level og: tags. */
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

  const list = brands ?? FALLBACK_BRANDS;
  /* HUEL is the homepage's showcase brand too — keep the two pages agreeing.
     Falls back to whatever leads the vault if it ever lapses. */
  const featured = useMemo(
    () => list.find((b) => b.brand.toUpperCase() === 'HUEL') || list[0],
    [list],
  );

  return (
    <div className="powr-partners" style={{ background: pg.bg, fontFamily: "'Outfit', system-ui, sans-serif", color: pg.text, minHeight: '100vh' }}>
      <GlobalStyles />
      <ScrollProgress />

      {/* Film grain + vignette — the homepage's canvas, so the two pages read
          as one site rather than a marketing site and a microsite */}
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

      <Vault brands={list} />
      <Loop />
      <Listing featured={featured} />
      <Delivery />
      <Placements />
      <Portal />
      <Apply />

      <SiteFooter />
    </div>
  );
}

function Nav() {
  const compact = useCompact(900);
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
        {!compact && <GhostButton href="/partner/login" style={{ padding: '9px 18px', fontSize: 12 }}>Partner login</GhostButton>}
        <GoldButton href="#apply" style={{ padding: '9px 18px', fontSize: 12 }}>Apply</GoldButton>
      </div>
    </nav>
  );
}

function Hero() {
  const { scrollY } = useScroll();
  const videoOpacity = useTransform(scrollY, [0, 700], [1, 0.3]);
  const contentY = useTransform(scrollY, [0, 700], [0, -110]);
  const contentOpacity = useTransform(scrollY, [0, 520], [1, 0]);

  return (
    <section style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
      <motion.video
        autoPlay muted loop playsInline preload="auto"
        aria-hidden
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: videoOpacity, zIndex: 0 }}
      >
        <source src={HERO_VIDEO} type="video/mp4" />
      </motion.video>

      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0, zIndex: 1,
          background: `linear-gradient(to bottom, rgba(8,8,8,0.62) 0%, rgba(8,8,8,0.5) 40%, rgba(8,8,8,0.9) 85%, ${pg.bg} 100%)`,
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute', top: -220, left: '50%', width: 820, height: 820, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(232,210,0,0.1) 0%, transparent 70%)',
          pointerEvents: 'none', zIndex: 2, animation: 'powrGlow 6s ease-in-out infinite alternate',
        }}
      />

      <motion.div
        variants={stagger(0.11)} initial="hidden" animate="show"
        style={{
          position: 'relative', zIndex: 3, width: '100%', maxWidth: MAXW, margin: '0 auto',
          padding: '130px clamp(20px, 4vw, 32px) 60px', y: contentY, opacity: contentOpacity,
        }}
      >
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
          <span
            aria-hidden
            style={{
              width: 7, height: 7, borderRadius: '50%', background: pg.accent,
              animation: 'powrDot 2s ease-out infinite',
            }}
          />
          For reward brands
        </motion.div>

        <motion.h1
          variants={rise}
          style={{ fontSize: 'clamp(38px, 5.6vw, 68px)', fontWeight: w.extraLight, letterSpacing: -1.8, lineHeight: 1.04, color: pg.text, margin: 0 }}
        >
          Your brand belongs
          <br />
          where the <span style={{ fontStyle: 'italic', color: pg.textSec }}>habit lives.</span>
        </motion.h1>

        <motion.p
          variants={rise}
          style={{ marginTop: 24, fontSize: 'clamp(15px, 1.6vw, 19px)', color: pg.textSec, fontWeight: w.light, maxWidth: 540, lineHeight: 1.55 }}
        >
          POWR members earn points for training POWR can verify — then spend them with the brands
          in the vault. Your reward is where all that effort goes.
        </motion.p>

        <motion.div variants={rise} style={{ marginTop: 34, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <GoldButton href="#apply">Apply to partner</GoldButton>
          <GhostButton href="#partners">See who’s already in</GhostButton>
        </motion.div>
      </motion.div>

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
      /* Anchored sections must clear the fixed nav */
      section[id] { scroll-margin-top: 78px; }
      .powr-nav-link { font-size: 12.5px; color: ${pg.textSec}; font-weight: 300; text-decoration: none; transition: color 0.2s; white-space: nowrap; }
      .powr-nav-link:hover { color: ${pg.text}; }
      .powr-partners input:focus, .powr-partners select:focus, .powr-partners textarea:focus { border-color: rgba(232,210,0,0.5); }
      .powr-partners input::placeholder, .powr-partners textarea::placeholder { color: rgba(255,255,255,0.28); }
    `}</style>
  );
}
