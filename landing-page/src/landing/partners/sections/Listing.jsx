import { motion } from 'framer-motion';
import { pg, t, w } from '../../theme';
import { GhostLabel, Kicker, Panel, Section, SectionHead, rise } from '../bits';
import { useCompact } from '../../stages/shared';

/**
 * 03 — YOUR LISTING. What a member actually sees, and what it costs you to
 * get there.
 *
 * The card is a likeness of the app's reward card built from the app's own
 * tokens (theme.js `t` mirrors constants/tokens.ts), furnished with a REAL
 * live reward so the mock can never show an offer POWR doesn't carry. The
 * friction grid beside it is the honest answer to "what do you need from me" —
 * the shortest list on the page, and the reason most brands say yes.
 */
const NEED = [
  'Your logo and a hero image',
  'The offer — a discount, a free product, a trial',
  'Sign-off to list it',
];
const DONT_NEED = [
  'Systems integration',
  'Cash up front',
  'Hardware, scanners or staff training',
];

export default function Listing({ featured }) {
  const compact = useCompact(900);
  return (
    <Section id="listing" style={{ overflow: 'hidden' }}>
      <GhostLabel top={60} left={-30}>LISTING</GhostLabel>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? '1fr' : 'minmax(0,1fr) minmax(300px, 380px)',
          gap: compact ? 44 : 64,
          alignItems: 'center',
        }}
      >
        <div>
          <SectionHead
            n="03"
            label="Your listing"
            title={<>Live in the app,<br />the same day.</>}
            body="You send an offer and a logo. We build the listing, review it, and put it in the vault — usually inside 24 hours. From then on you edit it yourself from the portal, and every change is previewed on a phone as you type."
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: compact ? '1fr' : '1fr 1fr',
              gap: 26,
            }}
          >
            <motion.div variants={rise}>
              <Kicker color={pg.accent} style={{ display: 'block', marginBottom: 14 }}>What we need</Kicker>
              {NEED.map((item) => (
                <Row key={item} ok>{item}</Row>
              ))}
            </motion.div>
            <motion.div variants={rise}>
              <Kicker color={pg.textMuted} style={{ display: 'block', marginBottom: 14 }}>What we don’t</Kicker>
              {DONT_NEED.map((item) => (
                <Row key={item}>{item}</Row>
              ))}
            </motion.div>
          </div>
        </div>

        <RewardCard featured={featured} />
      </div>
    </Section>
  );
}

function Row({ children, ok = false }) {
  return (
    <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', marginBottom: 11 }}>
      <span
        aria-hidden
        style={{
          marginTop: 1, width: 17, height: 17, borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: ok ? 'rgba(232,210,0,0.12)' : 'rgba(255,255,255,0.05)',
          color: ok ? pg.accent : pg.textMuted, fontSize: 10, fontWeight: w.bold,
        }}
      >
        {ok ? '✓' : '✕'}
      </span>
      <span style={{ fontSize: 13.5, lineHeight: 1.5, color: ok ? pg.text : pg.textSec, fontWeight: w.light }}>
        {children}
      </span>
    </div>
  );
}

/* A likeness of the app's reward card, furnished with a live reward. */
function RewardCard({ featured }) {
  const brand = featured?.brand || 'HUEL';
  const offer = featured?.offer || featured?.flash || 'Member reward';
  const pts = featured?.pts ?? 185;

  return (
    <Panel
      style={{
        background: t.cardBg, border: `1px solid ${t.borderCard}`, borderRadius: 26,
        padding: 0, boxShadow: '0 30px 90px rgba(0,0,0,0.6)',
      }}
    >
      {/* Hero art — the same face the app paints */}
      <div style={{ position: 'relative', aspectRatio: '3 / 2', background: '#111', overflow: 'hidden' }}>
        {featured?.hero ? (
          <img
            src={featured.hero}
            alt=""
            loading="lazy"
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div
            style={{
              position: 'absolute', inset: 0,
              background: `radial-gradient(120% 100% at 50% 0%, ${featured?.tint || t.accent}33, transparent 70%)`,
            }}
          />
        )}
        <div
          style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.75) 100%)',
          }}
        />
        {featured?.logo && (
          <img
            src={featured.logo}
            alt={brand}
            loading="lazy"
            decoding="async"
            style={{ position: 'absolute', top: 16, left: 18, maxHeight: 26, maxWidth: 110, objectFit: 'contain' }}
          />
        )}
        {featured?.flash && (
          <span
            style={{
              position: 'absolute', top: 16, right: 16, padding: '5px 11px', borderRadius: 100,
              background: t.accent, color: t.onAccent, fontSize: 10, fontWeight: w.bold, letterSpacing: 1.2,
            }}
          >
            {featured.flash}
          </span>
        )}
      </div>

      <div style={{ padding: '18px 20px 20px' }}>
        <div style={{ fontSize: 10, letterSpacing: 2.4, color: t.textSec, fontWeight: w.semiBold, textTransform: 'uppercase' }}>
          {brand}
        </div>
        <div style={{ marginTop: 7, fontSize: 17, fontWeight: w.medium, color: t.text, lineHeight: 1.25 }}>
          {offer}
        </div>

        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '12px 0', borderRadius: 12, background: t.accent, color: t.onAccent,
              fontSize: 13, fontWeight: w.bold, letterSpacing: 0.4,
            }}
          >
            REDEEM
          </div>
          <div
            style={{
              display: 'flex', alignItems: 'baseline', gap: 5, padding: '11px 14px', borderRadius: 12,
              border: `1px solid ${t.accentMid}`, background: t.accentGlow,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: w.semiBold, color: t.accent }}>{pts}</span>
            <span style={{ fontSize: 9.5, fontWeight: w.semiBold, letterSpacing: 1.2, color: t.accent, opacity: 0.7 }}>PTS</span>
          </div>
        </div>
      </div>

      <div
        style={{
          padding: '11px 20px', borderTop: `1px solid ${t.border}`,
          fontSize: 10.5, letterSpacing: 1.8, color: pg.textMuted, fontWeight: w.medium, textTransform: 'uppercase',
        }}
      >
        Live in the app now
      </div>
    </Panel>
  );
}
