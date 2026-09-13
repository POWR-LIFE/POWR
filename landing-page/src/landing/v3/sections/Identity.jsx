import { pg, w } from '../../theme';
import { useCompact } from '../../stages/shared';
import PhoneFrame from '../../PhoneFrame';
import { LEVELS } from '../data';
import { CARD, Head, Reveal, Section, fmt } from '../ui';

/**
 * 06 — Together & Become. The social layer and the identity layer in one
 * screen: a real Together challenge in a phone, and the level ladder with
 * the legend tier kept classified.
 */
const TIERS = ['Recruit', 'Athlete', 'Elite', 'Legend'];

export default function Identity() {
  const compact = useCompact(960);
  return (
    <Section id="identity">
      <Head
        n="06" tag="Together & Become"
        title="Bring your crew. Build your name."
        lede="Shared challenges pay a group bonus when everyone finishes — the last one in pays the whole crew. And twenty levels turn what you've earned into who you are."
      />
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '0.8fr 1.2fr', gap: compact ? 36 : 56, alignItems: 'center' }}>
        <Reveal amount={0.2} style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ position: 'relative' }}>
            <div aria-hidden style={{ position: 'absolute', inset: '-20% -30%', background: 'radial-gradient(circle, rgba(0,204,102,0.10), transparent 60%)', filter: 'blur(20px)', pointerEvents: 'none' }} />
            <PhoneFrame src="/app/together.webp" alt="A POWR Together challenge — Back Again, four friends" width={compact ? 220 : 250} topColor="#171717" />
            <div style={{ position: 'absolute', right: compact ? -14 : -84, top: '56%', ...CARD, borderRadius: 14, padding: '10px 14px', background: 'rgba(14,14,14,0.9)', backdropFilter: 'blur(8px)' }}>
              <div style={{ fontSize: 10, letterSpacing: 2.2, color: pg.textMuted, fontWeight: w.semiBold }}>PAYOUT</div>
              <div style={{ fontSize: 22, fontWeight: w.extraLight, color: pg.accent, letterSpacing: -0.6, marginTop: 2 }}>25 <span style={{ fontSize: 12, color: pg.textSec }}>base</span> + 15 <span style={{ fontSize: 12, color: pg.textSec }}>crew</span></div>
              <div style={{ fontSize: 11.5, color: pg.textSec, marginTop: 2 }}>40 each, when all four land</div>
            </div>
          </div>
        </Reveal>

        <Reveal amount={0.2} delay={0.1}>
          <div style={{ ...CARD, padding: 'clamp(22px, 2.2vw, 30px)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 11, letterSpacing: 2.6, color: pg.accent, fontWeight: w.semiBold }}>TWENTY LEVELS · FOUR TIERS</span>
              <span style={{ fontSize: 11, color: pg.textMuted }}>lifetime points</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)', gap: compact ? 14 : 10, marginTop: 22 }}>
              {LEVELS.map((l) => (
                <div key={l.level} style={{ textAlign: 'center' }}>
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '1', display: 'grid', placeItems: 'center' }}>
                    <div aria-hidden style={{ position: 'absolute', inset: '10%', borderRadius: '50%', background: `radial-gradient(circle, ${l.color}33, transparent 65%)`, filter: 'blur(10px)' }} />
                    <img
                      src={l.img} alt={l.name || `Level ${l.level}`} loading="lazy" decoding="async"
                      style={{ width: '82%', height: '82%', objectFit: 'contain', position: 'relative', filter: l.name ? 'none' : 'brightness(0.18) contrast(1.2) blur(1.2px)' }}
                    />
                    {!l.name && (
                      <span style={{ position: 'absolute', bottom: '8%', padding: '3px 8px', borderRadius: 999, background: 'rgba(0,0,0,0.7)', border: `1px solid ${l.color}66`, color: l.color, fontSize: 9, letterSpacing: 1.6, fontWeight: w.semiBold }}>CLASSIFIED</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, letterSpacing: 2, color: pg.textMuted, fontWeight: w.semiBold, marginTop: 6 }}>LEVEL {l.level}</div>
                  <div style={{ fontSize: 13, color: l.name ? l.color : pg.textMuted, fontWeight: w.medium, marginTop: 3, letterSpacing: l.name ? 0 : 3 }}>{l.name || '?????'}</div>
                  <div style={{ fontSize: 11, color: pg.textMuted, marginTop: 2 }}>{l.xp ? fmt(l.xp) : '0'} pts</div>
                </div>
              ))}
            </div>
            {/* tier rail */}
            <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: 'repeat(20, 1fr)', gap: 3 }}>
              {Array.from({ length: 20 }, (_, i) => {
                const tier = i < 5 ? 0 : i < 10 ? 1 : i < 15 ? 2 : 3;
                const c = ['rgba(255,255,255,0.35)', '#F2C230', '#4A9EFF', '#E8D200'][tier];
                return <span key={i} style={{ height: 3, borderRadius: 2, background: c, opacity: tier === 3 ? 0.9 : 0.55 }} />;
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              {TIERS.map((t) => <span key={t} style={{ fontSize: 10, letterSpacing: 2, color: pg.textMuted, fontWeight: w.semiBold, textTransform: 'uppercase' }}>{t}</span>)}
            </div>
            <div style={{ marginTop: 18, fontSize: 14, color: pg.textSec, fontWeight: w.light, lineHeight: 1.5 }}>
              Level 20 has a name. <span style={{ color: pg.accent }}>Earn it.</span>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
