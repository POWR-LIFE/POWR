/* eslint-disable no-unused-vars */
// VENDORED — procedural 3D vault door, authored and visually approved in a
// browser preview harness, then dropped in unmodified. Keep it byte-identical
// to the upstream file apart from this header so design iterations stay a
// straight copy rather than a merge. Its contract lives in vaultDoorModel.d.ts.
//
// RN-safe by construction: every texture is a DataTexture built from typed
// arrays, so there is no canvas, DOM or asset loading anywhere in it.
//
// ⚠ LOCAL TUNING ON TOP OF UPSTREAM: makeEnvSource() and makeSurfaceMaps()
// have been reworked here for the metallic pass (dark-gunmetal studio env +
// anisotropic turning marks, normalScale 0.08 -> 0.22). If a newer upstream
// module is pasted in, RE-APPLY those two functions or the door goes back to
// reading like flat dark plastic.
//
// ⚠ GRIT PASS (2026-07-21): the remaining gap to the reference render was
// DEPTH, not material — the plates were only 2–9% relief on the door radius,
// so nothing cast a shadow and every crevice was as bright as the face.
// Three coordinated changes close it, and they depend on each other:
//   1. GEOMETRY — ring plates are taller, the channel under them is deeper,
//      the guide brackets arch higher and the bolts ride prouder (ARM_Z).
//   2. SHADOW MAP — the key light casts real shadows (enabled in
//      buildEnvironment, the one place handed a renderer). The taller
//      geometry is what gives it something to draw.
//   3. BAKED AO — aoRing() contact-shadow annuli hugging every wall/step
//      junction, because a shadow map only darkens the sun side and AO is
//      what makes crevices read dirty-dark from every angle.
// Roll back any one of these alone and the door regresses to "flat disc".
/**
 * createVaultDoor(THREE)
 * ------------------------------------------------------------------
 * Self-contained, procedural bank-vault door for three.js (r0.18x).
 * No external assets: geometry, materials and the environment map are
 * all generated in code.
 *
 * Returned API:
 *   group              THREE.Group ('VaultDoor')
 *   arms               [Arm_0 .. Arm_6]  (THREE.Group pivots)
 *   setUnlock(t)       pure fn of t in 0..1  (0 sealed, 1 unlocked).
 *                      ONLY the arms translate. No timers/easing/state.
 *   setLightIntensity(k)
 *   buildEnvironment(renderer)   <-- CALL ONCE with your WebGLRenderer.
 *                      PMREM needs a renderer, which this factory is not
 *                      given, so reflections are wired up here. In Expo:
 *                      door.buildEnvironment(renderer) after gl init.
 *   setCamRingFollow(deg)        optional hook: makes setUnlock rotate the
 *                      cam ring by up to `deg` at t=1. Default 0 (off) ->
 *                      the ring never moves. Nothing but the arms moves.
 *   dispose()
 *
 * Named parts: 'DoorBody', 'CamRing', 'LockModule', 'Hinge', 'Glass'.
 */
