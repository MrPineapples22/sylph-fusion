/**
 * SYLPH FUSION — COORDINATION DECAY & ORGANIC TAKEOVER DETECTOR
 * Specifications: Master Blueprint Sections XXXIV, XXXV
 *
 * Implements:
 * 1. CoordinationShare(t) = CoordinatedVolume_t / TotalVolume_t
 * 2. CoordinationDecay = - d(CoordinationShare)/dt
 * 3. OrganicTakeoverDetector: Recognizes phase transitions:
 *    COORDINATED_SEED -> MIXED_FLOW -> INDEPENDENT_EXPANSION -> ORGANIC_DOMINANCE -> MASS_DIFFUSION
 *
 * Rule: Do not permanently blacklist every coordinated birth. Suspicious launches can morph into organic runners.
 */
export class OrganicTakeoverDetector {
    history = [];
    /**
     * Tracks coordination decay and detects organic takeover transitions.
     */
    evaluateCoordination(params) {
        let coordinationShare = 1.0;
        if (params.totalVolumeLamports > 0n) {
            coordinationShare = Number(params.coordinatedVolumeLamports) / Number(params.totalVolumeLamports);
            coordinationShare = Math.max(0, Math.min(1, coordinationShare));
        }
        const prev = this.history[this.history.length - 1];
        const dt = prev ? Math.max(1, (params.timestampMs - prev.timestampMs) / 1000) : 1;
        // CoordinationDecay = - (currentShare - prevShare) / dt
        const coordinationDecayRate = prev ? -(coordinationShare - prev.share) / dt : 0;
        this.history.push({ timestampMs: params.timestampMs, share: coordinationShare });
        if (this.history.length > 200)
            this.history.shift();
        const organicVolumeShare = 1 - coordinationShare;
        // Phase transition classification
        let currentPhase = 'COORDINATED_SEED';
        if (coordinationShare > 0.8) {
            currentPhase = 'COORDINATED_SEED';
        }
        else if (coordinationShare > 0.5) {
            currentPhase = 'MIXED_FLOW';
        }
        else if (coordinationShare > 0.25 && params.uniqueIndependentWallets >= 15) {
            currentPhase = 'INDEPENDENT_EXPANSION';
        }
        else if (coordinationShare <= 0.25 && params.uniqueIndependentWallets >= 50) {
            currentPhase = 'ORGANIC_DOMINANCE';
        }
        else if (coordinationShare < 0.10 && params.uniqueIndependentWallets >= 150) {
            currentPhase = 'MASS_DIFFUSION';
        }
        else {
            currentPhase = 'MIXED_FLOW';
        }
        const isTakeoverConfirmed = (currentPhase === 'ORGANIC_DOMINANCE' || currentPhase === 'MASS_DIFFUSION') &&
            coordinationDecayRate >= 0;
        return {
            timestampMs: params.timestampMs,
            totalVolumeLamports: params.totalVolumeLamports,
            coordinatedVolumeLamports: params.coordinatedVolumeLamports,
            coordinationShare: Number(coordinationShare.toFixed(4)),
            coordinationDecayRate: Number(coordinationDecayRate.toFixed(4)),
            organicVolumeShare: Number(organicVolumeShare.toFixed(4)),
            currentPhase,
            isTakeoverConfirmed,
        };
    }
}
//# sourceMappingURL=coordination-decay.js.map