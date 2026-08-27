import { motion } from 'framer-motion';
import { pg, w } from '../../theme';
import { GhostLabel, Kicker, Panel, Section, SectionHead, rise } from '../../partners/bits';
import { useCompact } from '../../stages/shared';
import { CONVERSION_PTS, INVITEE_PTS } from '../data';

/**
 * 01 — THE DEAL. What you actually earn, in three numbers.
 *
 * The figures are the Default programme's (see data.js). The line about
 * verification is the programme's one non-negotiable — manual sessions
 * never convert, for anyone — and it is what makes the whole thing worth
 * more than a discount code, so it sits in the headline, not a footnote.
 */
const TILES = [
  {
    value: `${CONVERSION_PTS}`,
    unit: 'pts',
    title: 'To you, every conversion',
    body: 'Someone joins with your code and logs their first session POWR can verify — gym, run, ride, class. Fifty points land on your balance. Every time, no cap.',
    lit: true,
  },
  {
    value: `${INVITEE_PTS}`,
    unit: 'pts',
    title: 'To them, the same moment',
    body: 'The person you brought in is paid too. Your code is worth something to use, not just something to share — that is why people bother.',
  },
  {
    value: '+',
    unit: 'rewards',
    title: 'Rewards at every step',
    body: 'Hit a step on your ladder and there is a bonus on top — points, and a reward from a POWR partner. Physical or digital, it is yours to keep.',
  },
];

export default function Deal() {
  const compact = useCompact(900);
  return (
    <Section id="deal" style={{ overflow: 'hidden' }}>
      <GhostLabel top={30} right={-30} gold>THE DEAL</GhostLabel>

      <SectionHead
        n="01"
        label="The deal"
        title={<>Not a discount code.<br />A person who trained.</>}
        body="Most referral schemes pay on a download and call it growth. POWR pays when the person you brought in actually moves — a check-in at the gym door, a run or ride their phone recorded, a session off their watch. Typed-in workouts never count. For anyone."
      />

      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(3, 1fr)', gap: 14 }}>
        {TILES.map((tile) => (
          <Panel key={tile.title} lit={tile.lit} style={{ padding: compact ? '26px 24px' : '32px 30px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span
                style={{
                  fontSize: 'clamp(52px, 6vw, 76px)', fontWeight: w.extraLight, letterSpacing: -3,
                  lineHeight: 0.95, color: tile.lit ? pg.accent : pg.text, fontVariantNumeric: 'tabular-nums',
                }}
              >
                {tile.value}
              </span>
              <Kicker color={tile.lit ? pg.accent : pg.textSec}>{tile.unit}</Kicker>
            </div>
            <h3 style={{ margin: '18px 0 0', fontSize: 18, fontWeight: w.medium, letterSpacing: -0.3, color: pg.text }}>
              {tile.title}
            </h3>
            <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.62, color: pg.textSec, fontWeight: w.light }}>
              {tile.body}
            </p>
          </Panel>
        ))}
      </div>

      <motion.div
        variants={rise}
        style={{
          marginTop: 22, display: 'flex', flexWrap: 'wrap', gap: '10px 28px', alignItems: 'center',
          fontSize: 12.5, color: pg.textMuted, fontWeight: w.light,
        }}
      >
        <span><b style={{ color: pg.textSec, fontWeight: w.medium }}>Verified means</b> a geofenced gym check-in, or a session recorded by their phone or wearable — no watch required.</span>
        <span><b style={{ color: pg.textSec, fontWeight: w.medium }}>No cash.</b> Points spend in the app like everyone else’s; step rewards are sent to you.</span>
      </motion.div>
    </Section>
  );
}
