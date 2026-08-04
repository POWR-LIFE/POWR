import { motion } from 'framer-motion';
import { pg, w } from '../../theme';
import { GhostLabel, Kicker, Panel, Section, SectionHead, rise } from '../bits';

/**
 * 01 — THE VAULT. Who is already in.
 *
 * Every tile is a live row in the `rewards` table, so this wall cannot claim
 * a partner POWR no longer has. Two open slots close the grid: the wall is a
 * pitch, not a trophy cabinet, and the empty frames are the pitch.
 */
export default function Vault({ brands }) {
  return (
    <Section id="partners" style={{ overflow: 'hidden' }}>
      <GhostLabel top={40} right={-40} gold>THE VAULT</GhostLabel>

      <SectionHead
        n="01"
        label="The vault"
        title={<>Already spending<br />what they earned.</>}
        body="These brands are live in the app right now. One listing per brand, priced in points — a member cannot buy their way in with cash, only with sessions they actually completed."
      />

      <div
        style={{
          display: 'grid',
          // 140px floor so a phone gets two columns — at 190 the wall became a
          // single stack of 240px-tall tiles and the "who's in" read was lost
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 14,
        }}
      >
        {brands.map((b) => (
          <BrandTile key={b.id} brand={b} />
        ))}
        <OpenSlot />
        <OpenSlot />
      </div>

      {/* Index rail — every partner as a wordmark, the way the homepage vault
          lists them under the gallery */}
      <motion.div
        variants={rise}
        style={{
          marginTop: 34, paddingTop: 22, borderTop: `1px solid ${pg.border}`,
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 22px',
        }}
      >
        <Kicker color={pg.accent}>{brands.length} live partners</Kicker>
        {brands.map((b) => (
          <span key={b.id} style={{ fontSize: 12, letterSpacing: 2, color: pg.textMuted, fontWeight: w.medium, textTransform: 'uppercase' }}>
            {b.brand}
          </span>
        ))}
      </motion.div>
    </Section>
  );
}

function BrandTile({ brand }) {
  return (
    <Panel
      style={{
        aspectRatio: '1.45 / 1', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 14, padding: 20,
      }}
    >
      {/* Brand-coloured wash so the wall isn't eight identical grey boxes */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0, opacity: 0.1, pointerEvents: 'none',
          background: `radial-gradient(120% 90% at 50% 120%, ${brand.tint}, transparent 70%)`,
        }}
      />
      {brand.logo ? (
        <img
          src={brand.logo}
          alt={brand.brand}
          loading="lazy"
          decoding="async"
          style={{ maxHeight: 36, maxWidth: '72%', objectFit: 'contain', position: 'relative' }}
        />
      ) : (
        <span style={{ fontSize: 18, fontWeight: w.light, letterSpacing: 2.5, color: pg.text, position: 'relative' }}>
          {brand.brand.toUpperCase()}
        </span>
      )}
      {brand.flash && (
        <span
          style={{
            position: 'relative', padding: '4px 11px', borderRadius: 100,
            border: '1px solid rgba(232,210,0,0.3)', background: 'rgba(232,210,0,0.06)',
            fontSize: 9.5, fontWeight: w.semiBold, letterSpacing: 1.6, color: pg.accent,
          }}
        >
          {brand.flash}
        </span>
      )}
    </Panel>
  );
}

function OpenSlot() {
  return (
    <motion.a
      variants={rise}
      href="#apply"
      style={{
        aspectRatio: '1.45 / 1', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20,
        borderRadius: 20, textDecoration: 'none',
        border: '1px dashed rgba(232,210,0,0.28)', background: 'rgba(232,210,0,0.02)',
      }}
    >
      <Kicker color={pg.textMuted}>Slot open</Kicker>
      <span style={{ fontSize: 14, fontWeight: w.light, color: pg.accent }}>Apply to partner</span>
    </motion.a>
  );
}
