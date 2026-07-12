import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { pg, t, w } from '../theme';
import Ion from '../Ionicon';
import { SectionTag, CopyPanel, GhostWord, MobileCopyDock, useCompact } from './shared';

/**
 * Act IV — Together. Shared challenges, played out on ONE evolving
 * SharedChallengeCard (real app anatomy, real template, real bonus maths
 * from lib/social/bonus.ts: earned = base + min(30, 5 × co-completers)):
 *  1. The invite: Sorine fires "Back Again" at the crew; Accept fills
 *     under your scroll. The clock only starts when everyone's in.
 *  2. The race: four members tick their own part to 3/3 — every friend
 *     who finishes adds +5 to YOUR payout, live in the footer.
 *  3. The payoff: the last check-in lands the group bonus for everyone —
 *     25 base + 15 bonus = 40 each, bursting to the whole crew.
 * (The league podium act is retired until leagues go live.)
 */

const GREEN = '#00CC66';
const CARD_SHELL = 'rgba(20,20,22,0.92)';

/* Real template: shared_challenge_templates sort_order 1 */
const CHALLENGE = { title: 'Back Again', goal: 'Check in 3× this week', base: 25, target: 3 };
const BONUS = 15; // 3 co-completers × 5/head (BONUS_DEFAULTS)
const TOTAL = CHALLENGE.base + BONUS;

/* The crew — same cast as the rest of the film. `done` = when they finish */
const CREW = [
  { initial: 'Y', name: 'You',    tint: t.accent,  start: 0.36, done: 0.44, isYou: true },
  { initial: 'M', name: 'Maya',   tint: '#EC4899', start: 0.38, done: 0.52 },
  { initial: 'S', name: 'Sorine', tint: t.actCycle, start: 0.37, done: 0.58 },
  { initial: 'J', name: 'Jack',   tint: '#88CC28', start: 0.40, done: 0.66 },
];
const ALL_DONE = 0.66;

const PANELS = [
  { range: [0.06, 0.11, 0.26, 0.31], title: 'Drag your mates into it.',
    body: 'Pick a challenge, fire it at the crew. The clock doesn’t start until everyone’s in.' },
  { range: [0.34, 0.40, 0.62, 0.68], title: 'Everyone pulls their weight.',
    body: 'No passengers — each of you finishes your own part. Every friend who gets there adds +5 to your payout.' },
  { range: [0.72, 0.78, 0.92, 0.98], title: 'The last one in pays everyone.',
    body: 'Jack’s final check-in lands the group bonus for the whole crew. 25 base + 15 bonus — 40 points each.' },
];

export default function TogetherStage() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const compact = useCompact();

  const copyOpacity = useTransform(scrollYProgress, [0.05, 0.11], [0, 1]);
  const ghostOpacity = useTransform(scrollYProgress, [0.62, 0.70], [1, 0]);

  return (
    <section ref={ref} data-act="together" style={{ position: 'relative', height: '500vh' }}>
      <div
        style={{
          position: 'sticky', top: 0, height: '100vh', overflow: 'hidden',
          display: 'flex', alignItems: 'center',
        }}
      >
        {/* Ghost act word — deep background */}
        <motion.div style={{ opacity: ghostOpacity }}>
          <GhostWord progress={scrollYProgress} bottom="5%" left="-1%" drift={[60, -60]} size="clamp(44px, 13vw, 200px)" gold>
            TOGETHER
          </GhostWord>
        </motion.div>

        {/* Beat copy — left column on desktop, bottom dock on compact */}
        {compact ? (
          <MobileCopyDock tag="04 — TOGETHER" tagOpacity={copyOpacity}>
            {PANELS.map((p, i) => (
              <CopyPanel key={i} panel={p} progress={scrollYProgress} compact />
            ))}
          </MobileCopyDock>
        ) : (
          <motion.div
            style={{
              position: 'absolute', left: '7%', top: '50%', y: '-50%', width: 380, maxWidth: '32vw',
              opacity: copyOpacity, zIndex: 30,
            }}
          >
            <SectionTag>04 — TOGETHER</SectionTag>
            <div style={{ position: 'relative', height: 230 }}>
              {PANELS.map((p, i) => (
                <CopyPanel key={i} panel={p} progress={scrollYProgress} />
              ))}
            </div>
          </motion.div>
        )}

        {/* The stage: one card, evolving invite → race → payoff */}
        <div
          style={{
            position: 'absolute', left: compact ? '50%' : '60%', top: compact ? '40%' : '50%',
            transform: 'translate(-50%, -50%)', zIndex: 12,
          }}
        >
          <ChallengeCard progress={scrollYProgress} compact={compact} />
          <BurstPills progress={scrollYProgress} compact={compact} />
        </div>

        <InviteToast progress={scrollYProgress} compact={compact} />
        <MiniToast
          progress={scrollYProgress}
          compact={compact}
          slot={0}
          at={0.46}
          out={0.55}
          icon="checkmark-circle"
          iconColor={GREEN}
          text={<>You finished — <b style={{ fontWeight: w.semiBold, color: t.accent }}>bonus grows as friends finish</b></>}
        />
        <MiniToast
          progress={scrollYProgress}
          compact={compact}
          slot={1}
          at={0.585}
          out={0.67}
          icon="people"
          iconColor={t.accent}
          text={<><b style={{ fontWeight: w.semiBold }}>Sorine</b> finished her part · your bonus is now <b style={{ fontWeight: w.semiBold, color: t.accent }}>+10</b></>}
        />
      </div>
    </section>
  );
}

