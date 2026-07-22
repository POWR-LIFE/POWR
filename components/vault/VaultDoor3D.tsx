import { GLView } from 'expo-gl';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, InteractionManager, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import * as THREE from 'three';

import { createVaultDoor, type VaultDoorModel } from './three/vaultDoorModel';
import { ACCENT, ACCENT_SOFT } from './potTokens';

// ⚠ Warm-up covers tried and rejected before this one (all Jamie): a
// full-frame BAKED RENDER of the door (one oversized image on device), a
// disc + porthole ring + spinner ("two circles look horrible"), a bare disc
// saying LOADING (no sense of progress), a disc behind the progress ring
// plus an on-device SNAPSHOT of the door as a revisit cover ("that's not
// working" — don't re-propose covers that imitate the door). The brief that
// stands: OPEN → LOAD → SHOW. Loading is the gold progress ring with its
// counting percentage on the TRANSPARENT background — no disc, no image,
// nothing pretending to be the door — and the door fades in over it.

/**
 * Built ONCE per app session, reused across every mount. The door is fully
 * deterministic (seeded PRNG — it must look identical every launch), and
 * building it — geometry plus several procedurally-generated noise textures —
 * is the expensive half of this screen, all synchronous JS. Rebuilding it on
 * every visit made opening /vault "take ages" on device, every time. What
 * CANNOT be cached is anything bound to a GL context: the renderer and the
 * PMREM environment (a render-target texture dies with its context), so
 * buildEnvironment still runs per mount — that is the cheap part. The model's
 * DataTextures carry CPU-side arrays, so three re-uploads them into each new
 * context automatically. Corollary: the unmount cleanup must NOT dispose the
 * cached model.
 */
let sharedDoor: VaultDoorModel | null = null;

/**
 * The vault door as real 3D geometry.
 *
 * Replaces a raster render that could not be animated: the source image's
 * locking arms turned out to sit at irregular angles AND radii (measured in
 * polar space — left/right at r≈187–222 against r≈124–168 for the rest), so no
 * parametric slice could separate them cleanly. The model is procedural, so
 * the mechanism is exactly regular and every arm is a real object.
 *
 * ── Frame policy ────────────────────────────────────────────────────────────
 * Renders ON DEMAND, not in a permanent loop. A vault door is static most of
 * the time, and this scene is far heavier than the shader-quad in MagicRings.
 * `wake()` runs frames while something is actually moving — a hold in
 * progress, the unlock payoff, or the countdown ring ticking over — then idles
 * after a short settle. The hold subscribes via an Animated listener rather
 * than props so the gesture never re-renders React.
 */

/** Seconds of continued rendering after the last change, so easings finish. */
const SETTLE_MS = 900;
/** Countdown ring only needs a nudge occasionally; it moves over days. */
const TIMER_TICK_MS = 30000;

export interface VaultDoor3DProps {
  /** Hold charge 0..1 — drives arm retraction directly. */
  holdAnim: Animated.Value;
  /** Elapsed fraction of the soonest deposit's vest window. */
  vestProgress: number;
  /**
   * Hinge angle, 0 = shut, 1 = fully open. An Animated.Value rather than a
   * boolean because the payoff is a round trip (open, hold, reseal) whose
   * timing has to stay in step with the flash and the porthole fade — so the
   * caller owns the whole sequence and this component just follows.
   */
  swingAnim: Animated.Value;
  /** Rendering is paused unless the door is on screen. */
  active?: boolean;
  /** The door box's side in dp — sizes the progress ring. */
  size: number;
  /**
   * Fired once, when there is something to look at: the first successfully
   * DRAWN frame, or the fallback if GL fails. The parent holds the porthole
   * readout back until then, so its text never sits over the progress ring.
   */
  onFirstFrame?: () => void;
}

