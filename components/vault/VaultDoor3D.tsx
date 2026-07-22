import { GLView } from 'expo-gl';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, InteractionManager, StyleSheet, View } from 'react-native';
import * as THREE from 'three';

import { createVaultDoor, type VaultDoorModel } from './three/vaultDoorModel';
import { ACCENT } from './potTokens';

// ⚠ A full-frame BAKED RENDER of the door was tried as the warm-up cover and
// rejected: pixel-perfect on web, it rendered as one oversized image on
// device (Jamie). The loading treatment below — disc silhouette, porthole
// ring, small gold spinner — is deliberately geometry-only: nothing about it
// can scale wrong, and it says "loading" honestly instead of pretending the
// door is already there. Don't re-propose the baked cover.

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
}

export function VaultDoor3D({ holdAnim, vestProgress, swingAnim, active = true }: VaultDoor3DProps) {
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
        Animated.timing(staticFade, { toValue: 0, duration: 350, useNativeDriver: false }).start();
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
      // Deferred behind the push animation: on first open the build below is
      // heavy synchronous JS, and running it during the transition froze the
      // navigation mid-slide on device. Later opens hit the cache and the
      // deferral is imperceptible.
      initTaskRef.current = InteractionManager.runAfterInteractions(() => {
        if (unmountedRef.current) return;
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

          const renderer = new THREE.WebGLRenderer({
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
          console.warn('[VaultDoor3D] GL init failed, using static fallback:', err);
          setGlFailed(true);
        }
      });
    },
    [wake],
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      {!glFailed && <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />}
      {/* The LOADING VAULT sits above the canvas: a dark disc + porthole ring
          sized by the same fractions the scene projects to (disc r≈0.44,
          glass 0.367 — see VaultPotDoor/VaultRecess) with a small gold
          spinner, opaque from the first frame so there is never a blank
          square while the model builds and shaders compile. drawFrame fades
          it out once live pixels exist; it stays for good (minus the
          spinner) if GL fails. Every functional element — readout, dial,
          flash — is an RN overlay painted above this by the parent. */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { opacity: glFailed ? 1 : staticFade }]}
      >
        <View style={styles.loadingDisc} />
        <View style={styles.loadingPorthole} />
        {!glFailed && (
          <View style={styles.loadingSpinner}>
            <ActivityIndicator size="small" color={ACCENT} />
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingDisc: {
    position: 'absolute',
    left: '6%', right: '6%', top: '6%', bottom: '6%',
    borderRadius: 9999,
    backgroundColor: '#141a1f',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  loadingPorthole: {
    position: 'absolute',
    left: '31.65%', top: '31.65%', width: '36.7%', height: '36.7%',
    borderRadius: 9999,
    backgroundColor: '#0a0d10',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.25)',
  },
  // Under the porthole glass, low in it — the readout takes the centre the
  // moment data lands, and the two must not sit on top of each other.
  loadingSpinner: {
    position: 'absolute',
    left: 0, right: 0, top: '58%',
    alignItems: 'center',
  },
});
