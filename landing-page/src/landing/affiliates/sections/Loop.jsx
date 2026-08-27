import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { pg, t, w } from '../../theme';
import { GhostLabel, Kicker, Section, SectionHead, rise } from '../../partners/bits';
import { useCompact } from '../../stages/shared';
import { CODE_GRACE_DAYS, CONVERSION_PTS } from '../data';

/**
 * 02 — HOW IT WORKS. Four steps on a gold thread that fills as you scroll.
 *
 * Same chain the partners page draws for brands, because it is the same
 * chain: the whole pitch is that every link in it is verified server-side.
 * Facts per step come from the shipped flow — the smart link, the 14-day
 * grace window for entering a code, first-verified-workout conversion, and
 * the affiliate_conversion push.
 */
const STEPS = [
  {
    n: '01',
    tag: 'Share',
    title: 'Put your link out',
    body: 'One link, one code. Bio, stories, the gym noticeboard, a message to your client group. Say the code out loud in videos — iPhone installs can’t carry a link through the App Store, so the code is how they find you.',
  },
  {
    n: '02',
    tag: 'Join',
    title: 'They sign up with it',
    body: `They install POWR and enter your code — at signup, or any time in the first ${CODE_GRACE_DAYS} days. It is a POWR ID, so it never expires and never runs out.`,
  },
  {
    n: '03',
    tag: 'Verify',
    title: 'They actually train',
    body: 'Their first session POWR can prove — a check-in at the gym, a walk or run recorded on their phone, a session off a watch — turns the signup into a conversion. That is the moment that counts. Not the download.',
  },
  {
    n: '04',
    tag: 'Earn',
    title: 'You both get paid',
    body: `A push lands on your phone: +${CONVERSION_PTS}. Their bonus lands on theirs. Your ladder ticks up one, and when a step unlocks, so does the reward that comes with it.`,
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
        label="How it works"
        title={<>Share once.<br />Earn every time they show up.</>}
        body="Nothing here is on trust. The tap is logged, the code is tied to one account, the workout is verified by the same system that pays every POWR member — and the points are a row you can read in your portal."
      />

      <div ref={ref} style={{ position: 'relative' }}>
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

        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(4, 1fr)', gap: compact ? 34 : 28 }}>
          {STEPS.map((s) => (
            <motion.div
              key={s.n}
              variants={rise}
              style={{ paddingLeft: compact ? 48 : 0, paddingTop: compact ? 0 : 48, position: 'relative' }}
            >
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
              <h3 style={{ margin: 0, fontSize: 19, fontWeight: w.light, letterSpacing: -0.4, color: pg.text }}>{s.title}</h3>
              <p style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.62, color: pg.textSec, fontWeight: w.light }}>{s.body}</p>
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
        You are not selling anything. You are telling people who already train that their
        training is worth something now.{' '}
        <span style={{ color: t.accent }}>Then you get paid when they find out you were right.</span>
      </motion.p>
    </Section>
  );
}
