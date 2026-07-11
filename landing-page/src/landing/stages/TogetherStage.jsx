import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { pg, t, w } from '../theme';
import Ion from '../Ionicon';
import { SectionTag, CopyPanel, GhostWord, MobileCopyDock, useCompact } from './shared';

/**
 * Act IV — Together. Four beats:
 *  1. Friend joins (FriendToast) + crew activity card (FriendActivityCard)
 *  2. Crew challenge (CrewChallengeCard) — vertical member list with session dots
 *  3. Crew bonus burst
 *  4. League podium rises (LeagueWeekLabel + PodiumCols + CrewStatsBar)
 */
const PANELS = [
  { range: [0.14, 0.20, 0.32, 0.36], title: 'Fitness is better with your crew.',
    body: 'Add friends with a QR scan and every session starts counting for more than just you.' },
  { range: [0.38, 0.44, 0.54, 0.58], title: 'Challenges you take on together.',
    body: 'Everyone has to finish — no passengers. The bigger the crew, the bigger the bonus.' },
  { range: [0.60, 0.65, 0.75, 0.79], title: 'Win together, earn together.',
    body: 'The moment the last of you finishes, the crew bonus lands for everyone at once.' },
  { range: [0.81, 0.86, 0.96, 1.0], title: 'Then climb the podium.',
    body: 'A weekly league of the people you actually train with. Bragging rights, refreshed every Monday.' },
];

// league.tsx RANK_META — points match FRIEND_ACTS ranking
const META = {
  1: { colour: t.gold,   platformH: 108, avatar: 72, label: '1ST', name: 'Maya',   initials: 'M', pts: 355 },
  2: { colour: t.silver, platformH: 74,  avatar: 56, label: '2ND', name: 'Sorine', initials: 'S', pts: 310 },
  3: { colour: t.bronze, platformH: 54,  avatar: 46, label: '3RD', name: 'Jack',   initials: 'J', pts: 285 },
};
const ORDER = [2, 1, 3];
const COL_W = 116;

// Full weekly league leaderboard — hero element for panels 1–3
const LEADERBOARD = [
  { rank: 1, initial: 'M', name: 'Maya',   tint: '#EC4899',  pts: 355, acts: ['barbell-outline', 'bicycle-outline', 'footsteps-outline'], change: +3 },
  { rank: 2, initial: 'S', name: 'Sorine', tint: t.actCycle, pts: 310, acts: ['barbell-outline', 'bicycle-outline'],                    change:  0 },
  { rank: 3, initial: 'J', name: 'Jack',   tint: '#88CC28',  pts: 285, acts: ['barbell-outline', 'footsteps-outline'],                  change: -1 },
  { rank: 4, initial: 'Y', name: 'You',    tint: t.accent,   pts: 240, acts: ['barbell-outline', 'footsteps-outline'],                  change: +2, isYou: true },
  { rank: 5, initial: 'A', name: 'Alex',   tint: '#6366F1',  pts: 198, acts: ['barbell-outline'],                                      change: -2 },
];
const RANK_BADGE_COLOURS = { 1: t.gold, 2: t.silver, 3: t.bronze };

// Crew members: challenge card + tick timeline (You + 3 friends)
const CREW = [
  { initial: 'Y', name: 'You',    tint: t.accent,   at: 0.40, done: 3, total: 3, isYou: true },
  { initial: 'M', name: 'Maya',   tint: '#EC4899',  at: 0.46, done: 3, total: 3 },
  { initial: 'S', name: 'Sorine', tint: t.actCycle, at: 0.52, done: 3, total: 3 },
  { initial: 'J', name: 'Jack',   tint: '#88CC28',  at: 0.58, done: 3, total: 3 },
];

const CREW_INITIALS = new Set(['Y', 'M', 'S', 'J']);
const CREW_TOTAL_PTS = LEADERBOARD.filter(e => CREW_INITIALS.has(e.initial)).reduce((s, e) => s + e.pts, 0);

