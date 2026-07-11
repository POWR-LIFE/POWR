import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { pg, t, w } from '../theme';
import Ion from '../Ionicon';
import { SectionTag, useCompact } from './shared';

/**
 * Act II — Earn. Horizontal travel: a track of real app components (the
 * home screen's activity circles, wearable sync, streak multiplier, balance)
 * slides across as you scroll. No phone — the components fly free.
 */

// ActivityCircle constants from components/home/WeeklyActivityRings.tsx
const CIRCLE_SIZE = 80, CIRCLE_R = 32, CIRCLE_SW = 5;
const CIRC = 2 * Math.PI * CIRCLE_R;

const CARD_BG = '#151515';
const CARD_BORDER = 'rgba(255,255,255,0.07)';

export default function EarnTrack() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const compact = useCompact();

  const infoOpacity = useTransform(scrollYProgress, [0.04, 0.12], [0, 1]);
  // Compact: the viewport shows ~1 card, so the track needs a longer travel
  const trackX = useTransform(scrollYProgress, [0.10, 0.94], compact ? ['4%', '-86%'] : ['6%', '-58%']);

  // The week's points, accumulating as the cards pass — the act's one number
  const tally = useTransform(scrollYProgress, [0.20, 0.86], [0, 145]);
  const tallyText = useTransform(tally, (v) => `+${Math.round(v)}`);
  const tallyOpacity = useTransform(scrollYProgress, [0.14, 0.24], [0, 1]);
  const tallyY = useTransform(scrollYProgress, [0, 1], [30, -30]);

  return (
    <section ref={ref} style={{ position: 'relative', height: '360vh' }}>
      <div
        style={{
          position: 'sticky', top: 0, height: '100vh', overflow: 'hidden',
          display: 'flex', alignItems: 'center',
        }}
      >
        {/* Giant running tally — behind the cards, in front of the void */}
        <motion.div
          aria-hidden
          style={{
            position: 'absolute', right: '4%', bottom: compact ? '3%' : '5%', zIndex: 2, pointerEvents: 'none',
            textAlign: 'right', opacity: tallyOpacity, y: tallyY, userSelect: 'none',
          }}
        >
          <motion.div
            style={{
              fontSize: compact ? 'clamp(96px, 26vw, 150px)' : 'clamp(150px, 19vw, 280px)',
              fontWeight: w.extraLight, lineHeight: 0.9,
              letterSpacing: -6, color: 'rgba(232,210,0,0.055)', fontVariantNumeric: 'tabular-nums',
            }}
          >
            {tallyText}
          </motion.div>
          <div style={{ fontSize: compact ? 11 : 13, fontWeight: w.medium, letterSpacing: 6, color: 'rgba(232,210,0,0.18)', marginTop: 6, marginRight: 10 }}>
            PTS THIS WEEK
          </div>
        </motion.div>

        {/* Info block — left column on desktop, top block on compact */}
        <motion.div
          style={{
            ...(compact
              ? { top: 'calc(58px + 5vh)', left: 22, right: 22 }
              : { left: '7%', top: '50%', width: 360, maxWidth: '30vw' }),
            position: 'absolute', y: compact ? 0 : '-50%',
            opacity: infoOpacity, zIndex: 30,
          }}
        >
          <SectionTag style={compact ? { marginBottom: 10, fontSize: 10.5, letterSpacing: 2.6 } : undefined}>02 — EARN</SectionTag>
          <div style={{ fontSize: compact ? 'clamp(26px, 7vw, 34px)' : 'clamp(30px, 3.2vw, 44px)', fontWeight: w.extraLight, letterSpacing: -1.2, lineHeight: 1.05, color: pg.text }}>
            The gym is just
            {compact ? ' ' : <br />}
            the start.
          </div>
          <p style={{ marginTop: compact ? 10 : 18, color: pg.textSec, fontSize: compact ? 13.5 : 15, lineHeight: 1.5, fontWeight: w.light, maxWidth: 460 }}>
            Walks, rides, sleep — synced from Apple Health, Whoop and more, earning on their own.
            Show up daily and your streak multiplies the lot.
          </p>
        </motion.div>

        {/* Fade under the info column so cards slide beneath it (desktop only) */}
        {!compact && (
          <div
            style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: '38%', zIndex: 20, pointerEvents: 'none',
              background: `linear-gradient(90deg, ${pg.bg} 62%, transparent 100%)`,
            }}
          />
        )}

        {/* The sliding track — cards staggered off the centreline */}
        <motion.div
          style={{
            display: 'flex', alignItems: 'center', gap: compact ? 18 : 26, x: trackX,
            paddingLeft: compact ? '16%' : '40%', zIndex: 10, willChange: 'transform',
            marginTop: compact ? '9vh' : 0,
          }}
        >
          <Lift y={26}><SyncCard progress={scrollYProgress} /></Lift>
          <Lift y={-34}><RingCard progress={scrollYProgress} at={0.28} icon="barbell-outline" label="GYM" colour={t.actGym} target={0.75} count="3" /></Lift>
          <Lift y={30}><RingCard progress={scrollYProgress} at={0.38} icon="footsteps-outline" label="WALK" colour={t.actWalk} target={0.9} count="5" /></Lift>
          <Lift y={-24}><SleepCard progress={scrollYProgress} /></Lift>
          <Lift y={38}><RingCard progress={scrollYProgress} at={0.56} icon="bicycle-outline" label="CYCLE" colour={t.actCycle} target={0.5} count="2" /></Lift>
          <Lift y={-18}><MultiplierCard progress={scrollYProgress} /></Lift>
          <Lift y={20}><BalanceCard progress={scrollYProgress} /></Lift>
        </motion.div>
      </div>
    </section>
  );
}

