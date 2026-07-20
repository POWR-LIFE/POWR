import { motion, motionValue, useAnimationFrame, useScroll, useTransform } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { storageImage } from '../../lib/storage';
import { supabase } from '../../lib/supabase';
import Ion from '../Ionicon';
import { pg, t, w } from '../theme';
import { CopyPanel, GhostWord, MobileCopyDock, SectionTag, useCompact } from './shared';

/**
 * Act III — Redeem. The payoff act: this is what the points are FOR.
 * Two movements:
 *  1. The vault: the FULL live partner catalogue as an editorial gallery —
 *     mixed-scale posters glide past a fixed spotlight; whichever prize
 *     crosses the stage centre ignites (brightness, scale, gold hairline)
 *     while the partner index rail along the bottom lights its name.
 *  2. The spend: HUEL takes centre stage — gold-framed, a light sheen
 *     sweeps the card as it seats, the REDEEM button fills under your
 *     scroll, the balance banked in Earn drains, and the card flips into
 *     a live code that lands in the wallet.
 */
const FALLBACK = [
  { id: 'f1', brand: 'HUEL',   name: 'HUEL',   flash: '£10 OFF', item: '£10 OFF',          pts: 185, logo: null, heroImage: null, heroVideo: null, initial: 'H', tint: '#A6C34C' },
  { id: 'f2', brand: 'MAJIC',  name: 'MAJIC',  flash: '15% OFF', item: '15% off desserts', pts: 180, logo: null, heroImage: null, heroVideo: null, initial: 'M', tint: '#9000fe' },
  { id: 'f3', brand: 'FRANk',  name: 'FRANk',  flash: '20% OFF', item: '20% OFF',          pts: 200, logo: null, heroImage: null, heroVideo: null, initial: 'F', tint: '#E8734A' },
  { id: 'f4', brand: 'REP',    name: 'REP',    flash: '20% OFF', item: '20% OFF',          pts: 200, logo: null, heroImage: null, heroVideo: null, initial: 'R', tint: '#006AFB' },
  { id: 'f5', brand: 'SWT',    name: 'SWT',    flash: '15% OFF', item: '15% OFF',          pts: 150, logo: null, heroImage: null, heroVideo: null, initial: 'S', tint: '#E8D200' },
  { id: 'f6', brand: 'TRIBE',  name: 'TRIBE',  flash: '35% OFF', item: '35% OFF',          pts: 220, logo: null, heroImage: null, heroVideo: null, initial: 'T', tint: '#1877C7' },
  { id: 'f7', brand: 'OMNITY', name: 'OMNITY', flash: '20% OFF', item: '20% off',          pts: 210, logo: null, heroImage: null, heroVideo: null, initial: 'O', tint: '#E8D200' },
  { id: 'f8', brand: 'MATHAN', name: 'MATHAN', flash: '£15 OFF', item: '£15 off',          pts: 300, logo: null, heroImage: null, heroVideo: null, initial: 'M', tint: '#0e2bff' },
];

/* The WHOLE live catalogue, one reward per brand. Duplicate brand rows are
   merged rather than dropped so the richest copy/colour wins. */

/* Card-scale copies of the brand art. The vault paints eight posters at once
   while the stage is scrolling, so the originals — press-resolution, ~19MB and
   150MB+ of decoded bitmap between them — land as multi-second decode stalls
   exactly as you scroll in. Bounds the longest side; the posters keep their
   own aspect ratios so object-fit crops them exactly as it does at full res.
   One hero size serves both the poster and the featured card, so the showcase
   piece reuses the poster's decode instead of fetching its own. */
const HERO_MAX = 1280; // featured card is 420x540 CSS — covers it at ~2x DPR
const LOGO_MAX = 128; //  largest chip is 54px CSS — covers it at ~2x DPR

