import { motion } from 'framer-motion';
import { pg, w } from '../../theme';
import { GhostButton, GhostLabel, Kicker, Panel, Section, SectionHead, rise } from '../../partners/bits';
import { useCompact } from '../../stages/shared';

/**
 * 04 — THE TOOLKIT. What an affiliate actually gets.
 *
 * Every card is a surface that exists: the in-app affiliate screen
 * (app/affiliate.tsx), the portal pages under /affiliate/*, the /join/<handle>
 * link page, and the affiliate_conversion / affiliate_milestone pushes. Keep
 * this list honest against those — a page promising a feature the portal
 * doesn't have costs more than the feature would.
 */
const TOOLS = [
  {
    name: 'Your code and link',
    body: 'One code, one link — powr.life/join/you. A QR for the gym wall, a ready-made message, and campaign tags so you can tell your Instagram from your WhatsApp.',
  },
  {
    name: 'Your link page',
    body: 'Your name, photo and a line about you, unfurled the moment the link lands in a chat. It looks like you sent it, because you did.',
  },
  {
    name: 'The funnel',
    body: 'Taps, signups, converted — by day, over 7, 30 or 90 days. You see the numbers and when they happened. You never see who; nobody’s workout history is yours to read.',
  },
  {
    name: 'The ladder',
    body: 'Your next step, how many to go, what is owed and where it is — sent, shipped, or on its way. If a reward needs posting, it asks for an address then — not before.',
  },
  {
    name: 'The ledger',
    body: 'Every point, dated, with the reason it landed. They sit on your normal POWR balance and spend in the rewards tab like everyone else’s.',
  },
  {
    name: 'It comes to you',
    body: 'A push the moment someone converts and the moment a step unlocks. The full portal opens from the app already signed in — same account, no second login.',
  },
];

export default function Toolkit() {
  const compact = useCompact(900);
  return (
    <Section id="toolkit" style={{ overflow: 'hidden' }}>
      <GhostLabel top={30} left={-30}>THE TOOLKIT</GhostLabel>

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
            n="04"
            label="The toolkit"
            title={<>In the app.<br />On the web.<br />One login.</>}
            body="Affiliate lives under Settings in POWR — your code, your numbers, your next step — and opens into a full portal on the web when you want the detail. Nothing to install, nothing to set up."
          />
          <motion.div variants={rise} style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <GhostButton href="/affiliate/login">Affiliate login</GhostButton>
            <GhostButton href="/affiliate/terms">Read the terms</GhostButton>
          </motion.div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(2, 1fr)', gap: 12 }}>
          {TOOLS.map((tool, i) => (
            <Panel key={tool.name} style={{ padding: '24px 22px' }}>
              <Kicker color={pg.textMuted}>{String(i + 1).padStart(2, '0')}</Kicker>
              <h3 style={{ margin: '10px 0 0', fontSize: 17, fontWeight: w.medium, letterSpacing: -0.3, color: pg.text }}>
                {tool.name}
              </h3>
              <p style={{ margin: '9px 0 0', fontSize: 13, lineHeight: 1.6, color: pg.textSec, fontWeight: w.light }}>
                {tool.body}
              </p>
            </Panel>
          ))}
        </div>
      </div>
    </Section>
  );
}
