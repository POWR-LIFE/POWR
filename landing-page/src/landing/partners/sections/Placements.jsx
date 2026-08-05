import { motion } from 'framer-motion';
import { pg, t, w } from '../../theme';
import { GhostLabel, GoldButton, Kicker, Panel, Section, SectionHead, rise } from '../bits';
import { useCompact } from '../../stages/shared';

/**
 * 05 — PLACEMENTS. The differentiator: buying a piece of the real world.
 *
 * Same three beats as the portal's PlacementExplainer, restated on the
 * marketing canvas. Two things are deliberately carried over from there:
 *
 *  • The map is a FLAT IMAGE (public/placement-map.webp, ~62 KB, real
 *    Web-Mercator z18 tiles painted in the editor's own colours). Never mount
 *    a live map for decoration — every render bills a Maps load and pulls a
 *    third-party script onto the page. The tiles are OpenStreetMap, not
 *    Google, and ODbL requires the visible credit. Keep it.
 *  • The push copy is verbatim from notifyNearbyOffer() in lib/notifications.ts,
 *    so the pitch cannot drift from what members actually receive.
 *
 * Partner self-serve is behind a global flag today, so the CTA is a
 * conversation, not a button that isn't switched on for them.
 */
const MAP_SRC = '/placement-map.webp';
const GOLD = '#E8D200';
const RED = '#FF4444';

const BEATS = [
  {
    n: '01',
    title: 'Paint the ground',
    copy: 'Draw straight onto the map — a high street, the park everyone runs in, the blocks around a gym. Then set the days and the hours it should run.',
  },
  {
    n: '02',
    title: 'A member walks in',
    copy: 'When a POWR member is physically inside your squares during those hours, their phone knows. No beacon, no scan, nothing for them to do.',
  },
  {
    n: '03',
    title: 'Your reward leads',
    copy: 'Your offer jumps the queue — straight to the top of their rewards, in the hero slot, priced in points they have already earned.',
  },
];

const FUNNEL = [
  ['Seen', 'in the app'],
  ['Visited', 'inside your squares'],
  ['Pushed', 'notified on the spot'],
  ['Redeemed', 'points spent'],
];

export default function Placements() {
  const compact = useCompact(900);
  return (
    <Section id="placements" style={{ overflow: 'hidden' }}>
      <GhostLabel bottom={20} right={-30} gold>ON THE GROUND</GhostLabel>

      <SectionHead
        n="05"
        label="Placements"
        title={<>Your reward, waiting<br />in the street.</>}
        body="A placement buys a piece of the real world. Members standing inside it get your offer pushed to the front of their rewards — at the moment they are in the place you care about."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? '1fr' : 'repeat(3, 1fr)',
          gap: 16,
        }}
      >
        <Beat beat={BEATS[0]}><MapVisual /></Beat>
        <Beat beat={BEATS[1]}><PushVisual /></Beat>
        <Beat beat={BEATS[2]}><VaultVisual /></Beat>
      </div>

      {/* What every campaign reports back, and the exclusivity rule */}
      <Panel style={{ marginTop: 16, padding: compact ? '26px 24px' : '30px 32px' }}>
        <div
          style={{
            display: 'flex', flexWrap: 'wrap', gap: '24px 48px',
            alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <div>
            <Kicker color={pg.textMuted} style={{ display: 'block', marginBottom: 16 }}>
              Every campaign reports back
            </Kicker>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '12px 10px' }}>
              {FUNNEL.map(([label, sub], i) => (
                <span key={label} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 12, fontWeight: w.semiBold, letterSpacing: 1.6, textTransform: 'uppercase',
                      color: i === FUNNEL.length - 1 ? pg.accent : pg.text,
                    }}
                  >
                    {label}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: w.light, color: pg.textMuted }}>{sub}</span>
                  {i < FUNNEL.length - 1 && (
                    <span aria-hidden style={{ margin: '0 8px', color: pg.textMuted, fontSize: 12 }}>→</span>
                  )}
                </span>
              ))}
            </div>
          </div>

          <div style={{ maxWidth: 300 }}>
            <Kicker color={pg.accent} style={{ display: 'block', marginBottom: 12 }}>One brand per square</Kicker>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: pg.textSec, fontWeight: w.light }}>
              While your campaign holds a square for a time slot, no other brand can book it.
              Enforced in the database, not by a sales promise.
            </p>
          </div>
        </div>

        <div style={{ marginTop: 24, paddingTop: 24, borderTop: `1px solid ${pg.border}` }}>
          <GoldButton href="#apply">Talk to us about a placement</GoldButton>
        </div>
      </Panel>
    </Section>
  );
}

function Beat({ beat, children }) {
  return (
    <motion.div variants={rise}>
      <div
        style={{
          position: 'relative', height: 230, borderRadius: 18, overflow: 'hidden',
          background: '#0b0b0b', border: `1px solid ${pg.border}`,
        }}
      >
        {children}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 20 }}>
        <span style={{ fontSize: 10.5, fontWeight: w.semiBold, letterSpacing: 2.4, color: pg.accent }}>{beat.n}</span>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: w.light, letterSpacing: -0.4, color: pg.text }}>{beat.title}</h3>
      </div>
      <p style={{ marginTop: 9, fontSize: 13, lineHeight: 1.6, color: pg.textSec, fontWeight: w.light }}>{beat.copy}</p>
    </motion.div>
  );
}

