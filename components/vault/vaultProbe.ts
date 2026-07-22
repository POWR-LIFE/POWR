// ── Dev-only load telemetry ─────────────────────────────────────────────────
// One line per stage, ms since screen mount — read from the dev-server
// console while a device runs the screen. Costs nothing in release builds.
// Its own zero-import module so no require order or HMR pass can leave a
// caller holding a module object without these exports.
let probeT0 = 0;

export function vaultProbe(stage: string) {
    if (__DEV__) console.log(`[vault-probe] +${Date.now() - probeT0}ms ${stage}`);
}

export function vaultProbeStart() {
    probeT0 = Date.now();
    if (__DEV__) console.log('[vault-probe] t0 — /vault mounted');
}
