import type * as THREE from 'three';

/**
 * Type surface for the procedural vault-door module (vaultDoorModel.js).
 *
 * The module itself is plain JS so it stays byte-identical to the version
 * authored and previewed in the browser — re-authoring it in TS would make
 * future design iterations a merge exercise. This declaration is the contract.
 */

export interface VaultDoorModel {
  group: THREE.Group;
  /** The seven locking-arm pivots, Arm_0 … Arm_6. */
  arms: THREE.Group[];
  /**
   * 0 = sealed, 1 = fully withdrawn. Pure function of t: no timers, no easing,
   * no internal state, so it can be scrubbed forwards and backwards freely.
   * Only the arms translate.
   */
  setUnlock(t: number): void;
  setLightIntensity(k: number): void;
  /** Wires up PMREM reflections. Must be called once with the live renderer. */
  buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture | null;
  /** Degrees the cam ring turns at t=1. Default 0 — the ring never moves. */
  setCamRingFollow(deg: number): void;
  /** 0 = shut, 1 = swung fully open on the hinge (115°). */
  setOpen(a: number): void;
  /** 0 = dark chamber, 1 = warm gold pool lit deep inside. */
  setChamberGlow(t: number): void;
  /** 0 = padlock shut, 1 = shackle sprung open. Pure in t, so it scrubs back. */
  setLockOpen(t: number): void;
  setTimer(p: number): void;
  dispose(): void;

  camRing: THREE.Object3D;
  lock: THREE.Object3D;
  hinge: THREE.Object3D;
  glass: THREE.Object3D;
  swing: THREE.Object3D;
  timer: THREE.Object3D;
  interior: THREE.Object3D;
  materials: Record<string, THREE.Material>;
}

export function createVaultDoor(three: typeof THREE): VaultDoorModel;
