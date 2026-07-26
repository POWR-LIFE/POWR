import { motion, useScroll, useSpring } from 'framer-motion';
import { pg, w } from './theme';
import Hero from './Hero';
import LogoMorph, { NavBrand, LOGO_SRC } from './LogoMorph';
import MoveStage from './stages/MoveStage';
import EarnTrack from './stages/EarnTrack';
import RedeemTrack from './stages/RedeemTrack';
import TogetherStage from './stages/TogetherStage';
import AscendStage from './stages/AscendStage';
import { StoreBadges, ChapterBreak } from './stages/shared';

/**
 * /v2 — scroll-driven app showcase, on the live landing page's canvas:
 * #080808, film grain, video hero. Five acts joined by film-style chapter
 * cards: Move (the map), Earn (the day thread + streak ignition), Redeem
 * (poster vault + the spend), Together (a shared challenge, invite →
 * race → group bonus), Become (the level ascent, legend tier classified).
 * Live page at / is untouched.
 */
export default function LandingV2() {
  return (
    <div style={{ background: pg.bg, fontFamily: "'Outfit', system-ui, sans-serif", color: pg.text, minHeight: '100vh' }}>
      <GlobalStyles />
      <ScrollProgress />

      {/* Film grain over everything (live page's body::before) */}
      <div
        style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', opacity: 0.032,
          backgroundImage: pg.grain, backgroundSize: '180px 180px', zIndex: 1000,
        }}
      />

      {/* Cinematic vignette — edges fall away, the stage owns the centre */}
      <div
        style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999,
          background: 'radial-gradient(130% 100% at 50% 50%, transparent 58%, rgba(0,0,0,0.5) 100%)',
        }}
      />

      <nav
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px clamp(18px, 3vw, 28px)',
          background: 'linear-gradient(180deg, rgba(8,8,8,0.85), rgba(8,8,8,0))', backdropFilter: 'blur(4px)',
        }}
      >
        <NavBrand />
        <a
          href="#download"
          style={{
            padding: '9px 18px', borderRadius: 100, background: pg.accent, color: pg.onAccent,
            fontSize: 12, fontWeight: w.semiBold, textDecoration: 'none', letterSpacing: 0.3,
          }}
        >
          Get the App
        </a>
      </nav>

      <LogoMorph />
      <Hero />
      <MoveStage />
      <ChapterBreak n="02" word="EARN" kicker="Every move counts — not just the gym." />
      <EarnTrack />
      <ChapterBreak n="03" word="REDEEM" kicker="Points that buy real things." />
      <RedeemTrack />
      <ChapterBreak n="04" word="TOGETHER" kicker="Bring your crew. Split nothing, win everything." />
      <TogetherStage />
      <ChapterBreak n="05" word="BECOME" kicker="Twenty levels. Four tiers. One identity." />
      <AscendStage />

      <Marquee />

      {/* ── Closing CTA ── */}
      <section
        id="download"
        style={{
          minHeight: '90vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          textAlign: 'center', padding: '80px 24px', position: 'relative', overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute', bottom: -300, left: '50%', transform: 'translateX(-50%)',
            width: 900, height: 600, borderRadius: '50%', pointerEvents: 'none',
            background: 'radial-gradient(circle, rgba(232,210,0,0.08), transparent 65%)',
          }}
        />
        {/* Slow concentric rings radiating from the CTA */}
        {[420, 640, 880].map((d, i) => (
          <div
            key={d}
            style={{
              position: 'absolute', left: '50%', top: '50%', width: d, height: d,
              marginLeft: -d / 2, marginTop: -d / 2, borderRadius: '50%', pointerEvents: 'none',
              border: '1px solid rgba(232,210,0,0.06)',
              animation: `powrRing 5s ease-out ${i * 1.6}s infinite`,
            }}
          />
        ))}

        <motion.div
          initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.5 }}
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.14 } } }}
          style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        >
          <motion.div variants={ctaRise} style={{ fontSize: 'clamp(36px,5vw,64px)', fontWeight: w.extraLight, letterSpacing: -1.5, lineHeight: 1.05 }}>
            Rewarded from your
            <br />
            very first move.
          </motion.div>
          <motion.p variants={ctaRise} style={{ marginTop: 18, color: pg.textSec, fontWeight: w.light, maxWidth: 440, fontSize: 16 }}>
            Download POWR, walk into your gym tonight, and start the climb to Level 20.
          </motion.p>
          <motion.div variants={ctaRise} style={{ marginTop: 36 }}>
            <StoreBadges size={1.1} />
          </motion.div>
        </motion.div>
      </section>

      <Footer />
    </div>
  );
}

/* Site footer — the live page's elements (SiteFooter.js), restated in the
   v2 canvas: brand + tagline, support/legal links, copyright */