/* 01 — the pre-rendered map. Cells are painted into the image itself. */
function MapVisual() {
  return (
    <>
      <img
        src={MAP_SRC}
        alt="A map of central London with six squares painted gold, and one square another brand has already booked in red."
        loading="lazy"
        draggable={false}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
      />
      <div style={{ position: 'absolute', left: 12, top: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
        <span
          style={{
            padding: '6px 10px', borderRadius: 100, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            fontSize: 9, fontWeight: w.semiBold, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)',
          }}
        >
          6 squares · Mon–Fri · 6–10am
        </span>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 9px', borderRadius: 100, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            fontSize: 8, fontWeight: w.semiBold, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 2, background: RED, opacity: 0.7 }} /> Booked
        </span>
      </div>
      {/* ODbL requires the credit to be visible wherever the tiles are */}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer noopener"
        style={{ position: 'absolute', right: 10, bottom: 8, fontSize: 8, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}
      >
        © OpenStreetMap
      </a>
    </>
  );
}

/* 02 — the lock screen. Strings are notifyNearbyOffer()'s, verbatim. */
function PushVisual() {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(120% 90% at 50% 0%, rgba(232,210,0,0.10), rgba(0,0,0,0) 60%), #0b0b0b',
        }}
      />
      <div style={{ position: 'relative', paddingTop: 30, textAlign: 'center' }}>
        <div style={{ fontSize: 44, fontWeight: w.extraLight, color: t.text, letterSpacing: -1, lineHeight: '46px' }}>9:41</div>
        <div style={{ fontSize: 10.5, color: t.textMuted, letterSpacing: 0.5, marginTop: 3 }}>Tuesday 12 August</div>
      </div>

      <div style={{ position: 'relative', marginTop: 'auto', padding: 14 }}>
        <div
          style={{
            borderRadius: 16, padding: 13,
            background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.14)', backdropFilter: 'blur(12px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
            <img src="/powr-avatar.png" alt="" style={{ width: 16, height: 16, borderRadius: 5, objectFit: 'cover' }} />
            <span style={{ fontSize: 9, fontWeight: w.bold, color: t.dim, letterSpacing: 0.5 }}>POWR</span>
            <span style={{ fontSize: 9, color: t.textMuted, marginLeft: 'auto' }}>now</span>
          </div>
          <div style={{ fontSize: 12.5, fontWeight: w.semiBold, color: t.text }}>Your brand is nearby</div>
          <div style={{ fontSize: 11.5, fontWeight: w.light, color: t.dim, lineHeight: '16px', marginTop: 2 }}>
            Your reward is boosted where you are right now — open to redeem.
          </div>
        </div>
      </div>
    </div>
  );
}

/* 03 — a crop of the vault with the placed reward held at the top. */
const FILLER_ROWS = [
  { title: '25% off your bill', sub: 'Notto Pasta · Any branch', logo: 'NOTTO', pts: '500', o: 0.4 },
  { title: '3 months free', sub: 'Calm · Premium', logo: 'calm', pts: '600', o: 0.25 },
];

function VaultVisual() {
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '14px 14px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 17, fontWeight: w.extraLight, color: t.text, letterSpacing: -0.3 }}>Rewards</span>
        <img src="/powr-avatar.png" alt="" style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.1)' }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 26, fontWeight: w.extraLight, color: GOLD, letterSpacing: -1, lineHeight: '26px' }}>1,650</span>
        <span style={{ fontSize: 8, fontWeight: w.medium, color: t.dim, letterSpacing: 1.5, marginBottom: 3 }}>POINTS</span>
      </div>

      {/* The placed reward, held at the top of the list */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, padding: '9px 8px', borderRadius: 10,
          background: 'linear-gradient(to bottom, rgba(255,255,255,0.13), rgba(0,0,0,0))',
        }}
      >
        <div
          style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)',
            fontSize: 8, fontWeight: w.bold, color: t.dim,
          }}
        >
          YOU
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: t.text }}>Your reward</div>
          <div style={{ fontSize: 9.5, fontWeight: w.light, color: t.dim }}>Your brand</div>
        </div>
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: w.extraLight, color: GOLD, letterSpacing: -0.5, lineHeight: '17px' }}>800</div>
          <div style={{ fontSize: 7, fontWeight: w.medium, color: GOLD, opacity: 0.7, letterSpacing: 1 }}>PTS</div>
        </div>
      </div>

      {FILLER_ROWS.map((s) => (
        <div
          key={s.logo}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '9px 8px',
            opacity: s.o, borderTop: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div
            style={{
              width: 34, height: 34, borderRadius: 10, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)',
              fontSize: 8, fontWeight: w.bold, color: t.dim,
            }}
          >
            {s.logo}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: t.text }}>{s.title}</div>
            <div style={{ fontSize: 9.5, fontWeight: w.light, color: t.dim }}>{s.sub}</div>
          </div>
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: 16, fontWeight: w.extraLight, color: GOLD, letterSpacing: -0.5, lineHeight: '17px' }}>{s.pts}</div>
            <div style={{ fontSize: 7, fontWeight: w.medium, color: GOLD, opacity: 0.7, letterSpacing: 1 }}>PTS</div>
          </div>
        </div>
      ))}
    </div>
  );
}