export function VaultDoor3D({ holdAnim, vestProgress, swingAnim, active = true, size, onFirstFrame }: VaultDoor3DProps) {
  // The whole 3D stack has only ever been verified on expo web; on a device
  // where expo-gl or the renderer throws, the screen must degrade to a static
  // door rather than crash — the porthole readout, the dial and the payout are
  // all RN overlays that work fine without the render.
  const [glFailed, setGlFailed] = useState(false);
  // The loading state fades out on the FIRST successfully drawn GL frame —
  // not on init: shader compilation happens inside the first render call,
  // and revealing the canvas before it would flash the blank we exist to hide.
  const firstFramePaintedRef = useRef(false);
  const staticFade = useRef(new Animated.Value(1)).current;
  // Ref, not the prop, inside drawFrame — the render loop must never
  // re-subscribe because a parent re-created its callback.
  const onFirstFrameRef = useRef(onFirstFrame);
  onFirstFrameRef.current = onFirstFrame;
  // Drives the progress percentage; flipped by drawFrame's first frame.
  const [glReady, setGlReady] = useState(false);
  const [pct, setPct] = useState(0);
  const doorRef = useRef<VaultDoorModel | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
   
  const glRef = useRef<any>(null);
  const frameRef = useRef<number | null>(null);
  const idleAtRef = useRef(0);

  // Latest values, read inside the render loop without re-subscribing.
  const holdRef = useRef(0);
  const openValRef = useRef(0);
  const vestRef = useRef(vestProgress);
  vestRef.current = vestProgress;

  const drawFrame = useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const gl = glRef.current;
    const door = doorRef.current;
    if (!renderer || !scene || !camera || !gl || !door) return;

    try {
      door.setUnlock(holdRef.current);
      door.setOpen(openValRef.current);
      // The padlock springs on the HOLD, not the swing — the bolts and the lock
      // are the same act, and it has to read as open before the leaf turns away
      // and takes it out of view. Scrubs back shut with the hold on release.
      door.setLockOpen(holdRef.current);
      // The chamber lights on the SWING: it should only be warm while there is
      // an open door to see it through.
      door.setChamberGlow(openValRef.current);
      renderer.render(scene, camera);
      // Required: tells expo-gl to present the rendered frame
      gl.endFrameEXP();

      // Live pixels exist: retire the loading state. JS driver on purpose —
      // see the useNativeDriver warning in VaultPotDoor; this one-shot fade
      // isn't worth an exception to the rule.
      if (!firstFramePaintedRef.current) {
        firstFramePaintedRef.current = true;
        setGlReady(true);
        Animated.timing(staticFade, { toValue: 0, duration: 350, useNativeDriver: false }).start();
        onFirstFrameRef.current?.();
      }
    } catch (err) {
      // A context lost mid-session (backgrounding, GPU reset) would otherwise
      // throw once per frame for as long as the loop runs.
      console.warn('[VaultDoor3D] frame render failed, falling back:', err);
      idleAtRef.current = 0;
      setGlFailed(true);
    }
  }, []);

  /** Render frames until `until`, then stop. Cheap to call repeatedly. */
  const wake = useCallback(
    (durationMs = SETTLE_MS) => {
      idleAtRef.current = Math.max(idleAtRef.current, Date.now() + durationMs);
      if (frameRef.current != null) return;
      const loop = () => {
        drawFrame();
        if (Date.now() >= idleAtRef.current) {
          frameRef.current = null;
          return;
        }
        frameRef.current = requestAnimationFrame(loop);
      };
      frameRef.current = requestAnimationFrame(loop);
    },
    [drawFrame],
  );

  // The gesture drives the mechanism without going through React state.
  useEffect(() => {
    const sub = holdAnim.addListener(({ value }) => {
      holdRef.current = value;
      wake(120);
    });
    return () => holdAnim.removeListener(sub);
  }, [holdAnim, wake]);

  useEffect(() => {
    const sub = swingAnim.addListener(({ value }) => {
      openValRef.current = value;
      wake(120);
    });
    return () => swingAnim.removeListener(sub);
  }, [swingAnim, wake]);

  // The countdown ring changes over days; poll it rarely rather than per frame.
  useEffect(() => {
    doorRef.current?.setTimer(vestProgress);
    wake(200);
    const id = setInterval(() => {
      doorRef.current?.setTimer(vestRef.current);
      wake(200);
    }, TIMER_TICK_MS);
    return () => clearInterval(id);
  }, [vestProgress, wake]);

  useEffect(() => {
    if (active) wake(300);
  }, [active, wake]);

  // A dead GL is as ready as this door will ever get: the parent's overlays
  // (readout, dial) are the working surface over the fallback, so they must
  // not stay held back waiting for a frame that will never draw.
  useEffect(() => {
    if (glFailed && !firstFramePaintedRef.current) {
      firstFramePaintedRef.current = true;
      onFirstFrameRef.current?.();
    }
  }, [glFailed]);

  // The percentage: the build is one opaque synchronous call, so progress is
  // a time model — quick out of the gate, easing toward 90, resolved to 100
  // by the first real frame.
  useEffect(() => {
    if (glFailed) return;
    if (glReady) {
      setPct(100);
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(() => {
      const t = Date.now() - startedAt;
      setPct(Math.min(90, Math.round(90 * (1 - Math.exp(-t / 900)))));
    }, 90);
    return () => clearInterval(id);
  }, [glFailed, glReady]);

  // Deferred-init bookkeeping: the build is scheduled behind the push
  // animation, so an unmount can arrive before it has run at all.
  const initTaskRef = useRef<{ cancel: () => void } | null>(null);
  const unmountedRef = useRef(false);

  useEffect(
    () => () => {
      unmountedRef.current = true;
      initTaskRef.current?.cancel();
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      // ⚠ The door model is NOT disposed — it is the shared per-session cache
      // (see sharedDoor). Only the per-context renderer goes.
      rendererRef.current?.dispose();
      doorRef.current = null;
      rendererRef.current = null;
    },
    [],
  );

  const onContextCreate = useCallback(

    (gl: any) => {
      // Present ONE TRANSPARENT FRAME immediately: until something has been
      // presented, the native GL surface composites as an opaque BLACK SQUARE
      // around the round loading cover (web canvases start transparent, so
      // the QA rig never showed it — device-only, and the deferred build
      // below stretches the window). Raw GL, no three needed, cosmetic only.
      try {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.endFrameEXP();
      } catch {
        // Nothing to do — the opacity gate on the canvas covers this too.
      }

      // Deferred behind the push animation: on first open the build below is
      // heavy synchronous JS, and running it during the transition froze the
      // navigation mid-slide on device. Later opens hit the cache and the
      // deferral is imperceptible.
      initTaskRef.current?.cancel();
      initTaskRef.current = InteractionManager.runAfterInteractions(() => {
        if (unmountedRef.current) return;
        // Hoisted above the try so the catch can dispose a renderer that was
        // constructed before a LATER init step threw (the Copilot autofix had
        // the right leak in mind but referenced a const scoped to the try).
        let renderer: THREE.WebGLRenderer | null = null;
        try {
          const width = gl.drawingBufferWidth;
          const height = gl.drawingBufferHeight;

          // Three.js expects a canvas. expo-gl hands us a bare context, so
          // stand in a shim — Three reads the dimensions and attaches
          // listeners but never touches style or the DOM. Same pattern as
          // MagicRings; without it the renderer throws on construction.
          const fakeCanvas = {
            width,
            height,
            style: {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
            clientWidth: width,
            clientHeight: height,
          };

          renderer = new THREE.WebGLRenderer({
            canvas: fakeCanvas as unknown as HTMLCanvasElement,
            context: gl,
            alpha: true,
          });
          // The GL drawing buffer is already at native device resolution.
          renderer.setPixelRatio(1);
          // false = don't attempt to set canvas.style.width/height
          renderer.setSize(width, height, false);
          renderer.setClearColor(0x000000, 0);
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          renderer.toneMapping = THREE.NeutralToneMapping;
          renderer.toneMappingExposure = 1.1;

          const scene = new THREE.Scene();
          // Long lens, straight down -Z: the door reads head-on, matching the
          // approved render rather than looking like a 3D viewport.
          const camera = new THREE.PerspectiveCamera(22, width / height, 0.1, 100);
          camera.position.set(0, 0, 7.3);
          camera.lookAt(0, 0, 0);

          // Session cache: only the very first open pays for the build. The
          // environment is per-context and rebuilt every time (cheap);
          // scene.add() re-parents the cached group out of the dead scene.
          const door = sharedDoor ?? createVaultDoor(THREE);
          sharedDoor = door;
          door.buildEnvironment(renderer);
          scene.add(door.group);
          door.setTimer(vestRef.current);

          rendererRef.current = renderer;
          sceneRef.current = scene;
          cameraRef.current = camera;
          glRef.current = gl;
          doorRef.current = door;

          wake(600);
        } catch (err) {
          renderer?.dispose();
          console.warn('[VaultDoor3D] GL init failed, using static fallback:', err);
          setGlFailed(true);
        }
      });
    },
    [wake],
  );

  // Ring geometry, off the box size: sits between the porthole (0.367Ø) and
  // the disc edge so it reads as part of the door's architecture.
  const ringR = size * 0.21;
  const ringStroke = 2.5;
  const ringBox = (ringR + ringStroke) * 2;
  const ringC = 2 * Math.PI * ringR;

  // The canvas is invisible until the door has painted — the exact inverse
  // of the cover's fade, so the two cross in the middle. Belt-and-braces
  // with the transparent clear in onContextCreate: between them, no state of
  // the native surface can ever show as a black square.
  const canvasReveal = useRef(
    staticFade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
  ).current;

  return (
    <View style={StyleSheet.absoluteFill}>
      {!glFailed && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: canvasReveal }]}>
          <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
        </Animated.View>
      )}
      {/* OPEN → LOAD → SHOW. Loading is the progress ring + counting
          percentage on the TRANSPARENT background — no disc, no image,
          nothing pretending to be the door. Faded out by drawFrame once
          live pixels exist; the parent holds the porthole readout back
          until onFirstFrame — see VaultPotDoor. The silhouette disc
          survives only as the GL-failure fallback, where the RN overlays
          need something to sit on. */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { opacity: glFailed ? 1 : staticFade }]}
      >
        {glFailed ? (
          <View style={styles.fallbackDisc} />
        ) : (
          <View style={styles.loadingCentre}>
            <View style={{ width: ringBox, height: ringBox }}>
              {/* Rotated so progress grows from 12 o'clock. */}
              <Svg
                width={ringBox}
                height={ringBox}
                style={{ transform: [{ rotate: '-90deg' }] }}
              >
                <Circle
                  cx={ringBox / 2} cy={ringBox / 2} r={ringR}
                  stroke="rgba(255,255,255,0.08)" strokeWidth={ringStroke} fill="none"
                />
                <Circle
                  cx={ringBox / 2} cy={ringBox / 2} r={ringR}
                  stroke={ACCENT} strokeWidth={ringStroke} fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${ringC}`}
                  strokeDashoffset={ringC * (1 - pct / 100)}
                />
              </Svg>
              <View style={styles.loadingCentre}>
                <Text style={[styles.loadingPct, { fontSize: size * 0.085 }]}>{pct}%</Text>
                <Text style={styles.loadingText}>LOADING</Text>
              </View>
            </View>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fallbackDisc: {
    position: 'absolute',
    left: '6%', right: '6%', top: '6%', bottom: '6%',
    borderRadius: 9999,
    backgroundColor: '#141a1f',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  loadingCentre: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The porthole figure voice for the count, the label voice underneath.
  loadingPct: {
    fontWeight: '200',
    letterSpacing: -0.5,
    color: ACCENT,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  loadingText: {
    fontSize: 9, fontWeight: '700', letterSpacing: 2.2,
    color: ACCENT_SOFT, opacity: 0.75, marginTop: 3,
  },
});
