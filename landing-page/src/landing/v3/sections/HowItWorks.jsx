import { pg, w } from '../../theme';
import { useCompact } from '../../stages/shared';
import { storageImage } from '../../../lib/storage';
import { EVENT, WEARABLES } from '../data';
import { CARD, Check, Head, Pts, Reveal, Section } from '../ui';

/**
 * 02 — The plan. Three moves, each with the real app surface that does it.
 * Static cards that reveal once — this is the explainer, it has to be
 * skimmable in five seconds, not scrubbed for thirty.
 */
const STEPS = [
  {
    n: '01', title: 'Show up.',
    body: 'Walk into any partner gym and the session starts on its own — no check-in button, no QR code. Runs, rides, swims, sleep and steps arrive from the wearable you already own.',
    demo: <SessionCard />,
    foot: <WearableRow />,
  },
  {
    n: '02', title: 'Get verified. Get paid.',
    body: 'Every session is checked — where you were, for how long, what your device recorded — and the points land without you touching anything. Keep a streak and your workouts multiply.',
    demo: <Receipt />,
  },
  {
    n: '03', title: 'Spend it.',
    body: 'Points are a currency at the checkout of brands that respect the work. Redeem in a tap; the code lands in your wallet, ready when you are.',
    demo: <CodeCard />,
  },
];

export default function HowItWorks() {
  const compact = useCompact(960);
  return (
    <Section id="how">
      <Head
        n="02" tag="The plan"
        title="Move. Get verified. Earn. Spend."
        lede="POWR recognises what you already do. Nothing to log, nothing to remember — the app watches the door, your wearable watches the rest."
      />
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(3, 1fr)', gap: compact ? 18 : 22 }}>
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={compact ? 0 : i * 0.12} amount={0.2}>
            <article style={{ ...CARD, padding: 'clamp(22px, 2.2vw, 30px)', height: '100%', display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <span style={{ color: pg.accent, fontSize: 12, fontWeight: w.semiBold, letterSpacing: 3 }}>{s.n}</span>
                <h3 style={{ margin: 0, fontSize: 'clamp(22px, 1.9vw, 27px)', fontWeight: w.light, letterSpacing: -0.6, color: pg.text }}>{s.title}</h3>
              </div>
              <p style={{ margin: 0, color: pg.textSec, fontSize: 14.5, lineHeight: 1.55, fontWeight: w.light, flex: 1 }}>{s.body}</p>
              <div style={{ paddingTop: 8 }}>{s.demo}</div>
              {s.foot}
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ── The app surfaces, 1:1 in spirit with the RN components ─────────── */
const APP_CARD = {
  background: 'rgba(30,30,30,0.92)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 18,
  boxShadow: '0 30px 60px -30px rgba(0,0,0,0.8)',
};
const GREEN = '#00CC66';

function SessionCard() {
  return (
    <div style={{ ...APP_CARD, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 40, height: 40, borderRadius: 12, background: '#fff', display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0 }}>
          <img src={storageImage(EVENT.venueLogo, 96)} alt="" width={40} height={40} style={{ width: 30, height: 30, objectFit: 'contain' }} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: w.semiBold, color: pg.text }}>ONE LDN</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: GREEN, boxShadow: `0 0 8px ${GREEN}` }} />
            <span style={{ fontSize: 9.5, letterSpacing: 2, color: GREEN, fontWeight: w.semiBold }}>SESSION ACTIVE</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 26, fontWeight: w.extraLight, letterSpacing: -0.8, color: pg.text, lineHeight: 1 }}>52:14</div>
          <div style={{ fontSize: 9, letterSpacing: 2, color: pg.textMuted, marginTop: 4 }}>ELAPSED</div>
        </div>
      </div>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: pg.textSec }}>
          <Check size={13} /> Geofence verified · 25 m
        </span>
        <Pts>+20 <span style={{ fontSize: 9, letterSpacing: 1.2, opacity: 0.8 }}>PTS</span></Pts>
      </div>
    </div>
  );
}

