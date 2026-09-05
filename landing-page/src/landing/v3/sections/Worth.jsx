import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { pg, w } from '../../theme';
import { useCompact } from '../../stages/shared';
import { GYM_PTS, LADDER, fetchLiveRewards } from '../data';
import { CARD, Head, Pts, Reveal, Section, fmt } from '../ui';

/**
 * 03 — What it's worth. The economy made concrete: the award ladder on the
 * left, the LIVE catalogue on the right, and every reward priced in gym
 * sessions as well as points. This is the page's most persuasive fact —
 * "a tenner off Huel is nine sessions" — and it is true.
 */
export default function Worth() {
  const compact = useCompact(1024);
  const [rewards, setRewards] = useState([]);
  useEffect(() => {
    let live = true;
    fetchLiveRewards()
      .then((rows) => {
        if (!live) return;
        const huelFirst = [...rows].sort((a, b) => {
          const ah = /huel/i.test(a.brand) ? -1 : 0;
          const bh = /huel/i.test(b.brand) ? -1 : 0;
          return ah - bh || a.pts - b.pts;
        });
        setRewards(huelFirst);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  return (
    <Section id="worth">
      <Head
        n="03" tag="What it's worth"
        title="Priced in sessions, not pounds."
        lede={`Every reward in the app, live below, priced in points. A gym session of forty minutes is worth ${GYM_PTS}. So ten pounds off Huel is nine sessions — earned, not given.`}
      />

      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'minmax(300px, 0.85fr) 1.6fr', gap: compact ? 40 : 56, alignItems: 'start' }}>
        {/* The ladder */}
        <Reveal amount={0.2}>
          <div style={{ ...CARD, padding: 'clamp(20px, 2vw, 28px)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontSize: 11, letterSpacing: 2.6, color: pg.accent, fontWeight: w.semiBold }}>THE LADDER</span>
              <span style={{ fontSize: 11, color: pg.textMuted }}>points per session</span>
            </div>
            {LADDER.map((row, i) => (
              <div key={`${row.label}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14.5, color: pg.text, fontWeight: w.medium }}>{row.label}</span>
                  <span style={{ display: 'block', fontSize: 12, color: pg.textMuted, marginTop: 2 }}>{row.detail}</span>
                </span>
                <span style={{ fontSize: 20, fontWeight: w.light, color: row.pts >= 20 ? pg.accent : pg.text, letterSpacing: -0.5 }}>+{row.pts}</span>
              </div>
            ))}
            <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: 'rgba(232,210,0,0.06)', border: '1px solid rgba(232,210,0,0.18)' }}>
              <div style={{ fontSize: 13, color: pg.text, fontWeight: w.medium }}>Streaks multiply.</div>
              <div style={{ fontSize: 12.5, color: pg.textSec, marginTop: 3, lineHeight: 1.5 }}>
                Twelve days in a row and every workout pays ×1.5. Walking and sleep top out at 5 a day; gym at 30. Runs, rides and swims are uncapped.
              </div>
            </div>
          </div>
        </Reveal>

        {/* The live vault */}
        <div>
          <Reveal amount={0.1} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14, padding: '0 4px' }}>
            <span style={{ fontSize: 11, letterSpacing: 2.6, color: pg.accent, fontWeight: w.semiBold }}>THE VAULT · LIVE</span>
            <span style={{ fontSize: 11, color: pg.textMuted }}>{rewards.length ? `${rewards.length} brands` : 'loading…'}</span>
          </Reveal>
          <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: compact ? 12 : 16 }}>
            {rewards.map((r, i) => <Poster key={r.id} r={r} i={i} />)}
            {!rewards.length && Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ ...CARD, aspectRatio: '3 / 4', borderRadius: 18, background: '#101010' }} />
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

function Poster({ r, i }) {
  const sessions = Math.ceil(r.pts / GYM_PTS);
  return (
    <motion.a
      href="#download"
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.8, delay: (i % 4) * 0.07, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -6 }}
      style={{
        ...CARD, borderRadius: 18, aspectRatio: '3 / 4', position: 'relative', overflow: 'hidden', display: 'block', textDecoration: 'none',
        background: r.heroImage ? '#0e0e0e' : `linear-gradient(160deg, ${r.tint}55, #0e0e0e 70%)`,
      }}
    >
      {r.heroImage && (
        <img
          src={r.heroImage} alt="" loading="lazy" decoding="async"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', maxWidth: 'none', filter: 'brightness(0.78) saturate(1.05)' }}
        />
      )}
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 62%, rgba(0,0,0,0.92) 100%)' }} />
      <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        {r.logo ? (
          <span style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,0.92)', display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0 }}>
            <img src={r.logo} alt="" width={34} height={34} style={{ width: 26, height: 26, objectFit: 'contain' }} />
          </span>
        ) : <span />}
        {r.flash && <Pts size={11}>{r.flash}</Pts>}
      </div>
      <div style={{ position: 'absolute', left: 14, right: 14, bottom: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: 2.4, color: 'rgba(255,255,255,0.7)', fontWeight: w.semiBold, textTransform: 'uppercase' }}>{r.brand}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
          <span style={{ fontSize: 'clamp(26px, 2.4vw, 34px)', fontWeight: w.extraLight, color: pg.text, letterSpacing: -1, lineHeight: 1 }}>{fmt(r.pts)}</span>
          <span style={{ fontSize: 10, letterSpacing: 1.6, color: pg.accent, fontWeight: w.semiBold }}>PTS</span>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.62)', marginTop: 5 }}>≈ {sessions} gym sessions</div>
      </div>
    </motion.a>
  );
}
