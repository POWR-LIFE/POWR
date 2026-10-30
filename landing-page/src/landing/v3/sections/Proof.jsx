import { pg, w } from '../../theme';
import { useCompact } from '../../stages/shared';
import { STATS_AS_OF } from '../data';
import { CountUp, DrawLine, Item, Section, Stagger } from '../ui';

/**
 * Proof strip — four numbers straight from the database (landing_stats RPC),
 * counting up as they enter between two gold rules that draw themselves
 * from the centre out. Member count is deliberately absent: the numbers
 * shown are the ones that are already impressive and honest.
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
      <DrawLine soft origin="center" duration={1.6} />
      <Stagger gap={0.1} amount={0.4} style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: compact ? '28px 16px' : 24, padding: 'clamp(32px, 4vw, 56px) 0' }}>
        {items.map((it) => (
          <Item key={it.label} from="up" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 'clamp(34px, 4vw, 56px)', fontWeight: w.extraLight, color: pg.text, letterSpacing: -1.6, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              <CountUp to={it.n} />
            </div>
            <div style={{ fontSize: 12, letterSpacing: 2.4, color: pg.accent, fontWeight: w.semiBold, marginTop: 10, textTransform: 'uppercase' }}>{it.label}</div>
            <div style={{ fontSize: 12, color: pg.textMuted, marginTop: 4 }}>{it.sub}</div>
          </Item>
        ))}
      </Stagger>
      <DrawLine soft origin="center" duration={1.6} delay={0.2} />
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 18, fontSize: 11.5, color: pg.textMuted }}>
        {stats.live && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00CC66', boxShadow: '0 0 8px #00CC66', animation: 'powrBreathe 2.4s ease-in-out infinite' }} />}
        {stats.live ? 'Live from the POWR database' : `As of ${STATS_AS_OF}`}
      </div>
    </Section>
  );
}
