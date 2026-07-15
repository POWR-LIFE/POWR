import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { pg, t, w } from '../theme';
import Ion from '../Ionicon';
import { SectionTag, CopyPanel, GhostWord, MobileCopyDock, useCompact } from './shared';

/**
 * Act II — Earn. Two movements:
 *  1. The day that pays: one day's earning moments (sleep, run, steps, the
 *     verified gym session, a ride) ride a gold thread across the stage.
 *     Each card ignites as it crosses the scan line and its points fire;
 *     behind, a slow parallax rail of the wearable brands POWR plugs into.
 *  2. The ignition: the track falls back, the streak medallion lights its
 *     twelve day-ticks, and the day's 41 points roll to a gold 57 before
 *     landing in the balance.
 */

const CARD_BG = '#151515';
const CARD_BORDER = 'rgba(255,255,255,0.07)';
const THREAD = 'rgba(232,210,0,0.22)';

const PANELS = [
  { range: [0.04, 0.09, 0.26, 0.32], title: 'The gym is just the start.',
    body: 'Sleep, steps, runs, rides — one ordinary day, and every hour of it lands as points. Automatically.' },
  { range: [0.35, 0.41, 0.52, 0.58], title: 'Plugs into what you already wear.',
    body: 'Apple Health, WHOOP, Garmin, Oura, Strava and 15 more. Connect once — it earns on autopilot.' },
  { range: [0.63, 0.69, 0.88, 0.95], title: 'Show up daily. It multiplies.',
    body: 'A 12-day streak turns today’s 41 points into 57. The flame does the maths.' },
];

/* Where each card crosses the scan line, in section progress */
const AT = { sleep: 0.15, run: 0.24, steps: 0.33, gym: 0.42, ride: 0.51 };

