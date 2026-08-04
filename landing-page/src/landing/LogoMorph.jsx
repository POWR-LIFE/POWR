import { useLayoutEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useMotionValueEvent, useScroll } from 'framer-motion';

/**
 * Shared-element logo: one fixed <img> that sits over the hero's logo slot
 * at the top of the page, then travels and shrinks into the nav's brand
 * slot as the user scrolls, replacing the wordmark there.
 *
 * Both slots are invisible placeholders measured from the DOM:
 *  - #powr-hero-logo-slot (Hero.jsx) — start rect, document coordinates
 *  - #powr-nav-logo-slot (NavBrand below) — end rect, viewport coordinates
 */
/**
 * The mark, white on transparency. Every logo on the marketing site reads from
 * here — hero, nav, both footers, the partners page.
 *
 * Swapped 2026-08-04 from `powrlogotext.png` (same mark with a small "OWR" set
 * under the right stroke). It is a safe drop-in because the two share an ink
 * aspect ratio (1.43 vs 1.42) and near-identical padding inside their square
 * canvases, so nothing that sizes this by height needed touching. Any FUTURE
 * replacement must be checked the same way — this is sized by height in a
 * dozen places, and a different ink-to-canvas ratio silently shrinks or
 * enlarges the logo everywhere at once.
 */
export const LOGO_SRC = 'https://auth.powr.life/storage/v1/object/public/landing-page-assets/powr_transparent.png';

const EASE = [0.16, 1, 0.3, 1];

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// The morph completes after half a viewport of scroll — in step with the
// hero content, which has faded out by 0.55 of its scroll range. Ease-in-out
// so the logo lingers with the hero before committing to the nav.
const dockProgress = (y) => easeInOutCubic(clamp01(y / (window.innerHeight * 0.5)));

export default function LogoMorph() {
  const { scrollY } = useScroll();
  const rectsRef = useRef(null);
  const [heroH, setHeroH] = useState(0);
  const transform = useMotionValue('translate(-9999px, -9999px)');

  const update = () => {
    const r = rectsRef.current;
    if (!r) return;
    const y = scrollY.get();
    const p = dockProgress(y);
    // Mirror the hero content's scroll lift (contentY: 0 → -160 over one viewport)
    const contentShift = -160 * clamp01(y / window.innerHeight);
    const top = lerp(r.heroTop - y + contentShift, r.navTop, p);
    const left = lerp(r.heroLeft, r.navLeft, p);
    const scale = lerp(1, r.navH / r.heroH, p);
    transform.set(`translate(${left}px, ${top}px) scale(${scale})`);
  };

  const measure = () => {
    const hero = document.getElementById('powr-hero-logo-slot');
    const nav = document.getElementById('powr-nav-logo-slot');
    if (!hero || !nav) return;
    const h = hero.getBoundingClientRect();
    const n = nav.getBoundingClientRect();
    if (!h.height || !n.height) return;
    const y = window.scrollY;
    rectsRef.current = {
      // Undo the scroll offset and the hero's contentY lift so this is the
      // slot's static document position, whatever scroll we measured at
      heroTop: h.top + y + 160 * clamp01(y / window.innerHeight),
      heroLeft: h.left,
      heroH: h.height,
      navTop: n.top,
      navLeft: n.left,
      navH: n.height,
    };
    setHeroH(h.height);
    update();
  };

  useLayoutEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('load', measure);
    document.fonts?.ready?.then(measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('load', measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useMotionValueEvent(scrollY, 'change', update);

  return (
    // Outer layer replays the hero logo's entrance (rise, second in the
    // stagger); inner img carries the scroll-driven morph transform
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1.0, delay: 0.37, ease: EASE }}
      style={{ position: 'fixed', top: 0, left: 0, zIndex: 150, pointerEvents: 'none' }}
    >
      <motion.img
        src={LOGO_SRC}
        alt="POWR"
        style={{
          transform, transformOrigin: '0 0', display: 'block',
          height: heroH || 120, width: 'auto',
          visibility: heroH ? 'visible' : 'hidden',
        }}
      />
    </motion.div>
  );
}

/* Nav brand slot: an invisible nav-sized logo the morph docks onto — the
   header carries no wordmark of its own, the travelling logo is the brand */
export function NavBrand() {
  return (
    <img
      id="powr-nav-logo-slot"
      src={LOGO_SRC}
      alt=""
      aria-hidden
      style={{ height: 36, width: 'auto', display: 'block', visibility: 'hidden' }}
    />
  );
}
