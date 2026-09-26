/**
 * PHASE 15, 16 & 17 — QUORUMROOT, MIRRORLOCK & ECLIPSE-GUARD
 *
 * Implements:
 * - Signed ObservationReceipts for provider responses
 * - Provider Equivocation Detection (MirrorLock)
 * - Provider Failure Domain Independence (QuorumRoot)
 * - Missingness Security Dimension Classifier (EclipseGuard)
 *
 * Prime Invariant:
 * Provider failure or equivocation reduces provider authority;
 * it NEVER manufactures token guilt or a protected VETO.
 */
export class MirrorLock {
    receiptsByReqKey = new Map();
    quarantinedProviders = new Set();
    equivocationLog = [];
    reqKey(receipt) {
        return `${receipt.subject.kind}:${receipt.subject.mint ?? ''}:${receipt.bankSlot}:${receipt.canonicalRequestHash}`;
    }
    /**
     * Records an observation receipt and actively checks for provider equivocation.
     * Equivocation occurs when the SAME provider reports DIFFERENT response hashes
     * for the exact same semantic request and bank slot.
     */
    recordReceipt(receipt) {
        if (this.quarantinedProviders.has(receipt.providerId)) {
            return { isAccepted: false, equivocationDetected: true };
        }
        const key = this.reqKey(receipt);
        const existing = this.receiptsByReqKey.get(key) ?? [];
        for (const prev of existing) {
            if (prev.providerId === receipt.providerId && prev.rawResponseHash !== receipt.rawResponseHash) {
                // Provider Equivocation confirmed!
                this.quarantinedProviders.add(receipt.providerId);
                const report = {
                    providerId: receipt.providerId,
                    detectedAtUnixMs: Date.now(),
                    conflictingReceipts: [prev, receipt],
                    reason: `Provider ${receipt.providerId} returned conflicting hashes for slot ${receipt.bankSlot}`,
                };
                this.equivocationLog.push(report);
                return { isAccepted: false, equivocationDetected: true, report };
            }
        }
        existing.push(receipt);
        this.receiptsByReqKey.set(key, existing);
        return { isAccepted: true, equivocationDetected: false };
    }
    isProviderQuarantined(providerId) {
        return this.quarantinedProviders.has(providerId);
    }
    getEquivocations() {
        return [...this.equivocationLog];
    }
}
export class QuorumRoot {
    /**
     * Verifies that corroborating receipts come from INDEPENDENT causal failure domains,
     * not merely multiple endpoints behind the same provider backend.
     */
    static verifyFailureDomainDiversity(receipts, requiredIndependentDomains) {
        const domains = new Set();
        for (const r of receipts) {
            domains.add(r.failureDomainId);
        }
        const uniqueDomains = Array.from(domains);
        return {
            satisfiesDiversity: uniqueDomains.length >= requiredIndependentDomains,
            uniqueDomains,
        };
    }
}
export class EclipseGuard {
    /**
     * Classifies missing evidence into a typed security dimension.
     * Missing evidence triggers operational containment (WAIT, QUARANTINE), NEVER a token VETO.
     */
    static classifyMissingness(params) {
        if (params.isSchemaError) {
            return { classification: 'SCHEMA_FAILURE', operationalAction: 'QUARANTINE' };
        }
        if (params.httpStatus === 429) {
            return { classification: 'RATE_LIMIT', operationalAction: 'WAIT' };
        }
        if (params.isSelectiveGap) {
            return { classification: 'POSSIBLE_ADVERSARIAL_SUPPRESSION', operationalAction: 'BLOCK_NEW_ENTRY' };
        }
        if (params.failedProvidersCount === params.totalProvidersCount && params.totalProvidersCount > 0) {
            return { classification: 'CORRELATED_PROVIDER_GAP', operationalAction: 'QUARANTINE' };
        }
        if (params.failedProvidersCount > 0) {
            return { classification: 'PROVIDER_OUTAGE', operationalAction: 'WAIT' };
        }
        if (params.latencyMs > 5000) {
            return { classification: 'NORMAL_LATENCY', operationalAction: 'WAIT' };
        }
        return { classification: 'UNKNOWN_CAUSE', operationalAction: 'WAIT' };
    }
}
//# sourceMappingURL=mirrorlock.js.map