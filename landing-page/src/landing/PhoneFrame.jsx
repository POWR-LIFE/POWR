import { motion } from 'framer-motion';

/**
 * A real app screen in a phone. The screenshots in /public/app are 390×844
 * CSS-px captures of the shipped app (2x WebP), so the frame is drawn to that
 * aspect and everything — bezel, corner radius, island — scales off `width`.
 *
 * The captures have no OS status bar, so the frame adds one in the app's own
 * top colour and seats the island inside it, rather than covering the app's
 * header with a notch.
 */
export const SCREEN_ASPECT = 390 / 844;
const STATUS_H = 0.112; // of width — the screen's status-bar strip

export default function PhoneFrame({
  src,
  alt = '',
  width = 300,
  topColor = '#1c1c1c',
  priority = false,
  style,
  motionStyle,
  className,
}) {
  const bezel = Math.round(width * 0.028);
  const radius = Math.round(width * 0.15);
  const statusH = Math.round(width * STATUS_H);
  const islandW = Math.round(width * 0.31);
  const islandH = Math.round(width * 0.09);
  // Screen height: image keeps its aspect, plus the status strip above it
  const screenW = width - bezel * 2;
  const imgH = screenW / SCREEN_ASPECT;
  const screenH = imgH + statusH;

  return (
    <motion.div
      className={className}
      style={{
        width,
        height: screenH + bezel * 2,
        borderRadius: radius,
        background: 'linear-gradient(160deg, #1a1a1a 0%, #060606 55%, #141414 100%)',
        padding: bezel,
        boxShadow:
          '0 0 0 1px rgba(255,255,255,0.10), 0 2px 0 1px rgba(255,255,255,0.03) inset, 0 50px 120px -30px rgba(0,0,0,0.85), 0 20px 40px -20px rgba(0,0,0,0.7)',
        position: 'relative',
        flexShrink: 0,
        ...motionStyle,
        ...style,
      }}
    >
      {/* side buttons — a hint of hardware, not a spec sheet */}
      <div aria-hidden style={{ position: 'absolute', left: -2, top: screenH * 0.22, width: 2, height: width * 0.075, borderRadius: 2, background: 'rgba(255,255,255,0.14)' }} />
      <div aria-hidden style={{ position: 'absolute', left: -2, top: screenH * 0.33, width: 2, height: width * 0.14, borderRadius: 2, background: 'rgba(255,255,255,0.14)' }} />
      <div aria-hidden style={{ position: 'absolute', right: -2, top: screenH * 0.27, width: 2, height: width * 0.2, borderRadius: 2, background: 'rgba(255,255,255,0.14)' }} />

      <div
        style={{
          width: screenW, height: screenH, borderRadius: radius - bezel, overflow: 'hidden',
          background: topColor, position: 'relative',
        }}
      >
        {/* status strip */}
        <div
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: statusH, background: topColor,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: `0 ${Math.round(width * 0.085)}px`, zIndex: 2,
            color: '#F2F2F2', fontSize: Math.max(9, width * 0.04), fontWeight: 600, letterSpacing: -0.2,
            fontFamily: "'Outfit', system-ui, sans-serif",
          }}
        >
          <span>9:41</span>
          <div
            aria-hidden
            style={{
              position: 'absolute', left: '50%', top: Math.round(statusH * 0.24), transform: 'translateX(-50%)',
              width: islandW, height: islandH, borderRadius: 999, background: '#000',
            }}
          />
          <svg width={width * 0.13} height={width * 0.035} viewBox="0 0 52 14" fill="#F2F2F2" aria-hidden>
            <rect x="0" y="6" width="3" height="8" rx="1" /><rect x="5" y="4" width="3" height="10" rx="1" /><rect x="10" y="2" width="3" height="12" rx="1" /><rect x="15" y="0" width="3" height="14" rx="1" />
            <rect x="26" y="1.5" width="22" height="11" rx="3" fill="none" stroke="#F2F2F2" strokeWidth="1.4" /><rect x="28" y="3.5" width="16" height="7" rx="1.5" /><rect x="49" y="5" width="2" height="4" rx="1" />
          </svg>
        </div>
        <img
          src={src}
          alt={alt}
          width={780}
          height={1688}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
          draggable={false}
          style={{ position: 'absolute', top: statusH, left: 0, width: screenW, height: imgH, maxWidth: 'none', display: 'block', userSelect: 'none' }}
        />
        {/* glass edge highlight */}
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0, borderRadius: radius - bezel, pointerEvents: 'none', zIndex: 3,
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
            background: 'linear-gradient(115deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 28%)',
          }}
        />
      </div>
    </motion.div>
  );
}