/* ── The push that starts it ───────────────────────────────────────── */

function InviteToast({ progress, compact }) {
  const y = useTransform(progress, [0.07, 0.14], [-120, 0]);
  const opacity = useTransform(progress, [0.07, 0.11, 0.22, 0.27], [0, 1, 1, 0]);
  return (
    <motion.div
      style={{
        position: 'absolute',
        ...(compact
          ? { top: 'calc(58px + 3vh)', left: '50%', marginLeft: 'min(-40vw, -150px)', width: 'min(80vw, 300px)' }
          : { top: '12%', left: '60%', marginLeft: -150, width: 300 }),
        y, opacity, zIndex: 16,
        display: 'flex', gap: 11, alignItems: 'center', padding: 12,
        background: CARD_SHELL, backdropFilter: 'blur(14px)',
        border: `1px solid ${t.borderCard}`, borderRadius: 18,
        boxShadow: '0 20px 40px -12px rgba(0,0,0,0.6)',
      }}
    >
      <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(14,165,233,0.18)', border: `2px solid ${t.actCycle}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: t.actCycle, fontWeight: w.bold, fontSize: 15 }}>
        S
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: w.bold, letterSpacing: 0.5, color: pg.text }}>POWR</span>
          <span style={{ fontSize: 11, color: pg.textMuted }}>now</span>
        </div>
        <div style={{ fontSize: 13, color: pg.text, fontWeight: w.light, lineHeight: 1.3 }}>
          <b style={{ fontWeight: w.semiBold }}>Sorine</b> challenged the crew — Back Again
        </div>
      </div>
      <Ion name="people" size={16} color={t.accent} style={{ flexShrink: 0 }} />
    </motion.div>
  );
}

/* ── Mid-race asides — the mechanic, teaching itself ───────────────── */

function MiniToast({ progress, compact, slot, at, out, icon, iconColor, text }) {
  const x = useTransform(progress, [at, at + 0.04], [compact ? 40 : -40, 0]);
  const opacity = useTransform(progress, [at, at + 0.03, out, out + 0.04], [0, 1, 1, 0]);
  return (
    <motion.div
      style={{
        position: 'absolute',
        ...(compact
          ? { top: 'calc(58px + 3vh)', left: 22, right: 22 }
          : { top: `${34 + slot * 13}%`, left: '60%', marginLeft: -420, width: 252 }),
        x, opacity, zIndex: 16,
        display: 'flex', gap: 10, alignItems: 'center', padding: '11px 13px',
        background: CARD_SHELL, backdropFilter: 'blur(12px)',
        border: `1px solid ${t.borderCard}`, borderRadius: 14,
        boxShadow: '0 18px 36px -14px rgba(0,0,0,0.6)',
      }}
    >
      <Ion name={icon} size={17} color={iconColor} style={{ flexShrink: 0 }} />
      <div style={{ fontSize: 11.5, color: pg.textSec, fontWeight: w.light, lineHeight: 1.4 }}>{text}</div>
    </motion.div>
  );
}

/* ── The evolving SharedChallengeCard ──────────────────────────────── */

