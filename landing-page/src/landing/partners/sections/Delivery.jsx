import { motion } from 'framer-motion';
import { pg, w } from '../../theme';
import { GhostLabel, Kicker, Panel, Section, SectionHead, rise } from '../bits';

/**
 * 04 — DELIVERY. The three ways a code reaches a member.
 *
 * Facts here are sourced from the shipped system, not from a pitch deck:
 * the methods and their behaviour are the same three the portal's Integration
 * hub offers (reward_brand_integrations.delivery_method), and each card links
 * to that method's public guide under /docs.
 */
const METHODS = [
  {
    id: 'manual',
    name: 'Promo codes',
    lede: 'Upload a pool. We hand them out.',
    body: 'Paste, upload a CSV, or have the portal generate codes to your format. One code leaves the pool per redemption — oldest first, never twice, and never a code that has expired.',
    points: ['No engineering at all', 'Low-stock warnings before you run dry', 'Full ledger, searchable and exportable'],
    href: '/docs/promo-codes',
    badge: 'Most brands start here',
  },
  {
    id: 'shopify',
    name: 'Shopify',
    lede: 'Connect your store once.',
    body: 'Pick a discount to clone from. Every redemption mints a fresh single-use code in your store — carrying the same product restrictions as the template — and orders reconcile themselves when it gets spent.',
    points: ['Install, authorise, map a discount', 'Single-use codes, minted on demand', 'Orders auto-reconcile back to POWR'],
    href: '/docs/shopify',
    badge: 'Zero manual stock',
  },
  {
    id: 'api',
    name: 'Developer API',
    lede: 'Your system stays the source of truth.',
    body: 'REST endpoints for pushing codes and reading redemptions, signed webhooks when a code is assigned, used or running low, and just-in-time minting so POWR asks your system for a code at the moment a member redeems.',
    points: ['Signed webhooks (HMAC-SHA256)', 'Just-in-time minting with a safety pool', 'Self-serve connection tests'],
    href: '/docs/api',
    badge: 'Full control',
  },
];

export default function Delivery() {
  return (
    <Section id="delivery" style={{ overflow: 'hidden' }}>
      <GhostLabel top={40} right={-20}>DELIVERY</GhostLabel>

      <SectionHead
        n="04"
        label="Delivery"
        title={<>Three ways to hand<br />over a code.</>}
        body="Pick the one that matches how your business already works. You can switch later — nothing is torn down when you do, and a code pool can sit behind an integration as a buffer."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
        }}
      >
        {METHODS.map((m) => (
          <Panel key={m.id} style={{ padding: '28px 26px 24px', display: 'flex', flexDirection: 'column' }}>
            <Kicker color={pg.accent}>{m.badge}</Kicker>
            <h3 style={{ margin: '14px 0 0', fontSize: 24, fontWeight: w.extraLight, letterSpacing: -0.6, color: pg.text }}>
              {m.name}
            </h3>
            <p style={{ margin: '8px 0 0', fontSize: 14, fontWeight: w.light, color: pg.text, opacity: 0.85 }}>
              {m.lede}
            </p>
            <p style={{ margin: '14px 0 0', fontSize: 13.5, lineHeight: 1.6, color: pg.textSec, fontWeight: w.light }}>
              {m.body}
            </p>

            <ul style={{ margin: '20px 0 0', padding: 0, listStyle: 'none', flex: 1 }}>
              {m.points.map((p) => (
                <li
                  key={p}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 9,
                    fontSize: 12.5, lineHeight: 1.5, color: pg.textSec, fontWeight: w.light,
                  }}
                >
                  <span aria-hidden style={{ marginTop: 7, width: 4, height: 4, borderRadius: '50%', background: pg.accent, flexShrink: 0 }} />
                  {p}
                </li>
              ))}
            </ul>

            <a
              href={m.href}
              style={{
                marginTop: 22, paddingTop: 16, borderTop: `1px solid ${pg.border}`,
                display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none',
                fontSize: 12, fontWeight: w.semiBold, letterSpacing: 1.4, color: pg.accent, textTransform: 'uppercase',
              }}
            >
              Read the guide <span aria-hidden>→</span>
            </a>
          </Panel>
        ))}
      </div>

      <motion.p
        variants={rise}
        style={{ marginTop: 26, fontSize: 13, color: pg.textMuted, fontWeight: w.light }}
      >
        However the code is delivered, the member’s side is identical: one tap, a code in their wallet, and the points gone from their balance.
      </motion.p>
    </Section>
  );
}
