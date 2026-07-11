import { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { pg, t, w } from '../theme';
import Ion from '../Ionicon';
import { SectionTag, CopyPanel, GhostWord, MobileCopyDock, useCompact } from './shared';

/**
 * Act III — Redeem. Two movements:
 *  1. The vault: reward rows (real rewards.tsx anatomy, live catalogue) slide
 *     across as a horizontal track, mirrored against Earn.
 *  2. The climax: the track parts, the featured reward takes centre stage and
 *     FLIPS — hero art on the front, a live code on the back — the points
 *     deduct, and the code lands in the wallet. The act earns its payoff.
 */
const FALLBACK = [
  { id: 'f1', name: 'TRIBE', item: '35% off protein',  pts: 220, logo: null, heroImage: null, initial: 'T', tint: '#1877C7' },
  { id: 'f2', name: 'HUEL',  item: 'Member reward',    pts: 185, logo: null, heroImage: null, initial: 'H', tint: '#A6C34C' },
  { id: 'f3', name: 'Frank', item: 'Coffee bundle',    pts: 200, logo: null, heroImage: null, initial: 'F', tint: '#E8734A' },
  { id: 'f4', name: 'MAJIC', item: '25% off desserts', pts: 180, logo: null, heroImage: null, initial: 'M', tint: '#9000fe' },
  { id: 'f5', name: 'REP',   item: 'Member reward',    pts: 150, logo: null, heroImage: null, initial: 'R', tint: '#E84040' },
];

/* One live reward per brand, in the app's own catalogue order */
async function fetchLiveRewards() {
  const { data, error } = await supabase
    .from('rewards')
    .select('id, title, brand_name, powr_cost, value_label, image_url, hero_image_url, brand_color, partners(logo_url)')
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
      initial: brand[0].toUpperCase(),
      tint: r.brand_color?.trim() || t.accent,
    });
    if (out.length >= 5) break;
  }
  return out;
}

const CARD_BG = '#151515';
const CARD_BORDER = 'rgba(255,255,255,0.07)';

const PANELS = [
  { range: [0.05, 0.10, 0.38, 0.44], title: 'Points that buy real things.',
    body: 'A vault of rewards from brands you actually use — stocked live, priced in the points you just earned.' },
  { range: [0.50, 0.56, 0.90, 0.97], title: 'Tap once. It’s yours.',
    body: 'Redeem and a real code lands in your wallet instantly — saved, tracked and ready at the checkout.' },
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

  const infoOpacity = useTransform(scrollYProgress, [0.04, 0.10], [0, 1]);

  // Movement 1 — the vault slides through, then falls back for the climax
  const trackX = useTransform(scrollYProgress, [0.06, 0.48], compact ? ['-84%', '6%'] : ['-36%', '16%']);
  const trackOpacity = useTransform(scrollYProgress, [0.44, 0.54], [1, 0.08]);
  const trackScale = useTransform(scrollYProgress, [0.44, 0.54], [1, 0.95]);

  const featured = rewards[0];

  return (
    <section ref={ref} style={{ position: 'relative', height: '500vh' }}>
      <div
        style={{
          position: 'sticky', top: 0, height: '100vh', overflow: 'hidden',
          display: 'flex', alignItems: 'center',
        }}
      >
        {/* Ghost act word — deep background */}
        <GhostWord progress={scrollYProgress} top="7%" left="-2%" drift={[70, -70]} gold>
          REDEEM
        </GhostWord>

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
              position: 'absolute', right: 0, top: 0, bottom: 0, width: '38%', zIndex: 20, pointerEvents: 'none',
              background: `linear-gradient(270deg, ${pg.bg} 55%, transparent 100%)`,
            }}
          />
        )}

        {/* Movement 1 — the sliding vault */}
        <motion.div
          style={{
            display: 'flex', alignItems: 'center', gap: compact ? 18 : 26, x: trackX, opacity: trackOpacity, scale: trackScale,
            paddingRight: compact ? '14%' : '40%', zIndex: 10, willChange: 'transform',
            marginTop: compact ? '-10vh' : 0,
          }}
        >
          {rewards.map((r, i) => (
            <div key={r.id} style={{ transform: `translateY(${[26, -30, 34, -22, 28][i % 5]}px)`, flexShrink: 0 }}>
              <RewardRowCard reward={r} />
            </div>
          ))}
        </motion.div>

        {/* Movement 2 — the redemption */}
        <RedeemMoment progress={scrollYProgress} reward={featured} compact={compact} />
      </div>
    </section>
  );
}

