import { pg, w } from '../../theme';
import { useCompact } from '../../stages/shared';
import { storageImage } from '../../../lib/storage';
import { EVENT } from '../data';
import { CARD, Check, Head, Reveal, Section } from '../ui';

/**
 * 05 — The gym floor, live. Events: a week of verified sessions becomes a
 * leaderboard at a real venue with prizes worth the effort. FNL x POWR at
 * ONE LDN was the first; its real prizes are the picture.
 */
const RANK = ['1ST', '2ND', '3RD', '4TH'];

export default function Events() {
  const compact = useCompact(960);
  return (
    <Section id="events" style={{ overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', left: '50%', top: '30%', width: 1100, height: 700, transform: 'translate(-50%,-50%)', background: 'radial-gradient(ellipse, rgba(232,210,0,0.07), transparent 60%)', pointerEvents: 'none' }} />
      <Head
        n="05" tag="The gym floor, live"
        title="A week of training. A live leaderboard. A room full of people who showed up."
        lede="Events turn one week of verified sessions into a leaderboard at a real venue, with prizes worth the effort. The board seals the night before; the winners are revealed at the doors."
      />
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '0.9fr 1.1fr', gap: compact ? 28 : 44, alignItems: 'stretch' }}>
        <Reveal amount={0.2}>
          <div style={{ ...CARD, padding: 'clamp(22px, 2.2vw, 30px)', height: '100%', display: 'flex', flexDirection: 'column', gap: 18, background: 'linear-gradient(180deg, #151515, #0f0f0f)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ width: 52, height: 52, borderRadius: 14, background: '#fff', display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0 }}>
                <img src={storageImage(EVENT.venueLogo, 128)} alt={EVENT.venue} width={52} height={52} style={{ width: 40, height: 40, objectFit: 'contain' }} />
              </span>
              <span>
                <div style={{ fontSize: 11, letterSpacing: 2.6, color: pg.accent, fontWeight: w.semiBold }}>FIRST EVENT · SEPTEMBER 2026</div>
                <div style={{ fontSize: 'clamp(24px, 2.2vw, 30px)', fontWeight: w.light, color: pg.text, letterSpacing: -0.6, marginTop: 4 }}>{EVENT.name}</div>
              </span>
            </div>
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 18px', fontSize: 14 }}>
              <Row k="Venue" v={`${EVENT.venue} · ${EVENT.venueArea}`} />
              <Row k="Scoring" v={EVENT.scoring} />
              <Row k="The night" v={EVENT.night} />
              <Row k="Board" v={`${EVENT.competitors} competitors, ranked live`} />
            </dl>
            <ul style={{ listStyle: 'none', margin: 0, padding: '14px 0 0', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {EVENT.rules.map((r) => (
                <li key={r} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: pg.textSec, lineHeight: 1.45 }}>
                  <span style={{ marginTop: 3 }}><Check size={12} /></span>{r}
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 'auto', paddingTop: 8, fontSize: 13, color: pg.textMuted, lineHeight: 1.5 }}>
              The next event lands in the app first. <a href="#download" style={{ color: pg.accent, textDecoration: 'none' }}>Be in the room.</a>
            </div>
          </div>
        </Reveal>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: compact ? 12 : 16 }}>
          {EVENT.prizes.map((p, i) => (
            <Reveal key={p.rank} delay={i * 0.08} amount={0.2}>
              <figure style={{ ...CARD, margin: 0, borderRadius: 18, position: 'relative', overflow: 'hidden', aspectRatio: '4 / 5', background: '#0e0e0e' }}>
                <img src={p.img} alt={p.label} loading="lazy" decoding="async" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', maxWidth: 'none' }} />
                <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.05) 40%, rgba(0,0,0,0.85) 100%)' }} />
                <span style={{ position: 'absolute', top: 12, left: 12, padding: '5px 10px', borderRadius: 999, background: i === 0 ? pg.accent : 'rgba(0,0,0,0.6)', color: i === 0 ? pg.onAccent : pg.text, fontSize: 10.5, fontWeight: w.semiBold, letterSpacing: 2, border: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.14)' }}>
                  {RANK[i]}
                </span>
                <figcaption style={{ position: 'absolute', left: 14, right: 14, bottom: 14, fontSize: 'clamp(13px, 1.15vw, 15px)', color: pg.text, fontWeight: w.medium, lineHeight: 1.3 }}>{p.label}</figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}

function Row({ k, v }) {
  return (
    <>
      <dt style={{ color: pg.textMuted, fontSize: 11, letterSpacing: 2, fontWeight: w.semiBold, textTransform: 'uppercase', alignSelf: 'center' }}>{k}</dt>
      <dd style={{ margin: 0, color: pg.text, fontWeight: w.light }}>{v}</dd>
    </>
  );
}