export default function EarnTrack() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const compact = useCompact();

  const infoOpacity = useTransform(scrollYProgress, [0.03, 0.09], [0, 1]);

  // Movement 1 — the day slides through, then falls back for the ignition
  const trackX = useTransform(scrollYProgress, [0.06, 0.58], compact ? ['4%', '-90%'] : ['6%', '-64%']);
  const trackOpacity = useTransform(scrollYProgress, [0.56, 0.63], [1, 0.03]);
  const trackScale = useTransform(scrollYProgress, [0.56, 0.63], [1, 0.96]);

  // Ghost word bows out before the ignition takes its spot
  const ghostOpacity = useTransform(scrollYProgress, [0.56, 0.63], [1, 0]);

  // Wearable-brand rail — slower travel, so it reads as a deeper layer
  const railX = useTransform(scrollYProgress, [0.06, 0.62], compact ? ['12%', '-72%'] : ['50%', '-8%']);
  const railOpacity = useTransform(
    scrollYProgress,
    [0.08, 0.14, 0.34, 0.40, 0.54, 0.62],
    [0, 0.45, 0.45, 1, 1, 0],
  );

  // Scan line — the vertical light every moment is scored against
  const scanOpacity = useTransform(scrollYProgress, [0.06, 0.12, 0.55, 0.62], [0, 1, 1, 0]);

  // The day's points, stepping up as each card is scored
  const tally = useTransform(
    scrollYProgress,
    [0, 0.145, 0.175, 0.235, 0.265, 0.325, 0.355, 0.415, 0.445, 0.505, 0.535],
    [0, 0, 4, 4, 10, 10, 15, 15, 35, 35, 41],
  );
  const tallyText = useTransform(tally, (v) => `+${Math.round(v)}`);
  const tallyOpacity = useTransform(scrollYProgress, [0.10, 0.16, 0.56, 0.61], [0, 1, 1, 0]);
  const tallyY = useTransform(scrollYProgress, [0, 1], [30, -30]);

  return (
    <section ref={ref} data-act="earn" style={{ position: 'relative', height: '520vh' }}>
      <div
        style={{
          position: 'sticky', top: 0, height: '100vh', overflow: 'hidden',
          display: 'flex', alignItems: 'center',
        }}
      >
        {/* Ghost act word — deep background */}
        <motion.div style={{ opacity: ghostOpacity }}>
          <GhostWord progress={scrollYProgress} top="8%" right="-2%" drift={[70, -70]} gold>
            EARN
          </GhostWord>
        </motion.div>

        {/* Giant stepping tally — behind the cards, in front of the void */}
        <motion.div
          aria-hidden
          style={{
            position: 'absolute', right: '4%', bottom: compact ? '26%' : '5%', zIndex: 2, pointerEvents: 'none',
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
            PTS TODAY
          </div>
        </motion.div>

        {/* Beat copy — left column on desktop, bottom dock on compact */}
        {compact ? (
          <MobileCopyDock tag="02 — EARN" tagOpacity={infoOpacity}>
            {PANELS.map((p, i) => (
              <CopyPanel key={i} panel={p} progress={scrollYProgress} compact />
            ))}
          </MobileCopyDock>
        ) : (
          <motion.div
            style={{
              position: 'absolute', left: '7%', top: '50%', y: '-50%', width: 360, maxWidth: '30vw',
              opacity: infoOpacity, zIndex: 30,
            }}
          >
            <SectionTag>02 — EARN</SectionTag>
            <div style={{ position: 'relative', height: 230 }}>
              {PANELS.map((p, i) => (
                <CopyPanel key={i} panel={p} progress={scrollYProgress} />
              ))}
            </div>
          </motion.div>
        )}

        {/* Fade under the info column so cards slide beneath it (desktop only) */}
        {!compact && (
          <div
            style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: '40%', zIndex: 20, pointerEvents: 'none',
              background: `linear-gradient(90deg, ${pg.bg} 55%, rgba(8,8,8,0.92) 74%, transparent 100%)`,
            }}
          />
        )}

        {/* Wearable-brand rail — the sources, drifting on a deeper layer */}
        <motion.div
          aria-hidden
          style={{
            position: 'absolute', top: compact ? '12%' : '15%', left: 0, zIndex: 4,
            display: 'flex', alignItems: 'center', gap: 14, x: railX, opacity: railOpacity,
            pointerEvents: 'none', willChange: 'transform',
          }}
        >
          <LogoChip src="/wearables/apple-health.png" glyphH={15} name="Apple Health" />
          <LogoChip src="/wearables/whoop.png" glyphH={16} name="WHOOP" />
          <LogoChip src="/wearables/garmin.png" wordH={12} />
          <LogoChip src="/wearables/oura.png" wordH={11} />
          <LogoChip src="/wearables/strava.png" wordH={11} />
          <LogoChip src="/wearables/fitbit.png" glyphH={16} name="Fitbit" />
          <div
            style={{
              flexShrink: 0, padding: '10px 16px', borderRadius: 100,
              border: '1px solid rgba(232,210,0,0.16)', color: 'rgba(232,210,0,0.5)',
              fontSize: 10, fontWeight: w.semiBold, letterSpacing: 2,
            }}
          >
            + 15 MORE
          </div>
        </motion.div>

        {/* Scan line — where a moment becomes points */}
        <motion.div
          aria-hidden
          style={{
            position: 'absolute', top: 0, bottom: 0, left: compact ? '50%' : '64%',
            zIndex: 5, opacity: scanOpacity, pointerEvents: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute', top: 0, bottom: 0, left: -70, width: 140,
              background: 'radial-gradient(ellipse 50% 42% at 50% 50%, rgba(232,210,0,0.055), transparent 70%)',
            }}
          />
          <div
            style={{
              position: 'absolute', top: 0, bottom: 0, width: 1,
              background: 'linear-gradient(180deg, transparent 4%, rgba(232,210,0,0.16) 30%, rgba(232,210,0,0.16) 70%, transparent 96%)',
            }}
          />
        </motion.div>

        {/* Movement 1 — the day, strung on its thread */}
        <motion.div
          style={{
            position: 'relative', display: 'flex', alignItems: 'center', gap: compact ? 22 : 32,
            x: trackX, opacity: trackOpacity, scale: trackScale,
            paddingLeft: compact ? '16%' : '42%', paddingRight: '10%',
            zIndex: 10, willChange: 'transform', marginTop: compact ? '-7vh' : 0,
          }}
        >
          {/* The gold thread the day hangs from */}
          <div
            aria-hidden
            style={{
              position: 'absolute', left: 0, right: 0, top: '50%', height: 1,
              background: `linear-gradient(90deg, transparent 1%, ${THREAD} 8%, ${THREAD} 94%, transparent 99%)`,
            }}
          />

          <ThreadCard y={-34} time="06:54" progress={scrollYProgress} at={AT.sleep}>
            <SleepCard progress={scrollYProgress} />
          </ThreadCard>
          <ThreadCard y={30} time="07:15" progress={scrollYProgress} at={AT.run}>
            <RunCard progress={scrollYProgress} />
          </ThreadCard>
          <ThreadCard y={-28} time="ALL DAY" progress={scrollYProgress} at={AT.steps}>
            <StepsCard progress={scrollYProgress} />
          </ThreadCard>
          <ThreadCard y={26} time="12:47" progress={scrollYProgress} at={AT.gym}>
            <GymCard progress={scrollYProgress} />
          </ThreadCard>
          <ThreadCard y={-24} time="18:05" progress={scrollYProgress} at={AT.ride}>
            <RideCard progress={scrollYProgress} />
          </ThreadCard>
        </motion.div>

        {/* Movement 2 — the streak ignition */}
        <StreakIgnition progress={scrollYProgress} compact={compact} />
      </div>
    </section>
  );
}

