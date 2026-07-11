import { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { pg, t, w } from '../theme';
import Ion from '../Ionicon';
import { SectionTag, CopyPanel, GhostWord, MobileCopyDock, useCompact } from './shared';

/**
 * Act III — Redeem. The payoff act: this is what the points are FOR.
 * Two movements:
 *  1. The vault: full-bleed brand posters (live catalogue) glide past in
 *     two depth layers — a hall of prizes, mirrored against Earn's travel.
 *  2. The spend: the featured reward takes centre stage, the REDEEM button
 *     fills as you scroll, the balance banked in Earn visibly drains, and
 *     the card flips into a live code that lands in the wallet.
 */
const FALLBACK = [
  { id: 'f1', name: 'TRIBE', item: '35% off protein',  pts: 220, logo: null, heroImage: null, heroVideo: null, initial: 'T', tint: '#1877C7' },
  { id: 'f2', name: 'HUEL',  item: 'Member reward',    pts: 185, logo: null, heroImage: null, heroVideo: null, initial: 'H', tint: '#A6C34C' },
  { id: 'f3', name: 'Frank', item: 'Coffee bundle',    pts: 200, logo: null, heroImage: null, heroVideo: null, initial: 'F', tint: '#E8734A' },
  { id: 'f4', name: 'MAJIC', item: '25% off desserts', pts: 180, logo: null, heroImage: null, heroVideo: null, initial: 'M', tint: '#9000fe' },
  { id: 'f5', name: 'REP',   item: 'Member reward',    pts: 150, logo: null, heroImage: null, heroVideo: null, initial: 'R', tint: '#E84040' },
];

/* One live reward per brand, in the app's own catalogue order */
async function fetchLiveRewards() {
  const { data, error } = await supabase
    .from('rewards')
    .select('id, title, brand_name, powr_cost, value_label, image_url, hero_image_url, hero_video_url, brand_color, partners(logo_url)')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('powr_cost', { ascending: true })
    .limit(24);
  if (error) throw error;
  const seen = new Set();
  const out = [];
  for (const r of data ?? []) {
    const brand = (r.brand_name || r.title || '').trim();
    const key = brand.toLowerCase();
    if (!brand || seen.has(key)) continue;
    seen.add(key);
    const partner = Array.isArray(r.partners) ? r.partners[0] : r.partners;
    out.push({
      id: r.id,
      name: r.title || brand,
      item: r.value_label?.trim() || 'Member reward',
      pts: r.powr_cost,
      logo: r.image_url || partner?.logo_url || null,
      heroImage: r.hero_image_url || null,
      heroVideo: r.hero_video_url || null,
      initial: brand[0].toUpperCase(),
      tint: r.brand_color?.trim() || t.accent,
    });
    if (out.length >= 5) break;
  }
  return out;
}

const CARD_BG = '#151515';
const CARD_BORDER = 'rgba(255,255,255,0.07)';

/* The balance Earn just banked — Act II ends on 1,345 */
const BAL_START = 1345;

const PANELS = [
  { range: [0.04, 0.09, 0.24, 0.30], title: 'This is what the sweat buys.',
    body: 'A vault of real rewards from brands you actually want — stocked live from the app, priced in points.' },
  { range: [0.33, 0.39, 0.50, 0.56], title: 'Your points are money here.',
    body: 'Every session, street and sleep you banked — spendable at the checkout, like cash.' },
  { range: [0.60, 0.66, 0.90, 0.97], title: 'Tap once. It’s yours.',
    body: 'A real code, in your wallet, seconds after you redeem. Show it at the till or paste it online.' },
];

export default function RedeemTrack() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const [rewards, setRewards] = useState(FALLBACK);
  const compact = useCompact();

  useEffect(() => {
    fetchLiveRewards()
      .then((live) => { if (live.length) setRewards(live); })
      .catch(() => { /* keep fallback */ });
  }, []);

  const infoOpacity = useTransform(scrollYProgress, [0.03, 0.09], [0, 1]);

  // Movement 1 — the vault glides through, then falls back for the spend
  const trackX = useTransform(scrollYProgress, [0.05, 0.52], compact ? ['-88%', '6%'] : ['-40%', '14%']);
  const trackOpacity = useTransform(scrollYProgress, [0.52, 0.60], [1, 0.04]);
  const trackScale = useTransform(scrollYProgress, [0.52, 0.60], [1, 0.94]);

  // Depth layer — a dimmer rank of posters drifting slower behind
  const backX = useTransform(scrollYProgress, [0.05, 0.56], ['-12%', '6%']);
  const backOpacity = useTransform(scrollYProgress, [0.06, 0.14, 0.50, 0.58], [0, 0.30, 0.30, 0]);

  // Ghost word bows out before the spend takes its side of the stage
  const ghostOpacity = useTransform(scrollYProgress, [0.50, 0.58], [1, 0]);

  const featured = rewards[0];
  const backRow = [...rewards.slice(2), ...rewards.slice(0, 2)];

  return (
    <section ref={ref} data-act="redeem" style={{ position: 'relative', height: '560vh' }}>
      <div
        style={{
          position: 'sticky', top: 0, height: '100vh', overflow: 'hidden',
          display: 'flex', alignItems: 'center',
        }}
      >
        {/* Ghost act word — deep background */}
        <motion.div style={{ opacity: ghostOpacity }}>
          <GhostWord progress={scrollYProgress} top="7%" left="-2%" drift={[70, -70]} gold>
            REDEEM
          </GhostWord>
        </motion.div>

        {/* Beat copy — right column on desktop, bottom dock on compact */}
        {compact ? (
          <MobileCopyDock tag="03 — REDEEM" tagOpacity={infoOpacity}>
            {PANELS.map((p, i) => (
              <CopyPanel key={i} panel={p} progress={scrollYProgress} compact />
            ))}
          </MobileCopyDock>
        ) : (
          <motion.div
            style={{
              position: 'absolute', right: '7%', top: '50%', y: '-50%', width: 360, maxWidth: '30vw',
              opacity: infoOpacity, zIndex: 30, textAlign: 'left',
            }}
          >
            <SectionTag>03 — REDEEM</SectionTag>
            <div style={{ position: 'relative', height: 230 }}>
              {PANELS.map((p, i) => (
                <CopyPanel key={i} panel={p} progress={scrollYProgress} />
              ))}
            </div>
          </motion.div>
        )}

        {/* Fade under the info column (desktop only) */}
        {!compact && (
          <div
            style={{
              position: 'absolute', right: 0, top: 0, bottom: 0, width: '42%', zIndex: 20, pointerEvents: 'none',
              background: `linear-gradient(270deg, ${pg.bg} 60%, rgba(8,8,8,0.96) 80%, transparent 100%)`,
            }}
          />
        )}

        {/* Depth rank — the hall of prizes behind the front row */}
        {!compact && (
          <motion.div
            aria-hidden
            style={{
              position: 'absolute', top: '42%', y: '-50%', left: 0, zIndex: 6,
              display: 'flex', alignItems: 'center', gap: 44, x: backX, opacity: backOpacity,
              pointerEvents: 'none', willChange: 'transform',
            }}
          >
            {backRow.map((r, i) => (
              <div key={`b-${r.id}`} style={{ transform: `translateY(${[38, -26, 44, -18, 30][i % 5]}px)`, flexShrink: 0 }}>
                <PosterCard reward={r} width={206} height={284} muted />
              </div>
            ))}
          </motion.div>
        )}

        {/* Movement 1 — the vault's front row */}
        <motion.div
          style={{
            display: 'flex', alignItems: 'center', gap: compact ? 20 : 34, x: trackX, opacity: trackOpacity, scale: trackScale,
            paddingRight: compact ? '14%' : '42%', zIndex: 10, willChange: 'transform',
            marginTop: compact ? '-9vh' : 0,
          }}
        >
          {rewards.map((r, i) => (
            <div key={r.id} style={{ transform: `translateY(${[24, -30, 32, -22, 26][i % 5]}px)`, flexShrink: 0 }}>
              <PosterCard
                reward={r}
                width={compact ? 224 : 296}
                height={compact ? 312 : 404}
              />
            </div>
          ))}
        </motion.div>

        {/* Movement 2 — the spend */}
        <RedeemMoment progress={scrollYProgress} reward={featured} compact={compact} />
      </div>
    </section>
  );
}

