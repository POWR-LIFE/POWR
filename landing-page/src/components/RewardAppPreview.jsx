import React, { useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// RewardAppPreview — a pixel-accurate recreation of the POWR mobile app's
// Rewards screen and Redeem screen, so partners see exactly how their brand
// renders in the app.
//
// Fidelity approach: the phone is rendered at TRUE device resolution
// (390×844, an iPhone logical size) using the exact px values from the RN
// source, then the whole device is uniformly CSS-scaled to fit the column —
// so every card, button and font is in correct proportion to the screen.
//   • Rewards screen  → app/(tabs)/rewards.tsx
//   • Tab bar         → app/(tabs)/_layout.tsx
//   • Background      → components/home/GeometricBackground.tsx
//   • Redeem screen   → app/redeem-modal.tsx
// ─────────────────────────────────────────────────────────────────────────────

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.55)';
const MUTED = 'rgba(255,255,255,0.35)';
const BORDER = 'rgba(255,255,255,0.08)';
const FONT = "'Outfit', system-ui, sans-serif";

// Device geometry (true app pixels) → scaled to DISPLAY_W on screen.
const BEZEL = 12;
const DEVICE_W = 390, DEVICE_H = 844;       // iPhone logical resolution
const PHONE_W = DEVICE_W + BEZEL * 2;         // 414
const PHONE_H = DEVICE_H + BEZEL * 2;         // 868
const STATUS_H = 50;                          // ~ safe-area top (insets.top)
const TAB_H = 84;                             // _layout.tsx iOS tabBar height
const DISPLAY_W = 300;                        // on-screen width (fits both columns)
const SCALE = DISPLAY_W / PHONE_W;            // uniform downscale

const SAMPLE_BALANCE = 1650;
const SAMPLE_SUFFIX = 'A1B2C3';

// Mirror affordability() from rewards.tsx.
function affordState(balance, pts) {
  if (balance >= pts) return 'can';
  if (balance >= pts * 0.6) return 'close';
  return 'locked';
}

// Exact Ionicons glyphs — same font (@expo/vector-icons Ionicons.ttf) and
// codepoints the app renders. Font file lives at landing-page/public/Ionicons.ttf.
const ION = {
  'home-outline': '',
  'bar-chart-outline': '',
  'trophy-outline': '',
  'bag': '',
  'compass-outline': '',
  'arrow-forward': '',
  'lock-closed': '',
  'gift-outline': '',
  'chevron-down': '',
  'chevron-up': '',
  'copy-outline': '',
  'open-outline': '',
  'checkmark': '',
};

function Ion({ name, size = 16, color = TEXT, style }) {
  return (
    <span style={{ fontFamily: 'PreviewIonicons', fontSize: size, lineHeight: 1, color, fontStyle: 'normal', fontWeight: 'normal', display: 'inline-block', ...style }}>
      {ION[name]}
    </span>
  );
}

const SAMPLE_REWARDS = [
  { title: '25% off your bill',   subtitle: 'Notto Pasta · Any branch', pts: 500, value: '25% off',  logoText: 'NOTTO' },
  { title: '3 months free',       subtitle: 'Calm · Premium',           pts: 600, value: '£45 value', logoText: 'calm' },
  { title: '£50 off mattress',    subtitle: 'Eight Sleep · Any model',  pts: 1200, value: '£50 off',  logoText: 'eight' },
];

function formatDiscountValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? `${n}` : n.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

// Mirror getRewardDisplayValue() from the app.
export function previewValueLabel({ valueLabel, discountType, discountValue }) {
  if (discountType && discountValue !== '' && discountValue != null && Number.isFinite(Number(discountValue))) {
    const amt = formatDiscountValue(discountValue);
    return discountType === 'percentage' ? `${amt}% off` : `£${amt} off`;
  }
  return valueLabel || '';
}