/* ── Track scaffolding ─────────────────────────────────────────────── */

/*
 * A card hung off the thread: lifted above/below the centreline, with a
 * stem back down to a pulsing node dot sitting exactly on the thread,
 * and its timestamp beside the node.
 */
function ThreadCard({ y, time, progress, at, children }) {
  const scale = useTransform(progress, [at - 0.06, at, at + 0.06], [0.97, 1.03, 0.97]);
  const nodeOpacity = useTransform(progress, [at - 0.07, at, at + 0.08], [0.35, 1, 0.5]);
  return (
    <div style={{ position: 'relative', transform: `translateY(${y}px)`, flexShrink: 0 }}>
      {/* Stem from the card back to the thread */}
      <div
        aria-hidden
        style={{
          position: 'absolute', left: '50%', width: 1, background: THREAD, zIndex: 0,
          top: y < 0 ? '50%' : `calc(50% - ${y}px)`, height: Math.abs(y),
        }}
      />
      {/* Node on the thread */}
      <motion.div
        aria-hidden
        style={{
          position: 'absolute', left: '50%', top: `calc(50% - ${y}px)`,
          x: '-50%', y: '-50%', opacity: nodeOpacity, zIndex: 0,
          width: 7, height: 7, borderRadius: '50%', background: t.accent,
          animation: 'powrDot 2.6s ease-out infinite',
        }}
      />
      {/* Timestamp beside the node */}
      <div
        aria-hidden
        style={{
          position: 'absolute', left: 'calc(50% + 12px)', top: `calc(50% - ${y}px)`,
          transform: 'translateY(-50%)', zIndex: 0,
          fontSize: 10.5, fontWeight: w.medium, letterSpacing: 2, color: 'rgba(255,255,255,0.34)', whiteSpace: 'nowrap',
        }}
      >
        {time}
      </div>
      <motion.div style={{ position: 'relative', zIndex: 1, scale }}>{children}</motion.div>
    </div>
  );
}

/* Card shell: dark surface, gold ignition border, floating points badge */
function EventCard({ progress, at, width, gold = false, pts, children }) {
  const igniteOpacity = useTransform(progress, [at - 0.05, at, at + 0.07], [0, 0.9, 0]);
  const ptsOpacity = useTransform(progress, [at - 0.02, at + 0.02], [0, 1]);
  const ptsScale = useTransform(progress, [at - 0.02, at + 0.015, at + 0.045], [0.6, 1.14, 1]);
  const ptsY = useTransform(progress, [at - 0.02, at + 0.03], [8, 0]);
  return (
    <div
      style={{
        position: 'relative', flexShrink: 0, width,
        background: CARD_BG, borderRadius: 20, padding: 18,
        border: `1px solid ${gold ? 'rgba(232,210,0,0.22)' : CARD_BORDER}`,
        boxShadow: gold
          ? '0 30px 60px -30px rgba(0,0,0,0.8), 0 0 60px -18px rgba(232,210,0,0.28)'
          : '0 30px 60px -30px rgba(0,0,0,0.8)',
      }}
    >
      {/* Ignition — the border warms as the card crosses the scan line */}
      <motion.div
        aria-hidden
        style={{
          position: 'absolute', inset: 0, borderRadius: 20, opacity: igniteOpacity, pointerEvents: 'none',
          border: '1px solid rgba(232,210,0,0.55)', boxShadow: '0 0 44px -10px rgba(232,210,0,0.35)',
        }}
      />
      {/* Points fire as it's scored, then stay */}
      <motion.div
        style={{
          position: 'absolute', top: -14, right: -10, zIndex: 2,
          opacity: ptsOpacity, scale: ptsScale, y: ptsY,
          background: t.accent, color: t.onAccent, borderRadius: 100, padding: '5px 11px',
          fontSize: 13, fontWeight: w.bold, letterSpacing: 0.2,
          boxShadow: '0 10px 24px -8px rgba(232,210,0,0.5)',
        }}
      >
        +{pts}
      </motion.div>
      {children}
    </div>
  );
}

