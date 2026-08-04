import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import { pg, t, w } from '../../theme';
import { GhostLabel, Kicker, Section, SectionHead, rise } from '../bits';
import { useCompact } from '../../stages/shared';

/**
 * 02 — THE LOOP. The argument, in four steps.
 *
 * A brand's first question is "how is this different from buying ads". The
 * answer is that every step of this loop is verified server-side — the
 * session happened, the points were earned, the code was assigned to one
 * member, and the redemption is a row you can read. So the section is built
 * as a chain, drawn by a gold thread that fills as you scroll it.
 */
const STEPS = [
  {
    n: '01',
    title: 'They earn it',
    body: 'Points come from sessions POWR can prove: a geofenced check-in at the gym door, a workout off their watch, steps, sleep. No self-reporting, no points for opening the app.',
    tag: 'Verified',
  },
  {
    n: '02',
    title: 'They choose you',
    body: 'Your listing sits in the vault beside every other brand, priced in points. Nobody is interrupted with it — they arrive holding a balance and decide where to spend it.',
    tag: 'Intent',
  },
  {
    n: '03',
    title: 'You hand over a code',
    body: 'One code, one member, one use — from a pool you uploaded, minted in your Shopify store, or pulled live from your own system at the moment of redemption.',
    tag: 'Delivery',
  },
  {
    n: '04',
    title: 'You see what it did',
    body: 'Every claim lands in your dashboard with the reward, the points it cost and the day it happened. Reconcile it against the order and the loop closes.',
    tag: 'Attribution',
  },
];

export default function Loop() {
  const ref = useRef(null);
  const compact = useCompact(900);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 78%', 'end 65%'] });
  const threadScale = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <Section id="how" style={{ overflow: 'hidden' }}>
      <GhostLabel bottom={30} left={-30}>THE LOOP</GhostLabel>

      <SectionHead
        n="02"
        label="The loop"
        title={<>Not an impression.<br />A person who showed up.</>}
        body="Advertising sells you attention and asks you to believe it turned into something. POWR only has one currency, and it is minted by effort — so a redemption is proof the whole chain happened."
      />

      <div ref={ref} style={{ position: 'relative' }}>
        {/* The thread the steps hang on — fills under the scroll */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: compact ? 19 : 0, top: compact ? 0 : 19,
            width: compact ? 1 : '100%', height: compact ? '100%' : 1,
            background: 'rgba(255,255,255,0.08)',
          }}
        />
        <motion.div
          aria-hidden
          style={{
            position: 'absolute',
            left: compact ? 19 : 0, top: compact ? 0 : 19,
            width: compact ? 1 : '100%', height: compact ? '100%' : 1,
            background: pg.accent,
            transformOrigin: compact ? '50% 0%' : '0% 50%',
            scaleX: compact ? 1 : threadScale,
            scaleY: compact ? threadScale : 1,
          }}
        />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: compact ? '1fr' : 'repeat(4, 1fr)',
            gap: compact ? 34 : 28,
          }}
        >
          {STEPS.map((s) => (
            <motion.div
              key={s.n}
              variants={rise}
              style={{ paddingLeft: compact ? 48 : 0, paddingTop: compact ? 0 : 48, position: 'relative' }}
            >
              {/* Node on the thread */}
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  left: compact ? 13 : 0, top: compact ? 6 : 13,
                  width: 13, height: 13, borderRadius: '50%',
                  background: pg.bg, border: `1px solid ${pg.accent}`,
                  boxShadow: '0 0 0 4px rgba(8,8,8,1)',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
                <span style={{ fontSize: 26, fontWeight: w.extraLight, color: pg.accent, lineHeight: 1 }}>{s.n}</span>
                <Kicker color={pg.textMuted}>{s.tag}</Kicker>
              </div>
              <h3 style={{ margin: 0, fontSize: 19, fontWeight: w.light, letterSpacing: -0.4, color: pg.text }}>
                {s.title}
              </h3>
              <p style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.62, color: pg.textSec, fontWeight: w.light }}>
                {s.body}
              </p>
            </motion.div>
          ))}
        </div>
      </div>

      <motion.p
        variants={rise}
        style={{
          marginTop: 52, paddingTop: 26, borderTop: `1px solid ${pg.border}`,
          fontSize: 'clamp(17px, 2.2vw, 26px)', fontWeight: w.extraLight, letterSpacing: -0.6,
          lineHeight: 1.35, color: pg.text, maxWidth: 760,
        }}
      >
        Every redemption in your dashboard is someone who trained, banked the points,
        and chose to spend them with you.{' '}
        <span style={{ color: t.accent }}>That is the whole product.</span>
      </motion.p>
    </Section>
  );
}