export function cleanPrefix(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

// Extract the brand segment from a stored promo code: 'POWR-TRIBE' / 'POWR-TRIBE-XXXXXX' / 'TRIBE' → 'TRIBE'
export function prefixFromPromo(promo, fallbackName) {
  const parts = String(promo ?? '').toUpperCase().split('-').filter(Boolean);
  if (parts[0] === 'POWR') parts.shift();
  return cleanPrefix(parts[0] ?? fallbackName ?? '');
}

// Map a rewards row to this component's props — shared by every surface that
// shows a live reward in the phone (Rewards editor, Overview rail).
export const previewFromReward = (r, partnerName) => ({
  brandName: r.brand_name || partnerName || '',
  title: r.title ?? '',
  description: r.description ?? '',
  partnerBlurb: r.partner_blurb ?? '',
  offer: r.offer ?? '',
  valueLabel: r.value_label ?? '',
  discountType: r.discount_type ?? '',
  discountValue: r.discount_value ?? '',
  pts: r.powr_cost,
  logoUrl: r.image_url,
  heroUrl: r.hero_image_url,
  heroVideoUrl: r.hero_video_url,
  codePrefix: prefixFromPromo(r.promo_code, r.brand_name || partnerName),
});

// Mirror splitDiscount() from the app.
function splitDiscount(label) {
  if (!label) return { amount: '', suffix: '' };
  const m = label.match(/^(.+?)\s*(OFF|off)$/);
  return m ? { amount: m[1].trim(), suffix: 'OFF' } : { amount: label, suffix: '' };
}

export default function RewardAppPreview(props) {
  const {
    brandName = '', title = '', description = '', partnerBlurb = '', offer = '',
    valueLabel = '', discountType = '', discountValue = '',
    pts = null, logoUrl = null, heroUrl = null, heroVideoUrl = null, codePrefix = '',
    pageTheme = 'dark',
  } = props;

  // The phone is always dark (the POWR app is dark-mode only); only the chrome
  // around it (toggle buttons + caption) adapts to the host page's theme.
  const lightPage = pageTheme === 'light';
  const tabIdleBorder = lightPage ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.12)';
  const tabIdleColor = lightPage ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.4)';
  const captionColor = lightPage ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.3)';

  const [screen, setScreen] = useState('rewards'); // 'rewards' | 'redeem'
  const [expanded, setExpanded] = useState(true);

  const displayBrand = brandName || 'Your Brand';
  const fallback = (brandName || title || '??').slice(0, 5).toLowerCase();
  const value = previewValueLabel({ valueLabel, discountType, discountValue });
  const ptsNum = pts != null && pts !== '' ? Number(pts) : 2200;
  const af = affordState(SAMPLE_BALANCE, ptsNum);

  const reward = {
    title: title || 'Your reward title',
    subtitle: description || displayBrand,
    value, pts: ptsNum, logoUrl, heroUrl, heroVideoUrl, fallback,
    brand: displayBrand, blurb: partnerBlurb, offer,
  };

  return (
    <div style={{ fontFamily: FONT, width: '100%', maxWidth: DISPLAY_W, margin: '0 auto' }}>
      <style>{`
        @font-face { font-family: 'PreviewIonicons'; src: url('/Ionicons.ttf') format('truetype'); font-display: block; }
        .powr-prev-scroll::-webkit-scrollbar{display:none;}
      `}</style>

      {/* Screen toggle (preview chrome, not part of the app UI) */}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 14 }}>
        {[['rewards', 'Rewards screen'], ['redeem', 'Redeem screen']].map(([key, label]) => (
          <button key={key} type="button" onClick={() => setScreen(key)} style={{
            cursor: 'pointer', borderRadius: 999, padding: '6px 12px', fontFamily: FONT,
            fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
            border: `1px solid ${screen === key ? 'rgba(232,210,0,0.5)' : tabIdleBorder}`,
            background: screen === key ? 'rgba(232,210,0,0.1)' : 'transparent',
            color: screen === key ? GOLD : tabIdleColor, transition: 'all .2s',
          }}>{label}</button>
        ))}
      </div>

      {/* Scaler: reserves the scaled footprint; the device renders at true px inside. */}
      <div style={{ width: DISPLAY_W, height: PHONE_H * SCALE, margin: '0 auto', position: 'relative' }}>
        <div style={{ width: PHONE_W, height: PHONE_H, transform: `scale(${SCALE})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
          {/* Phone bezel */}
          <div style={{ width: PHONE_W, height: PHONE_H, background: '#0a0a0a', borderRadius: 56, padding: BEZEL, boxShadow: '0 40px 90px rgba(0,0,0,0.55)' }}>
            {/* Screen */}
            <div style={{ position: 'relative', width: DEVICE_W, height: DEVICE_H, borderRadius: 44, overflow: 'hidden', background: '#060606' }}>
              <PreviewBackground />

              {/* Dynamic island + home indicator */}
              <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', width: 120, height: 34, background: '#000', borderRadius: 18, zIndex: 5 }} />
              <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', width: 140, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.45)', zIndex: 6 }} />

              <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
                <StatusBar />
                {screen === 'rewards' ? (
                  <>
                    <RewardsScreen reward={reward} af={af} expanded={expanded} onToggle={() => setExpanded(e => !e)} onRedeem={() => setScreen('redeem')} />
                    <NavBar />
                  </>
                ) : (
                  <RedeemScreen reward={reward} brand={displayBrand} codePrefix={codePrefix} onBack={() => setScreen('rewards')} />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <p style={{ textAlign: 'center', fontSize: 10, color: captionColor, marginTop: 12, fontFamily: FONT, letterSpacing: '0.05em' }}>
        Live preview · true-to-scale iPhone render
      </p>
    </div>
  );
}

// ── Status bar ────────────────────────────────────────────────────────────────
function StatusBar() {
  return (
    <div style={{ height: STATUS_H, paddingTop: 14, paddingLeft: 30, paddingRight: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
      <span style={{ fontSize: 15, fontWeight: 600, color: TEXT, letterSpacing: '0.5px' }}>9:41</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: 13, color: TEXT, letterSpacing: '1px' }}>●●●</span>
        <svg width="18" height="13" viewBox="0 0 16 11" fill="none"><path d="M8 2C10.5 2 12.7 3 14.3 4.7L8 11 1.7 4.7C3.3 3 5.5 2 8 2Z" fill={TEXT} opacity="0.9"/></svg>
        <div style={{ width: 25, height: 12, borderRadius: 3, border: '1px solid rgba(255,255,255,0.5)', padding: 2, display: 'flex' }}>
          <div style={{ flex: 1, background: TEXT, borderRadius: 1 }} />
        </div>
      </div>
    </div>
  );
}

// ── Geometric background (components/home/GeometricBackground.tsx) ───────────
function PreviewBackground() {
  const W = DEVICE_W, H = DEVICE_H;
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #181818 0%, #0e0e0e 50%, #060606 100%)' }} />
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id="pv_bloom" cx="15%" cy="8%" r="75%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.12" />
            <stop offset="45%" stopColor="#ffffff" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="pv_top" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.07" />
            <stop offset="60%" stopColor="#ffffff" stopOpacity="0.02" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="pv_right" x1="100%" y1="0%" x2="40%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="pv_bottom" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#000000" stopOpacity="0.40" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="url(#pv_bloom)" />
        <polygon points={`0,0 ${W * 0.88},0 ${W * 0.35},${H * 0.42} 0,${H * 0.28}`} fill="url(#pv_top)" />
        <polygon points={`${W},0 ${W},${H * 0.65} ${W * 0.58},${H * 0.38} ${W * 0.72},0`} fill="url(#pv_right)" />
        <polygon points={`0,${H * 0.62} ${W * 0.55},${H * 0.45} ${W},${H * 0.6} ${W},${H} 0,${H}`} fill="url(#pv_bottom)" />
        <line x1={W * 0.72} y1="0" x2={W * 0.58} y2={H * 0.38} stroke="#ffffff" strokeWidth="0.6" strokeOpacity="0.12" />
        <circle cx={W + 60} cy={H * 0.44} r="200" fill="none" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.09" />
        <circle cx={W + 60} cy={H * 0.44} r="265" fill="none" stroke="#ffffff" strokeWidth="0.6" strokeOpacity="0.05" />
        <circle cx={W * 0.72} cy="0" r="2" fill="#ffffff" fillOpacity="0.30" />
        <circle cx={W * 0.58} cy={H * 0.38} r="2" fill="#ffffff" fillOpacity="0.22" />
      </svg>
    </div>
  );
}

// ── Bottom tab bar (app/(tabs)/_layout.tsx) ──────────────────────────────────
function NavBar() {
  // Matches _layout.tsx: focused tab uses the filled glyph, others the outline.
  const items = [
    { name: 'home-outline', active: false },
    { name: 'bar-chart-outline', active: false },
    { name: 'trophy-outline', active: false },
    { name: 'bag', active: true },   // Spend = the rewards tab (focused → filled)
    { name: 'compass-outline', active: false },
  ];
  return (
    <div style={{ height: TAB_H, background: '#222222', borderTop: '1px solid #303030', display: 'flex', paddingTop: 8, flexShrink: 0 }}>
      {items.map(({ name, active }, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 4 }}>
          <Ion name={name} size={26} color={active ? GOLD : 'rgba(255,255,255,0.25)'} />
        </div>
      ))}
    </div>
  );
}

// ── Rewards screen (app/(tabs)/rewards.tsx) ──────────────────────────────────
function RewardsScreen({ reward, af, expanded, onToggle, onRedeem }) {
  const CATS = ['ALL', 'EAT', 'MOVE', 'MIND', 'SLEEP'];
  return (
    <div className="powr-prev-scroll" style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'none' }}>
      {/* Header */}
      <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 28, fontWeight: 200, letterSpacing: '-0.4px', color: TEXT }}>Rewards</span>
        <div style={{ width: 36, height: 36, borderRadius: 18, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
          <img src="/powr-avatar.png" alt="POWR" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      </div>

      {/* topContent: paddingHorizontal 12, gap 10 */}
      <div style={{ padding: '4px 12px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Balance card */}
        <div style={{ padding: '6px 6px 10px' }}>
          <div style={{ fontSize: 9, fontWeight: 500, letterSpacing: '2px', color: MUTED, textTransform: 'uppercase' }}>Available balance</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <span style={{ fontSize: 64, fontWeight: 100, letterSpacing: '-3px', lineHeight: '66px', color: GOLD }}>{SAMPLE_BALANCE.toLocaleString()}</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: DIM, letterSpacing: '2px', marginBottom: 14 }}>Points</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto', alignSelf: 'center' }}>
              <div style={{ width: 5, height: 5, borderRadius: 3, background: GOLD }} />
              <span style={{ fontSize: 10, fontWeight: 500, color: GOLD, letterSpacing: '0.3px' }}>+120 today</span>
            </div>
          </div>
        </div>

        {/* Featured card = the partner's reward */}
        <FeaturedCard reward={reward} af={af} onRedeem={onRedeem} />

        {/* Category tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)', marginTop: 4, marginBottom: 8 }}>
          {CATS.map((c, i) => (
            <div key={c} style={{ flex: 1, textAlign: 'center', paddingTop: 10, paddingBottom: 10, position: 'relative' }}>
              <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: '1.5px', color: i === 0 ? '#FFFFFF' : 'rgba(255,255,255,0.5)' }}>{c}</span>
              {i === 0 && <div style={{ position: 'absolute', bottom: -1, left: '20%', right: '20%', height: 1.5, background: '#FFFFFF', borderRadius: 1 }} />}
            </div>
          ))}
        </div>
      </div>

      {/* Reward list: paddingHorizontal 12 */}
      <div style={{ padding: '0 12px 24px' }}>
        <RewardCard reward={reward} af={af} expanded={expanded} onToggle={onToggle} onRedeem={onRedeem} />
        {SAMPLE_REWARDS.map((s, i) => <SampleCard key={i} s={s} />)}
      </div>
    </div>
  );
}

function LogoBox({ logoUrl, fallback, size = 56 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 14, flexShrink: 0, overflow: 'hidden',
      background: logoUrl ? 'transparent' : 'rgba(255,255,255,0.06)',
      border: logoUrl ? 'none' : '1px solid rgba(255,255,255,0.10)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {logoUrl
        ? <img src={logoUrl} alt="" style={{ width: '78%', height: '78%', objectFit: 'contain' }} />
        : <span style={{ fontSize: 12, fontWeight: 700, color: DIM, textAlign: 'center' }}>{fallback}</span>}
    </div>
  );
}

// Hero media — video-first (plays the loop) with the still image as the fallback/poster.
function HeroMedia({ videoUrl, imageUrl, style }) {
  if (videoUrl) return <video src={videoUrl} muted loop autoPlay playsInline preload="auto" style={style} />;
  if (imageUrl) return <img src={imageUrl} alt="" style={style} />;
  return null;
}

// ── Featured hero card (height 200) ──────────────────────────────────────────
function FeaturedCard({ reward, af, onRedeem }) {
  const { amount, suffix } = splitDiscount(reward.value);
  const ptsNeeded = reward.pts - SAMPLE_BALANCE;
  const progress = Math.min(SAMPLE_BALANCE / reward.pts, 1);
  return (
    <div style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}`, borderRadius: 20, overflow: 'hidden' }}>
      <div style={{ height: 200, position: 'relative', background: (reward.heroVideoUrl || reward.heroUrl) ? 'transparent' : '#101010' }}>
        {(reward.heroVideoUrl || reward.heroUrl)
          ? <HeroMedia videoUrl={reward.heroVideoUrl} imageUrl={reward.heroUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase' }}>Hero image</div>}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(10,10,10,0) 30%, rgba(10,10,10,0.45) 65%, rgba(10,10,10,0.85) 100%)' }} />

        <div style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,0.4)', padding: '6px 10px', borderRadius: 12 }}>
          <span style={{ fontSize: 30, fontWeight: 200, color: GOLD, letterSpacing: '-1px' }}>{reward.pts} </span>
          <span style={{ fontSize: 9, fontWeight: 600, color: GOLD, opacity: 0.7, letterSpacing: '1.5px', textTransform: 'uppercase' }}>points</span>
        </div>

        <div style={{ position: 'absolute', left: 16, right: 16, bottom: 14 }}>
          {reward.logoUrl && (
            <div style={{ marginBottom: 10 }}><img src={reward.logoUrl} alt="" style={{ width: 72, height: 72, objectFit: 'contain' }} /></div>
          )}

          {/* Progress bar — shown until the reward is affordable (afford !== 'can') */}
          {af !== 'can' && (
            <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ height: '100%', background: GOLD, borderRadius: 2, width: `${progress * 100}%` }} />
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {reward.value ? (
              <div style={{ display: 'inline-flex', alignItems: 'baseline', background: 'rgba(232,210,0,0.07)', border: '1px solid rgba(232,210,0,0.2)', borderRadius: 10, padding: '5px 10px' }}>
                <span style={{ fontSize: 16, fontWeight: 200, color: GOLD, letterSpacing: '-0.3px' }}>{amount}</span>
                {suffix && <span style={{ fontSize: 8, fontWeight: 600, color: GOLD, letterSpacing: '1px', opacity: 0.7, marginLeft: 4 }}>{suffix}</span>}
              </div>
            ) : <span />}
            {af === 'can' ? (
              <div onClick={onRedeem} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, background: GOLD, padding: '12px 20px', borderRadius: 22 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: '#0a0a0a', textTransform: 'uppercase' }}>Redeem</span>
                <Ion name="arrow-forward" size={13} color="#0a0a0a" />
              </div>
            ) : af === 'close' ? (
              <span style={{ fontSize: 13, fontWeight: 400, color: GOLD }}>{ptsNeeded.toLocaleString()} pts away</span>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Ion name="lock-closed" size={11} color={MUTED} />
                <span style={{ fontSize: 12, fontWeight: 300, color: MUTED }}>{ptsNeeded.toLocaleString()} pts</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Reward list card (paddingVertical 14, paddingHorizontal 4) ───────────────
function RewardCard({ reward, af, expanded, onToggle, onRedeem }) {
  const ptsNeeded = reward.pts - SAMPLE_BALANCE;
  return (
    <div onClick={onToggle} style={{ cursor: 'pointer', padding: '14px 4px', borderBottom: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden', opacity: af === 'locked' ? 0.5 : 1, background: expanded ? 'linear-gradient(to bottom, rgba(255,255,255,0.13), rgba(0,0,0,0))' : 'transparent' }}>
      {expanded && (reward.heroVideoUrl || reward.heroUrl) && (
        <div style={{ height: 170, margin: '-14px -4px 4px', overflow: 'hidden', position: 'relative', background: 'rgba(0,0,0,0.35)' }}>
          <HeroMedia videoUrl={reward.heroVideoUrl} imageUrl={reward.heroUrl} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0) 60%, rgba(30,30,30,0.95) 100%)' }} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <LogoBox logoUrl={reward.logoUrl} fallback={reward.fallback} size={expanded ? 64 : 56} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 400, color: TEXT, letterSpacing: '-0.1px' }}>{reward.title}</div>
          <div style={{ fontSize: 11, fontWeight: 300, color: DIM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{reward.subtitle}</div>
        </div>
        {!expanded && reward.value && (
          <div style={{ minWidth: 86, textAlign: 'center', padding: '9px 10px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.33)', background: 'rgba(255,255,255,0.07)', marginRight: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.6px', textTransform: 'uppercase', color: '#FFFFFF' }}>{reward.value}</span>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 44 }}>
          <span style={{ fontSize: 20, fontWeight: 200, color: GOLD, letterSpacing: '-0.5px', lineHeight: '22px' }}>{reward.pts}</span>
          <span style={{ fontSize: 9, fontWeight: 500, color: GOLD, opacity: 0.7, letterSpacing: '1px', textTransform: 'uppercase' }}>pts</span>
          <Ion name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={DIM} style={{ marginTop: 2 }} />
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {(reward.value || reward.blurb) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              {reward.value && (
                <div style={{ padding: '10px 14px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.08)' }}>
                  <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.8px', textTransform: 'uppercase', color: '#FFFFFF' }}>{reward.value}</span>
                </div>
              )}
              {reward.blurb && (
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '2px', color: MUTED, textTransform: 'uppercase' }}>About {reward.fallback.toUpperCase()}</div>
                  <div style={{ fontSize: 12, fontWeight: 300, color: DIM, lineHeight: '18px', marginTop: 6 }}>{reward.blurb}</div>
                </div>
              )}
            </div>
          )}
          {reward.offer && <div style={{ fontSize: 14, fontWeight: 300, color: TEXT, lineHeight: '21px' }}>{reward.offer}</div>}
          {af === 'can' ? (
            <div onClick={(e) => { e.stopPropagation(); onRedeem(); }} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '14px 0', borderRadius: 100, background: '#FFFFFF' }}>
              <Ion name="gift-outline" size={14} color="#000" />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#000', letterSpacing: '0.3px' }}>Redeem for {reward.pts} pts</span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Ion name="lock-closed" size={10} color={MUTED} />
              <span style={{ fontSize: 12, fontWeight: 300, color: MUTED }}>{ptsNeeded.toLocaleString()} pts {af === 'close' ? 'away' : 'needed'}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SampleCard({ s }) {
  return (
    <div style={{ padding: '14px 4px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 14, opacity: 0.55 }}>
      <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: DIM }}>{s.logoText}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 400, color: TEXT, letterSpacing: '-0.1px' }}>{s.title}</div>
        <div style={{ fontSize: 11, fontWeight: 300, color: DIM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.subtitle}</div>
      </div>
      <div style={{ minWidth: 86, textAlign: 'center', padding: '9px 10px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.33)', background: 'rgba(255,255,255,0.07)', marginRight: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.6px', textTransform: 'uppercase', color: '#FFFFFF' }}>{s.value}</span>
      </div>
      <div style={{ textAlign: 'center', minWidth: 44 }}>
        <div style={{ fontSize: 20, fontWeight: 200, color: GOLD, letterSpacing: '-0.5px', lineHeight: '22px' }}>{s.pts}</div>
        <div style={{ fontSize: 9, fontWeight: 500, color: GOLD, opacity: 0.7, letterSpacing: '1px', textTransform: 'uppercase' }}>pts</div>
      </div>
    </div>
  );
}

// ── Redeem screen (app/redeem-modal.tsx success view) ────────────────────────
// NB: redeem-modal uses its OWN muted/dim values (0.25 / 0.5), distinct from
// the rewards screen (0.35 / 0.55), so they're declared locally here.
function RedeemScreen({ reward, brand, codePrefix, onBack }) {
  const R_MUTED = 'rgba(255,255,255,0.25)';
  const R_DIM = 'rgba(255,255,255,0.5)';
  const prefix = (codePrefix || 'BRAND').toUpperCase();
  return (
    <div className="powr-prev-scroll" style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'none', display: 'flex', flexDirection: 'column' }}>
      <div onClick={onBack} style={{ cursor: 'pointer', padding: '6px 20px 0', color: R_MUTED, fontSize: 12, letterSpacing: '0.5px' }}>‹ Back</div>

      {/* Logo (160×80) */}
      <div style={{ paddingTop: 40, paddingBottom: 16, display: 'flex', justifyContent: 'center' }}>
        {reward.logoUrl
          ? <img src={reward.logoUrl} alt="" style={{ width: 160, height: 80, objectFit: 'contain' }} />
          : <div style={{ width: 80, height: 80, borderRadius: 20, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: R_DIM, fontSize: 28, fontWeight: 200, letterSpacing: 2 }}>{reward.fallback.slice(0, 2).toUpperCase()}</div>}
      </div>

      {/* Cover image (260) */}
      <div style={{ width: '100%', height: 260, position: 'relative', overflow: 'hidden' }}>
        {(reward.heroVideoUrl || reward.heroUrl)
          ? <HeroMedia videoUrl={reward.heroVideoUrl} imageUrl={reward.heroUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: R_MUTED, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase' }}>Cover image</div>}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(13,13,13,0) 40%, rgba(13,13,13,0.6) 80%, #0d0d0d 100%)' }} />
      </div>

      {/* Code + buttons */}
      <div style={{ marginTop: 'auto', padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ background: '#111', border: '1px solid rgba(232,210,0,0.2)', borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '2px', color: R_MUTED }}>YOUR CODE</span>
          <span style={{ fontSize: 20, fontWeight: 200, letterSpacing: '3px', color: TEXT }}>POWR-{prefix}-{SAMPLE_SUFFIX}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Ion name="copy-outline" size={13} color={R_MUTED} />
            <span style={{ fontSize: 11, fontWeight: 300, color: R_MUTED, letterSpacing: '0.3px' }}>Tap to copy</span>
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 300, color: R_MUTED, textAlign: 'center' }}>The final 6 characters are generated uniquely for each member.</span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: GOLD, borderRadius: 20, padding: '14px 0' }}>
          <Ion name="open-outline" size={14} color="#0a0a0a" />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '1.2px', color: '#0a0a0a', textTransform: 'uppercase' }}>Use code at {brand}</span>
        </div>
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 20, padding: '14px 0', textAlign: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 400, letterSpacing: '1.2px', color: R_DIM, textTransform: 'uppercase' }}>Done</span>
        </div>
      </div>
    </div>
  );
}