/* Tiny source chip — which device or platform this moment synced from */
function SourceChip({ src, name, wordH, glyphH }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
        padding: '4px 10px', borderRadius: 100,
        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <img src={src} alt={name || ''} style={{ height: wordH || glyphH, width: 'auto', opacity: 0.8, display: 'block' }} loading="lazy" />
      {name && (
        <span style={{ fontSize: 9, fontWeight: w.semiBold, letterSpacing: 1.2, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
          {name}
        </span>
      )}
    </span>
  );
}

/* Rail chip — the "works with" wall drifting behind the track */
function LogoChip({ src, name, wordH, glyphH }) {
  return (
    <div
      style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 9,
        padding: '10px 18px', borderRadius: 100,
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <img src={src} alt={name || ''} style={{ height: wordH || glyphH, width: 'auto', opacity: 0.72, display: 'block' }} loading="lazy" />
      {name && (
        <span style={{ fontSize: 11, fontWeight: w.medium, letterSpacing: 0.4, color: 'rgba(255,255,255,0.55)' }}>
          {name}
        </span>
      )}
    </div>
  );
}

/* ── The five moments ──────────────────────────────────────────────── */

/* Overnight — you earned before you woke up */
function SleepCard({ progress }) {
  return (
    <EventCard progress={progress} at={AT.sleep} width={286} pts={4}>
      <Header label="OVERNIGHT" chip={<SourceChip src="/wearables/oura.png" wordH={9} />} />
      <div style={{ display: 'flex', gap: 13, alignItems: 'center', marginTop: 13 }}>
        <div style={{ width: 46, height: 46, borderRadius: 13, background: 'rgba(99,102,241,0.14)', border: '1px solid rgba(99,102,241,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Ion name="moon" size={21} color={t.actSleep} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: w.light, color: pg.text, letterSpacing: -0.4 }}>7h 42m</div>
          <div style={{ fontSize: 11.5, color: pg.textSec, fontWeight: w.light, marginTop: 2 }}>Recovery target met</div>
        </div>
      </div>
      {/* Sleep stages */}
      <div style={{ display: 'flex', gap: 4, marginTop: 14 }}>
        {[['22%', 0.85], ['34%', 0.45], ['30%', 0.65], ['14%', 0.25]].map(([wd, a], i) => (
          <div key={i} style={{ width: wd, height: 5, borderRadius: 3, background: `rgba(99,102,241,${a})` }} />
        ))}
      </div>
    </EventCard>
  );
}

/* Morning run — synced from the wrist */
function RunCard({ progress }) {
  const draw = useTransform(progress, [AT.run - 0.09, AT.run + 0.02], [190, 0]);
  return (
    <EventCard progress={progress} at={AT.run} width={296} pts={6}>
      <Header label="MORNING RUN" chip={<SourceChip src="/wearables/whoop.png" glyphH={13} name="WHOOP" />} />
      <div style={{ marginTop: 12, position: 'relative' }}>
        <svg width="100%" height="56" viewBox="0 0 250 56" fill="none" style={{ display: 'block' }}>
          <motion.path
            d="M4 46 C 30 42, 44 18, 70 16 S 112 40, 140 36 S 182 8, 210 12 S 238 30, 246 24"
            stroke={t.actRun} strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray="260" style={{ strokeDashoffset: draw }}
          />
          <circle cx="246" cy="24" r="4" fill={t.actRun} />
        </svg>
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 11.5, color: pg.textSec, fontWeight: w.light }}>
        <span style={{ color: pg.text, fontWeight: w.regular }}>4.2 km</span>
        <span>24:38</span>
        <span>148 bpm</span>
      </div>
    </EventCard>
  );
}

/* Steps — the ring closes as it crosses the line */
const RING_SIZE = 84, RING_R = 34, RING_SW = 5.5;
const RING_CIRC = 2 * Math.PI * RING_R;

function StepsCard({ progress }) {
  const fill = useTransform(progress, [AT.steps - 0.09, AT.steps + 0.02], [RING_CIRC * 0.42, 0]);
  const count = useTransform(progress, [AT.steps - 0.09, AT.steps + 0.02], [6540, 10000]);
  const countText = useTransform(count, (v) => Math.round(v).toLocaleString());
  return (
    <EventCard progress={progress} at={AT.steps} width={272} pts={5}>
      <Header label="STEPS" chip={<SourceChip src="/wearables/apple-health.png" glyphH={12} name="Apple Health" />} />
      <div style={{ display: 'flex', gap: 15, alignItems: 'center', marginTop: 11 }}>
        <div style={{ position: 'relative', width: RING_SIZE, height: RING_SIZE, flexShrink: 0 }}>
          <svg width={RING_SIZE} height={RING_SIZE}>
            <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={RING_SW} />
            <motion.circle
              cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_R} fill="none"
              stroke={t.actWalk} strokeWidth={RING_SW} strokeLinecap="round"
              strokeDasharray={RING_CIRC} style={{ strokeDashoffset: fill }}
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ion name="footsteps-outline" size={22} color={t.actWalk} />
          </div>
        </div>
        <div>
          <motion.div style={{ fontSize: 22, fontWeight: w.light, color: pg.text, letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums' }}>
            {countText}
          </motion.div>
          <div style={{ fontSize: 11.5, color: pg.textSec, fontWeight: w.light, marginTop: 2 }}>Daily goal hit</div>
        </div>
      </div>
    </EventCard>
  );
}

/* The gym session — POWR's own verification, the crown of the day */
function GymCard({ progress }) {
  return (
    <EventCard progress={progress} at={AT.gym} width={330} gold pts={20}>
      <Header
        label="GYM SESSION"
        chip={(
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
              padding: '4px 10px', borderRadius: 100,
              background: 'rgba(232,210,0,0.08)', border: '1px solid rgba(232,210,0,0.35)',
              fontSize: 9, fontWeight: w.bold, letterSpacing: 1.4, color: t.accent,
            }}
          >
            <Ion name="shield-checkmark" size={11} color={t.accent} /> VERIFIED · LOCATION
          </span>
        )}
      />
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 13 }}>
        <div style={{ width: 52, height: 52, borderRadius: 15, background: t.accentDim, border: `1px solid ${t.accentMid}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Ion name="barbell-outline" size={26} color={t.accent} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: w.medium, color: pg.text, letterSpacing: -0.2 }}>52 min on site</div>
          <div style={{ fontSize: 11.5, color: pg.textSec, fontWeight: w.light, marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Ion name="location" size={11} color={pg.textSec} /> Walked in. POWR saw it. No check-in.
          </div>
        </div>
      </div>
    </EventCard>
  );
}

/* Evening ride */
function RideCard({ progress }) {
  return (
    <EventCard progress={progress} at={AT.ride} width={280} pts={6}>
      <Header label="EVENING RIDE" chip={<SourceChip src="/wearables/garmin.png" wordH={10} />} />
      <div style={{ display: 'flex', gap: 13, alignItems: 'center', marginTop: 13 }}>
        <div style={{ width: 46, height: 46, borderRadius: 13, background: 'rgba(14,165,233,0.13)', border: '1px solid rgba(14,165,233,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Ion name="bicycle-outline" size={22} color={t.actCycle} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: w.light, color: pg.text, letterSpacing: -0.4 }}>12.4 km</div>
          <div style={{ fontSize: 11.5, color: pg.textSec, fontWeight: w.light, marginTop: 2 }}>43:12 · commute home</div>
        </div>
      </div>
    </EventCard>
  );
}

function Header({ label, chip }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ fontSize: 9, fontWeight: w.medium, letterSpacing: 2, color: t.textMuted }}>{label}</span>
      {chip}
    </div>
  );
}

/* ── Movement 2: the streak ignition ───────────────────────────────── */

const TICKS = Array.from({ length: 12 }, (_, i) => i);

function StreakIgnition({ progress, compact }) {
  const opacity = useTransform(progress, [0.60, 0.65], [0, 1]);
  const y = useTransform(progress, [0.60, 0.68], [70, 0]);
  const scale = useTransform(progress, [0.60, 0.68], [0.9, 1]);
  const glowOpacity = useTransform(progress, [0.66, 0.76], [0, 1]);

  // The day's 41 rolls to 57 and turns gold
  const total = useTransform(progress, [0.76, 0.85], [41, 57]);
  const totalText = useTransform(total, (v) => `+${Math.round(v)}`);
  const totalColor = useTransform(progress, [0.76, 0.85], ['#F2F2F2', '#E8D200']);

  // Balance card lands underneath
  const balY = useTransform(progress, [0.84, 0.90], [26, 0]);
  const balOpacity = useTransform(progress, [0.84, 0.89], [0, 1]);
  const balance = useTransform(progress, [0.85, 0.93], [1240, 1297]);
  const balanceText = useTransform(balance, (v) => Math.round(v).toLocaleString());
  const pillOpacity = useTransform(progress, [0.88, 0.92], [0, 1]);

  const M = compact ? 236 : 300;

  return (
    <motion.div
      style={{
        position: 'absolute', left: compact ? '50%' : '65%', top: compact ? '40%' : '50%',
        x: '-50%', y: '-50%', zIndex: 15, opacity,
      }}
    >
      <motion.div style={{ y, scale, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* Payoff glow */}
        <motion.div
          aria-hidden
          style={{
            position: 'absolute', left: '50%', top: M / 2, transform: 'translate(-50%, -50%)',
            width: 640, height: 640, borderRadius: '50%', opacity: glowOpacity, pointerEvents: 'none',
            background: 'radial-gradient(circle, rgba(232,210,0,0.10), transparent 62%)',
          }}
        />

        {/* The medallion — twelve day-ticks igniting around the flame */}
        <div style={{ position: 'relative', width: M, height: M, flexShrink: 0 }}>
          <div aria-hidden style={{ position: 'absolute', inset: 26, borderRadius: '50%', border: '1px solid rgba(232,210,0,0.15)' }} />
          {TICKS.map((i) => (
            <Tick key={i} i={i} progress={progress} radius={M / 2 - 7} />
          ))}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            <Ion name="flame" size={compact ? 30 : 38} color={t.accent} />
            <div style={{ fontSize: compact ? 44 : 56, fontWeight: w.light, letterSpacing: -2, color: t.accent, lineHeight: 1 }}>
              ×1.5
            </div>
            <div style={{ fontSize: 10, fontWeight: w.semiBold, letterSpacing: 3, color: 'rgba(232,210,0,0.55)' }}>
              12-DAY STREAK
            </div>
          </div>
        </div>

        {/* 41 → 57 */}
        <div style={{ marginTop: compact ? 16 : 24, textAlign: 'center' }}>
          <motion.div
            style={{
              fontSize: compact ? 54 : 72, fontWeight: w.extraLight, letterSpacing: -2.5, lineHeight: 1,
              color: totalColor, fontVariantNumeric: 'tabular-nums',
            }}
          >
            {totalText}
          </motion.div>
          <div style={{ fontSize: 10.5, fontWeight: w.medium, letterSpacing: 4, color: pg.textMuted, marginTop: 7 }}>
            PTS TODAY
          </div>
        </div>

        {/* Balance card — the day banked */}
        <motion.div
          style={{
            marginTop: compact ? 18 : 26, y: balY, opacity: balOpacity,
            width: compact ? 252 : 284, background: CARD_BG, border: `1px solid ${CARD_BORDER}`,
            borderRadius: 18, padding: '14px 18px', boxShadow: '0 30px 60px -30px rgba(0,0,0,0.8)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 9, fontWeight: w.medium, letterSpacing: 2, color: t.textMuted }}>BALANCE</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 4 }}>
              <motion.span style={{ fontSize: 30, fontWeight: w.extraLight, letterSpacing: -1, color: pg.text, fontVariantNumeric: 'tabular-nums' }}>
                {balanceText}
              </motion.span>
              <span style={{ fontSize: 12, fontWeight: w.medium, color: t.accent }}>pts</span>
            </div>
          </div>
          <motion.div
            style={{
              opacity: pillOpacity, flexShrink: 0,
              background: t.accentDim, border: `1px solid ${t.accentMid}`, color: t.accent,
              borderRadius: 100, padding: '4px 11px', fontSize: 11, fontWeight: w.semiBold,
            }}
          >
            +57 today
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/* One day-tick on the medallion rim, igniting in sequence */
function Tick({ i, progress, radius }) {
  const opacity = useTransform(progress, [0.63 + i * 0.008, 0.655 + i * 0.008], [0.13, 1]);
  return (
    <motion.div
      aria-hidden
      style={{
        position: 'absolute', left: '50%', top: '50%', width: 2.5, height: 15, borderRadius: 2,
        background: t.accent, opacity,
        transform: `translate(-50%, -50%) rotate(${i * 30}deg) translateY(-${radius}px)`,
      }}
    />
  );
}