/* One reward row as a free-floating card — real rewards.tsx anatomy */
function RewardRowCard({ reward }) {
  const hasHero = !!reward.heroImage;
  return (
    <div
      style={{
        flexShrink: 0, width: 316, borderRadius: 20, overflow: 'hidden',
        position: 'relative', boxShadow: '0 30px 60px -30px rgba(0,0,0,0.8)',
        minHeight: 88,
        border: hasHero ? 'none' : `1px solid ${CARD_BORDER}`,
        background: hasHero ? 'transparent' : CARD_BG,
        backdropFilter: hasHero ? undefined : 'blur(20px)',
      }}
    >
      {/* Hero image fills the card */}
      {hasHero && (
        <img
          src={reward.heroImage}
          alt=""
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          loading="lazy"
        />
      )}
      {/* Gradient scrim — heavier at bottom so text pops */}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: hasHero
            ? 'linear-gradient(to bottom, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.72) 70%, rgba(0,0,0,0.88) 100%)'
            : undefined,
          borderRadius: 20,
        }}
      />
      {/* Content row */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 13, padding: 16 }}>
        <LogoBox reward={reward} size={56} radius={14} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: w.regular, color: '#F2F2F2', letterSpacing: -0.1 }}>{reward.name}</div>
          <div style={{ fontSize: 11, fontWeight: w.light, color: 'rgba(255,255,255,0.6)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {reward.item}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
          <span style={{ fontSize: 20, fontWeight: w.extraLight, color: t.gold, letterSpacing: -0.5 }}>{reward.pts}</span>
          <span style={{ fontSize: 9, fontWeight: w.medium, color: t.gold, opacity: 0.7 }}>pts</span>
        </div>
      </div>
    </div>
  );
}

/* Brand logo chip shared by row, featured card and code card */
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

/* ── Movement 2: featured card takes centre stage, flips into its code ── */

const CARD_W = 340;
const CARD_H = 430;
const MONO = "'SF Mono', ui-monospace, 'Cascadia Mono', Menlo, monospace";

function redeemCode(reward) {
  const brand = reward.name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5) || 'POWR';
  return `${brand}-7F3K-2Q`;
}

