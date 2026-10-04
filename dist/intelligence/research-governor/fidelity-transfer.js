/**
 * SYLPH FUSION — AUTONOMOUS R&D GOVERNOR-X: MULTI-FIDELITY TRANSFER
 * Specifications: Master Blueprint Section LV (Multi-Fidelity R&D & FidelityTransferMatrix)
 *
 * Invariant: Low-fidelity evidence loses weight when real-world transfer degrades.
 */
export function computeFidelityTransfer(params) {
    const replayToShadow = params.replayReturnBps !== 0 ? Math.min(1.0, Math.max(0, params.shadowReturnBps / params.replayReturnBps)) : 0;
    const shadowToCanary = params.shadowReturnBps !== 0 ? Math.min(1.0, Math.max(0, params.canaryReturnBps / params.shadowReturnBps)) : 0;
    const canaryToLive = params.canaryReturnBps !== 0 ? Math.min(1.0, Math.max(0, params.liveReturnBps / params.canaryReturnBps)) : 0;
    const composite = replayToShadow * shadowToCanary * canaryToLive;
    const isTrustworthy = composite >= 0.30;
    return {
        replayToShadowTransferRatio: Number(replayToShadow.toFixed(2)),
        shadowToCanaryTransferRatio: Number(shadowToCanary.toFixed(2)),
        canaryToLiveTransferRatio: Number(canaryToLive.toFixed(2)),
        compositeFidelityWeight: Number(composite.toFixed(3)),
        isTransferTrustworthy: isTrustworthy,
    };
}
//# sourceMappingURL=fidelity-transfer.js.map