/* ── The vault poster — a reward as a prize, not a list row ────────── */

function PosterCard({ reward, width, height, muted = false }) {
  const hasHero = !!reward.heroImage;
  return (
    <div
      style={{
        width, height, borderRadius: 24, overflow: 'hidden', position: 'relative', flexShrink: 0,
        background: hasHero
          ? '#101010'
          : `radial-gradient(120% 90% at 50% 0%, ${hexA(reward.tint, 0.22)}, transparent 60%), ${CARD_BG}`,
        border: hasHero ? 'none' : `1px solid ${CARD_BORDER}`,
        boxShadow: muted ? '0 24px 50px -30px rgba(0,0,0,0.9)' : '0 40px 80px -34px rgba(0,0,0,0.9)',
      }}
    >
      {hasHero && (
        <img
          src={reward.heroImage}
          alt=""
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          loading="lazy"
        />
      )}
      {/* Scrim so the price row pops */}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.08) 38%, rgba(0,0,0,0.62) 74%, rgba(0,0,0,0.9) 100%)',
        }}
      />
      {/* Offer flash */}
      {reward.item !== 'Member reward' && !muted && (
        <div
          style={{
            position: 'absolute', top: 14, left: 14,
            padding: '5px 11px', borderRadius: 100,
            background: 'rgba(8,8,8,0.55)', border: '1px solid rgba(232,210,0,0.4)', backdropFilter: 'blur(8px)',
            fontSize: 10, fontWeight: w.bold, letterSpacing: 1.2, color: t.accent, textTransform: 'uppercase',
          }}
        >
          {reward.item}
        </div>
      )}
      {/* Fallback initial when there's no art */}
      {!hasHero && (
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: width * 0.42, fontWeight: w.bold, color: hexA(reward.tint, 0.5),
          }}
        >
          {reward.initial}
        </div>
      )}
      {/* Identity + price */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: muted ? 14 : 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <LogoBox reward={reward} size={muted ? 34 : 42} radius={muted ? 9 : 11} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: muted ? 12.5 : 15, fontWeight: w.medium, color: '#F2F2F2', letterSpacing: -0.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {reward.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 2 }}>
              <span style={{ fontSize: muted ? 17 : 22, fontWeight: w.extraLight, color: t.gold, letterSpacing: -0.5 }}>{reward.pts}</span>
              <span style={{ fontSize: 9, fontWeight: w.medium, color: t.gold, opacity: 0.7 }}>pts</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Brand logo chip shared by posters, the featured card and the code card */
