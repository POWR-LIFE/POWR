import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient as SvgGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { VaultDoor } from './VaultDoor';

const GOLD  = '#E8D200';
const TEXT  = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.25)';
const DIM   = 'rgba(255,255,255,0.5)';

/**
 * The Vault hero centrepiece contract. Each design is a full composition —
 * its own geometry and its own motion — not an icon swap. The hero owns the
 * hold gesture, claim flow, and the text block below; designs with
 * `ownCountdown` render the countdown inside themselves and the hero
 * suppresses its big countdown line.
 */
export interface VaultCenterpieceProps {
  hasPending: boolean;
  /** Elapsed vest fraction (0..1) of the soonest pending deposit. */
  progress: number;
  ready: boolean;
  unlocked: boolean;
  /** Hold charge, quantised 0..60. */
  holdTicks: number;
  /** Hold charge as the live animated value (JS driver). */
  holdAnim: Animated.Value;
  countdown: string | null;
  nextVestAt: string | null;
  dueTotal: number;
  totalPending: number;
}

/** Slow continuous rotation for kinetic designs. Native driver, loops forever. */
function useLoopRotation(durationMs: number, reverse = false) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, { toValue: 1, duration: durationMs, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, durationMs]);
  return anim.interpolate({ inputRange: [0, 1], outputRange: reverse ? ['360deg', '0deg'] : ['0deg', '360deg'] });
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIC — the shipped door: 60-tick dial + spoke-wheel vault door.
// ─────────────────────────────────────────────────────────────────────────────

const RING_SIZE = 240;
const RING_RADIUS = 112;
const TICK_COUNT = 60;
const TICK_LEN = 8;
const DOOR_SIZE = 164;

const TICKS = Array.from({ length: TICK_COUNT }, (_, i) => {
  const a = ((i / TICK_COUNT) * 360 - 90) * (Math.PI / 180);
  const inner = RING_RADIUS - TICK_LEN / 2;
  const outer = RING_RADIUS + TICK_LEN / 2;
  return {
    x1: RING_SIZE / 2 + inner * Math.cos(a),
    y1: RING_SIZE / 2 + inner * Math.sin(a),
    x2: RING_SIZE / 2 + outer * Math.cos(a),
    y2: RING_SIZE / 2 + outer * Math.sin(a),
  };
});

function ClassicCenterpiece(p: VaultCenterpieceProps) {
  const sweep = Math.floor(Date.now() / 1000) % TICK_COUNT;
  const doorSpin = p.holdAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '270deg'] });
  const doorScale = p.holdAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  return (
    <View style={styles.classicWrap}>
      <Svg width={RING_SIZE} height={RING_SIZE} style={StyleSheet.absoluteFill}>
        {TICKS.map((t, i) => {
          let stroke = 'rgba(255,255,255,0.10)';
          let width = 2;
          if (p.unlocked) {
            stroke = GOLD;
          } else if (p.ready) {
            if (i < p.holdTicks) { stroke = GOLD; width = 3; }
            else stroke = 'rgba(232,210,0,0.28)';
          } else if (p.hasPending) {
            if (i === sweep) { stroke = GOLD; width = 3; }
            else if (i / TICK_COUNT <= p.progress) stroke = 'rgba(232,210,0,0.5)';
          }
          return (
            <Line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
              stroke={stroke} strokeWidth={width} strokeLinecap="round" />
          );
        })}
      </Svg>
      <Animated.View style={{ transform: [{ rotate: doorSpin }, { scale: doorScale }] }}>
        <VaultDoor size={DOOR_SIZE} />
      </Animated.View>
    </View>
  );
}

function ClassicPreview() {
  return <VaultDoor size={40} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEALS — no door: three segmented locking rings rotating at different
// speeds/directions like a live mechanism, countdown at the core. Holding
// winds the whole mechanism.
// ─────────────────────────────────────────────────────────────────────────────

const SEAL_RINGS = [
  { r: 112, n: 24, dur: 90000, reverse: false, op: 0.5 },
  { r: 95,  n: 18, dur: 60000, reverse: true,  op: 0.38 },
  { r: 79,  n: 12, dur: 45000, reverse: false, op: 0.28 },
];

function sealDash(r: number, n: number): string {
  const per = (2 * Math.PI * r) / n;
  return `${per * 0.55} ${per * 0.45}`;
}

function SealRing({ r, n, dur, reverse, opacity }: { r: number; n: number; dur: number; reverse: boolean; opacity: number }) {
  const rotate = useLoopRotation(dur, reverse);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
      <Svg width={RING_SIZE} height={RING_SIZE}>
        <Circle
          cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={r}
          stroke={GOLD} strokeOpacity={opacity} strokeWidth={2.5}
          strokeDasharray={sealDash(r, n)} fill="none"
        />
      </Svg>
    </Animated.View>
  );
}

