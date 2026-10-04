/**
 * SYLPH FUSION — SAFE-CANARY-X: EXPERIMENT MANIFEST & LOSS BUDGET
 * Specifications: Master Blueprint Section XXIV (Safe-Canary-X)
 *
 * Invariants:
 * 1. A canary is an evidence instrument, NOT "turn live trading on".
 * 2. Live authorized size remains ZERO until release gates permit a live experiment.
 * 3. Entry + exit form ONE atomic economic experiment lifecycle.
 */
export function createSafeCanaryManifest(params) {
    // Invariant Section XXIV: Live authorized size remains zero unless explicitly permitted by release gates
    const isLive = params.canaryLevel === 'BOUNDED_LIVE_CANARY';
    const lossBudget = isLive ? (params.lossBudgetLamports ?? 0n) : 0n;
    return {
        experimentId: params.experimentId,
        canaryLevel: params.canaryLevel,
        policyArtifactId: params.policyArtifactId,
        lossBudgetLamports: lossBudget,
        maxPermittedTranches: 1,
        maxDurationSlots: 200n,
        startSlot: params.startSlot,
        treatmentArmFraction: 0.10,
        isLiveAllowed: isLive && lossBudget > 0n,
        registeredAtMs: Date.now(),
    };
}
//# sourceMappingURL=canary-manifest.js.map