function WearableRow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', paddingTop: 4 }}>
      <span style={{ fontSize: 10, letterSpacing: 2, color: pg.textMuted, fontWeight: w.semiBold }}>ALSO FROM</span>
      {WEARABLES.map((wb) => (
        <img key={wb.id} src={`/wearables/${wb.id}.png`} alt={wb.name} title={wb.name} height={14} style={{ height: 14, width: 'auto', opacity: 0.6 }} />
      ))}
      <span style={{ fontSize: 11, color: pg.textMuted }}>+15 more</span>
    </div>
  );
}

const ROWS = [
  { icon: '▮', label: 'Gym', detail: 'ONE LDN · 52 min', pts: 20, color: '#E8D200' },
  { icon: '▮', label: 'Run', detail: '5.2 km · 26:40', pts: 8, color: '#FF9944' },
  { icon: '▮', label: 'Sleep', detail: '7h 42m', pts: 4, color: '#6366F1' },
  { icon: '▮', label: 'Streak ×1.5', detail: '12 days · workouts', pts: 14, color: '#E8D200', bonus: true },
];

function Receipt() {
  return (
    <div style={{ ...APP_CARD, padding: '6px 16px 14px' }}>
      {ROWS.map((r) => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, boxShadow: `0 0 10px ${r.color}55`, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13.5, color: pg.text, fontWeight: w.medium }}>{r.label}</span>
            <span style={{ fontSize: 12, color: pg.textMuted, marginLeft: 8 }}>{r.detail}</span>
          </span>
          <span style={{ fontSize: 14, fontWeight: w.semiBold, color: r.bonus ? pg.accent : pg.text, letterSpacing: -0.2 }}>+{r.pts}</span>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 12 }}>
        <span style={{ fontSize: 10, letterSpacing: 2.4, color: pg.textMuted, fontWeight: w.semiBold }}>TODAY</span>
        <span style={{ fontSize: 30, fontWeight: w.extraLight, color: pg.accent, letterSpacing: -1, lineHeight: 1 }}>
          +46 <span style={{ fontSize: 11, letterSpacing: 1.5, fontWeight: w.semiBold, opacity: 0.8 }}>PTS</span>
        </span>
      </div>
    </div>
  );
}

const MAJIC_LOGO = 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-images/rewards/1779282253167-cwto35.png';

function CodeCard() {
  return (
    <div style={{ ...APP_CARD, padding: 16, position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 90% at 100% 0%, rgba(144,0,254,0.22), transparent 55%)', pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: '#111', border: '1px solid rgba(255,255,255,0.1)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
            <img src={storageImage(MAJIC_LOGO, 96)} alt="" width={36} height={36} style={{ width: 28, height: 28, objectFit: 'contain' }} />
          </span>
          <span>
            <div style={{ fontSize: 14, fontWeight: w.semiBold, color: pg.text }}>MAJIC</div>
            <div style={{ fontSize: 11, color: pg.textSec }}>High-protein desserts</div>
          </span>
        </span>
        <Pts>15% OFF</Pts>
      </div>
      <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(232,210,0,0.28)', textAlign: 'center', position: 'relative' }}>
        <div style={{ fontSize: 9, letterSpacing: 2.6, color: pg.textMuted, fontWeight: w.semiBold }}>YOUR CODE</div>
        <div style={{ fontSize: 19, letterSpacing: 2.2, color: pg.text, fontWeight: w.medium, marginTop: 4 }}>POWR-MAJIC-418206</div>
        <div style={{ fontSize: 11, color: pg.textMuted, marginTop: 4 }}>Tap to copy</div>
      </div>
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: pg.textSec, position: 'relative' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Check size={12} color={GREEN} /> Saved to your wallet</span>
        <span>Valid 90 days</span>
      </div>
    </div>
  );
}