/* "15% OFF" / "£10 OFF" from the reward's structured discount columns */
function discountLabel(type, value) {
  const v = parseFloat(value);
  if (!v) return '';
  const n = Number.isInteger(v) ? v : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  if (type === 'percentage') return `${n}% OFF`;
  if (type === 'fixed_amount') return `£${n} OFF`;
  return '';
}

async function fetchLiveRewards() {
  const { data, error } = await supabase
    .from('rewards')
    .select('id, title, brand_name, powr_cost, value_label, offer, discount_type, discount_value, image_url, hero_image_url, hero_video_url, brand_color, partners(logo_url)')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('powr_cost', { ascending: true })
    .limit(24);
  if (error) throw error;
  const byBrand = new Map();
  for (const r of data ?? []) {
    const brand = (r.brand_name || r.title || '').trim();
    if (!brand) continue;
    const key = brand.toLowerCase();
    const partner = Array.isArray(r.partners) ? r.partners[0] : r.partners;
    const flash = discountLabel(r.discount_type, r.discount_value)
      || offerFlash(r.value_label?.trim() || r.offer?.trim() || '');
    const item = r.value_label?.trim() || r.offer?.trim() || flash || 'Member reward';
    const tint = r.brand_color?.trim() || '';
    const existing = byBrand.get(key);
    if (existing) {
      if (!existing.flash && flash) { existing.flash = flash; existing.item = item; }
      if (existing.tint === t.accent && tint) existing.tint = tint;
      continue;
    }
    byBrand.set(key, {
      id: r.id,
      brand,
      name: brand,
      flash,
      item,
      pts: r.powr_cost,
      logo: storageImage(r.image_url || partner?.logo_url || null, LOGO_MAX),
      heroImage: storageImage(r.hero_image_url || null, HERO_MAX),
      heroVideo: r.hero_video_url || null,
      initial: brand[0].toUpperCase(),
      tint: tint || t.accent,
    });
  }
  return [...byBrand.values()];
}

const CARD_BG = '#151515';
const CARD_BORDER = 'rgba(255,255,255,0.07)';

/* The vault pill shows just the discount — "25% OFF", not the full offer
   sentence (long labels like MAJIC's would truncate). */
function offerFlash(item) {
  const m = /(£\s?\d+(?:\.\d+)?|\d+\s?%)\s*off/i.exec(item || '');
  return m ? `${m[1].replace(/\s/g, '')} OFF` : item;
}

/* The balance Earn just banked — Act II ends on 1,297 */
const BAL_START = 1297;

/* The showcase piece. Falls back to the first reward if HUEL ever lapses. */
const FEATURED_BRAND = 'HUEL';

const PANELS = [
  { range: [0.04, 0.09, 0.24, 0.30], title: 'This is what the sweat buys.',
    body: 'The partner vault — every brand in the app, stocked live and priced in points.' },
  { range: [0.33, 0.39, 0.50, 0.56], title: 'Your points are money here.',
    body: 'Every session, street and sleep you banked — spendable at the checkout, like cash.' },
  { range: [0.60, 0.66, 0.90, 0.97], title: 'Tap once. It’s yours.',
    body: 'A real code, in your wallet, seconds after you redeem.' },
];

/* Where the gallery spotlight sits: centre of the OPEN stage, not the
   viewport — desktop cedes the right 42% to the copy column. */
