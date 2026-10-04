/**
 * SYLPH FUSION — SAFE-CANARY-X: CANARY INVARIANT ENGINE
 * Specifications: Master Blueprint Section XXV (Canary Invariant)
 *
 * Invariant: An unresolved canary consumes full risk budget and blocks conflicting
 * new exposure until authoritative reconciliation.
 */
export class CanaryInvariantController {
    activeCanaries = new Map();
    registerCanary(experimentId, targetMint, allocatedLamports) {
        this.activeCanaries.set(experimentId, {
            experimentId,
            targetMint,
            allocatedCapitalLamports: allocatedLamports,
            isEntryExecuted: true,
            isExitExecuted: false,
            isAuthoritativelyReconciled: false,
        });
    }
    recordExit(experimentId) {
        const existing = this.activeCanaries.get(experimentId);
        if (!existing)
            return;
        this.activeCanaries.set(experimentId, { ...existing, isExitExecuted: true });
    }
    reconcileCanary(experimentId) {
        const existing = this.activeCanaries.get(experimentId);
        if (!existing)
            return;
        this.activeCanaries.set(experimentId, { ...existing, isAuthoritativelyReconciled: true });
    }
    /**
     * Section XXV Invariant: An unresolved canary consumes full risk budget
     * and blocks conflicting new exposure until authoritative reconciliation.
     */
    canAuthorizeNewExposure(targetMint) {
        for (const canary of this.activeCanaries.values()) {
            if (!canary.isAuthoritativelyReconciled) {
                if (canary.targetMint === targetMint) {
                    return {
                        allowed: false,
                        reason: `CANARY_CONFLICT: Unresolved canary ${canary.experimentId} is active on mint ${targetMint}; blocks new exposure`,
                    };
                }
            }
        }
        return { allowed: true };
    }
    getTotalUnresolvedCanaryRisk() {
        let sum = 0n;
        for (const canary of this.activeCanaries.values()) {
            if (!canary.isAuthoritativelyReconciled) {
                sum += canary.allocatedCapitalLamports;
            }
        }
        return sum;
    }
}
//# sourceMappingURL=canary-invariant.js.map