function Footer() {
  const links = [
    { label: 'Support', href: '/support' },
    { label: 'support@powr.life', href: 'mailto:support@powr.life' },
    { label: 'Privacy Policy', href: '/privacy' },
    { label: 'Cookie Policy', href: '/cookies' },
  ];
  /* Second tier: brand/partner audience. Deliberately subordinate to the links
     above — a consumer never needs these, a brand scrolls looking for them. */
  const brandLinks = [
    { label: 'Partner Login', href: '/partner/login' },
    { label: 'Integration Docs', href: '/docs' },
    { label: 'partners@powr.life', href: 'mailto:partners@powr.life' },
  ];
  return (
    <footer style={{ borderTop: `1px solid ${pg.border}`, padding: '40px clamp(18px, 3vw, 28px)' }}>
      <div className="powr-footer-inner">
        <div className="powr-footer-brand">
          <img src={LOGO_SRC} alt="POWR" style={{ height: 28, width: 'auto', display: 'block', opacity: 0.5 }} />
          <span style={{ fontSize: 13, color: pg.textSec, fontWeight: w.light }}>Made to Move. Designed to Reward.</span>
        </div>
        <div className="powr-footer-links">
          {links.map((l) => (
            <a key={l.label} className="powr-footer-link" href={l.href}>{l.label}</a>
          ))}
        </div>
      </div>
      <div className="powr-footer-sub">
        <div className="powr-footer-links">
          <span className="powr-footer-label">For Brands</span>
          {brandLinks.map((l) => (
            <a key={l.label} className="powr-footer-link" href={l.href}>{l.label}</a>
          ))}
        </div>
        <span style={{ fontSize: 12, color: pg.textSec, fontWeight: w.light }}>© 2026 POWR. All rights reserved.</span>
      </div>
    </footer>
  );
}

const ctaRise = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.9, ease: [0.16, 1, 0.3, 1] } },
};

/* Thin gold reading line — how far through the film you are */
function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });
  return (
    <motion.div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 2, zIndex: 300,
        background: pg.accent, transformOrigin: '0 50%', scaleX,
      }}
    />
  );
}

/* Slow typographic marquee — the five acts, restated as one line of film credits */
function Marquee() {
  const words = ['MOVE', 'EARN', 'REDEEM', 'TOGETHER', 'BECOME'];
  const Half = () => (
    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      {words.map((word) => (
        <span key={word} style={{ display: 'flex', alignItems: 'center' }}>
          <span
            style={{
              fontSize: 'clamp(54px, 7vw, 96px)', fontWeight: w.extraLight, letterSpacing: 2,
              color: 'transparent', WebkitTextStroke: '1px rgba(255,255,255,0.22)', whiteSpace: 'nowrap',
            }}
          >
            {word}
          </span>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: pg.accent, margin: '0 34px', flexShrink: 0 }} />
        </span>
      ))}
    </div>
  );
  return (
    <div
      aria-hidden
      style={{
        overflow: 'hidden', padding: '54px 0', whiteSpace: 'nowrap',
        borderTop: `1px solid ${pg.border}`, borderBottom: `1px solid ${pg.border}`,
      }}
    >
      <div style={{ display: 'flex', width: 'max-content', animation: 'powrMarquee 36s linear infinite' }}>
        <Half />
        <Half />
      </div>
    </div>
  );
}

function GlobalStyles() {
  return (
    <style>{`
      @font-face {
        font-family: 'Ionicons';
        src: url('/fonts/Ionicons.subset.woff2') format('woff2');
        font-display: block;
      }
      @keyframes powrPulse { 0% { transform: scale(1); opacity: 0.7; } 100% { transform: scale(1.6); opacity: 0; } }
      @keyframes powrBob { 0%, 100% { transform: translateY(0); opacity: 1; } 50% { transform: translateY(9px); opacity: 0.4; } }
      @keyframes powrGlow { 0% { opacity: 0.4; transform: translateX(-50%) scale(1); } 100% { opacity: 0.7; transform: translateX(-50%) scale(1.1); } }
      @keyframes powrDot { 0% { box-shadow: 0 0 0 0 rgba(232,210,0,0.45); } 70% { box-shadow: 0 0 0 9px rgba(232,210,0,0); } 100% { box-shadow: 0 0 0 0 rgba(232,210,0,0); } }
      @keyframes powrMarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      @keyframes powrRing { 0% { transform: scale(0.85); opacity: 0; } 30% { opacity: 1; } 100% { transform: scale(1.25); opacity: 0; } }
      .powr-footer-inner { max-width: 1200px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 24px; }
      .powr-footer-brand { display: flex; align-items: center; gap: 16px; }
      .powr-footer-links { display: flex; gap: 24px; flex-wrap: wrap; }
      .powr-footer-link { font-size: 13px; color: ${pg.textSec}; font-weight: 300; text-decoration: none; transition: color 0.2s; }
      .powr-footer-link:hover { color: ${pg.accent}; }
      .powr-footer-sub { max-width: 1200px; margin: 24px auto 0; padding-top: 20px; border-top: 1px solid ${pg.border}; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px 24px; }
      .powr-footer-sub .powr-footer-link { font-size: 12px; opacity: 0.72; }
      .powr-footer-sub .powr-footer-link:hover { opacity: 1; }
      .powr-footer-label { font-size: 10px; color: ${pg.textSec}; font-weight: 500; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.6; }
      @media (max-width: 768px) {
        .powr-footer-inner { flex-direction: column; text-align: center; gap: 16px; }
        .powr-footer-brand { flex-direction: column; gap: 8px; }
        .powr-footer-links { justify-content: center; gap: 14px 18px; }
        .powr-footer-sub { flex-direction: column; text-align: center; gap: 14px; }
      }
    `}</style>
  );
}