const focusX = (compact) => window.innerWidth * (compact ? 0.5 : 0.3);

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

  // The featured piece leads the DOM so it rests stage-left as the vault
  // settles — right where the spend moment rises. A match cut, not a jump.
  const gallery = useMemo(() => {
    const hero = rewards.find((r) => r.brand.toUpperCase() === FEATURED_BRAND);
    return hero ? [hero, ...rewards.filter((r) => r !== hero)] : rewards;
  }, [rewards]);
  const featured = gallery[0];

  const infoOpacity = useTransform(scrollYProgress, [0.03, 0.09], [0, 1]);

  // Movement 1 — the vault glides through, then falls back for the spend
  const trackX = useTransform(scrollYProgress, [0.05, 0.52], compact ? ['-90%', '4%'] : ['-56%', '9%']);
  const trackOpacity = useTransform(scrollYProgress, [0.52, 0.60], [1, 0.04]);
  const trackScale = useTransform(scrollYProgress, [0.52, 0.60], [1, 0.94]);

  // Ghost word + rail bow out before the spend takes the stage
  const ghostOpacity = useTransform(scrollYProgress, [0.50, 0.58], [1, 0]);
  const railOpacity = useTransform(scrollYProgress, [0.07, 0.13, 0.50, 0.57], [0, 1, 1, 0]);

  // One motion value pair per poster, written by a single rAF measurer:
  // focus (0..1, peaks at the spotlight) and signed offset (for parallax).
  const focusMVs = useMemo(() => gallery.map(() => motionValue(0)), [gallery]);
  const driftMVs = useMemo(() => gallery.map(() => motionValue(1.4)), [gallery]);

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

        {/* Movement 1 — the gallery. flex-start ALWAYS (a flex-end here
            silently shifts the track's natural x and breaks the travel). */}
        <VaultGallery
          gallery={gallery}
          compact={compact}
          trackX={trackX}
          trackOpacity={trackOpacity}
          trackScale={trackScale}
          focusMVs={focusMVs}
          driftMVs={driftMVs}
        />

        {/* Partner index — every brand in the vault, lighting as it passes */}
        {!compact && <PartnerRail gallery={gallery} focusMVs={focusMVs} opacity={railOpacity} />}

        {/* Movement 2 — the spend */}
        <RedeemMoment progress={scrollYProgress} reward={featured} compact={compact} />
      </div>
    </section>
  );
}

/* ── The gallery track: one rAF loop feeds every poster's spotlight ── */

function VaultGallery({ gallery, compact, trackX, trackOpacity, trackScale, focusMVs, driftMVs }) {
  const trackRef = useRef(null);
  const cardRefs = useRef([]);

  useAnimationFrame(() => {
    const track = trackRef.current;
    if (!track) return;
    const vw = window.innerWidth;
    const box = track.getBoundingClientRect();
    if (box.right < 0 || box.left > vw) return;
    const cx = focusX(compact);
    for (let i = 0; i < gallery.length; i++) {
      const el = cardRefs.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const d = (r.left + r.width / 2 - cx) / (vw / 2);
      driftMVs[i]?.set(Math.max(-1.4, Math.min(1.4, d)));
      focusMVs[i]?.set(Math.max(0, 1 - Math.abs(d) * 1.15));
    }
  });

  return (
    <motion.div
      ref={trackRef}
      style={{
        display: 'flex', alignItems: 'center', gap: compact ? 18 : 28,
        x: trackX, opacity: trackOpacity, scale: trackScale,
        paddingRight: compact ? '16%' : '44%', zIndex: 10, willChange: 'transform',
        marginTop: compact ? '-9vh' : 0,
      }}
    >
      {gallery.map((r, i) => {
        const big = i % 2 === 0;
        return (
          <div
            key={r.id}
            ref={(el) => { cardRefs.current[i] = el; }}
            style={{ transform: `translateY(${[18, -34, 30, -24, 24, -30, 34, -20][i % 8]}px)`, flexShrink: 0 }}
          >
            <SpotlitPoster
              reward={r}
              width={compact ? (big ? 208 : 172) : (big ? 304 : 246)}
              height={compact ? (big ? 292 : 242) : (big ? 424 : 344)}
              focus={focusMVs[i]}
              drift={driftMVs[i]}
            />
          </div>
        );
      })}
    </motion.div>
  );
}

/* A poster under the gallery spotlight: ignites as it crosses the stage
   centre — brightness, a breath of scale, a gold hairline — while its
   hero art drifts against the travel for depth. */