function LogoBox({ reward, size, radius }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: radius, flexShrink: 0, overflow: 'hidden',
        background: reward.logo ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.10)',
        border: '1px solid rgba(255,255,255,0.14)',
        backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: reward.tint, fontWeight: w.bold, fontSize: size * 0.4, fontFamily: t.font,
      }}
    >
      {reward.logo ? (
        <img src={reward.logo} alt={reward.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} loading="lazy" />
      ) : (
        reward.initial
      )}
    </div>
  );
}

function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(232,210,0,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ── Movement 2: the spend — focus, fill, drain, flip, bank ────────── */

const CARD_W = 400;
const CARD_H = 512;
const MONO = "'SF Mono', ui-monospace, 'Cascadia Mono', Menlo, monospace";

function redeemCode(reward) {
  const brand = reward.name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5) || 'POWR';
  return `${brand}-7F3K-2Q`;
}

function RedeemMoment({ progress, reward, compact }) {
  // Stage entrance
  const opacity = useTransform(progress, [0.54, 0.60], [0, 1]);
  const y = useTransform(progress, [0.54, 0.62], [80, 0]);
  const scale = useTransform(progress, [0.54, 0.62], [0.84, 1]);

  // The REDEEM button fills gold under your scroll — the "tap"
  const fillX = useTransform(progress, [0.585, 0.645], [0, 1]);
  const labelColor = useTransform(progress, [0.615, 0.63], ['#E8D200', '#0a0a0a']);

  // The flip — front (the prize) to back (the code)
  const rotateY = useTransform(progress, [0.66, 0.76], [0, 180]);

  // The balance banked in Earn drains by the price
  const balance = useTransform(progress, [0.66, 0.74], [BAL_START, BAL_START - reward.pts]);
  const balanceText = useTransform(balance, (v) => Math.round(v).toLocaleString());
  const balOpacity = useTransform(progress, [0.57, 0.61], [0, 1]);
  const costOpacity = useTransform(progress, [0.66, 0.70, 0.80, 0.85], [0, 1, 1, 0]);
  const costY = useTransform(progress, [0.66, 0.80], [10, -64]);

  // Code-reveal bloom + one expanding ring
  const glowOpacity = useTransform(progress, [0.60, 0.74], [0, 1]);
  const ringScale = useTransform(progress, [0.72, 0.82], [0.9, 1.3]);
  const ringOpacity = useTransform(progress, [0.72, 0.76, 0.82], [0, 0.45, 0]);

  // Wallet toast
  const toastY = useTransform(progress, [0.80, 0.87], [70, 0]);
  const toastOpacity = useTransform(progress, [0.80, 0.85], [0, 1]);

  const cw = compact ? 'min(80vw, 330px)' : CARD_W;
  const ch = compact ? 'min(54vh, 424px)' : CARD_H;

  return (
    <motion.div
      style={{
        position: 'absolute', left: compact ? '50%' : '31%', top: compact ? '41%' : '50%',
        x: '-50%', y: '-50%', zIndex: 15,
        opacity,
      }}
    >
      <motion.div style={{ y, scale, position: 'relative' }}>
        {/* Payoff glow */}
        <motion.div
          aria-hidden
          style={{
            position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
            width: 720, height: 720, borderRadius: '50%', opacity: glowOpacity, pointerEvents: 'none',
            background: 'radial-gradient(circle, rgba(232,210,0,0.11), transparent 62%)',
          }}
        />
        {/* One ring as the code lands */}
        <motion.div
          aria-hidden
          style={{
            position: 'absolute', left: '50%', top: '50%', x: '-50%', y: '-50%',
            width: compact ? 380 : 560, height: compact ? 380 : 560, borderRadius: '50%',
            border: '1px solid rgba(232,210,0,0.5)', scale: ringScale, opacity: ringOpacity, pointerEvents: 'none',
          }}
        />

        {/* The balance, draining as you spend it */}
        <motion.div
          style={{
            position: 'absolute', top: compact ? -54 : -60, right: 0, zIndex: 18,
            opacity: balOpacity, display: 'flex', alignItems: 'center', gap: 9,
            padding: '9px 14px', borderRadius: 100,
            background: 'rgba(20,20,22,0.92)', backdropFilter: 'blur(12px)', border: `1px solid ${t.borderCard}`,
          }}
        >
          <span style={{ fontSize: 9, fontWeight: w.medium, letterSpacing: 2, color: t.textMuted }}>BALANCE</span>
          <motion.span style={{ fontSize: 17, fontWeight: w.light, color: pg.text, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.3 }}>
            {balanceText}
          </motion.span>
          <span style={{ fontSize: 10, fontWeight: w.medium, color: t.accent }}>pts</span>
        </motion.div>

        {/* −cost floats off the balance */}
        <motion.div
          style={{
            position: 'absolute', top: compact ? -44 : -48, right: 10, opacity: costOpacity, y: costY, zIndex: 17,
            display: 'flex', alignItems: 'baseline', gap: 4, pointerEvents: 'none',
          }}
        >
          <span style={{ fontSize: 30, fontWeight: w.light, color: t.accent, letterSpacing: -1 }}>−{reward.pts}</span>
          <span style={{ fontSize: 10, fontWeight: w.bold, color: t.accent, opacity: 0.7, letterSpacing: 1 }}>PTS</span>
        </motion.div>

        {/* Flip stage */}
        <div style={{ perspective: 1500, width: cw, height: ch }}>
          <motion.div
            style={{
              width: '100%', height: '100%', position: 'relative',
              transformStyle: 'preserve-3d', rotateY,
            }}
          >
            <FeaturedFace reward={reward} fillX={fillX} labelColor={labelColor} />
            <CodeFace reward={reward} />
          </motion.div>
        </div>

        {/* Saved to wallet */}
        <motion.div
          style={{
            position: 'absolute', bottom: compact ? -60 : -74, left: '50%', x: '-50%',
            width: compact ? 'min(78vw, 320px)' : 330, y: toastY, opacity: toastOpacity, zIndex: 18,
            display: 'flex', gap: 12, alignItems: 'center', padding: 13,
            background: 'rgba(20,20,22,0.94)', backdropFilter: 'blur(14px)',
            border: `1px solid ${t.borderCard}`, borderRadius: 16,
            boxShadow: '0 20px 40px -12px rgba(0,0,0,0.6)',
          }}
        >
          <div style={{ width: 38, height: 38, borderRadius: 10, background: t.accentDim, border: `1px solid ${t.accentMid}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Ion name="wallet" size={19} color={t.accent} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: w.semiBold, color: pg.text }}>Saved to your wallet</div>
            <div style={{ fontSize: 11, fontWeight: w.light, color: pg.textSec, marginTop: 2 }}>Active · ready at checkout</div>
          </div>
          <Ion name="checkmark-circle" size={20} color={t.success} style={{ flexShrink: 0 }} />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/* Front face — the prize at full size, with the scroll-driven redeem */
function FeaturedFace({ reward, fillX, labelColor }) {
  const hasHero = !!reward.heroImage;
  return (
    <div
      style={{
        position: 'absolute', inset: 0, borderRadius: 28, overflow: 'hidden',
        backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
        background: hasHero ? '#101010' : CARD_BG,
        border: hasHero ? 'none' : `1px solid ${CARD_BORDER}`,
        boxShadow: '0 60px 120px -36px rgba(0,0,0,0.92)',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      }}
    >
      {/* The app's own signature: live video when the reward has one */}
      {reward.heroVideo ? (
        <video
          src={reward.heroVideo}
          poster={reward.heroImage || undefined}
          muted loop autoPlay playsInline preload="metadata"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : hasHero && (
        <img
          src={reward.heroImage} alt="" aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.72) 78%, rgba(0,0,0,0.9) 100%)',
        }}
      />
      <div style={{ position: 'relative', padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <LogoBox reward={reward} size={54} radius={14} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: w.medium, color: '#F2F2F2', letterSpacing: -0.2 }}>{reward.name}</div>
            <div style={{ fontSize: 12.5, fontWeight: w.light, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>{reward.item}</div>
          </div>
        </div>
        {/* Scroll fills the button — the tap, played in slow motion */}
        <div
          style={{
            marginTop: 18, position: 'relative', overflow: 'hidden', borderRadius: 100,
            border: '1.5px solid rgba(232,210,0,0.65)',
          }}
        >
          <motion.div
            aria-hidden
            style={{
              position: 'absolute', inset: 0, background: t.accent,
              scaleX: fillX, transformOrigin: '0% 50%',
            }}
          />
          <motion.div
            style={{
              position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '14px 0', fontSize: 13.5, fontWeight: w.bold, letterSpacing: 1.5, color: labelColor,
            }}
          >
            REDEEM · {reward.pts} PTS
          </motion.div>
        </div>
      </div>
    </div>
  );
}

/* Back face — the live code, pre-rotated so the flip reveals it */
function CodeFace({ reward }) {
  return (
    <div
      style={{
        position: 'absolute', inset: 0, borderRadius: 28, overflow: 'hidden',
        backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
        transform: 'rotateY(180deg)',
        background: '#141416', border: '1px solid rgba(232,210,0,0.28)',
        boxShadow: '0 60px 120px -36px rgba(0,0,0,0.92), 0 0 90px -24px rgba(232,210,0,0.3)',
        padding: 24, display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <LogoBox reward={reward} size={46} radius={12} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: w.medium, color: pg.text }}>{reward.name}</div>
          <div style={{ fontSize: 11.5, fontWeight: w.light, color: pg.textSec, marginTop: 2 }}>{reward.item}</div>
        </div>
        <span
          style={{
            display: 'flex', alignItems: 'center', gap: 4, color: t.success,
            border: `1.5px solid ${t.success}`, borderRadius: 6, padding: '3px 8px',
            fontSize: 10, fontWeight: w.bold, letterSpacing: 1, flexShrink: 0,
          }}
        >
          <Ion name="checkmark" size={11} color={t.success} /> REDEEMED
        </span>
      </div>

      {/* The code */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 15 }}>
        <div style={{ fontSize: 10, fontWeight: w.semiBold, letterSpacing: 3, color: pg.textMuted }}>YOUR CODE</div>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 14, padding: '19px 26px',
            border: `1.5px dashed ${t.accentMid}`, borderRadius: 14, background: 'rgba(232,210,0,0.04)',
          }}
        >
          <span style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600, color: t.accent, letterSpacing: 1.5 }}>
            {redeemCode(reward)}
          </span>
          <Ion name="copy-outline" size={17} color={pg.textSec} />
        </div>
        <div style={{ fontSize: 12, fontWeight: w.light, color: pg.textSec }}>Show at checkout, online or in store</div>
      </div>

      {/* Footer */}
      <div style={{ paddingTop: 14, borderTop: `1px solid ${t.borderCard}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: pg.textSec, fontSize: 11.5, fontWeight: w.light }}>
          <Ion name="wallet-outline" size={14} color={pg.textSec} /> In your wallet
        </span>
        <span style={{ color: pg.textMuted, fontSize: 11, fontWeight: w.light }}>Expires in 30 days</span>
      </div>
    </div>
  );
}
