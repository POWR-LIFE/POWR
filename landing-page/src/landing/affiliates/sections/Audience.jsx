import { motion } from 'framer-motion';
import { pg, w } from '../../theme';
import { Section, rise } from '../../partners/bits';
import { useCompact } from '../../stages/shared';

/**
 * WHO IT'S FOR — a strip, not a chapter. The people with a room, a group
 * chat or an audience that already trains. Deliberately no "influencer"
 * anywhere: the programme was renamed away from "creator" because it read
 * as content-making, and the people we want most run sessions, not channels.
 */
const WHO = [
  { who: 'PTs & coaches', line: 'Every client you already have is a conversion waiting to be logged.' },
  { who: 'Gym owners & studios', line: 'A QR by the door. Your members earn for turning up — and so do you.' },
  { who: 'Run clubs & crews', line: 'One link in the group chat. A run recorded on a phone counts as much as one off a watch.' },
  { who: 'Athletes', line: 'People copy what you do. Now what you do pays them to start.' },
  { who: 'Anyone with a following that moves', line: 'If your audience trains, your link works. If they don’t, it doesn’t — and we would rather you knew.' },
];

export default function Audience() {
  const compact = useCompact(900);
  return (
    <Section tight style={{ borderTop: `1px solid ${pg.border}`, borderBottom: `1px solid ${pg.border}` }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? '1fr' : 'minmax(0, 300px) minmax(0, 1fr)',
          gap: compact ? 24 : 60, alignItems: 'start',
        }}
      >
        <motion.div variants={rise}>
          <div style={{ fontSize: 10.5, fontWeight: w.semiBold, letterSpacing: 4, color: pg.accent, marginBottom: 14 }}>BUILT FOR</div>
          <h2 style={{ margin: 0, fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: w.extraLight, letterSpacing: -1, lineHeight: 1.1, color: pg.text }}>
            People whose people
            <br />
            already train.
          </h2>
        </motion.div>

        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(2, 1fr)', gap: '18px 36px' }}>
          {WHO.map((item) => (
            <motion.div key={item.who} variants={rise} style={{ borderLeft: `1px solid rgba(232,210,0,0.35)`, paddingLeft: 16 }}>
              <div style={{ fontSize: 15, fontWeight: w.medium, color: pg.text, letterSpacing: -0.2 }}>{item.who}</div>
              <div style={{ marginTop: 5, fontSize: 13, lineHeight: 1.55, color: pg.textSec, fontWeight: w.light }}>{item.line}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </Section>
  );
}
