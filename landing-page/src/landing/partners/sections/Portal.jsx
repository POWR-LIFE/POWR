import { motion } from 'framer-motion';
import { pg, w } from '../../theme';
import { GhostLabel, GhostButton, Kicker, Panel, Section, SectionHead, rise } from '../bits';
import { useCompact } from '../../stages/shared';

/**
 * 06 — THE PORTAL. Every partner gets a login, not an account manager.
 *
 * Each capability below is a page that exists at /partner/*. Keep this list
 * honest against PartnerLayout's nav — a partners page listing a feature the
 * portal doesn't have is the fastest way to lose the first meeting.
 */
const CAPABILITIES = [
  {
    name: 'The verdict',
    body: 'Your Overview opens on one plain sentence about whether your rewards are healthy — and, if something needs you, exactly one thing to go and fix.',
  },
  {
    name: 'Your rewards',
    body: 'Write and edit your listings, previewed on a live phone as you type. Changes go to us for review; approved edits apply in place.',
  },
  {
    name: 'Redemptions',
    body: 'Every claim, with the reward, the points it cost and the day it happened. Search it, filter it, export it.',
  },
  {
    name: 'Codes',
    body: 'Pool health at a glance, warnings before you run dry, and a full ledger of what has been issued and what has been spent.',
  },
  {
    name: 'What’s On',
    body: 'The featured calendar — see who has the hero slot and when, and ask for a week of your own.',
  },
  {
    name: 'Your team',
    body: 'Invite colleagues with their own logins. No shared password, no waiting on us to add someone.',
  },
];

export default function Portal() {
  const compact = useCompact(900);
  return (
    <Section id="portal" style={{ overflow: 'hidden' }}>
      <GhostLabel top={30} left={-30}>THE PORTAL</GhostLabel>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? '1fr' : 'minmax(0, 380px) minmax(0, 1fr)',
          gap: compact ? 40 : 60,
          alignItems: 'start',
        }}
      >
        <div style={{ position: compact ? 'static' : 'sticky', top: 110 }}>
          <SectionHead
            n="06"
            label="The portal"
            title={<>You get the keys.</>}
            body="Partnering with POWR is not an email thread. You get a login to a portal that shows you what your rewards are doing and lets you change them yourself."
          />
          <motion.div variants={rise} style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <GhostButton href="/partner/login">Partner login</GhostButton>
            <GhostButton href="/docs">Read the docs</GhostButton>
          </motion.div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: compact ? '1fr' : 'repeat(2, 1fr)',
            gap: 12,
          }}
        >
          {CAPABILITIES.map((c, i) => (
            <Panel key={c.name} style={{ padding: '24px 22px' }}>
              <Kicker color={pg.textMuted}>{String(i + 1).padStart(2, '0')}</Kicker>
              <h3 style={{ margin: '10px 0 0', fontSize: 17, fontWeight: w.medium, letterSpacing: -0.3, color: pg.text }}>
                {c.name}
              </h3>
              <p style={{ margin: '9px 0 0', fontSize: 13, lineHeight: 1.6, color: pg.textSec, fontWeight: w.light }}>
                {c.body}
              </p>
            </Panel>
          ))}
        </div>
      </div>
    </Section>
  );
}