function RedeemMoment({ progress, reward, compact }) {
  // Stage entrance
  const opacity = useTransform(progress, [0.50, 0.56], [0, 1]);
  const y = useTransform(progress, [0.50, 0.58], [70, 0]);
  const scale = useTransform(progress, [0.50, 0.58], [0.86, 1]);

  // The flip — front (reward art) to back (the code)
  const rotateY = useTransform(progress, [0.62, 0.72], [0, 180]);

  // Points deduct as the flip lands
  const costOpacity = useTransform(progress, [0.66, 0.70, 0.82, 0.87], [0, 1, 1, 0]);
  const costY = useTransform(progress, [0.66, 0.82], [16, -74]);

  // Wallet toast
  const toastY = useTransform(progress, [0.76, 0.83], [70, 0]);
  const toastOpacity = useTransform(progress, [0.76, 0.81], [0, 1]);

  // Glow behind the moment warms up for the payoff
  const glowOpacity = useTransform(progress, [0.56, 0.72], [0, 1]);

  return (
    <motion.div
      style={{
        position: 'absolute', left: compact ? '50%' : '31%', top: compact ? '42%' : '50%',
        x: '-50%', y: '-50%', zIndex: 15,
        opacity,
      }}
    >
      <motion.div style={{ y, scale, position: 'relative' }}>
        {/* Payoff glow */}
        <motion.div
          style={{
            position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
            width: 620, height: 620, borderRadius: '50%', opacity: glowOpacity, pointerEvents: 'none',
            background: 'radial-gradient(circle, rgba(232,210,0,0.10), transparent 62%)',
          }}
        />

        {/* Flip stage */}
        <div style={{ perspective: 1400, width: compact ? 'min(78vw, 320px)' : CARD_W, height: compact ? 'min(48vh, 404px)' : CARD_H }}>
          <motion.div
            style={{
              width: '100%', height: '100%', position: 'relative',
              transformStyle: 'preserve-3d', rotateY,
            }}
          >
            <FeaturedFace reward={reward} />
            <CodeFace reward={reward} />
          </motion.div>
        </div>

        {/* Points deducted */}
        <motion.div
          style={{
            position: 'absolute', top: -8, right: compact ? 0 : -30, opacity: costOpacity, y: costY, zIndex: 18,
            display: 'flex', alignItems: 'baseline', gap: 4, pointerEvents: 'none',
          }}
        >
          <span style={{ fontSize: 34, fontWeight: w.light, color: t.accent, letterSpacing: -1 }}>−{reward.pts}</span>
          <span style={{ fontSize: 11, fontWeight: w.bold, color: t.accent, opacity: 0.7, letterSpacing: 1 }}>PTS</span>
        </motion.div>

        {/* Saved to wallet */}
        <motion.div
          style={{
            position: 'absolute', bottom: compact ? -62 : -76, left: '50%', x: '-50%',
            width: compact ? 'min(76vw, 312px)' : 312, y: toastY, opacity: toastOpacity, zIndex: 18,
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

/* Front face — the reward, blown up to centre stage */
function FeaturedFace({ reward }) {
  const hasHero = !!reward.heroImage;
  return (
    <div
      style={{
        position: 'absolute', inset: 0, borderRadius: 26, overflow: 'hidden',
        backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
        background: hasHero ? '#101010' : CARD_BG,
        border: hasHero ? 'none' : `1px solid ${CARD_BORDER}`,
        boxShadow: '0 50px 100px -30px rgba(0,0,0,0.9)',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      }}
    >
      {hasHero && (
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
      <div style={{ position: 'relative', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <LogoBox reward={reward} size={52} radius={13} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: w.medium, color: '#F2F2F2', letterSpacing: -0.2 }}>{reward.name}</div>
            <div style={{ fontSize: 12, fontWeight: w.light, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>{reward.item}</div>
          </div>
        </div>
        <div
          style={{
            marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: t.accent, color: t.onAccent, borderRadius: 100, padding: '13px 0',
            fontSize: 13, fontWeight: w.bold, letterSpacing: 1.5,
          }}
        >
          REDEEM · {reward.pts} PTS
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
        position: 'absolute', inset: 0, borderRadius: 26, overflow: 'hidden',
        backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
        transform: 'rotateY(180deg)',
        background: '#141416', border: '1px solid rgba(232,210,0,0.28)',
        boxShadow: '0 50px 100px -30px rgba(0,0,0,0.9), 0 0 70px -20px rgba(232,210,0,0.25)',
        padding: 22, display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <LogoBox reward={reward} size={44} radius={11} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: w.medium, color: pg.text }}>{reward.name}</div>
          <div style={{ fontSize: 11, fontWeight: w.light, color: pg.textSec, marginTop: 2 }}>{reward.item}</div>
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <div style={{ fontSize: 10, fontWeight: w.semiBold, letterSpacing: 3, color: pg.textMuted }}>YOUR CODE</div>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 14, padding: '18px 24px',
            border: `1.5px dashed ${t.accentMid}`, borderRadius: 14, background: 'rgba(232,210,0,0.04)',
          }}
        >
          <span style={{ fontFamily: MONO, fontSize: 21, fontWeight: 600, color: t.accent, letterSpacing: 1.5 }}>
            {redeemCode(reward)}
          </span>
          <Ion name="copy-outline" size={17} color={pg.textSec} />
        </div>
        <div style={{ fontSize: 11.5, fontWeight: w.light, color: pg.textSec }}>Show at checkout, online or in store</div>
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