export function createVaultDoor(THREE) {
  const geoms = new Set(), mats = new Set(), texs = new Set();
  const G = g => (geoms.add(g), g);
  const M = m => (mats.add(m), m);
  const T = t => (texs.add(t), t);
  const TAU = Math.PI * 2;

  // ---- POWR gold accent ---------------------------------------------------
  const GOLD = 0xe8d200;

  // ---- materials -----------------------------------------------------
  const baseEnvI = {
    dark: 0.9, plate: 1.35, bright: 1.7, rivet: 1.35,
    housing: 1.0, well: 0.45, hex: 0.4, glass: 1.7, outer: 1.1
  };
  /**
   * BRUSHED STEEL — the large plates get real anisotropic specular, not just a
   * scratchy normal map.
   *
   * A normal map alone reads as "scratched": it breaks the reflection up but
   * every highlight stays round. What makes metal look BRUSHED is the highlight
   * stretching perpendicular to the grain, and that is a BRDF property, so it
   * needs MeshPhysicalMaterial's `anisotropy` (three r0.157+; we're on 0.183).
   *
   * `anisotropyRotation: 0` = grain along the tangent = along u. Every plate
   * here is lathe or cylinder geometry whose u runs CIRCUMFERENTIALLY, so this
   * gives a turned finish — concentric brushing, correct for a round door —
   * without touching a single UV. If a flat panel is ever added it will need
   * its own rotation.
   *
   * Only the big surfaces pay for the heavier shader; rivets and bolt caps stay
   * MeshStandard, since anisotropy is invisible at that size.
   */
  const brushed = (params) => M(new THREE.MeshPhysicalMaterial({
    anisotropy: 0.75,
    anisotropyRotation: 0,
    ...params,
  }));
  const steelDark = brushed({ name: 'SteelDark', color: 0x2b2d30, metalness: 0.58, roughness: 0.56, envMapIntensity: baseEnvI.dark, side: THREE.DoubleSide });
  const steelPlate = brushed({ name: 'SteelPlate', color: 0x3f4246, metalness: 0.62, roughness: 0.44, envMapIntensity: baseEnvI.plate, side: THREE.DoubleSide });
  // GRIT: the outer band is CAST housing, darker and rougher than the machined
  // mid band — the reference separates its rings tonally, and one shared plate
  // material made the whole face a single flat grey.
  const steelOuter = brushed({ name: 'SteelOuter', color: 0x33363a, metalness: 0.64, roughness: 0.54, envMapIntensity: baseEnvI.outer, side: THREE.DoubleSide });
  const steelBright = brushed({ name: 'SteelBright', color: 0x35373a, metalness: 0.93, roughness: 0.29, envMapIntensity: baseEnvI.bright, anisotropy: 0.6 });
  const steelRivet = M(new THREE.MeshStandardMaterial({ name: 'SteelRivet', color: 0x44474b, metalness: 0.93, roughness: 0.35, envMapIntensity: baseEnvI.rivet }));
  const housingMat = brushed({ name: 'Housing', color: 0x323539, metalness: 0.68, roughness: 0.5, envMapIntensity: baseEnvI.housing });
  const wellMat = M(new THREE.MeshStandardMaterial({ name: 'Well', color: 0x0f0e0a, metalness: 0.45, roughness: 0.9, envMapIntensity: baseEnvI.well, side: THREE.DoubleSide }));
  const hexMat = M(new THREE.MeshStandardMaterial({ name: 'HexWell', color: 0x0d0b06, metalness: 0.3, roughness: 0.82, emissive: 0x6c5a10, emissiveIntensity: 0.85, envMapIntensity: baseEnvI.hex }));
  const glassMat = M(new THREE.MeshPhysicalMaterial({ name: 'Glass', color: 0x131109, metalness: 0.0, roughness: 0.08, transparent: true, opacity: 0.14, clearcoat: 1.0, clearcoatRoughness: 0.08, ior: 1.45, reflectivity: 0.5, envMapIntensity: 1.1, depthWrite: false }));
  const goldMat = M(new THREE.MeshStandardMaterial({ name: 'Gold', color: 0x1f1a04, metalness: 0.0, roughness: 0.6, emissive: GOLD, emissiveIntensity: 1.0 }));
  const goldCore = M(new THREE.MeshStandardMaterial({ name: 'GoldCore', color: 0x2b2405, metalness: 0.0, roughness: 0.55, emissive: GOLD, emissiveIntensity: 1.1 }));
  const goldRecessMat = M(new THREE.MeshStandardMaterial({ name: 'LockRecessGlow', color: 0x1c1804, metalness: 0.2, roughness: 0.7, emissive: GOLD, emissiveIntensity: 0.05 }));
  // timer ticks: per-instance color scales the gold emissive (patched below)
  const timerMat = M(new THREE.MeshStandardMaterial({ name: 'Timer', color: 0x1a1703, metalness: 0.35, roughness: 0.5, emissive: GOLD, emissiveIntensity: 1.4 }));
  timerMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor.rgb;'
    );
  };
  const shadowMat = M(new THREE.MeshBasicMaterial({ name: 'Contact', color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }));
  const glowTex = makeGlowTex();
  const glowMat = M(new THREE.MeshBasicMaterial({ name: 'LockGlow', map: glowTex, color: GOLD, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  const streakTex = makeStreakTex();
  const streakMat = M(new THREE.MeshBasicMaterial({ name: 'LockStreak', map: streakTex, color: GOLD, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));

  const metalMats = [steelDark, steelPlate, steelBright, steelRivet, housingMat, wellMat, hexMat, steelOuter];

  // ---- procedural textures (DataTexture; RN/expo-gl safe) ------------
  const hexTex = makeHexTex();
  hexMat.emissiveMap = hexTex;
  const shadowTex = makeShadowTex();
  shadowMat.map = shadowTex;
  const envSource = makeEnvSource();

  // Micro-surface detail so reflections break up like brushed steel. The normal
  // map is intentionally the WEAKER half of the effect — push normalScale much
  // past this and the grain stops reading as a drawn finish and starts reading
  // as damage. Roughness variation plus the material's anisotropy do the work.
  const surf = makeSurfaceMaps();
  for (const m of [steelDark, steelPlate, steelRivet, housingMat, steelBright, steelOuter]) {
    m.roughnessMap = surf.rough; m.normalMap = surf.normal; m.map = surf.albedo;
    // 0.55 for the grit pass — past ~0.42 the grain starts reading as damage,
    // which is exactly what "worn industrial" wants a hint of. If it ever
    // reads as corrosion on device, this is the first dial to bring back.
    m.normalScale = new THREE.Vector2(0.55, 0.55); m.needsUpdate = true;
  }

  // ---- root ----------------------------------------------------------
  const group = new THREE.Group();
  group.name = 'VaultDoor';
  const HINGE_X = 1.02;
  const swing = new THREE.Group(); swing.name = 'Swing'; swing.position.set(HINGE_X, 0, 0); group.add(swing);
  const leaf = new THREE.Group(); leaf.name = 'DoorLeaf'; leaf.position.set(-HINGE_X, 0, 0); swing.add(leaf);

  // small helper
  const mesh = (g, m, name) => { const o = new THREE.Mesh(G(g), m); if (name) o.name = name; return o; };
  const disc = (r, thick, zc, m, seg = 72, name) => {
    const g = new THREE.CylinderGeometry(r, r, thick, seg);
    g.rotateX(Math.PI / 2);
    const o = new THREE.Mesh(G(g), m); o.position.z = zc; if (name) o.name = name; return o;
  };
  const circle = (r, z, m, seg = 72, name) => {
    const g = new THREE.CircleGeometry(r, seg);
    const o = new THREE.Mesh(G(g), m); o.position.z = z; if (name) o.name = name; return o;
  };
  // lathe ring: solid annular shell, top face toward +Z
  const ring = (innerR, outerR, zLow, zHigh, bev, m, name, seg = 72) => {
    const p = [
      new THREE.Vector2(innerR, zLow + bev),
      new THREE.Vector2(innerR, zHigh - bev),
      new THREE.Vector2(innerR + bev, zHigh),
      new THREE.Vector2(outerR - bev, zHigh),
      new THREE.Vector2(outerR, zHigh - bev),
      new THREE.Vector2(outerR, zLow + bev),
      new THREE.Vector2(outerR - bev, zLow),
      new THREE.Vector2(innerR + bev, zLow),
      new THREE.Vector2(innerR, zLow + bev)
    ];
    const g = new THREE.LatheGeometry(p, seg);
    g.rotateX(Math.PI / 2);
    const o = new THREE.Mesh(G(g), m); if (name) o.name = name; return o;
  };

  // ================================================================
  //  BODY  +  CONCENTRIC RING PLATES
  // ================================================================
  const body = ring(0.50, 0.965, -0.10, 0.0, 0.02, steelDark, 'DoorBody', 96);
  leaf.add(body);

  // back closing plate behind the well (so the porthole isn't see-through)
  leaf.add(disc(0.9, 0.02, -0.108, steelDark, 64));

  // recessed dark channel the segmented plates sit over (so seams read as gaps)
  // GRIT: deeper floor — the visible strips either side of the mid band are
  // now a real trench that the plate walls shadow into.
  leaf.add(ring(0.58, 0.885, -0.055, -0.008, 0.01, steelDark, 'Channel', 96));

  // SEGMENTED boltwork band — 8 arc plates, seams fall at the arm/lock slots
  // GRIT: plates ~2x taller and seams a shade wider so each segment reads as a
  // separate slab of steel with a dark gap round it, not an engraved line.
  leaf.add(arcRing(0.605, 0.85, 8, 5.2, -0.01, 0.038, 0.016, steelPlate, 'MidBand', Math.PI / 8));

  // SEGMENTED outer ring — 16 arc plates with bolts, over a continuous edge rim
  leaf.add(arcRing(0.86, 0.95, 16, 4.4, 0.0, 0.082, 0.018, steelOuter, 'OuterSeg', Math.PI / 16));
  leaf.add(ring(0.945, 0.995, 0.0, 0.058, 0.016, steelDark, 'OuterEdge', 96));

  // engraved seam groove between the bands — thicker, so it survives the
  // taller plates either side of it
  leaf.add((() => { const g = G(new THREE.TorusGeometry(0.855, 0.007, 6, 96)); const o = new THREE.Mesh(g, steelDark); o.position.z = 0.02; return o; })());

  // ================================================================
  //  CAM RING (bezel around the porthole)  — named, movable via hook
  // ================================================================
  const camRing = new THREE.Group();
  camRing.name = 'CamRing';
  // GRIT: taller bezel — the porthole now sits at the bottom of a real well
  // and the bezel wall throws a shadow onto the mid band beside it.
  camRing.add(ring(0.50, 0.62, 0.0, 0.112, 0.016, steelOuter, 'CamRingPlate', 96));
  // cam-ring inner shoulder + a rim of small notches for a machined feel
  camRing.add(ring(0.50, 0.535, 0.0, 0.062, 0.012, steelDark, 'CamRingInner', 96));
  leaf.add(camRing);

  // ================================================================
  //  PORTHOLE  (empty glass + dark hex well)  — LEAVE EMPTY
  // ================================================================
  // well wall
  const wellWall = new THREE.CylinderGeometry(0.52, 0.52, 0.115, 72, 1, true);
  wellWall.rotateX(Math.PI / 2);
  const wellWallMesh = new THREE.Mesh(G(wellWall), wellMat);
  wellWallMesh.position.z = -0.035;
  leaf.add(wellWallMesh);
  // plain dark well floor (empty — level artwork / timer composited at runtime)
  leaf.add(circle(0.515, -0.055, wellMat, 72, 'WellFloor'));
  // faint concentric well ledge
  leaf.add(ring(0.44, 0.52, -0.05, -0.02, 0.012, steelDark, 'WellLedge', 72));
  // glass (empty)
  const glass = circle(0.52, 0.02, glassMat, 72, 'Glass');
  leaf.add(glass);

  // ================================================================
  //  COUNTDOWN TIMER  (tick ring on the porthole's inner bevel)
  // ================================================================
  const TIMER_N = 60;
  const timerGeo = G(new THREE.BoxGeometry(0.007, 0.02, 0.008));
  const timerRing = new THREE.InstancedMesh(timerGeo, timerMat, TIMER_N);
  timerRing.name = 'TimerRing';
  {
    const dm = new THREE.Object3D(), c0 = new THREE.Color();
    for (let i = 0; i < TIMER_N; i++) {
      const a = Math.PI / 2 - i / TIMER_N * TAU;         // top, clockwise
      dm.position.set(Math.cos(a) * 0.548, Math.sin(a) * 0.548, 0.118);
      dm.rotation.z = a - Math.PI / 2;
      dm.updateMatrix(); timerRing.setMatrixAt(i, dm.matrix);
      timerRing.setColorAt(i, c0.setScalar(0.12));
    }
    timerRing.instanceColor.needsUpdate = true;
  }
  leaf.add(timerRing);

  // ================================================================
  //  ARMS  (7 identical, shared geometry, evenly spaced, radius equal)
  // ================================================================
  // GRIT: bolts ride high enough to clear the raised outer band (top 0.082)
  // and skim the mid band (top 0.038) — proud hardware that casts a shadow,
  // instead of shafts half-buried in the plate.
  const ARM_Z = 0.092;
  const RETRACT = 0.10;           // inward travel at t=1
  // shared bolt geometry — a clean shaft that runs through the guide
  const gShaft = G(rotX(new THREE.CylinderGeometry(0.052, 0.052, 0.22, 24)));
  const gEnd = G(rotX(new THREE.CylinderGeometry(0.056, 0.05, 0.05, 24)));   // rounded outer nose
  const gDome = G(new THREE.SphereGeometry(0.056, 20, 12));
  const gBand = G(rotX(new THREE.CylinderGeometry(0.06, 0.06, 0.022, 24)));  // machined collar
  const gInner = G(rotX(new THREE.CylinderGeometry(0.062, 0.058, 0.03, 24))); // gland at the ring
  const gArmShadow = G(new THREE.PlaneGeometry(0.42, 0.2));

  const arms = [];
  const armDirs = [];
  let armIndex = 0;

  // shared guide-bracket geometry (fixed; the bolt runs THROUGH it)
  // GRIT: the bracket arches over the raised bolt line, so the cheeks are
  // deeper and everything sits higher — see the per-part z's below.
  const gGuideBase = G(new THREE.BoxGeometry(0.15, 0.19, 0.03));
  const gGuideCheek = G(new THREE.BoxGeometry(0.15, 0.03, 0.11));
  const gGuideBridge = G(new THREE.BoxGeometry(0.12, 0.19, 0.03));
  const gGuideRing = G(rotX(new THREE.CylinderGeometry(0.075, 0.075, 0.04, 24))); // mouth collar around bolt
  const housings = new THREE.Group(); housings.name = 'Guides';

  for (let k = 0; k < 8; k++) {
    const ang = Math.PI / 2 - k * (Math.PI / 4);   // top, then clockwise
    if (k === 4) continue;                          // 6 o'clock -> lock module
    const dir = new THREE.Vector2(Math.cos(ang), Math.sin(ang));

    // ---- bolt pivot (local +X = radial outward) ----
    const pivot = new THREE.Group();
    pivot.name = 'Arm_' + armIndex;
    pivot.rotation.z = ang;

    const shaft = new THREE.Mesh(gShaft, steelBright); shaft.position.set(0.84, 0, ARM_Z);
    const end = new THREE.Mesh(gEnd, steelBright); end.position.set(0.925, 0, ARM_Z);
    const dome = new THREE.Mesh(gDome, steelBright); dome.position.set(0.94, 0, ARM_Z);
    const band = new THREE.Mesh(gBand, steelRivet); band.position.set(0.79, 0, ARM_Z);
    const inner = new THREE.Mesh(gInner, steelRivet); inner.position.set(0.735, 0, ARM_Z);
    // Contact shadow rides just above the mid band; the taller outer band
    // depth-clips it automatically where the plates rise over it. Real cast
    // shadows now do most of this work, so it stays subtle.
    const sh = new THREE.Mesh(gArmShadow, shadowMat); sh.position.set(0.83, 0, 0.042); sh.renderOrder = -1;
    pivot.add(sh, inner, band, shaft, end, dome);

    leaf.add(pivot);
    arms.push(pivot);
    armDirs.push(dir);

    // ---- fixed guide bracket the bolt slides through (outer end) ----
    const house = new THREE.Group();
    const base = new THREE.Mesh(gGuideBase, steelDark); base.position.set(0, 0, 0.068);
    const cheekL = new THREE.Mesh(gGuideCheek, housingMat); cheekL.position.set(0, 0.082, 0.112);
    const cheekR = new THREE.Mesh(gGuideCheek, housingMat); cheekR.position.set(0, -0.082, 0.112);
    const bridge = new THREE.Mesh(gGuideBridge, steelPlate); bridge.position.set(0, 0, 0.155);
    const ringMouth = new THREE.Mesh(gGuideRing, steelPlate); ringMouth.position.set(-0.075, 0, ARM_Z);
    // contact shadow pooling under the bracket on the outer band
    const hsh = new THREE.Mesh(gArmShadow, shadowMat); hsh.position.set(0, 0, 0.0845);
    hsh.scale.set(0.85, 1.5, 1); hsh.renderOrder = -1;
    house.add(base, cheekL, cheekR, bridge, ringMouth, hsh);
    house.position.set(dir.x * 0.895, dir.y * 0.895, 0);
    house.rotation.z = ang;
    housings.add(house);

    armIndex++;
  }
  leaf.add(housings);

  // ================================================================
  //  LOCK MODULE  (6 o'clock)  — gold padlock
  // ================================================================
  const lock = new THREE.Group();
  lock.name = 'LockModule';
  // GRIT: lifted so the housing stays proud of the taller mid band.
  lock.position.set(0, -0.71, 0.024);
  // base + two concentric machined bezel rings + dark shoulder
  lock.add(disc(0.16, 0.05, 0.014, steelPlate, 56, 'LockHousing'));
  lock.add(ring(0.118, 0.16, 0.0, 0.072, 0.017, steelPlate, 'LockBezel', 64));
  lock.add(ring(0.1, 0.123, 0.0, 0.056, 0.008, steelDark, 'LockBezelInner', 64));
  lock.add(disc(0.108, 0.04, 0.026, goldRecessMat, 48, 'LockRecess'));
  // segmented cog ring hugging the glow
  {
    const teeth = new THREE.InstancedMesh(G(new THREE.BoxGeometry(0.02, 0.03, 0.024)), steelPlate, 20);
    const dm = new THREE.Object3D();
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * TAU;
      dm.position.set(Math.cos(a) * 0.103, Math.sin(a) * 0.103, 0.044);
      dm.rotation.z = a; dm.updateMatrix(); teeth.setMatrixAt(i, dm.matrix);
    }
    teeth.instanceMatrix.needsUpdate = true; lock.add(teeth);
  }
  // top latch tab + two bezel screws
  const tab = new THREE.Mesh(G(new THREE.BoxGeometry(0.055, 0.032, 0.032)), steelPlate);
  tab.position.set(0, 0.157, 0.072); lock.add(tab);
  for (const sa of [Math.PI / 2 - 0.58, Math.PI / 2 + 0.58]) {
    const sc = new THREE.Mesh(G(rotX(new THREE.CylinderGeometry(0.013, 0.015, 0.026, 6))), steelBright);
    sc.position.set(Math.cos(sa) * 0.14, Math.sin(sa) * 0.14, 0.074); lock.add(sc);
  }
  // layered additive glow: soft core+halo, then radial streaks
  const gl = (r, mat, z, name) => { const m = new THREE.Mesh(G(new THREE.CircleGeometry(r, 48)), mat); m.position.z = z; if (name) m.name = name; return m; };
  lock.add(gl(0.106, glowMat, 0.032, 'LockGlow'));
  lock.add(gl(0.114, streakMat, 0.035));
  lock.add(gl(0.078, glowMat, 0.037));
  lock.add(gl(0.052, glowMat, 0.04));
  // ring of gold dial ticks (longer at cardinals)
  {
    const tickG = G(new THREE.BoxGeometry(0.006, 0.015, 0.006));
    const tickL = G(new THREE.BoxGeometry(0.007, 0.024, 0.006));
    for (let i = 0; i < 12; i++) {
      const a = Math.PI / 2 - i / 12 * TAU;
      const t = new THREE.Mesh(i % 3 === 0 ? tickL : tickG, goldMat);
      t.position.set(Math.cos(a) * 0.086, Math.sin(a) * 0.086, 0.05);
      t.rotation.z = a - Math.PI / 2; lock.add(t);
    }
  }
  // padlock (raised, glowing) + dark keyhole
  const padBody = new THREE.Mesh(G(new THREE.BoxGeometry(0.058, 0.048, 0.02)), goldCore);
  padBody.position.set(0, -0.01, 0.064);
  const shackle = new THREE.Mesh(G(new THREE.TorusGeometry(0.021, 0.008, 10, 26, Math.PI)), goldCore);
  shackle.position.set(0, 0.02, 0.064);
  // Shackle is kept as its own handle so the padlock can be sprung open — see
  // setLockOpen(). Its rest transform is captured here rather than hardcoded in
  // the setter so the two cannot drift apart.
  const SHACKLE_REST_Y = 0.02;
  const khole = new THREE.Mesh(G(new THREE.CircleGeometry(0.008, 16)), steelDark);
  khole.position.set(0, -0.004, 0.076);
  const kslot = new THREE.Mesh(G(new THREE.BoxGeometry(0.006, 0.014, 0.006)), steelDark);
  kslot.position.set(0, -0.015, 0.076);
  lock.add(padBody, shackle, khole, kslot);
  // faint gold cardinal ticks on the plate around the lock
  {
    const cg = G(new THREE.BoxGeometry(0.008, 0.02, 0.006));
    for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
      const t = new THREE.Mesh(cg, goldMat);
      t.position.set(Math.cos(a) * 0.188, Math.sin(a) * 0.188, 0.03);
      t.rotation.z = a - Math.PI / 2; lock.add(t);
    }
  }
  leaf.add(lock);
  // flanking domed bolts on the door body, either side of the lock
  for (const sx of [-0.215, 0.215]) {
    const socket = new THREE.Mesh(G(rotX(new THREE.CylinderGeometry(0.05, 0.055, 0.02, 20))), steelDark);
    socket.position.set(sx, -0.71, 0.054);
    const dome = new THREE.Mesh(G(new THREE.SphereGeometry(0.032, 16, 12)), steelBright);
    dome.position.set(sx, -0.71, 0.07); dome.scale.z = 0.55;
    leaf.add(socket, dome);
  }

  // ================================================================
  //  HINGE  (prominent vertical barrel hinge on the right edge)
  // ================================================================
  const hinge = new THREE.Group();
  hinge.name = 'Hinge';
  {
    // vertical back leaf
    const leaf = new THREE.Mesh(G(new THREE.BoxGeometry(0.07, 0.9, 0.07)), steelDark);
    leaf.position.set(1.075, 0, 0.015); hinge.add(leaf);
    // two mounting brackets bolting the hinge to the door edge
    const bracket = G(new THREE.BoxGeometry(0.26, 0.17, 0.055));
    const bBolt = G(rotX(new THREE.CylinderGeometry(0.016, 0.018, 0.026, 6)));
    for (const by of [0.35, -0.35]) {
      const b = new THREE.Mesh(bracket, steelDark); b.position.set(0.9, by, 0.035); hinge.add(b);
      for (const bx of [0.82, 0.98]) {
        const bo = new THREE.Mesh(bBolt, steelBright); bo.position.set(bx, by, 0.066); hinge.add(bo);
      }
    }
    // solid vertical barrel with knuckle ridges + flush rounded caps
    const barrel = new THREE.Mesh(G(new THREE.CylinderGeometry(0.058, 0.058, 0.9, 24)), steelPlate);
    barrel.position.set(1.035, 0, 0.05); hinge.add(barrel);
    const gRidge = G(new THREE.CylinderGeometry(0.067, 0.067, 0.05, 24));
    for (const ry of [0.17, -0.17]) {
      const rg = new THREE.Mesh(gRidge, steelDark); rg.position.set(1.035, ry, 0.05); hinge.add(rg);
    }
    const gCap = G(new THREE.SphereGeometry(0.058, 20, 12));
    for (const cy of [0.45, -0.45]) {
      const c = new THREE.Mesh(gCap, steelBright); c.position.set(1.035, cy, 0.05); hinge.add(c);
    }
    // hinge bolt heads (bright, facing viewer) at the knuckle joints
    const gHeadBolt = G(rotX(new THREE.CylinderGeometry(0.028, 0.03, 0.03, 14)));
    for (const hy of [0.17, -0.17]) {
      const hb = new THREE.Mesh(gHeadBolt, steelBright); hb.position.set(1.035, hy, 0.115); hinge.add(hb);
    }
  }
  leaf.add(hinge);

  // ================================================================
  //  VAULT INTERIOR  (chamber glimpsed while the door swings)
  //  On the ROOT (does NOT swing). Hidden behind the closed door.
  //  Replace/hide via door.interior.visible = false.
  // ================================================================
  // Deliberately just a dark, empty cavity. This used to hold a big additive
  // gradient cone lighting the chamber; it read as a flat disc of colour
  // covering half the screen and was cut. The door reseals moments after it
  // opens, so the interior is a glimpse, not a scene — anything staged in
  // here is gone before it can be looked at. If contents ever go back in,
  // they need the door to STAY open, which is a different design.
  const interior = new THREE.Group();
  interior.name = 'VaultInterior';
  let chamberGlowMat, chamberRimMat;
  // ⚠ UNLIT AND FLAT, deliberately — MeshBasic, no env map, no normal/roughness
  // maps, NOT in `metalMats`. As a lit MeshStandard it picked up the key light
  // and the studio env and read as a shaded metal funnel: a big graded cone in
  // the doorway. That shading was mistaken for the additive glow twice over.
  // A vault interior should be a black void the payout sits in, so it takes no
  // light at all. Do not "improve" this back to a lit material.
  const intWall = M(new THREE.MeshBasicMaterial({ name: 'IntWall', color: 0x05070a, side: THREE.BackSide }));
  {
    const CH_R = 0.99, FRONT = -0.18, BACK = -1.85, H = FRONT - BACK;
    // dark cavity wall (narrows toward the back)
    const tube = new THREE.CylinderGeometry(CH_R, CH_R * 0.5, H, 64, 1, true);
    tube.rotateX(Math.PI / 2);
    const tubeMesh = new THREE.Mesh(G(tube), intWall); tubeMesh.position.z = (FRONT + BACK) / 2;
    interior.add(tubeMesh);
    // doorway jamb lip (hidden behind the closed door)
    interior.add((() => {
      const p = [
        new THREE.Vector2(0.88, -0.2), new THREE.Vector2(0.88, -0.1),
        new THREE.Vector2(0.9, -0.09), new THREE.Vector2(0.99, -0.09),
        new THREE.Vector2(0.99, -0.22), new THREE.Vector2(0.9, -0.22), new THREE.Vector2(0.88, -0.2)
      ];
      const g = G(new THREE.LatheGeometry(p, 64)); g.rotateX(Math.PI / 2);
      return new THREE.Mesh(g, steelDark);
    })());
    // dark back cap so the cavity isn't see-through
    interior.add((() => { const o = new THREE.Mesh(G(new THREE.CircleGeometry(CH_R * 0.5, 32)), intWall); o.position.z = BACK; o.rotation.y = Math.PI; return o; })());
    // Warm pool deep in the chamber, lit only while the door stands open —
    // an empty black hole read as "lonely". This is a soft RADIAL falloff on a
    // single plane set well back, NOT the full-length cone that was cut
    // earlier: it pools behind the payout instead of coating the whole mouth,
    // so the chamber still reads as deep and the walls stay unlit.
    chamberGlowMat = M(new THREE.MeshBasicMaterial({
      name: 'ChamberGlow', map: makeSoftGlowTex(), color: GOLD,
      transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    // ⚠ A CIRCLE, and it must stay narrower than the tube at its own depth.
    // As a 1.9-wide plane the corners punched straight through the cavity wall
    // and drew a hard lit SQUARE over the door and the page behind it. The tube
    // tapers 0.99 -> 0.495 across z -0.18..-1.85, so at z=-0.7 the wall is at
    // r≈0.84 and 0.75 clears it.
    const cg = new THREE.Mesh(G(new THREE.CircleGeometry(0.75, 48)), chamberGlowMat);
    cg.position.z = -0.7;
    interior.add(cg);

    // Gold ring lining the chamber mouth — the accent that frames the opening.
    // Built in 3D rather than as an RN overlay so the swinging leaf OCCLUDES it
    // properly and it sits in the same perspective as the cavity; a flat ring
    // painted on top would float over the door as it turns.
    // ⚠ Must stay INSIDE the jamb lip, whose inner radius is 0.88 — a wider
    // ring disappears behind the lip. Sat just behind the lip's back face
    // (z -0.22) so it reads as recessed into the mouth rather than z-fighting.
    // Gold lining the chamber mouth — a SINGLE soft ramp, no separate band
    // mesh. Additive, so the dark chamber shows through the faded middle and
    // only the rim end of the ramp actually lights.
    chamberRimMat = M(new THREE.MeshBasicMaterial({
      name: 'ChamberRimSpill', map: makeRimTex(), color: GOLD,
      transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const crs = new THREE.Mesh(G(new THREE.CircleGeometry(0.862, 96)), chamberRimMat);
    crs.position.z = -0.23;
    interior.add(crs);
  }
  group.add(interior);

  // ================================================================
  //  RIVETS  (instanced) + GOLD INDICATOR TICKS
  // ================================================================
  // a bolt on each outer segment + a ring of studs on the raised bezel
  leaf.add(hexBolts(0.905, 16, 0.1));
  // The rivet ring used to sit half-buried at z 0.052; on the taller cam ring
  // that would have entombed it entirely, so it now studs the bezel top —
  // which is also closer to the reference's inner ring of small bolts.
  leaf.add(makeRivets(0.575, 18, 0.116));

  // gold ticks at the mid-angles BETWEEN slots, on the boltwork face
  const gTick = G(new THREE.BoxGeometry(0.014, 0.05, 0.01));
  for (let k = 0; k < 8; k++) {
    const ang = Math.PI / 2 - k * (Math.PI / 4) - Math.PI / 8;
    const t = new THREE.Mesh(gTick, goldMat);
    t.position.set(Math.cos(ang) * 0.80, Math.sin(ang) * 0.80, 0.046);
    t.rotation.z = ang - Math.PI / 2;
    leaf.add(t);
  }

  // ================================================================
  //  BAKED AO  (contact-shadow annuli in the crevices)
  // ================================================================
  // The shadow map only darkens the side facing away from the key light; what
  // makes a crevice read GRIMY-dark from every angle is occlusion, and this
  // flat-disc model has none — so it is baked here as black gradient annuli
  // hugging each wall/step junction (same trick as the arm contact shadows,
  // which predate this pass). Each ring peaks against its wall and fades to
  // nothing before the next feature; where a taller plate overlaps one, the
  // depth test clips it automatically, which is what keeps the seam gaps dark
  // while the plate tops stay clean.
  const aoRing = (rIn, rPeak, rOut, z, opacity, name) => {
    const m = M(new THREE.MeshBasicMaterial({
      name: name || 'AO', map: makeAOTex(rIn / rOut, rPeak / rOut),
      color: 0x000000, transparent: true, opacity, depthWrite: false,
    }));
    const o = new THREE.Mesh(G(new THREE.CircleGeometry(rOut, 96)), m);
    o.position.z = z; o.renderOrder = -1; if (name) o.name = name;
    return o;
  };
  leaf.add(aoRing(0.545, 0.593, 0.65, -0.006, 0.85, 'AOChannelIn'));   // trench, inner strip
  leaf.add(aoRing(0.81, 0.868, 0.925, -0.005, 0.85, 'AOChannelOut'));  // trench, outer strip
  leaf.add(aoRing(0.60, 0.627, 0.75, 0.0405, 0.7, 'AOCamBase'));       // mid band vs bezel wall
  leaf.add(aoRing(0.935, 0.955, 1.0, 0.0605, 0.7, 'AOOuterRim'));      // edge rim vs outer band
  {
    const lockAO = aoRing(0.125, 0.175, 0.28, 0.043, 0.6, 'AOLock');   // mid band vs lock housing
    lockAO.position.set(0, -0.71, 0.043);
    leaf.add(lockAO);
  }
  // Broad falloff toward the door's rim — the reference's face is brightest
  // around the porthole and dies toward the edge. Floats above the tallest
  // hardware and swings with the leaf; low opacity, it is a grade, not a hole.
  leaf.add(aoRing(0.62, 1.0, 1.13, 0.2, 0.42, 'AOVignette'));

  // ================================================================
  //  SCORE LINES  (machined concentric grooves on the plate tops)
  // ================================================================
  // The reference scores every ring with fine dark circles — panel definition
  // the broad faces here lacked. Thin dark tori sitting proud by less than
  // their own radius, so they read as engraved grooves, not wires.
  {
    const score = (r, z) => {
      const g = G(new THREE.TorusGeometry(r, 0.0045, 6, 96));
      const o = new THREE.Mesh(g, steelDark); o.position.z = z; return o;
    };
    leaf.add(score(0.585, 0.1115));  // cam-ring bezel top
    leaf.add(score(0.665, 0.039));   // mid band, inner
    leaf.add(score(0.775, 0.039));   // mid band, outer
    leaf.add(score(0.885, 0.083));   // outer band, inside the hex bolts
  }

  // ================================================================
  //  LIGHTS  (baked into the group so it reads without a host rig)
  // ================================================================
  // GRIT: harder, lower-angle key (longer shadows off the raised hardware) and
  // less fill/ambient, so everything the key does not hit falls toward black —
  // the reference is lit like a single hard lamp in a dark room, not a studio.
  const keyL = new THREE.DirectionalLight(0xfff3e6, 4.5); keyL.name = 'KeyLight'; keyL.position.set(-4.2, 4.4, 3.4);
  const fillL = new THREE.DirectionalLight(0xa9b4bb, 0.3); fillL.name = 'FillLight'; fillL.position.set(4.5, -2.5, 3);
  const rimL = new THREE.DirectionalLight(0xd2e2ea, 2.1); rimL.name = 'RimLight'; rimL.position.set(-1.5, 2.5, -5);
  const hemi = new THREE.HemisphereLight(0x42464b, 0x050708, 0.35); hemi.name = 'HemiLight';
  const kt = new THREE.Object3D(); group.add(kt); keyL.target = kt;
  const ft = new THREE.Object3D(); group.add(ft); fillL.target = ft;
  const rt = new THREE.Object3D(); group.add(rt); rimL.target = rt;
  group.add(keyL, fillL, rimL, hemi);

  // GRIT: only the key light casts. The shadow map itself is switched on in
  // buildEnvironment (the one place handed a renderer); everything here is
  // renderer-independent and free when shadows are off.
  keyL.castShadow = true;
  keyL.shadow.mapSize.set(1024, 1024);
  keyL.shadow.camera.left = -1.7; keyL.shadow.camera.right = 1.7;
  keyL.shadow.camera.top = 1.7; keyL.shadow.camera.bottom = -1.7;
  keyL.shadow.camera.near = 2; keyL.shadow.camera.far = 16;
  // normalBias, not bias, does the acne suppression on all the small curved
  // hardware; a big depth bias here made bolt shadows detach (peter-panning).
  keyL.shadow.bias = -0.0002;
  keyL.shadow.normalBias = 0.035;
  keyL.shadow.radius = 3;
  group.traverse(o => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const m = o.material;
    // transparent = glass / glows / AO+contact shadows; intWall = the chamber,
    // which must stay a lightless void; the timer ticks would pepper the
    // porthole ledge with 60 tiny shadow dots.
    if (!m || m.transparent || m === intWall || o === timerRing) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });

  // ================================================================
  //  API
  // ================================================================
  let camFollowRad = 0;

  function setUnlock(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const N = arms.length;
    const w = 1 / N;                 // each bolt's share of the travel
    const step = (1 - w) / (N - 1);  // stagger so the last finishes exactly at t=1
    for (let i = 0; i < N; i++) {
      let lt = (t - i * step) / w;   // this bolt's local progress
      lt = lt < 0 ? 0 : lt > 1 ? 1 : lt;
      lt = lt * lt * (3 - 2 * lt);   // ease in/out
      const d = RETRACT * lt;
      const dir = armDirs[i];
      arms[i].position.set(-dir.x * d, -dir.y * d, 0);   // withdraw INWARD, one by one
    }
    // optional cam-ring follow (default off -> ring never moves)
    camRing.rotation.z = camFollowRad * t;
  }

  function setCamRingFollow(deg) { camFollowRad = (deg || 0) * Math.PI / 180; }

  const MAX_OPEN = THREE.MathUtils.degToRad(115);
  function setOpen(a) {
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    swing.rotation.y = a * MAX_OPEN;                     // swing on the right hinge
  }

  /**
   * 0 = padlock shut, 1 = sprung open.
   *
   * The shackle lifts clear of the body and swings, which is the whole reason
   * the lock icon exists on this door: a vault that has just paid out should
   * not still be showing a closed padlock. Pure in t like setUnlock, so the
   * caller can scrub it back shut when the door reseals.
   */
  function setLockOpen(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    shackle.position.y = SHACKLE_REST_Y + t * 0.018;
    shackle.rotation.z = -t * 0.85;
  }

  /**
   * 0 = dark chamber, 1 = fully lit. Drive off the swing, not the hold — both
   * the pool and the mouth ring should only be alight while there is an open
   * door to see them through.
   */
  function setChamberGlow(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    chamberGlowMat.opacity = t * 0.55;
    chamberRimMat.opacity = t * 0.88;
  }

  const _tc = new THREE.Color();
  function setTimer(p) {
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    const lit = Math.round(p * TIMER_N);
    for (let i = 0; i < TIMER_N; i++) timerRing.setColorAt(i, _tc.setScalar(i < lit ? 1.0 : 0.1));
    timerRing.instanceColor.needsUpdate = true;
  }


  let curK = 1;
  function setLightIntensity(k) {
    curK = k;
    keyL.intensity = 4.5 * k; fillL.intensity = 0.3 * k;
    rimL.intensity = 2.1 * k; hemi.intensity = 0.35 * k;
    steelDark.envMapIntensity = baseEnvI.dark * k;
    steelPlate.envMapIntensity = baseEnvI.plate * k;
    steelBright.envMapIntensity = baseEnvI.bright * k;
    steelRivet.envMapIntensity = baseEnvI.rivet * k;
    housingMat.envMapIntensity = baseEnvI.housing * k;
    wellMat.envMapIntensity = baseEnvI.well * k;
    hexMat.envMapIntensity = baseEnvI.hex * k;
    glassMat.envMapIntensity = baseEnvI.glass * k;
    steelOuter.envMapIntensity = baseEnvI.outer * k;
  }

  let envRT = null;
  function buildEnvironment(renderer) {
    if (!renderer || !THREE.PMREMGenerator) return null;
    // GRIT: real cast shadows. Wired here because this is the only entry point
    // that ever sees the renderer, and it runs before the first frame in every
    // host (VaultDoor3D calls it straight after GL init). Guarded so a renderer
    // without shadow support degrades to the pre-shadow look instead of
    // throwing on the app's load path.
    try {
      renderer.shadowMap.enabled = true;
      // NOT PCFSoftShadowMap: deprecated in r183 (warns + falls back to PCF);
      // plain PCF also honours shadow.radius, which PCFSoft ignored.
      renderer.shadowMap.type = THREE.PCFShadowMap;
    } catch (e) { /* shadows are an enhancement, never a blocker */ }
    const pmrem = new THREE.PMREMGenerator(renderer);
    if (pmrem.compileEquirectangularShader) pmrem.compileEquirectangularShader();
    envRT = pmrem.fromEquirectangular(envSource);
    const env = envRT.texture;
    for (const m of metalMats) { m.envMap = env; m.needsUpdate = true; }
    glassMat.envMap = env; glassMat.needsUpdate = true;
    pmrem.dispose();
    return env;
  }

  function dispose() {
    if (envRT) { envRT.dispose(); envRT = null; }
    geoms.forEach(g => g.dispose());
    mats.forEach(m => m.dispose());
    texs.forEach(t => t.dispose());
    geoms.clear(); mats.clear(); texs.clear();
  }

  setUnlock(0);
  setOpen(0);
  setTimer(0.66);

  return {
    group, arms,
    setUnlock, setLightIntensity, buildEnvironment, setCamRingFollow, setOpen, setTimer, setLockOpen, setChamberGlow, dispose,
    camRing, lock, hinge, glass, swing, timer: timerRing, interior,
    materials: { steelDark, steelPlate, steelBright, steelRivet, housingMat, wellMat, hexMat, glassMat, goldMat }
  };

  // ---------------- local builders ----------------
  function rotX(g) { g.rotateZ(Math.PI / 2); return g; } // cyl axis Y -> X

  function makeSurfaceMaps() {
    // ── LOCAL TUNING (metallic pass, 2026-07-19) — see header note ──
    // s=512, not 256: the reference finish is DENSE — fine machining plus a
    // cast/blasted speckle — and at 256 the grain had to stay coarse enough to
    // survive mipmapping, which read as smooth by comparison. Costs generation
    // time on the createVaultDoor path; measured before committing to it.
    const s = 512, h = new Float32Array(s * s);
    // ⚠ INTEGER hash, not the usual sin-based one. Five octaves x 4 corners x
    // 512^2 texels is ~5.2M hash calls; with `Math.sin(...)*43758.5453` that
    // measured 580ms of the door's build; this integer version measures 91ms
    // warm for the SAME value-noise, which is what paid for s=512.
    const hash = (x, y) => {
      let n = (x | 0) * 374761393 + (y | 0) * 668265263;
      n = (n ^ (n >> 13)) * 1274126177;
      return ((n ^ (n >> 16)) >>> 0) / 4294967296;
    };
    const lerp = (a, b, t) => a + (b - a) * t, smooth = t => t * t * (3 - 2 * t);
    const vnoise = (x, y, sx, sy) => {
      x *= sx; y *= sy; const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = smooth(xf), v = smooth(yf);
      return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
    };
    // ANISOTROPIC: fast variation along v, slow along u. Lathe/extrude UVs run
    // u around the circumference, so this reads as machining marks on a turned
    // face. The previous isotropic noise just made the metal look dusty.
    //
    // The ratio between the two frequencies IS the grain: 3 vs 340 means each
    // streak runs ~110x longer than it is wide.
    //
    // ⚠ Frequency along v is CAPPED BY THE MAP, not by taste. With repeat 2,
    // anything past roughly s×0.75 cycles lands under 2 texels per streak and
    // aliases into sparkle the mipmaps then smear to mush — that ceiling is
    // ~200 at s=256 and ~380 at s=512. 340 sits under it with headroom.
    //
    // SPECKLE is the other half of matching the reference: that finish is not
    // purely drawn, it is cast/blasted metal with fine pitting UNDER the
    // machining. Pure anisotropic grain alone reads too clean and synthetic.
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const u = x / s, v = y / s;
      // GRIT: weights shifted from drawn grain toward the cast/blast octaves —
      // the reference face is pitted first, machined second.
      h[y * s + x] = vnoise(u, v, 3, 340) * 0.37     // primary drawn grain
                   + vnoise(u, v, 7, 165) * 0.23     // secondary pass
                   + vnoise(u, v, 150, 150) * 0.19   // cast/blasted speckle
                   + vnoise(u, v, 44, 44) * 0.12     // coarser pitting
                   + vnoise(u, v, 2, 78) * 0.09;     // slow banding, a polish pass
    }

    // ── WEAR ────────────────────────────────────────────────────────────────
    // A door that has been used, not one that has corroded. Everything here is
    // ACHROMATIC on purpose: wear is carried by how the surface takes light,
    // never by hue. The moment this shifts colour it reads as rust, which is a
    // different (and unwanted) story about the vault.
    //
    // Two mechanisms, because they say different things:
    //  - MOTTLE: broad, soft patches where the finish is more or less polished,
    //    the way a handled panel goes uneven. This is what actually reads as
    //    "used" at a glance.
    //  - SCRATCHES: sparse marks ACROSS the grain. Deliberately few and short —
    //    the map repeats 2x mirrored, so anything distinctive here shows up
    //    four times and starts reading as a pattern rather than as damage.
    // GRIT: a coarse blotch octave on top — the reference's plates carry big
    // soft patches of unevenness you can see at arm's length, not only the
    // fine mottle. Coarse first so it dominates the swing.
    const mottle = new Float32Array(s * s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const u = x / s, v = y / s;
      mottle[y * s + x] = vnoise(u, v, 1.7, 1.7) * 0.45
                        + vnoise(u, v, 3.5, 3.5) * 0.33
                        + vnoise(u, v, 9, 9) * 0.22;
    }

    // Deterministic PRNG: the door must look identical on every launch.
    let seed = 0x5eed;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const SCRATCHES = 34;
    for (let n = 0; n < SCRATCHES; n++) {
      // Biased across the grain (grain runs along u, so angles near vertical),
      // but not perfectly perpendicular — real handling marks wander.
      const ang = (Math.PI / 2) + (rnd() - 0.5) * 1.5;
      const len = (0.06 + rnd() * 0.16) * s;
      const depth = 0.10 + rnd() * 0.22;
      let px = rnd() * s, py = rnd() * s;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      for (let t = 0; t < len; t++) {
        px += dx; py += dy;
        const ix = ((px | 0) % s + s) % s, iy = ((py | 0) % s + s) % s;
        // Soft shoulder either side so it is a groove, not a 1px line.
        for (let o = -1; o <= 1; o++) {
          const jx = ((ix + o) % s + s) % s;
          const fall = o === 0 ? 1 : 0.45;
          const k = iy * s + jx;
          h[k] = Math.max(0, h[k] - depth * fall);
        }
      }
    }
    const at = (x, y) => h[((y % s) + s) % s * s + (((x % s) + s) % s)];
    const rd = new Uint8Array(s * s * 4), nd = new Uint8Array(s * s * 4), ad = new Uint8Array(s * s * 4);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      const hv = h[y * s + x], mv = mottle[y * s + x];
      // Grain is carried mostly by ROUGHNESS variation — polished streaks
      // against duller ones — which is what a drawn finish physically is. The
      // mottle then swings the whole local patch duller or more burnished, so
      // the finish is uneven the way a used panel is.
      const rc = Math.min(255, (0.36 + 0.54 * hv + 0.30 * mv) * 255) | 0;
      rd[i] = rd[i + 1] = rd[i + 2] = rc; rd[i + 3] = 255;
      // Albedo: GREY ONLY, and the swing is now WIDE (~0.69–1.0) — this is the
      // dial that finally made the plates read as handled metal on a real GPU;
      // the earlier 0.82 floor vanished into the tone mapping. Still strictly
      // achromatic: any colour here and the door reads as rusting.
      const ac = ((0.62 + 0.38 * (0.28 + 0.72 * mv)) * 255) | 0;
      ad[i] = ad[i + 1] = ad[i + 2] = ac; ad[i + 3] = 255;
      const dx = (at(x + 1, y) - at(x - 1, y)) * 1.0, dy = (at(x, y + 1) - at(x, y - 1)) * 1.0;
      let nx = -dx, ny = -dy, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      nd[i] = (nx * 0.5 + 0.5) * 255 | 0; nd[i + 1] = (ny * 0.5 + 0.5) * 255 | 0; nd[i + 2] = (nz * 0.5 + 0.5) * 255 | 0; nd[i + 3] = 255;
    }
    // ⚠ The albedo map is the ONE that needs SRGBColorSpace — it feeds `map`,
    // which three colour-converts. Roughness and normal are raw data and must
    // stay NoColorSpace or the values get gamma-mangled.
    const mk = (data, colorSpace) => {
      const t = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
      t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.repeat.set(2, 2);
      t.colorSpace = colorSpace || THREE.NoColorSpace; t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
      return T(t);
    };
    return { rough: mk(rd), normal: mk(nd), albedo: mk(ad, THREE.SRGBColorSpace) };
  }

  function arcRing(innerR, outerR, count, gapDeg, zLow, zHigh, bevel, mat, name, offset) {
    offset = offset || 0;
    const grp = new THREE.Group(); grp.name = name || 'SegRing';
    const step = TAU / count;
    const half = (step - gapDeg * Math.PI / 180) / 2;
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outerR, -half, half, false);
    shape.absarc(0, 0, innerR, half, -half, true);
    const geo = G(new THREE.ExtrudeGeometry(shape, {
      depth: zHigh - zLow, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
      bevelSegments: 1, curveSegments: 10, steps: 1
    }));
    geo.translate(0, 0, zLow);
    for (let i = 0; i < count; i++) {
      // GRIT: every segment used to share one geometry, so all 8/16 plates
      // showed the IDENTICAL grain, mottle and scratches — which the eye reads
      // as a printed pattern, not wear. A per-segment UV shift makes each
      // plate sample its own patch of the surface maps. Costs one small
      // buffer clone per segment, built once.
      const g2 = G(geo.clone());
      const uv = g2.attributes.uv;
      const du = (i * 0.371) % 1, dv = (i * 0.713) % 1;
      for (let j = 0; j < uv.count; j++) uv.setXY(j, uv.getX(j) + du, uv.getY(j) + dv);
      uv.needsUpdate = true;
      const m = new THREE.Mesh(g2, mat); m.rotation.z = offset + i * step; grp.add(m);
    }
    return grp;
  }

  function hexBolts(radius, count, z) {
    const g = G(rotX(new THREE.CylinderGeometry(0.032, 0.036, 0.04, 6)));
    const inst = new THREE.InstancedMesh(g, steelRivet, count);
    inst.name = 'HexBolts';
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + Math.PI / count;
      dummy.position.set(Math.cos(a) * radius, Math.sin(a) * radius, z);
      dummy.rotation.set(0, 0, a);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  }

  function makeRivets(radius, count, z, skip) {    const g = G(new THREE.SphereGeometry(0.016, 8, 6));
    const inst = new THREE.InstancedMesh(g, steelRivet, count);
    inst.name = 'Rivets';
    const dummy = new THREE.Object3D();
    let n = 0;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + Math.PI / count;
      if (skip && skip.some(s => Math.abs(((a - s + Math.PI) % TAU) - Math.PI) < 0.2)) continue;
      dummy.position.set(Math.cos(a) * radius, Math.sin(a) * radius, z);
      dummy.scale.set(1, 1, 0.6);
      dummy.updateMatrix();
      inst.setMatrixAt(n++, dummy.matrix);
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  }

  function makeHexTex() {
    const s = 128, data = new Uint8Array(s * s * 4);
    const l = Math.hypot(1, 1.732), hnx = 1 / l, hny = 1.732 / l;
    const mod = (a, b) => a - b * Math.floor(a / b);
    const N = 8.0, rx = 1.0, ry = 1.732;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const u = x / s * N, v = y / s * N;
      let ax = mod(u, rx) - rx * 0.5, ay = mod(v, ry) - ry * 0.5;
      let bx = mod(u - rx * 0.5, rx) - rx * 0.5, by = mod(v - ry * 0.5, ry) - ry * 0.5;
      let gx, gy;
      if (ax * ax + ay * ay < bx * bx + by * by) { gx = ax; gy = ay; } else { gx = bx; gy = by; }
      const dd = Math.max(Math.abs(gx) * hnx + Math.abs(gy) * hny, Math.abs(gx));
      const edge = Math.abs(0.5 - dd);
      const line = Math.max(0, 1 - edge / 0.045);
      const rad = Math.min(1, Math.hypot(x / s - 0.5, y / s - 0.5) * 2);
      const c = (line * (0.28 + 0.72 * rad) * 255) | 0;
      const i = (y * s + x) * 4; data[i] = c; data[i + 1] = c; data[i + 2] = c; data[i + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return T(tex);
  }

  /**
   * Radial occlusion band for aoRing(): alpha 0 at innerFrac, 1 at peakFrac,
   * 0 again at the disc edge, smoothstepped both sides so neither end draws a
   * line. RGB is irrelevant (the material colour is black); alpha carries it.
   */
  function makeAOTex(innerFrac, peakFrac) {
    const s = 128, data = new Uint8Array(s * s * 4), c = s / 2;
    const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = (x - c) / c, dy = (y - c) / c, r = Math.hypot(dx, dy);
      const a = r > 1 ? 0 : (r <= peakFrac ? ss(innerFrac, peakFrac, r) : 1 - ss(peakFrac, 1, r));
      const i = (y * s + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; data[i + 3] = (a * 255) | 0;
    }
    const t = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true; return T(t);
  }

  function makeSoftGlowTex() {    const s = 128, data = new Uint8Array(s * s * 4), c = s / 2;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = (x - c) / c, dy = (y - c) / c, r = Math.hypot(dx, dy);
      const q = (Math.pow(Math.max(0, 1 - r), 2.2) * 255) | 0;
      const i = (y * s + x) * 4; data[i] = data[i + 1] = data[i + 2] = q; data[i + 3] = 255;
    }
    const t = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return T(t);
  }

  /**
   * INVERSE of makeSoftGlowTex: dark at the centre, bright at the edge.
   *
   * The chamber's mouth ring, as ONE continuous ramp — there is no separate
   * band mesh. An earlier version drew a solid-gold annulus with this gradient
   * underneath it, and the annulus's inner edge was a hard line straight across
   * the glow. If a crisp ring is ever wanted back, it has to be built into this
   * profile, not stacked on top of it.
   *
   * The profile falls to ZERO AT BOTH ENDS, which is what makes it smooth start
   * to finish:
   *   - inward, it is dark by r≈0.65 so the payout in front of it stays clean;
   *   - outward, it fades out again by r=1, so the disc's own edge is invisible
   *     rather than terminating a lit area.
   * Both ends use smoothstep, so the slope is zero at the peak from either
   * side and the two halves meet without a crease.
   *
   * ⚠ TWO DIALS CONTROL HOW FAR THE GOLD REACHES INWARD, and neither is the
   * material's opacity (that dims the rim just as much as the middle):
   *   INNER_START — where the light begins at all. Raising it is the blunt way
   *     to keep the middle clear.
   *   INNER_BIAS  — how hard the ramp is pushed toward the rim.
   * Together at 0.55/3.0 the mouth is dark to r≈0.65 and only reaches ~39% by
   * r=0.8, against 14%/75% at the earlier 0.34/2.2 — while the rim peak is
   * untouched. Lower either one and the wash creeps back over the payout.
   */
  function makeRimTex() {
    const s = 256, data = new Uint8Array(s * s * 4), c = s / 2;
    const PEAK = 0.93, INNER_START = 0.55, INNER_BIAS = 3.0;
    const ss = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = (x - c) / c, dy = (y - c) / c, r = Math.hypot(dx, dy);
      const a = r > 1 ? 0 : Math.min(Math.pow(ss(INNER_START, PEAK, r), INNER_BIAS), 1 - ss(PEAK, 1, r));
      const q = (a * 255) | 0;
      const i = (y * s + x) * 4; data[i] = data[i + 1] = data[i + 2] = q; data[i + 3] = 255;
    }
    const t = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true; return T(t);
  }

  function makeGlowTex() {    const s = 256, data = new Uint8Array(s * s * 4), c = s / 2;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = (x - c) / c, dy = (y - c) / c, r = Math.hypot(dx, dy);
      const v = Math.min(1, Math.pow(Math.max(0, 1 - r), 3.0) * 0.7 + Math.pow(Math.max(0, 1 - r * 3.6), 3) * 1.0);
      const q = (v * 255) | 0;
      const i = (y * s + x) * 4; data[i] = data[i + 1] = data[i + 2] = q; data[i + 3] = 255;
    }
    const t = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return T(t);
  }

  function makeStreakTex() {
    const s = 256, data = new Uint8Array(s * s * 4), c = s / 2, RAYS = 12;
    const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = (x - c) / c, dy = (y - c) / c, r = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
      const ray = Math.pow(0.5 + 0.5 * Math.cos(ang * RAYS), 6.0);
      const v = Math.min(1, ray * Math.pow(Math.max(0, 1 - r), 1.1) * ss(0.04, 0.3, r) * 1.15);
      const q = (v * 255) | 0;
      const i = (y * s + x) * 4; data[i] = data[i + 1] = data[i + 2] = q; data[i + 3] = 255;
    }
    const t = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return T(t);
  }

  function makeShadowTex() {    const s = 64, data = new Uint8Array(s * s * 4);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const nx = (x / (s - 1) - 0.5) * 2, ny = (y / (s - 1) - 0.5) * 2;
      const dd = Math.hypot(nx * 0.72, ny * 1.15);
      const a = Math.pow(Math.max(0, 1 - dd), 1.7);
      const i = (y * s + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; data[i + 3] = (a * 255) | 0;
    }
    const tex = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return T(tex);
  }

  function makeEnvSource() {
    // ── LOCAL TUNING (metallic pass, 2026-07-19) — see header note ──
    // At metalness ~1 the material IS its reflection, so this map carries the
    // entire metallic read. The shape that gives DARK metal rather than
    // polished aluminium: keep the broad fill (ceiling, horizon) low so the
    // average stays gunmetal, and make the narrow strips very hot so bevels,
    // bolt domes and rims pick up crisp glints. Raising the broad terms is
    // what turns this into chrome.
    const w = 512, h = 256, data = new Float32Array(w * h * 4);
    const dot = (ax,ay,az,bx,by,bz) => ax*bx + ay*by + az*bz;
    const N = (x,y,z) => { const l = Math.hypot(x,y,z); return [x/l, y/l, z/l]; };
    const ceil = N(-0.35, 0.92, 0.45);   // broad soft box, front-left-above
    const sA   = N(-0.85, 0.32, 0.42);   // sharp key strip
    const sB   = N( 0.78, 0.18, 0.35);   // sharp fill strip, opposite side
    const back = N( 0.10, 0.55, -0.88);  // cool rim so the silhouette reads
    const front = N(-0.28, 0.38, 0.88);  // broad frontal softbox — lights the flat face
    for (let y = 0; y < h; y++) {
      const phi = ((y + 0.5) / h) * Math.PI, dy = Math.cos(phi), sp = Math.sin(phi);
      for (let x = 0; x < w; x++) {
        const theta = ((x + 0.5) / w) * TAU - Math.PI;
        const dx = sp * Math.cos(theta), dz = sp * Math.sin(theta);
        const up = dy * 0.5 + 0.5;
        const v = 0.008 + Math.pow(up, 2.6) * 0.22;
        let r = v * 1.00, g = v * 0.99, b = v * 0.98;
        const dc = Math.max(0, dot(dx,dy,dz, ceil[0],ceil[1],ceil[2]));
        const cb = Math.pow(dc, 4.0) * 2.5;  r += cb * 1.00; g += cb * 0.99; b += cb * 0.97;
        const df = Math.max(0, dot(dx,dy,dz, front[0],front[1],front[2]));
        const fb = Math.pow(df, 3.0) * 0.55; r += fb * 1.00; g += fb * 0.99; b += fb * 0.97;
        const band = Math.exp(-Math.pow(dy / 0.26, 2)) * Math.max(0, dz * 0.5 + 0.5);
        const hb = band * 0.78;              r += hb * 1.00; g += hb * 0.98; b += hb * 0.95;
        const da = Math.max(0, dot(dx,dy,dz, sA[0],sA[1],sA[2]));
        const ab = Math.pow(da, 90) * 26.0;  r += ab * 1.00; g += ab * 0.99; b += ab * 0.97;
        const db = Math.max(0, dot(dx,dy,dz, sB[0],sB[1],sB[2]));
        const bb = Math.pow(db, 120) * 15.0; r += bb * 0.86; g += bb * 0.93; b += bb;
        const dbk = Math.max(0, dot(dx,dy,dz, back[0],back[1],back[2]));
        const kb = Math.pow(dbk, 10) * 1.6;  r += kb * 0.62; g += kb * 0.82; b += kb;
        const i = (y * w + x) * 4; data[i] = r; data[i+1] = g; data[i+2] = b; data[i+3] = 1;
      }
    }
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.needsUpdate = true;
    return T(tex);
  }
}