function SealsCenterpiece(p: VaultCenterpieceProps) {
  // Holding winds the mechanism a further quarter-turn.
  const wind = p.holdAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });
  const arcC = 2 * Math.PI * 117;
  const lit = p.unlocked ? 1 : p.ready ? p.holdTicks / 60 : p.progress;

  return (
    <View style={styles.classicWrap}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: wind }] }]}>
        {SEAL_RINGS.map((ring) => (
          <SealRing key={ring.r} r={ring.r} n={ring.n} dur={ring.dur} reverse={ring.reverse}
            opacity={p.unlocked ? 0.85 : ring.op} />
        ))}
      </Animated.View>
      {/* Static outer arc: vested fraction (or hold charge when ready). */}
      <Svg width={RING_SIZE} height={RING_SIZE} style={StyleSheet.absoluteFill}>
        <Circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={117}
          stroke="rgba(255,255,255,0.08)" strokeWidth={2} fill="none" />
        {p.hasPending && (
          <Circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={117}
            stroke={GOLD} strokeWidth={2} fill="none" strokeLinecap="round"
            strokeDasharray={`${arcC * lit} ${arcC}`}
            transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`} />
        )}
      </Svg>
      <View style={styles.sealsCore}>
        {p.unlocked ? (
          <Ionicons name="lock-open" size={26} color={GOLD} />
        ) : p.ready ? (
          <>
            <Text style={styles.sealsBig}>{p.dueTotal.toLocaleString()}</Text>
            <Text style={styles.sealsMicro}>POWR READY</Text>
          </>
        ) : p.hasPending ? (
          <>
            {p.countdown && <Text style={styles.sealsCountdown}>{p.countdown}</Text>}
            <Text style={styles.sealsMicro}>UNTIL UNLOCK</Text>
          </>
        ) : (
          <Ionicons name="lock-closed" size={22} color={MUTED} />
        )}
      </View>
    </View>
  );
}

function SealsPreview() {
  return (
    <Svg width={40} height={40} viewBox="0 0 100 100">
      {[46, 36, 26].map((r, i) => (
        <Circle key={r} cx={50} cy={50} r={r} stroke={GOLD} strokeOpacity={0.65 - i * 0.15}
          strokeWidth={4} fill="none" strokeDasharray={sealDash(r, 12)} />
      ))}
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BULLION — no circle: a hallmarked stack of gold bars with a slow light
// sheen. The vault as a private reserve; holding lifts the stack.
// ─────────────────────────────────────────────────────────────────────────────

const BAR_W = 110;
const BAR_H = 30;

function BullionBar({ x, y, dim, engraving }: { x: number; y: number; dim?: boolean; engraving?: string }) {
  return (
    <>
      <Rect x={x} y={y} width={BAR_W} height={BAR_H} rx={7}
        stroke={dim ? 'rgba(255,255,255,0.18)' : 'rgba(232,210,0,0.65)'} strokeWidth={1.5}
        fill={dim ? 'rgba(255,255,255,0.02)' : 'url(#ingot)'} />
      {/* Stamped recess */}
      {!dim && (
        <Rect x={x + 9} y={y + 6} width={BAR_W - 18} height={BAR_H - 12} rx={4}
          stroke="rgba(232,210,0,0.30)" strokeWidth={1} fill="rgba(0,0,0,0.28)" />
      )}
      {engraving ? (
        <SvgText x={x + BAR_W / 2} y={y + BAR_H / 2 + 3.5} textAnchor="middle"
          fontSize={9.5} letterSpacing={2.5} fontWeight="600" fill={GOLD} fillOpacity={0.95}>
          {engraving}
        </SvgText>
      ) : null}
    </>
  );
}

function BullionCenterpiece(p: VaultCenterpieceProps) {
  const sheenX = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sheenX, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.delay(3600),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sheenX]);

  const translateX = sheenX.interpolate({ inputRange: [0, 1], outputRange: [-90, 320] });
  const lift = p.holdAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });
  const glow = p.holdAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.14] });
  const engraving = `POWR · ${(p.ready ? p.dueTotal : p.totalPending).toLocaleString()}`;

  return (
    <View style={styles.bullionWrap}>
      <Animated.View style={{ transform: [{ translateY: lift }] }}>
        <Svg width={240} height={140}>
          <Defs>
            {/* Metallic banding: bright shoulder → deep middle → warm base. */}
            <SvgGradient id="ingot" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={GOLD} stopOpacity={0.34} />
              <Stop offset="0.45" stopColor={GOLD} stopOpacity={0.12} />
              <Stop offset="1" stopColor={GOLD} stopOpacity={0.24} />
            </SvgGradient>
          </Defs>
          {!p.hasPending && !p.unlocked ? (
            <BullionBar x={65} y={100} dim />
          ) : (
            <>
              <BullionBar x={8} y={100} />
              <BullionBar x={122} y={100} />
              <BullionBar x={65} y={66} engraving={engraving} />
            </>
          )}
        </Svg>
        {/* Sheen: a slow light pass every few seconds. */}
        <View style={styles.sheenClip} pointerEvents="none">
          <Animated.View style={[styles.sheenStrip, { transform: [{ translateX }, { rotate: '18deg' }] }]}>
            <LinearGradient
              colors={['rgba(232,210,0,0)', 'rgba(255,255,255,0.10)', 'rgba(232,210,0,0)']}
              start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>
        <Animated.View pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: GOLD, opacity: glow, borderRadius: 12 }]} />
      </Animated.View>
      {/* Vest progress under the stack */}
      {p.hasPending && (
        <View style={styles.bullionTrack}>
          <View style={[styles.bullionFill, { width: `${Math.round((p.unlocked ? 1 : p.ready ? p.holdTicks / 60 : p.progress) * 100)}%` }]} />
        </View>
      )}
    </View>
  );
}

function BullionPreview() {
  return (
    <Svg width={40} height={40} viewBox="0 0 100 100">
      <Rect x={10} y={58} width={36} height={16} rx={4} stroke={GOLD} strokeOpacity={0.6} strokeWidth={3} fill="rgba(232,210,0,0.12)" />
      <Rect x={54} y={58} width={36} height={16} rx={4} stroke={GOLD} strokeOpacity={0.6} strokeWidth={3} fill="rgba(232,210,0,0.12)" />
      <Rect x={32} y={36} width={36} height={16} rx={4} stroke={GOLD} strokeOpacity={0.8} strokeWidth={3} fill="rgba(232,210,0,0.16)" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TIMELOCK — typography as the monument: a hairline instrument panel with
// DD·HH·MM·SS unit blocks (bank vaults literally run clockwork time-locks),
// a once-per-second heartbeat, vest progress up the panel edge.
// ─────────────────────────────────────────────────────────────────────────────

function timelockParts(nextVestAt: string | null): { dd: string; hh: string; mm: string; ss: string } {
  const remaining = nextVestAt ? Math.max(0, Math.floor((new Date(nextVestAt).getTime() - Date.now()) / 1000)) : 0;
  return {
    dd: String(Math.floor(remaining / 86400)).padStart(2, '0'),
    hh: String(Math.floor((remaining % 86400) / 3600)).padStart(2, '0'),
    mm: String(Math.floor((remaining % 3600) / 60)).padStart(2, '0'),
    ss: String(remaining % 60).padStart(2, '0'),
  };
}

function TimelockCenterpiece(p: VaultCenterpieceProps) {
  const beat = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(beat, { toValue: 0.25, duration: 500, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(beat, { toValue: 1, duration: 500, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [beat]);

  const glow = p.holdAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.09] });
  const parts = timelockParts(p.nextVestAt);
  const units: { value: string; label: string }[] = [
    { value: parts.dd, label: 'DAYS' },
    { value: parts.hh, label: 'HRS' },
    { value: parts.mm, label: 'MIN' },
    { value: parts.ss, label: 'SEC' },
  ];
  const charge = p.unlocked ? 1 : p.ready ? p.holdTicks / 60 : 0;

  return (
    <View style={[styles.tlPanel, (p.ready || p.unlocked) && styles.tlPanelReady]}>
      <Animated.View pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: GOLD, opacity: glow, borderRadius: 18 }]} />
      <View style={styles.tlHeader}>
        <Text style={styles.tlTitle}>TIME LOCK</Text>
        <Animated.View style={[styles.tlDot, { opacity: p.unlocked ? 1 : beat, backgroundColor: p.ready || p.unlocked ? GOLD : 'rgba(232,210,0,0.55)' }]} />
      </View>

      {p.unlocked ? (
        <Text style={styles.tlOpen}>OPEN</Text>
      ) : p.ready ? (
        <>
          <Text style={styles.tlOpen}>{p.dueTotal.toLocaleString()}</Text>
          <Text style={styles.tlReadyLabel}>POWR READY</Text>
        </>
      ) : p.hasPending ? (
        <View style={styles.tlUnits}>
          {units.map((u, i) => (
            <React.Fragment key={u.label}>
              {i > 0 && <View style={styles.tlSep} />}
              <View style={styles.tlUnit}>
                <Text style={styles.tlValue}>{u.value}</Text>
                <Text style={styles.tlLabel}>{u.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      ) : (
        <>
          <Ionicons name="lock-closed" size={22} color={MUTED} style={{ alignSelf: 'center' }} />
          <Text style={styles.tlReadyLabel}>NO ACTIVE LOCK</Text>
        </>
      )}

      {/* Vest progress up the panel edge; becomes the hold charge when ready. */}
      <View style={styles.tlEdgeTrack}>
        <View style={[styles.tlEdgeFill, {
          height: `${Math.round((p.hasPending || p.unlocked ? (charge > 0 ? charge : p.progress) : 0) * 100)}%`,
        }]} />
      </View>
    </View>
  );
}

function TimelockPreview() {
  return (
    <View style={styles.tlPreview}>
      <Text style={styles.tlPreviewText}>00:00</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

export const VAULT_HERO_DESIGNS = [
  { id: 'classic', label: 'CLASSIC', ownCountdown: false, Centerpiece: ClassicCenterpiece, Preview: ClassicPreview },
  { id: 'seals', label: 'SEALS', ownCountdown: true, Centerpiece: SealsCenterpiece, Preview: SealsPreview },
  { id: 'bullion', label: 'BULLION', ownCountdown: false, Centerpiece: BullionCenterpiece, Preview: BullionPreview },
  { id: 'timelock', label: 'TIMELOCK', ownCountdown: true, Centerpiece: TimelockCenterpiece, Preview: TimelockPreview },
] as const;

export type VaultHeroDesign = (typeof VAULT_HERO_DESIGNS)[number];
export type VaultHeroDesignId = VaultHeroDesign['id'];

// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  classicWrap: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },

  sealsCore: { alignItems: 'center', gap: 4, maxWidth: 150 },
  sealsCountdown: { fontSize: 19, fontWeight: '200', letterSpacing: 1.5, color: GOLD, fontVariant: ['tabular-nums'] },
  sealsBig: { fontSize: 34, fontWeight: '200', letterSpacing: 2, color: GOLD },
  sealsMicro: { fontSize: 8, fontWeight: '600', letterSpacing: 2, color: MUTED },

  bullionWrap: { width: 240, alignItems: 'center', paddingVertical: 24, marginBottom: 12 },
  sheenClip: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  sheenStrip: { position: 'absolute', top: -30, left: 0, width: 52, height: 210 },
  bullionTrack: {
    width: 160, height: 2, borderRadius: 1, marginTop: 16,
    backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden',
  },
  bullionFill: { height: 2, borderRadius: 1, backgroundColor: GOLD },

  tlPanel: {
    width: 262, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(20,20,20,0.7)', paddingVertical: 24, paddingHorizontal: 22, gap: 16,
    marginBottom: 20,
  },
  tlPanelReady: { borderColor: 'rgba(232,210,0,0.45)' },
  tlHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  tlTitle: { fontSize: 9, fontWeight: '700', letterSpacing: 3, color: MUTED },
  tlDot: { width: 5, height: 5, borderRadius: 3 },
  tlUnits: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  tlUnit: { alignItems: 'center', gap: 3, minWidth: 44 },
  tlValue: { fontSize: 30, fontWeight: '200', letterSpacing: 1, color: GOLD, fontVariant: ['tabular-nums'] },
  tlLabel: { fontSize: 7, fontWeight: '600', letterSpacing: 2, color: MUTED },
  tlSep: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.08)', marginHorizontal: 8 },
  tlOpen: { fontSize: 34, fontWeight: '200', letterSpacing: 3, color: GOLD, textAlign: 'center' },
  tlReadyLabel: { fontSize: 8, fontWeight: '600', letterSpacing: 2, color: DIM, textAlign: 'center' },
  tlEdgeTrack: {
    position: 'absolute', left: 8, top: 20, bottom: 20, width: 2, borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', justifyContent: 'flex-end',
  },
  tlEdgeFill: { width: 2, borderRadius: 1, backgroundColor: GOLD },

  tlPreview: {
    width: 40, height: 30, borderRadius: 7, borderWidth: 1, borderColor: 'rgba(232,210,0,0.5)',
    alignItems: 'center', justifyContent: 'center', marginVertical: 5,
  },
  tlPreviewText: { fontSize: 9, fontWeight: '300', letterSpacing: 1, color: GOLD, fontVariant: ['tabular-nums'] },
});
