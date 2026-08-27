import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { t, w } from '../theme';
import { CONVERSION_PTS, DEMO, LADDER } from './data';

/**
 * The hero's right-hand composition: the affiliate's code card, their funnel,
 * and the next rung — with a conversion landing every few seconds so the
 * page shows the loop happening rather than describing it.
 *
 * Anatomy is ported from the in-app affiliate screen (app/affiliate.tsx):
 * gold-edged code hero, "SHARE YOUR LINK", taps → signups → converted, the
 * "NEXT UP · n more" rung. Product surfaces use the app tokens (`t`), the
 * canvas around them uses the page tokens (`pg`) — same rule as the film.
 *
 * Every tick is honest maths: converted +1, points +CONVERSION_PTS, the rung
 * counts down by one. Reduced-motion users get the resting state.
 */
const TICK_MS = 5200;
const TOAST_MS = 3000;

export default function HeroStage({ compact }) {
  const reduce = useReducedMotion();
  const [converted, setConverted] = useState(DEMO.converted);
  const [points, setPoints] = useState(DEMO.points);
  const [toast, setToast] = useState(false);
  const [burst, setBurst] = useState(0);
  const timers = useRef([]);

  useEffect(() => {
    if (reduce) return undefined;
    let alive = true;
    const loop = () => {
      if (!alive) return;
      setToast(true);
      setConverted((c) => c + 1);
      setPoints((p) => p + CONVERSION_PTS);
      setBurst((b) => b + 1);
      timers.current.push(setTimeout(() => alive && setToast(false), TOAST_MS));
    };
    const first = setTimeout(loop, 1900);
    const every = setInterval(loop, TICK_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(every);
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [reduce]);

  const next = LADDER.find((s) => s.n > converted) || LADDER[LADDER.length - 1];
  const remaining = Math.max(0, next.n - converted);
  const pct = Math.min(100, (converted / next.n) * 100);

  const width = compact ? 'min(100%, 420px)' : 'min(100%, 460px)';

  return (
    <div style={{ position: 'relative', width, margin: compact ? '0 auto' : '0 0 0 auto' }}>
      {/* Spotlight behind the composition */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: '-20% -30%', pointerEvents: 'none', zIndex: 0,
          background: 'radial-gradient(60% 55% at 50% 40%, rgba(232,210,0,0.13), transparent 70%)',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.25 }}
        style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <CodeCard />
        <Funnel converted={converted} points={points} burst={burst} reduce={reduce} />
        <NextUp next={next} remaining={remaining} pct={pct} />
      </motion.div>

      {/* The conversion toast — a push notification, docked ABOVE the code
          card so it never covers the identity row it is about */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: -18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            style={{
              position: 'absolute', top: compact ? -74 : -70, right: compact ? 0 : -28, zIndex: 3,
              width: compact ? '100%' : 330, maxWidth: '100%',
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px', borderRadius: 18,
              background: 'rgba(28,28,28,0.92)', backdropFilter: 'blur(14px)',
              border: `1px solid ${t.borderCard}`, boxShadow: '0 18px 50px rgba(0,0,0,0.55)',
            }}
          >
            <div
              style={{
                width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                background: '#080808', display: 'grid', placeItems: 'center',
                border: `1px solid ${t.borderCard}`,
              }}
            >
              <img src="/powr-avatar.png" alt="" style={{ width: 22, height: 22, borderRadius: 5, display: 'block' }} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: w.semiBold, color: t.text }}>POWR</span>
                <span style={{ fontSize: 10.5, color: t.textMuted }}>now</span>
              </div>
              <div style={{ fontSize: 12, color: t.textSec, fontWeight: w.light, lineHeight: 1.35, marginTop: 2 }}>
                <span style={{ color: t.accent, fontWeight: w.semiBold }}>+{CONVERSION_PTS}</span>
                {' '}— someone you invited just logged their first verified workout.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CodeCard() {
  return (
    <div
      style={{
        position: 'relative', borderRadius: 24, padding: 1.2,
        background: 'linear-gradient(135deg, rgba(232,210,0,0.75), rgba(232,210,0,0.12) 45%, rgba(255,255,255,0.08))',
        boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
      }}
    >
      <div
        style={{
          borderRadius: 23, padding: '22px 22px 18px',
          background: 'linear-gradient(160deg, #1a1a1a 0%, #111 60%, #0c0c0c 100%)',
          overflow: 'hidden', position: 'relative',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute', top: -80, right: -60, width: 220, height: 220, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(232,210,0,0.16), transparent 68%)', pointerEvents: 'none',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div
            style={{
              width: 38, height: 38, borderRadius: '50%', display: 'grid', placeItems: 'center',
              background: 'rgba(232,210,0,0.12)', border: '1px solid rgba(232,210,0,0.35)',
              fontSize: 13, fontWeight: w.semiBold, color: t.accent, letterSpacing: 0.5,
            }}
          >
            {DEMO.name.split(' ').map((s) => s[0]).join('')}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: w.medium, color: t.text }}>{DEMO.name}</div>
            <div style={{ fontSize: 10.5, letterSpacing: 2, textTransform: 'uppercase', color: t.textMuted, fontWeight: w.medium, marginTop: 2 }}>
              Affiliate · Active
            </div>
          </div>
          <span
            style={{
              marginLeft: 'auto', fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase',
              padding: '5px 9px', borderRadius: 100, border: '1px solid rgba(0,204,102,0.35)',
              color: t.success, fontWeight: w.semiBold, whiteSpace: 'nowrap',
            }}
          >
            Terms ✓
          </span>
        </div>

        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: t.accent, fontWeight: w.semiBold }}>
          Your code
        </div>
        <div
          style={{
            fontSize: 'clamp(34px, 9vw, 44px)', fontWeight: w.light, letterSpacing: 6, color: t.text,
            fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, marginTop: 6,
          }}
        >
          {DEMO.code}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, color: t.textSec, fontSize: 12.5, fontWeight: w.light }}>
          <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>powr.life/join/{DEMO.handle}</span>
          <CopyGlyph />
        </div>

        <div
          style={{
            marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            height: 44, borderRadius: 100, background: t.accent, color: t.onAccent,
            fontSize: 11.5, fontWeight: w.bold, letterSpacing: 2, textTransform: 'uppercase',
          }}
        >
          Share your link
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function Funnel({ converted, points, burst, reduce }) {
  const cells = [
    { label: 'Taps', value: DEMO.taps },
    { label: 'Signups', value: DEMO.signups },
    { label: 'Converted', value: converted, live: true },
    { label: 'Pts earned', value: points, gold: true, live: true },
  ];
  return (
    <div
      style={{
        position: 'relative', borderRadius: 20, padding: '16px 18px 14px',
        background: t.cardBg, border: `1px solid ${t.borderCard}`, backdropFilter: 'blur(10px)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <span style={{ fontSize: 10, letterSpacing: 2.4, textTransform: 'uppercase', color: t.textMuted, fontWeight: w.semiBold }}>
          Last 30 days
        </span>
        <span style={{ fontSize: 10.5, color: t.textMuted, fontWeight: w.light }}>taps → signups → converted</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {cells.map((c) => (
          <div key={c.label} style={{ position: 'relative', minWidth: 0 }}>
            <div
              style={{
                fontSize: 'clamp(17px, 4.4vw, 22px)', fontWeight: w.light, letterSpacing: -0.5,
                color: c.gold ? t.accent : t.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
              }}
            >
              {c.value.toLocaleString()}
            </div>
            <div style={{ fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: t.textMuted, fontWeight: w.medium, marginTop: 5, whiteSpace: 'nowrap' }}>
              {c.label}
            </div>
            {c.live && !reduce && burst > 0 && (
              <AnimatePresence>
                <motion.span
                  key={burst}
                  initial={{ opacity: 0, y: 2 }}
                  animate={{ opacity: [0, 1, 1, 0], y: [2, -14, -22, -30] }}
                  transition={{ duration: 1.5, ease: 'easeOut' }}
                  style={{
                    position: 'absolute', top: -6, left: 0, fontSize: 11, fontWeight: w.semiBold,
                    color: t.accent, pointerEvents: 'none',
                  }}
                >
                  +{c.gold ? CONVERSION_PTS : 1}
                </motion.span>
              </AnimatePresence>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function NextUp({ next, remaining, pct }) {
  return (
    <div
      style={{
        borderRadius: 20, padding: '14px 18px 16px',
        background: t.cardBg, border: `1px solid ${t.borderCard}`, backdropFilter: 'blur(10px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 2.4, textTransform: 'uppercase', color: t.accent, fontWeight: w.semiBold }}>
            Next up
          </div>
          <div style={{ fontSize: 15, fontWeight: w.medium, color: t.text, marginTop: 4 }}>
            {next.label}
            <span style={{ color: t.textMuted, fontWeight: w.light }}> · +{next.points.toLocaleString()} pts{next.reward ? ' + a reward' : ''}</span>
          </div>
        </div>
        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 22, fontWeight: w.light, color: t.text, fontVariantNumeric: 'tabular-nums' }}>{remaining}</span>
          <span style={{ fontSize: 10.5, color: t.textMuted, marginLeft: 5 }}>more</span>
        </div>
      </div>
      <div style={{ marginTop: 12, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <motion.div
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          style={{ height: '100%', borderRadius: 3, background: t.accent, boxShadow: '0 0 12px rgba(232,210,0,0.5)' }}
        />
      </div>
    </div>
  );
}

function CopyGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ opacity: 0.6 }}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