/* One activity circle — ported from WeeklyActivityRings.tsx circle variant */
function RingCard({ progress, at, icon, label, colour, target, count }) {
  const fill = useTransform(progress, [at, at + 0.20], [CIRC, CIRC - target * CIRC]);
  const countOpacity = useTransform(progress, [at + 0.06, at + 0.16], [0, 1]);
  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '6px 18px' }}>
        <div style={{ position: 'relative', width: CIRCLE_SIZE, height: CIRCLE_SIZE }}>
          <svg width={CIRCLE_SIZE} height={CIRCLE_SIZE}>
            <circle cx={CIRCLE_SIZE / 2} cy={CIRCLE_SIZE / 2} r={CIRCLE_R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={CIRCLE_SW} />
            <motion.circle
              cx={CIRCLE_SIZE / 2} cy={CIRCLE_SIZE / 2} r={CIRCLE_R} fill="none"
              stroke={colour} strokeWidth={CIRCLE_SW} strokeLinecap="round"
              strokeDasharray={CIRC} style={{ strokeDashoffset: fill }}
              transform={`rotate(-90 ${CIRCLE_SIZE / 2} ${CIRCLE_SIZE / 2})`}
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ion name={icon} size={20} color="#F2F2F2" />
          </div>
        </div>
        <div style={{ fontSize: 9, fontWeight: w.medium, letterSpacing: 2, color: t.textMuted }}>{label}</div>
        <motion.div style={{ fontSize: 15, fontWeight: w.semiBold, color: colour, opacity: countOpacity }}>
          {count}
        </motion.div>
      </div>
    </Card>
  );
}

/* Wearable workout sync */
function SyncCard({ progress }) {
  const ptsOpacity = useTransform(progress, [0.24, 0.30], [0, 1]);
  return (
    <Card width={296}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.06)', border: `1px solid ${CARD_BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Ion name="watch-outline" size={22} color={t.actWalk} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 14, fontWeight: w.medium, color: pg.text }}>Morning run synced</span>
            <motion.span style={{ fontSize: 15, fontWeight: w.bold, color: t.accent, opacity: ptsOpacity }}>+15</motion.span>
          </div>
          <div style={{ fontSize: 11.5, color: pg.textSec, fontWeight: w.light, marginTop: 3 }}>5.2 km · via Whoop</div>
        </div>
      </div>
    </Card>
  );
}

/* Sleep counted */
function SleepCard({ progress }) {
  const ptsOpacity = useTransform(progress, [0.50, 0.56], [0, 1]);
  return (
    <Card width={280}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(99,102,241,0.14)', border: '1px solid rgba(99,102,241,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Ion name="moon" size={20} color={t.actSleep} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 14, fontWeight: w.medium, color: pg.text }}>7h 40m of sleep</span>
            <motion.span style={{ fontSize: 15, fontWeight: w.bold, color: t.accent, opacity: ptsOpacity }}>+5</motion.span>
          </div>
          <div style={{ fontSize: 11.5, color: pg.textSec, fontWeight: w.light, marginTop: 3 }}>Recovery target met</div>
        </div>
      </div>
    </Card>
  );
}

/* Streak multiplier — the gold card */
function MultiplierCard({ progress }) {
  const scale = useTransform(progress, [0.62, 0.70, 0.74], [0.92, 1.05, 1]);
  return (
    <motion.div
      style={{
        scale, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '20px 26px',
        background: t.accent, color: t.onAccent, borderRadius: 20,
        boxShadow: '0 24px 50px -14px rgba(232,210,0,0.45)',
      }}
    >
      <Ion name="flame" size={30} color={t.onAccent} />
      <div>
        <div style={{ fontSize: 32, fontWeight: w.bold, lineHeight: 1, letterSpacing: -1 }}>×1.5</div>
        <div style={{ fontSize: 10, fontWeight: w.bold, letterSpacing: 2, opacity: 0.7, marginTop: 3 }}>12-DAY STREAK</div>
      </div>
    </motion.div>
  );
}

/* Running balance */
function BalanceCard({ progress }) {
  const balance = useTransform(progress, [0.62, 0.90], [1240, 1385]);
  const balanceText = useTransform(balance, (v) => Math.round(v).toLocaleString());
  return (
    <Card width={250}>
      <div style={{ padding: '4px 6px' }}>
        <div style={{ fontSize: 9, fontWeight: w.medium, letterSpacing: 2, color: t.textMuted }}>BALANCE</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
          <motion.span style={{ fontSize: 38, fontWeight: w.extraLight, letterSpacing: -1.5, color: pg.text, fontVariantNumeric: 'tabular-nums' }}>
            {balanceText}
          </motion.span>
          <span style={{ fontSize: 13, fontWeight: w.medium, color: t.accent }}>pts</span>
        </div>
      </div>
    </Card>
  );
}

/* Vertical stagger so the track reads as a composition, not a queue */
function Lift({ y, children }) {
  return <div style={{ transform: `translateY(${y}px)`, flexShrink: 0 }}>{children}</div>;
}

function Card({ children, width }) {
  return (
    <div
      style={{
        flexShrink: 0, width, background: CARD_BG, border: `1px solid ${CARD_BORDER}`,
        borderRadius: 20, padding: 18, boxShadow: '0 30px 60px -30px rgba(0,0,0,0.8)',
      }}
    >
      {children}
    </div>
  );
}
