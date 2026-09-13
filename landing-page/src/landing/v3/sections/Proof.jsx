import { useEffect, useRef, useState } from 'react';
import { useInView } from 'framer-motion';
import { pg, w } from '../../theme';
import { useCompact } from '../../stages/shared';
import { Hairline, Reveal, Section, fmt } from '../ui';

/**
 * Proof strip — four numbers straight from the database (landing_stats RPC),
 * counting up as they enter. Member count is deliberately absent: the
 * numbers shown are the ones that are already impressive and honest.
 */
export default function Proof({ stats }) {
  const compact = useCompact(760);
  const items = [
    { n: stats.partners, label: 'partner gyms', sub: 'across the UK' },
    { n: stats.sessions_7d, label: 'sessions verified', sub: 'in the last 7 days' },
    { n: stats.points_7d, label: 'POWR paid out', sub: 'in the last 7 days' },
    { n: stats.brands, label: 'brands in the vault', sub: 'live rewards' },
  ];
  return (
    <Section tight>
      <Hairline />
      <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: compact ? '28px 16px' : 24, padding: 'clamp(32px, 4vw, 56px) 0' }}>
        {items.map((it, i) => (
          <Reveal key={it.label} delay={i * 0.08} amount={0.4} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 'clamp(34px, 4vw, 56px)', fontWeight: w.extraLight, color: pg.text, letterSpacing: -1.6, lineHeight: 1 }}>
              <CountUp to={it.n} />
            </div>
            <div style={{ fontSize: 12, letterSpacing: 2.4, color: pg.accent, fontWeight: w.semiBold, marginTop: 10, textTransform: 'uppercase' }}>{it.label}</div>
            <div style={{ fontSize: 12, color: pg.textMuted, marginTop: 4 }}>{it.sub}</div>
          </Reveal>
        ))}
      </div>
      <Hairline />
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 18, fontSize: 11.5, color: pg.textMuted }}>
        {stats.live && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00CC66', boxShadow: '0 0 8px #00CC66' }} />}
        {stats.live ? 'Live from the POWR database' : 'As of 5 September 2026'}
      </div>
    </Section>
  );
}

function CountUp({ to, duration = 1400 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.round(to * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration]);
  return <span ref={ref}>{fmt(v)}</span>;
}
