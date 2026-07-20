import { GLView } from 'expo-gl';
import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import * as THREE from 'three';

import { createVaultDoor, type VaultDoorModel } from './three/vaultDoorModel';

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

  useEffect(
    () => () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      doorRef.current?.dispose();
      rendererRef.current?.dispose();
      doorRef.current = null;
      rendererRef.current = null;
    },
    [],
  );

  const onContextCreate = useCallback(
     
    (gl: any) => {
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;

      // Three.js expects a canvas. expo-gl hands us a bare context, so stand in
      // a shim — Three reads the dimensions and attaches listeners but never
      // touches style or the DOM. Same pattern as MagicRings; without it the
      // renderer throws on construction.
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

      const door = createVaultDoor(THREE);
      door.buildEnvironment(renderer);
      scene.add(door.group);
      door.setTimer(vestRef.current);

      rendererRef.current = renderer;
      sceneRef.current = scene;
      cameraRef.current = camera;
      glRef.current = gl;
      doorRef.current = door;

      wake(600);
    },
    [wake],
  );

  return <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />;
}