export default function TogetherStage() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const compact = useCompact();

  const copyOpacity = useTransform(scrollYProgress, [0.10, 0.16], [0, 1]);
  const podiumGlow = useTransform(scrollYProgress, [0.75, 0.9], [0, 1]);

  const colW = compact ? 92 : COL_W;

  return (
    <section ref={ref} style={{ position: 'relative', height: '480vh' }}>
      <div
        style={{
          position: 'sticky', top: 0, height: '100vh', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {/* Ghost act word — deep background */}
        <GhostWord progress={scrollYProgress} bottom="4%" left="-1%" drift={[60, -60]} size="clamp(110px, 13vw, 200px)">
          TOGETHER
        </GhostWord>

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

        {/* Podium assembly + all floating cards (right of centre on desktop) */}
        <div style={{ position: 'relative', transform: compact ? 'translateY(-6vh)' : 'translateX(60px)' }}>
          {/* Champion glow */}
          <motion.div
            style={{
              position: 'absolute', left: '50%', top: -60, x: '-50%', width: 420, height: 420,
              borderRadius: '50%', opacity: podiumGlow, pointerEvents: 'none',
              background: 'radial-gradient(circle, rgba(232,210,0,0.10), transparent 65%)',
            }}
          />

          {/* League week label rises with the podium */}
          <LeagueWeekLabel progress={scrollYProgress} compact={compact} />

          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            {ORDER.map((rank, i) => (
              <PodiumCol key={rank} rank={rank} index={i} progress={scrollYProgress} colW={colW} />
            ))}
          </div>

          {/* Crew stats — below the podium platforms */}
          <CrewStatsBar progress={scrollYProgress} />

          <FriendToast progress={scrollYProgress} compact={compact} />
          <CrewChallengeCard progress={scrollYProgress} compact={compact} colW={colW} />
          <CrewBonusBurst progress={scrollYProgress} compact={compact} colW={colW} />
        </div>

        {/* Leaderboard panel — hero for panels 1–3; on compact it hands the
            centre stage to the crew card instead of coexisting beside it */}
        <LeaderboardPanel progress={scrollYProgress} compact={compact} />
      </div>
    </section>
  );
}

/* ── League week label — fades in above podium when it rises ── */
function LeagueWeekLabel({ progress, compact }) {
  const opacity = useTransform(progress, [0.76, 0.84], [0, 1]);
  const y = useTransform(progress, [0.76, 0.84], [14, 0]);
  return (
    <motion.div
      style={{
        position: 'absolute', top: compact ? -226 : -268, left: '50%', x: '-50%',
        opacity, y, zIndex: 12, textAlign: 'center', pointerEvents: 'none',
      }}
    >
      <div style={{ fontSize: 10, fontWeight: w.semiBold, letterSpacing: 2.5, color: pg.textMuted, textTransform: 'uppercase' }}>
        Weekly League
      </div>
      <div style={{ fontSize: 11, fontWeight: w.light, color: pg.textMuted, letterSpacing: 0.3, marginTop: 3 }}>
        Jun 30 – Jul 6
      </div>
    </motion.div>
  );
}

/* ── Crew stats bar — materialises below the podium platforms ── */
function CrewStatsBar({ progress }) {
  const opacity = useTransform(progress, [0.84, 0.90], [0, 1]);
  const y = useTransform(progress, [0.84, 0.90], [14, 0]);
  return (
    <motion.div
      style={{
        position: 'absolute', bottom: -48, left: '50%', x: '-50%',
        opacity, y, zIndex: 12, display: 'flex', alignItems: 'center', gap: 0, whiteSpace: 'nowrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Ion name="people-outline" size={13} color={pg.textMuted} />
        <span style={{ fontSize: 11, fontWeight: w.light, color: pg.textMuted }}>
          Crew · <span style={{ color: pg.text, fontWeight: w.regular }}>4 members</span>
        </span>
      </div>
      <div style={{ width: 1, height: 14, background: pg.border, margin: '0 16px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Ion name="sparkles" size={13} color={t.accent} />
        <span style={{ fontSize: 11, fontWeight: w.light, color: pg.textMuted }}>
          This week · <span style={{ color: t.accent, fontWeight: w.semiBold }}>{CREW_TOTAL_PTS.toLocaleString()} pts</span>
        </span>
      </div>
    </motion.div>
  );
}

/* ── One podium column — real league.tsx anatomy, rising into place ── */
function PodiumCol({ rank, index, progress, colW = COL_W }) {
  const meta = META[rank];
  const isFirst = rank === 1;
  const at = 0.74 + index * 0.04;
  const y = useTransform(progress, [at, at + 0.08], [110, 0]);
  const opacity = useTransform(progress, [at, at + 0.06], [0, 1]);

  return (
    <motion.div style={{ y, opacity, width: colW, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {isFirst ? (
        <Ion name="trophy" size={20} color={t.gold} style={{ marginBottom: 6 }} />
      ) : (
        <span style={{ fontSize: 8, fontWeight: w.bold, letterSpacing: 2, color: meta.colour, opacity: 0.7, marginBottom: 8, fontFamily: t.font }}>
          {meta.label}
        </span>
      )}

      {/* Avatar with rank-colour ring */}
      <div
        style={{
          width: meta.avatar, height: meta.avatar, borderRadius: '50%', marginBottom: 6,
          border: `${isFirst ? 2 : 1.5}px solid ${meta.colour}`,
          background: '#1A1A1A', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: meta.avatar * 0.3, fontWeight: w.medium, color: meta.colour, fontFamily: t.font }}>
          {meta.initials}
        </span>
      </div>

      <span style={{
        fontSize: isFirst ? 12 : 10, fontWeight: isFirst ? w.regular : w.light,
        color: isFirst ? pg.text : t.dim, marginBottom: 10, fontFamily: t.font,
      }}>
        {meta.name}
      </span>

      {/* Platform with gradient + 2px top border */}
      <div
        style={{
          width: colW, height: meta.platformH,
          borderTopLeftRadius: 8, borderTopRightRadius: 8,
          background: `linear-gradient(180deg, ${meta.colour}22, ${meta.colour}06)`,
          borderTop: `2px solid ${meta.colour}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
        }}
      >
        <span style={{ fontSize: isFirst ? 17 : 13, fontWeight: w.extraLight, color: meta.colour, letterSpacing: -0.5 }}>
          {meta.pts.toLocaleString()}
        </span>
        <span style={{ fontSize: 8, fontWeight: w.medium, letterSpacing: 1.5, color: meta.colour, opacity: 0.6 }}>PTS</span>
      </div>
    </motion.div>
  );
}

/* ── Friend joins — push toast dropping above the podium ── */
function FriendToast({ progress, compact }) {
  const y = useTransform(progress, [0.16, 0.24], [-140, 0]);
  const opacity = useTransform(progress, [0.16, 0.20, 0.34, 0.40], [0, 1, 1, 0]);
  return (
    <motion.div
      style={{
        position: 'absolute', top: compact ? -216 : -170, left: '50%', x: '-50%',
        width: compact ? 'min(80vw, 300px)' : 300, y, opacity, zIndex: 14,
        display: 'flex', gap: 11, alignItems: 'center', padding: 12,
        background: 'rgba(20,20,22,0.92)', backdropFilter: 'blur(14px)',
        border: `1px solid ${t.borderCard}`, borderRadius: 18,
        boxShadow: '0 20px 40px -12px rgba(0,0,0,0.6)',
      }}
    >
      <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(236,72,153,0.2)', border: '2px solid #EC4899', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#EC4899', fontWeight: w.bold, fontSize: 15, fontFamily: t.font }}>
        M
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: w.bold, letterSpacing: 0.5, color: pg.text }}>POWR</span>
          <span style={{ fontSize: 11, color: pg.textMuted }}>now</span>
        </div>
        <div style={{ fontSize: 13, color: pg.text, fontWeight: w.light, lineHeight: 1.3 }}>
          <b style={{ fontWeight: w.semiBold }}>Maya</b> joined your crew
        </div>
      </div>
      <Ion name="person-add" size={16} color={t.accent} style={{ flexShrink: 0 }} />
    </motion.div>
  );
}

/* ── Leaderboard panel — the persistent hero surface for panels 1–3 ── */
function LeaderboardPanel({ progress, compact }) {
  // Compact re-sequences the act: the leaderboard exits before the crew
  // challenge card arrives, since both own the centre of a phone screen
  const opacity = useTransform(
    progress,
    compact ? [0.10, 0.16, 0.32, 0.40] : [0.10, 0.16, 0.76, 0.84],
    [0, 1, 1, 0],
  );
  const slideY = useTransform(progress, [0.10, 0.16], [20, 0]);
  return (
    <div
      style={{
        position: 'absolute', zIndex: 10,
        ...(compact
          ? { left: '50%', top: '44%', transform: 'translate(-50%, -50%)' }
          : { left: 'calc(50% - 120px)', top: '50%', transform: 'translateY(-50%)' }),
      }}
    >
      <motion.div
        style={{
          width: compact ? 'min(88vw, 360px)' : 360, opacity, y: slideY,
          background: 'rgba(14,14,16,0.96)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.09)', borderRadius: 22,
          padding: '18px 20px',
          boxShadow: '0 50px 100px -30px rgba(0,0,0,0.9), 0 0 80px -30px rgba(232,210,0,0.05)',
        }}
      >
        {/* Panel header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: pg.textMuted, fontSize: 10, fontWeight: w.semiBold, letterSpacing: 1.8 }}>
            <Ion name="trophy" size={12} color={pg.textMuted} /> WEEKLY LEAGUE
          </span>
          <span style={{ fontSize: 10, color: pg.textMuted }}>Jun 30 – Jul 6</span>
        </div>
        {LEADERBOARD.map((entry, i) => (
          <LeaderboardRow key={entry.rank} entry={entry} progress={progress} index={i} isLast={i === LEADERBOARD.length - 1} />
        ))}
      </motion.div>
    </div>
  );
}

function LeaderboardRow({ entry, progress, index, isLast }) {
  const at = 0.12 + index * 0.05;
  const rowY = useTransform(progress, [at, at + 0.06], [12, 0]);
  const rowOpacity = useTransform(progress, [at, at + 0.06], [0, 1]);
  const barWidth = useTransform(progress, [at + 0.02, at + 0.18], ['0%', `${Math.round(entry.pts / 355 * 100)}%`]);

  const rankColour = RANK_BADGE_COLOURS[entry.rank] ?? (entry.isYou ? t.accent : pg.textMuted);
  const changeColour = entry.change > 0 ? t.success : entry.change < 0 ? '#CC4444' : pg.textMuted;
  const changeText = entry.change > 0 ? `↑${entry.change}` : entry.change < 0 ? `↓${Math.abs(entry.change)}` : '—';

  return (
    <motion.div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        paddingBottom: isLast ? 0 : 11, marginBottom: isLast ? 0 : 11,
        borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.05)',
        paddingLeft: 8,
        borderLeft: entry.isYou ? `2px solid ${t.accent}` : '2px solid transparent',
        opacity: rowOpacity, y: rowY,
      }}
    >
      {/* Rank badge */}
      <div style={{ width: 22, textAlign: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: w.bold, color: rankColour }}>#{entry.rank}</span>
      </div>

      {/* Avatar */}
      <div style={{
        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
        background: `${entry.tint}22`, border: `1.5px solid ${entry.tint}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: entry.tint, fontSize: 12, fontWeight: w.bold, fontFamily: t.font,
      }}>
        {entry.initial}
      </div>

      {/* Name + activity icons + pts + bar */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: entry.isYou ? w.semiBold : w.regular, color: entry.isYou ? t.accent : pg.text, fontFamily: t.font }}>
              {entry.name}
            </span>
            <div style={{ display: 'flex', gap: 3 }}>
              {entry.acts.map((a, j) => <Ion key={j} name={a} size={11} color={pg.textMuted} />)}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
            <span style={{ fontSize: 13, fontWeight: w.semiBold, color: entry.isYou ? t.accent : pg.text, letterSpacing: -0.3, fontFamily: t.font }}>{entry.pts}</span>
            <span style={{ fontSize: 9, fontWeight: w.medium, color: pg.textMuted, letterSpacing: 1 }}>PTS</span>
          </div>
        </div>
        {/* Animated fill bar */}
        <div style={{ height: 2, background: 'rgba(255,255,255,0.07)', borderRadius: 1, overflow: 'hidden' }}>
          <motion.div style={{ height: '100%', background: entry.tint, borderRadius: 1, width: barWidth }} />
        </div>
      </div>

      {/* Rank change */}
      <div style={{ width: 24, textAlign: 'right', flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: w.semiBold, color: changeColour }}>{changeText}</span>
      </div>
    </motion.div>
  );
}

/* ── Crew challenge card — vertical member list with session progress ── */
function CrewChallengeCard({ progress, compact, colW = COL_W }) {
  // Compact: wait for the leaderboard to clear the centre before sliding in
  const at = compact ? 0.42 : 0.36;
  const x = useTransform(progress, [at, at + 0.10], [compact ? 320 : 520, 0]);
  const opacity = useTransform(progress, [at, at + 0.05, 0.72, 0.78], [0, 1, 1, 0]);
  const rot = useTransform(progress, [at, at + 0.10], [7, 0]);
  const doneOpacity = useTransform(progress, [0.62, 0.67], [0, 1]);
  const doneScale = useTransform(progress, [0.62, 0.68], [1.4, 1]);
  return (
    <motion.div
      style={{
        // Compact: takes the centre stage the leaderboard just vacated
        ...(compact
          ? { top: -130, left: '50%', marginLeft: -131, width: 262 }
          : { top: 40, left: colW * 3 + 70, width: 262 }),
        position: 'absolute', x, opacity, rotate: rot, zIndex: 16,
        background: 'rgba(24,24,26,0.88)', backdropFilter: 'blur(12px)', border: `1px solid ${t.borderCard}`,
        borderRadius: 18, padding: 16, boxShadow: '0 30px 60px -18px rgba(0,0,0,0.7)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: pg.textMuted, fontSize: 10, fontWeight: w.semiBold, letterSpacing: 1.6 }}>
          <Ion name="people-outline" size={13} color={pg.textMuted} /> CREW CHALLENGE
        </span>
        <motion.span
          style={{
            opacity: doneOpacity, scale: doneScale, display: 'flex', alignItems: 'center', gap: 4,
            color: t.success, border: `1.5px solid ${t.success}`, borderRadius: 6, padding: '3px 8px',
            fontSize: 10, fontWeight: w.bold, letterSpacing: 1,
          }}
        >
          <Ion name="checkmark" size={11} color={t.success} /> COMPLETE
        </motion.span>
      </div>

      {/* Challenge title */}
      <div style={{ color: pg.text, fontSize: 14.5, fontWeight: w.semiBold, marginBottom: 2 }}>3 gym sessions each</div>
      <div style={{ color: pg.textMuted, fontSize: 11, fontWeight: w.light, marginBottom: 14 }}>Crew of 4 · ends Sunday</div>

      {/* Member progress list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {CREW.map((m, i) => (
          <CrewMemberRow key={i} member={m} progress={progress} />
        ))}
      </div>
    </motion.div>
  );
}

/* One crew member row: avatar + tick + name + session dots + count */
function CrewMemberRow({ member, progress }) {
  const { initial, name, tint, at, done, total, isYou } = member;
  const tickOpacity = useTransform(progress, [at, at + 0.04], [0, 1]);
  const tickScale = useTransform(progress, [at, at + 0.05], [1.6, 1]);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 9,
      paddingLeft: isYou ? 7 : 0,
      borderLeft: isYou ? `2px solid ${t.accent}` : '2px solid transparent',
    }}>
      {/* Avatar with tick overlay */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: `${tint}22`, border: `1.5px solid ${tint}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: tint, fontSize: 11, fontWeight: w.bold, fontFamily: t.font,
        }}>
          {initial}
        </div>
        <motion.div style={{
          position: 'absolute', right: -4, bottom: -4, width: 14, height: 14, borderRadius: '50%',
          background: t.success, border: `2px solid rgba(24,24,26,0.88)`,
          opacity: tickOpacity, scale: tickScale,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Ion name="checkmark" size={7} color="#04240f" />
        </motion.div>
      </div>

      {/* Name */}
      <span style={{ flex: 1, fontSize: 12, fontWeight: isYou ? w.semiBold : w.regular, color: isYou ? t.accent : pg.text, fontFamily: t.font }}>
        {name}
      </span>

      {/* Session dots */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: '50%',
            background: i < done ? tint : 'rgba(255,255,255,0.12)',
          }} />
        ))}
      </div>

      {/* n/total count */}
      <span style={{ fontSize: 11, fontWeight: w.medium, color: pg.textMuted, minWidth: 22, textAlign: 'right', fontFamily: t.font }}>
        {done}/{total}
      </span>
    </div>
  );
}

/* ── Crew bonus burst — lands as the challenge completes ── */
function CrewBonusBurst({ progress, compact, colW = COL_W }) {
  const x = useTransform(progress, [0.64, 0.72], [compact ? 140 : 260, 0]);
  const y = useTransform(progress, [0.64, 0.72], [90, 0]);
  const opacity = useTransform(progress, [0.64, 0.68, 0.80, 0.85], [0, 1, 1, 0]);
  const scale = useTransform(progress, [0.64, 0.70, 0.74], [0.7, 1.06, 1]);
  return (
    <motion.div
      style={{
        ...(compact
          ? { top: 168, left: '50%', marginLeft: -110 }
          : { bottom: -40, left: colW * 3 + 90 }),
        position: 'absolute', x, y, opacity, scale, zIndex: 18,
        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px',
        background: t.accent, color: t.onAccent, borderRadius: 18,
        boxShadow: '0 24px 50px -14px rgba(232,210,0,0.5)',
      }}
    >
      <Ion name="people" size={26} color={t.onAccent} />
      <div style={{ whiteSpace: 'nowrap' }}>
        <div style={{ fontSize: 30, fontWeight: w.bold, lineHeight: 1, letterSpacing: -1 }}>+30</div>
        <div style={{ fontSize: 10, fontWeight: w.bold, letterSpacing: 2, opacity: 0.7, marginTop: 3 }}>CREW BONUS · EVERYONE</div>
      </div>
    </motion.div>
  );
}