function SpotlitPoster({ reward, width, height, focus, drift }) {
  const filter = useTransform(focus, (f) => `brightness(${(0.48 + 0.57 * f).toFixed(3)}) saturate(${(0.82 + 0.18 * f).toFixed(3)})`);
  const scale = useTransform(focus, (f) => 0.96 + 0.05 * f);
  const frameOpacity = useTransform(focus, (f) => Math.max(0, f - 0.35) * 1.3);
  const imgX = useTransform(drift, (d) => `${(-d * 4.5).toFixed(2)}%`);
  return (
    <motion.div style={{ position: 'relative', filter, scale, willChange: 'transform, filter' }}>
      <PosterCard reward={reward} width={width} height={height} imgX={imgX} />
      {/* Spotlight hairline */}
      <motion.div
        aria-hidden
        style={{
          position: 'absolute', inset: 0, borderRadius: 24, pointerEvents: 'none',
          border: '1px solid rgba(232,210,0,0.55)', opacity: frameOpacity,
          boxShadow: '0 0 44px -10px rgba(232,210,0,0.25)',
        }}
      />
    </motion.div>
  );
}

/* ── The vault poster — a prize on a gallery wall, not a list row ──── */

function PosterCard({ reward, width, height, imgX }) {
  const hasHero = !!reward.heroImage;
  return (
    <div
      style={{
        width, height, borderRadius: 24, overflow: 'hidden', position: 'relative', flexShrink: 0,
        background: hasHero
          ? '#101010'
          : `radial-gradient(120% 90% at 50% 0%, ${hexA(reward.tint, 0.22)}, transparent 60%), ${CARD_BG}`,
        border: hasHero ? 'none' : `1px solid ${CARD_BORDER}`,
        boxShadow: '0 46px 90px -34px rgba(0,0,0,0.94)',
      }}
    >
      {hasHero && (
        <motion.img
          src={reward.heroImage}
          alt=""
          aria-hidden="true"
          style={{
            // Bleed must outrun the parallax: |x| peaks at 4.5% * 1.4 clamp
            // * 1.16 own-width ≈ 7.3% of card width, so 8% overhang each side.
            // maxWidth:none defeats the site-wide `img { max-width: 100% }`,
            // which otherwise clamps the bleed and bares a strip on one edge.
            position: 'absolute', top: 0, bottom: 0, left: '-8%', width: '116%', maxWidth: 'none', height: '100%',
            objectFit: 'cover', x: imgX,
          }}
          loading="lazy"
          decoding="async"
        />
      )}
      {/* Scrim so the identity block pops */}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.10) 40%, rgba(0,0,0,0.58) 72%, rgba(0,0,0,0.92) 100%)',
        }}
      />
      {/* Offer flash — the discount only, badge-clean */}
      {reward.flash && (
        <div style={{ position: 'absolute', top: 14, left: 14, right: 58, display: 'flex' }}>
          <div
            style={{
              maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              padding: '5px 11px', borderRadius: 100,
              background: 'rgba(8,8,8,0.55)', border: '1px solid rgba(232,210,0,0.4)', backdropFilter: 'blur(8px)',
              fontSize: 10, fontWeight: w.bold, letterSpacing: 1.2, color: t.accent, textTransform: 'uppercase',
            }}
          >
            {reward.flash}
          </div>
        </div>
      )}
      {/* Brand chip — proof, kept out of the identity block's way */}
      <div style={{ position: 'absolute', top: 12, right: 12 }}><LogoBox reward={reward} size={38} radius={10} /></div>
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
      {/* Identity — editorial: hairline, wordmark, price */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 18 }}>
        <div style={{ width: 26, height: 1, background: 'rgba(232,210,0,0.75)', marginBottom: 10 }} />
        <div
          style={{
            fontSize: 11.5, fontWeight: w.semiBold, letterSpacing: 2.6, textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.88)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {reward.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 4 }}>
          <span style={{ fontSize: 27, fontWeight: w.extraLight, color: t.gold, letterSpacing: -0.5 }}>{reward.pts}</span>
          <span style={{ fontSize: 9, fontWeight: w.semiBold, color: t.gold, opacity: 0.7, letterSpacing: 1 }}>PTS</span>
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
        <img src={reward.logo} alt={reward.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} loading="lazy" decoding="async" />
      ) : (
        reward.initial
      )}
    </div>
  );
}