function ChallengeCard({ progress, compact }) {
  const entryY = useTransform(progress, [0.10, 0.18], [60, 0]);
  const entryOpacity = useTransform(progress, [0.10, 0.16], [0, 1]);

  // The three lives of the zone under the title
  const inviteOpacity = useTransform(progress, [0.12, 0.16, 0.31, 0.345], [0, 1, 1, 0]);
  const raceOpacity = useTransform(progress, [0.345, 0.38, 0.685, 0.71], [0, 1, 1, 0]);
  const payoffOpacity = useTransform(progress, [0.71, 0.745], [0, 1]);

  // Payoff glow blooms behind the card as Jack lands it
  const glowOpacity = useTransform(progress, [0.68, 0.78], [0, 1]);
  const ringScale = useTransform(progress, [0.70, 0.82], [0.9, 1.28]);
  const ringOpacity = useTransform(progress, [0.70, 0.74, 0.82], [0, 0.4, 0]);

  // COMPLETE chip stamps in
  const chipOpacity = useTransform(progress, [0.70, 0.74], [0, 1]);
  const chipScale = useTransform(progress, [0.70, 0.76], [1.5, 1]);

  const width = compact ? 'min(88vw, 344px)' : 384;

  return (
    <motion.div style={{ position: 'relative', width, y: entryY, opacity: entryOpacity }}>
      {/* Bloom + one ring, the act's payoff light */}
      <motion.div
        aria-hidden
        style={{
          position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          width: 660, height: 660, borderRadius: '50%', opacity: glowOpacity, pointerEvents: 'none',
          background: 'radial-gradient(circle, rgba(232,210,0,0.10), transparent 62%)',
        }}
      />
      <motion.div
        aria-hidden
        style={{
          position: 'absolute', left: '50%', top: '50%', x: '-50%', y: '-50%',
          width: compact ? 400 : 520, height: compact ? 400 : 520, borderRadius: '50%',
          border: '1px solid rgba(232,210,0,0.45)', scale: ringScale, opacity: ringOpacity, pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative', borderRadius: 22, padding: compact ? 18 : 22,
          background: 'rgba(16,16,18,0.96)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.09)',
          boxShadow: '0 50px 100px -30px rgba(0,0,0,0.9)',
        }}
      >
        {/* Header — the crew + the stake */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex' }}>
            {CREW.map((m, i) => (
              <WebAvatar key={m.initial} member={m} progress={progress} overlap={i > 0} />
            ))}
          </div>
          <div style={{ position: 'relative', height: 24 }}>
            {/* +25 pts, until the COMPLETE chip takes its place */}
            <motion.div style={{ opacity: useTransform(progress, [0.69, 0.72], [1, 0]), display: 'flex', alignItems: 'baseline', gap: 3 }}>
              <span style={{ fontSize: 19, fontWeight: w.extraLight, color: t.accent, letterSpacing: -0.4 }}>+{CHALLENGE.base}</span>
              <span style={{ fontSize: 9, fontWeight: w.medium, color: t.accent, opacity: 0.7 }}>pts</span>
            </motion.div>
            <motion.span
              style={{
                position: 'absolute', right: 0, top: 0,
                opacity: chipOpacity, scale: chipScale, display: 'flex', alignItems: 'center', gap: 4,
                color: GREEN, border: `1.5px solid ${GREEN}`, borderRadius: 6, padding: '3px 8px',
                fontSize: 10, fontWeight: w.bold, letterSpacing: 1, whiteSpace: 'nowrap',
              }}
            >
              <Ion name="checkmark" size={11} color={GREEN} /> COMPLETE
            </motion.span>
          </div>
        </div>

        {/* What it is — real template */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Ion name="barbell-outline" size={18} color={t.accent} />
          <span style={{ fontSize: 22, fontWeight: w.light, color: pg.text, letterSpacing: -0.3 }}>{CHALLENGE.title}</span>
        </div>
        <div style={{ fontSize: 12, fontWeight: w.light, color: pg.textSec, marginTop: 4, marginLeft: 27 }}>
          {CHALLENGE.goal}
        </div>

        {/* The zone — invite → race → payoff, same footprint */}
        <div style={{ position: 'relative', height: compact ? 196 : 204, marginTop: 16 }}>
          <InviteZone progress={progress} opacity={inviteOpacity} />
          <RaceZone progress={progress} opacity={raceOpacity} />
          <PayoffZone progress={progress} opacity={payoffOpacity} compact={compact} />
        </div>
      </div>
    </motion.div>
  );
}

/* Avatar with the app's exact states: pending dim, green ring + tick done */
function WebAvatar({ member, progress, overlap }) {
  // Everyone but Sorine is dim until the crew accepts (0.30–0.34)
  const pendingStart = member.name === 'Sorine' ? 1 : 0.4;
  const dimOpacity = useTransform(progress, [0.30, 0.34], [pendingStart, 1]);
  const ringColor = useTransform(
    progress,
    [member.done - 0.005, member.done + 0.005],
    [member.tint, GREEN],
  );
  const badgeOpacity = useTransform(progress, [member.done, member.done + 0.03], [0, 1]);
  const badgeScale = useTransform(progress, [member.done, member.done + 0.04], [1.6, 1]);
  return (
    <motion.div style={{ position: 'relative', marginLeft: overlap ? -10 : 0, opacity: dimOpacity, zIndex: 1 }}>
      <motion.div
        style={{
          width: 34, height: 34, borderRadius: '50%',
          background: `${member.tint}22`, border: '2px solid', borderColor: ringColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: member.tint, fontSize: 12.5, fontWeight: w.bold,
          boxShadow: '0 0 0 2px rgba(16,16,18,0.96)',
        }}
      >
        {member.initial}
      </motion.div>
      <motion.div
        style={{
          position: 'absolute', right: -3, bottom: -3, width: 14, height: 14, borderRadius: '50%',
          background: GREEN, border: '2px solid rgba(16,16,18,0.96)',
          opacity: badgeOpacity, scale: badgeScale,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Ion name="checkmark" size={7} color="#04240f" />
      </motion.div>
    </motion.div>
  );
}

/* ── Zone 1: the invite ────────────────────────────────────────────── */

function InviteZone({ progress, opacity }) {
  const fillX = useTransform(progress, [0.24, 0.29], [0, 1]);
  const labelColor = useTransform(progress, [0.265, 0.28], ['#E8D200', '#0a0a0a']);
  return (
    <motion.div style={{ position: 'absolute', inset: 0, opacity, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div style={{ fontSize: 12.5, fontWeight: w.light, color: pg.textSec }}>
        <b style={{ fontWeight: w.semiBold, color: pg.text }}>Sorine</b> invited you
        <span style={{ color: t.accent, fontWeight: w.semiBold }}>  ·  +{BONUS} bonus</span>
      </div>
      {/* Accept fills under your scroll — the tap, slowed right down */}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', borderRadius: 100, border: '1.5px solid rgba(232,210,0,0.65)' }}>
          <motion.div aria-hidden style={{ position: 'absolute', inset: 0, background: t.accent, scaleX: fillX, transformOrigin: '0% 50%' }} />
          <motion.div style={{ position: 'relative', textAlign: 'center', padding: '11px 0', fontSize: 12.5, fontWeight: w.bold, letterSpacing: 1.4, color: labelColor }}>
            ACCEPT
          </motion.div>
        </div>
        <div style={{ flex: 1, borderRadius: 100, border: '1px solid rgba(255,255,255,0.14)', textAlign: 'center', padding: '12px 0', fontSize: 12.5, fontWeight: w.medium, letterSpacing: 1.4, color: pg.textSec }}>
          DECLINE
        </div>
      </div>
      {/* The forming rule — no clock until everyone's in */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16, color: pg.textMuted, fontSize: 11, fontWeight: w.light }}>
        <Ion name="lock-closed-outline" size={11} color={pg.textMuted} />
        Clock starts when the whole crew accepts
      </div>
    </motion.div>
  );
}

/* ── Zone 2: the race — everyone's part, ticking over ──────────────── */

function RaceZone({ progress, opacity }) {
  // Your live bonus, stepping up as each friend lands (5/head)
  const bonus = useTransform(
    progress,
    [0, 0.515, 0.525, 0.575, 0.585, 0.655, 0.665],
    [0, 0, 5, 5, 10, 10, 15],
  );
  const bonusText = useTransform(bonus, (v) => `+${Math.round(v)} bonus`);
  const bonusOpacity = useTransform(progress, [0.51, 0.53], [0.25, 1]);
  return (
    <motion.div style={{ position: 'absolute', inset: 0, opacity, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11, flex: 1, marginTop: 2 }}>
        {CREW.map((m) => (
          <MemberRow key={m.initial} member={m} progress={progress} />
        ))}
      </div>
      {/* Footer — live bonus + the running clock */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <motion.span style={{ fontSize: 11.5, fontWeight: w.semiBold, color: t.accent, opacity: bonusOpacity }}>
          {bonusText}
        </motion.span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: w.light, color: pg.textSec }}>
          <Ion name="time-outline" size={12} color={pg.textSec} /> 4d 18h left
        </span>
      </div>
    </motion.div>
  );
}

function MemberRow({ member, progress }) {
  const fillW = useTransform(progress, [member.start, member.done], ['8%', '100%']);
  const fillColor = useTransform(progress, [member.done - 0.005, member.done + 0.005], [t.accent, GREEN]);
  const count = useTransform(progress, [member.start, member.done], [0, CHALLENGE.target]);
  const countText = useTransform(count, (v) => `${Math.min(CHALLENGE.target, Math.floor(v + 0.0001))} / ${CHALLENGE.target}`);
  const countColor = useTransform(progress, [member.done - 0.005, member.done + 0.005], ['rgba(255,255,255,0.5)', GREEN]);
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        paddingLeft: member.isYou ? 8 : 0,
        borderLeft: member.isYou ? `2px solid ${t.accent}` : '2px solid transparent',
      }}
    >
      <div
        style={{
          width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
          background: `${member.tint}22`, border: `1.5px solid ${member.tint}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: member.tint, fontSize: 10.5, fontWeight: w.bold,
        }}
      >
        {member.initial}
      </div>
      <span style={{ width: 52, fontSize: 12, fontWeight: member.isYou ? w.semiBold : w.regular, color: member.isYou ? t.accent : pg.text, flexShrink: 0 }}>
        {member.name}
      </span>
      <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
        <motion.div style={{ height: '100%', borderRadius: 2, width: fillW, background: fillColor }} />
      </div>
      <motion.span style={{ width: 34, textAlign: 'right', fontSize: 11, fontWeight: w.medium, color: countColor, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {countText}
      </motion.span>
    </div>
  );
}

/* ── Zone 3: the payoff — the §6a breakdown, everyone paid ─────────── */

function PayoffZone({ progress, opacity, compact }) {
  const baseIn = useTransform(progress, [0.73, 0.77], [0, 1]);
  const bonusIn = useTransform(progress, [0.765, 0.80], [0, 1]);
  const totalIn = useTransform(progress, [0.81, 0.85], [0, 1]);
  const totalScale = useTransform(progress, [0.81, 0.86, 0.89], [0.8, 1.06, 1]);
  return (
    <motion.div
      style={{
        position: 'absolute', inset: 0, opacity,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <motion.span style={{ opacity: baseIn, fontSize: 15, fontWeight: w.light, color: pg.text }}>
          {CHALLENGE.base} base
        </motion.span>
        <motion.span style={{ opacity: bonusIn, fontSize: 15, fontWeight: w.semiBold, color: t.accent }}>
          + {BONUS} group bonus
        </motion.span>
      </div>
      <motion.div style={{ opacity: totalIn, scale: totalScale, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: compact ? 52 : 60, fontWeight: w.extraLight, letterSpacing: -2, color: t.accent, lineHeight: 1 }}>
          {TOTAL}
        </span>
        <span style={{ fontSize: 13, fontWeight: w.semiBold, letterSpacing: 2, color: 'rgba(232,210,0,0.6)' }}>
          EACH
        </span>
      </motion.div>
      <motion.div style={{ opacity: totalIn, fontSize: 11.5, fontWeight: w.light, color: pg.textSec }}>
        Whole crew home — everyone banks it
      </motion.div>
    </motion.div>
  );
}

/* Four +40s, one to each of the crew, bursting off the card */
const BURSTS = [
  { dx: -150, dy: -110, rot: -8 },
  { dx: -56,  dy: -140, rot: -3 },
  { dx: 56,   dy: -140, rot: 3 },
  { dx: 150,  dy: -110, rot: 8 },
];

function BurstPills({ progress, compact }) {
  return BURSTS.map((b, i) => (
    <BurstPill key={i} spec={b} progress={progress} compact={compact} index={i} />
  ));
}

function BurstPill({ spec, progress, compact, index }) {
  const at = 0.73 + index * 0.02;
  const k = compact ? 0.62 : 1;
  // Launch already spread so the four never stack on one origin
  const x = useTransform(progress, [at, at + 0.10], [spec.dx * k * 0.35, spec.dx * k]);
  const y = useTransform(progress, [at, at + 0.10], [spec.dy * k * 0.2, spec.dy * k]);
  const opacity = useTransform(progress, [at, at + 0.03, at + 0.14, at + 0.19], [0, 1, 1, 0]);
  const scale = useTransform(progress, [at, at + 0.05], [0.5, 1]);
  return (
    <motion.div
      style={{
        position: 'absolute', left: '50%', top: 0, marginLeft: -28,
        x, y, opacity, scale, rotate: spec.rot, zIndex: 18, pointerEvents: 'none',
        padding: '6px 13px', borderRadius: 100,
        background: t.accent, color: t.onAccent,
        fontSize: 14, fontWeight: w.bold,
        boxShadow: '0 12px 28px -8px rgba(232,210,0,0.5)',
      }}
    >
      +{TOTAL}
    </motion.div>
  );
}
