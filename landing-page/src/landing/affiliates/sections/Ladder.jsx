import { motion } from 'framer-motion';
import { pg, t, w } from '../../theme';
import { GhostLabel, Kicker, Section, SectionHead, rise } from '../../partners/bits';
import { useCompact } from '../../stages/shared';
import { CONVERSION_PTS, DEMO, LADDER } from '../data';

/**
 * 03 — THE LADDER. The steps, drawn the way the app draws them.
 *
 * Rail + nodes + "reached / you're here / locked" is the in-app ladder's
 * anatomy (app/affiliate.tsx). The position shown is the hero's affiliate
 * (41 conversions), so the two sections agree. Locked steps stay VISIBLE —
 * dimmed, never hidden — because the point of a ladder is seeing the top.
 */
export default function Ladder() {
  const compact = useCompact(900);
  const at = DEMO.converted;
  const nextIdx = LADDER.findIndex((s) => s.n > at);

  return (
    <Section id="ladder" style={{ overflow: 'hidden' }}>
      <GhostLabel top={20} right={-30} gold>THE LADDER</GhostLabel>

      <SectionHead
        n="03"
        label="The ladder"
        title={<>Every conversion pays.<br />Every step pays extra.</>}
        body={`The ${CONVERSION_PTS} points per conversion never stop. On top of that, your ladder has steps — and each one you reach is a bonus in points plus, at the steps that carry one, a reward from a POWR partner — physical or digital. If something needs posting, we ask for an address then, not before.`}
      />

      <motion.div variants={rise} style={{ position: 'relative' }}>
        {/* Each step draws its own two half-segments of the rail (before and
            after its node) so the gold portion ends exactly at the "you're
            here" node whatever the column widths or row heights are. */}
        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : `repeat(${LADDER.length}, 1fr)`, gap: 0 }}>
          {LADDER.map((s, i) => {
            const reached = i < nextIdx;
            const here = i === nextIdx;
            return (
              <div
                key={s.n}
                style={{
                  position: 'relative',
                  paddingLeft: compact ? 56 : 12,
                  paddingRight: compact ? 0 : 12,
                  paddingTop: compact ? 0 : 60,
                  paddingBottom: compact ? 30 : 0,
                  textAlign: compact ? 'left' : 'center',
                }}
              >
                <RailSegment compact={compact} side="before" gold={i <= nextIdx} hidden={i === 0} />
                <RailSegment compact={compact} side="after" gold={i < nextIdx} hidden={i === LADDER.length - 1} />
                <div style={{ opacity: reached || here ? 1 : 0.5 }}>
                {/* Node */}
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: compact ? 10 : '50%', top: compact ? 2 : 22,
                    transform: compact ? 'none' : 'translateX(-50%)',
                    width: 23, height: 23, borderRadius: '50%',
                    background: reached ? pg.accent : pg.bg,
                    border: `1.5px solid ${reached || here ? pg.accent : 'rgba(255,255,255,0.2)'}`,
                    boxShadow: here ? '0 0 0 6px rgba(232,210,0,0.12), 0 0 22px rgba(232,210,0,0.45)' : '0 0 0 5px rgba(8,8,8,1)',
                    display: 'grid', placeItems: 'center',
                  }}
                >
                  {reached && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={pg.onAccent} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  )}
                  {here && <span style={{ width: 7, height: 7, borderRadius: '50%', background: pg.accent, animation: 'powrPulse 1.8s ease-in-out infinite' }} />}
                </div>

                <div
                  style={{
                    fontSize: 'clamp(40px, 5vw, 60px)', fontWeight: w.extraLight, letterSpacing: -2,
                    lineHeight: 1, color: here ? pg.accent : pg.text, fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {s.n}
                </div>
                <div style={{ marginTop: 6, fontSize: 11, letterSpacing: 2.4, textTransform: 'uppercase', color: pg.textMuted, fontWeight: w.semiBold }}>
                  conversions
                </div>
                <h3 style={{ margin: '14px 0 0', fontSize: 19, fontWeight: w.medium, letterSpacing: -0.3, color: pg.text }}>
                  {s.label}
                </h3>
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: compact ? 'flex-start' : 'center' }}>
                  <Chip gold>+{s.points.toLocaleString()} pts</Chip>
                  {s.reward && <Chip>+ a reward</Chip>}
                </div>
                <div style={{ marginTop: 12, minHeight: 18 }}>
                  {reached && <Kicker color={pg.textMuted}>Reached</Kicker>}
                  {here && (
                    <span
                      style={{
                        display: 'inline-block', padding: '5px 10px', borderRadius: 100,
                        border: `1px solid ${pg.accent}`, color: pg.accent,
                        fontSize: 9.5, letterSpacing: 2, fontWeight: w.semiBold, textTransform: 'uppercase',
                      }}
                    >
                      You’re here · {s.n - at} to go
                    </span>
                  )}
                  {!reached && !here && <Kicker color={pg.textMuted}>Locked</Kicker>}
                </div>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      <motion.div
        variants={rise}
        style={{
          marginTop: 48, paddingTop: 24, borderTop: `1px solid ${pg.border}`,
          display: 'grid', gridTemplateColumns: compact ? '1fr' : '1fr 1fr', gap: compact ? 18 : 40,
        }}
      >
        <p style={{ margin: 0, fontSize: 'clamp(16px, 2vw, 22px)', fontWeight: w.extraLight, letterSpacing: -0.4, lineHeight: 1.4, color: pg.text }}>
          At {DEMO.converted} conversions our affiliate has banked{' '}
          <span style={{ color: t.accent }}>{DEMO.points.toLocaleString()} points</span> and two step rewards —
          and the next {LADDER[nextIdx].n - DEMO.converted} people pay exactly the same as the first.
        </p>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.65, color: pg.textMuted, fontWeight: w.light }}>
          Steps and rewards are set by the programme you are on. We can change them for future
          conversions; anything you have already earned stays earned. Physical rewards are approved by a person
          before they ship; digital ones are sent straight to you. We may substitute an item of equal or higher value if something is out of stock.
        </p>
      </motion.div>
    </Section>
  );
}

/* Half a rail: from the column edge to the node (before) or node to edge (after). */
function RailSegment({ compact, side, gold, hidden }) {
  if (hidden) return null;
  const base = {
    position: 'absolute', pointerEvents: 'none',
    background: gold ? pg.accent : 'rgba(255,255,255,0.1)',
    boxShadow: gold ? '0 0 14px rgba(232,210,0,0.45)' : 'none',
  };
  if (compact) {
    // Node sits at top: 2, 23px tall → centre x = 21, centre y = 13.5
    return (
      <span
        aria-hidden
        style={{
          ...base, left: 21, width: 1,
          top: side === 'before' ? -30 : 14,
          bottom: side === 'before' ? 'auto' : 0,
          height: side === 'before' ? 44 : 'auto',
        }}
      />
    );
  }
  // Node sits at top: 22, 23px tall → centre y = 33.5; it is centred in the column
  return (
    <span
      aria-hidden
      style={{
        ...base, top: 33, height: 1,
        left: side === 'before' ? 0 : '50%',
        right: side === 'before' ? '50%' : 0,
      }}
    />
  );
}

function Chip({ children, gold = false }) {
  return (
    <span
      style={{
        display: 'inline-block', padding: '6px 11px', borderRadius: 100,
        background: gold ? 'rgba(232,210,0,0.1)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${gold ? 'rgba(232,210,0,0.35)' : pg.border}`,
        color: gold ? pg.accent : pg.textSec,
        fontSize: 12, fontWeight: w.medium, letterSpacing: 0.3, whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