/* ── Partner index rail — the whole roster, in lights ──────────────── */

function PartnerRail({ gallery, focusMVs, opacity }) {
  return (
    <motion.div
      style={{
        position: 'absolute', left: '4.5%', bottom: '6%', zIndex: 12, opacity,
        display: 'flex', alignItems: 'center', gap: 18, pointerEvents: 'none',
        maxWidth: '52%', flexWrap: 'wrap', rowGap: 10,
      }}
    >
      <span style={{ fontSize: 9.5, fontWeight: w.semiBold, letterSpacing: 2.4, color: t.accent, whiteSpace: 'nowrap' }}>
        THE VAULT · {gallery.length} PARTNERS
      </span>
      <span style={{ width: 26, height: 1, background: 'rgba(232,210,0,0.45)' }} />
      {gallery.map((r, i) => (
        <RailName key={r.id} name={r.brand} focus={focusMVs[i]} />
      ))}
    </motion.div>
  );
}

function RailName({ name, focus }) {
  const nameOpacity = useTransform(focus, (f) => 0.28 + 0.72 * f);
  const color = useTransform(focus, (f) => (f > 0.72 ? t.accent : '#F2F2F2'));
  return (
    <motion.span
      style={{
        fontSize: 10.5, fontWeight: w.medium, letterSpacing: 2.6, textTransform: 'uppercase',
        opacity: nameOpacity, color, whiteSpace: 'nowrap',
      }}
    >
      {name}
    </motion.span>
  );
}

function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(232,210,0,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ── Movement 2: the spend — focus, sheen, fill, drain, flip, bank ─── */

const CARD_W = 420;
const CARD_H = 540;
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

  // A light sheen sweeps the card as it seats — the product-shot moment
  const sheenX = useTransform(progress, [0.595, 0.685], ['-140%', '150%']);
  const sheenOpacity = useTransform(progress, [0.595, 0.62, 0.665, 0.685], [0, 1, 1, 0]);

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
        {/* Spotlight cone from above — the stage light finds the prize */}
        <motion.div
          aria-hidden
          style={{
            position: 'absolute', left: '50%', top: compact ? -220 : -320, transform: 'translateX(-50%)',
            width: compact ? 480 : 760, height: compact ? 560 : 860, opacity: glowOpacity, pointerEvents: 'none',
            background: 'radial-gradient(48% 58% at 50% 32%, rgba(232,210,0,0.10), transparent 70%)',
          }}
        />
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
            width: compact ? 380 : 580, height: compact ? 380 : 580, borderRadius: '50%',
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
            <FeaturedFace reward={reward} fillX={fillX} labelColor={labelColor} sheenX={sheenX} sheenOpacity={sheenOpacity} />
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
function FeaturedFace({ reward, fillX, labelColor, sheenX, sheenOpacity }) {
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
          decoding="async"
        />
      )}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.72) 78%, rgba(0,0,0,0.9) 100%)',
        }}
      />
      {/* Sheen sweep — one pass of light as the card seats */}
      <motion.div
        aria-hidden
        style={{
          position: 'absolute', top: '-12%', bottom: '-12%', left: 0, width: '55%',
          x: sheenX, opacity: sheenOpacity, pointerEvents: 'none',
          background: 'linear-gradient(105deg, transparent 8%, rgba(255,255,255,0.13) 50%, transparent 92%)',
          transform: 'skewX(-12deg)',
        }}
      />
      {/* Gold hairline frame — the showcase piece, framed */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 10, borderRadius: 20, pointerEvents: 'none',
          border: '1px solid rgba(232,210,0,0.32)',
        }}
      />
      <div style={{ position: 'relative', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <LogoBox reward={reward} size={54} radius={14} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: w.medium, color: '#F2F2F2', letterSpacing: -0.2 }}>{reward.name}</div>
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
