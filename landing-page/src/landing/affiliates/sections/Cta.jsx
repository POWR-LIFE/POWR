import { motion } from 'framer-motion';
import { pg, w } from '../../theme';
import { StoreBadges } from '../../stages/shared';
import { rise, stagger } from '../../partners/bits';

/**
 * Closing CTA — the homepage's ring-and-glow finale, restated for the one
 * action this page can honestly ask for: install the app. The programme
 * has no form; the store badge IS the application.
 */
export default function Cta() {
  return (
    <section
      id="download"
      style={{
        minHeight: '72vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '90px 24px', position: 'relative', overflow: 'hidden',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute', bottom: -300, left: '50%', transform: 'translateX(-50%)',
          width: 900, height: 600, borderRadius: '50%', pointerEvents: 'none',
          background: 'radial-gradient(circle, rgba(232,210,0,0.08), transparent 65%)',
        }}
      />
      {[420, 640, 880].map((d, i) => (
        <div
          key={d}
          aria-hidden
          style={{
            position: 'absolute', left: '50%', top: '50%', width: d, height: d,
            marginLeft: -d / 2, marginTop: -d / 2, borderRadius: '50%', pointerEvents: 'none',
            border: '1px solid rgba(232,210,0,0.06)',
            animation: `powrRing 5s ease-out ${i * 1.6}s infinite`,
          }}
        />
      ))}

      <motion.div
        variants={stagger(0.14)} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.5 }}
        style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      >
        <motion.div variants={rise} style={{ fontSize: 10.5, fontWeight: w.semiBold, letterSpacing: 4, color: pg.accent, marginBottom: 22 }}>
          POWR AFFILIATES
        </motion.div>
        <motion.div variants={rise} style={{ fontSize: 'clamp(36px,5vw,64px)', fontWeight: w.extraLight, letterSpacing: -1.5, lineHeight: 1.05, color: pg.text }}>
          Start with
          <br />
          one person.
        </motion.div>
        <motion.p variants={rise} style={{ marginTop: 18, color: pg.textSec, fontWeight: w.light, maxWidth: 440, fontSize: 16, lineHeight: 1.55 }}>
          Get the app, find your POWR ID, and send it to the one person you know will show up.
          The ladder starts there.
        </motion.p>
        <motion.div variants={rise} style={{ marginTop: 36 }}>
          <StoreBadges size={1.1} />
        </motion.div>
      </motion.div>
    </section>
  );
}
