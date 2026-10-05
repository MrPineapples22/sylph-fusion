/**
 * SYLPH FUSION — LABELFORGE V2: BITEMPORAL POINT-IN-TIME OUTCOME CERTIFICATION
 * Specifications: Blueprint Section 36
 * Workbook: #559, #543
 *
 * Invariants:
 * 1. Strict bitemporal causality:
 *    occurredAt <= observedAt <= availableAt <= knownAt <= decisionAt < targetTime <= settledAt <= labelMaturedAt
 * 2. Only ECONOMIC_FINAL may enter production learning.
 * 3. Ancestor revocation inheritance: if terminality, settlement, or profit certificates are revoked,
 *    the label is automatically invalidated (REVISED_INVALID).
 */
import { createHash } from 'node:crypto';
export class LabelForgeV2 {
    /**
     * Certifies a bitemporal point-in-time outcome label.
     */
    static certifyLabel(params) {
        const t = params.timeline;
        // Invariant 1: Temporal ordering
        if (t.availableAt > t.knownAt) {
            throw new Error(`FUTURE_LEAKAGE: Feature availableAt ${t.availableAt} > knownAt ${t.knownAt}`);
        }
        if (t.knownAt > t.decisionAt) {
            throw new Error(`KNOWLEDGE_CUT_VIOLATION: knownAt ${t.knownAt} > decisionAt ${t.decisionAt}`);
        }
        if (t.decisionAt >= t.targetTime) {
            throw new Error(`TARGET_CAUSALITY_VIOLATION: decisionAt ${t.decisionAt} >= targetTime ${t.targetTime}`);
        }
        if (t.targetTime > t.settledAt) {
            throw new Error(`SETTLEMENT_PREMATURE: targetTime ${t.targetTime} > settledAt ${t.settledAt}`);
        }
        if (t.settledAt > t.labelMaturedAt) {
            throw new Error(`MATURITY_PREMATURE: settledAt ${t.settledAt} > labelMaturedAt ${t.labelMaturedAt}`);
        }
        // Check ancestor revocations
        let effectiveFinality = params.labelFinality;
        if (params.revocationRegistry) {
            const isTerminalityRevoked = params.revocationRegistry.isRevoked(params.terminalityCertificateId);
            const isSettlementRevoked = params.revocationRegistry.isRevoked(params.settlementCertificateId);
            const isProfitRevoked = params.revocationRegistry.isRevoked(params.profitCertificateId);
            if (isTerminalityRevoked || isSettlementRevoked || isProfitRevoked) {
                effectiveFinality = 'REVISED_INVALID';
            }
        }
        const payload = [
            params.tokenMint,
            params.creatorIdentity,
            params.funderClusterId,
            params.economicFactId,
            params.executionGenerationId,
            t.decisionAt,
            t.targetTime,
            t.settledAt,
            t.labelMaturedAt,
            params.knowledgeCutRoot,
            params.terminalityCertificateId,
            params.settlementCertificateId,
            params.profitCertificateId,
            params.finalLabelValue,
            effectiveFinality,
        ].join(':');
        const digest = createHash('sha256').update(payload).digest('hex');
        const labelId = `LABEL-V2-${digest.slice(0, 16)}`;
        return {
            labelId,
            tokenMint: params.tokenMint,
            creatorIdentity: params.creatorIdentity,
            funderClusterId: params.funderClusterId,
            economicFactId: params.economicFactId,
            executionGenerationId: params.executionGenerationId,
            timeline: params.timeline,
            knowledgeCutRoot: params.knowledgeCutRoot,
            terminalityCertificateId: params.terminalityCertificateId,
            settlementCertificateId: params.settlementCertificateId,
            profitCertificateId: params.profitCertificateId,
            finalLabelValue: params.finalLabelValue,
            labelFinality: effectiveFinality,
            realizedNetProceedsLamports: params.realizedNetProceedsLamports,
            totalFrictionLamports: params.totalFrictionLamports,
            implementationShortfallBps: params.implementationShortfallBps,
            provenanceRoot: digest,
            digest,
        };
    }
    /**
     * Revalidates an existing label against current revocation status.
     */
    static checkRevocationStatus(label, revocationRegistry) {
        const isTerminalityRevoked = revocationRegistry.isRevoked(label.terminalityCertificateId);
        const isSettlementRevoked = revocationRegistry.isRevoked(label.settlementCertificateId);
        const isProfitRevoked = revocationRegistry.isRevoked(label.profitCertificateId);
        if (isTerminalityRevoked || isSettlementRevoked || isProfitRevoked) {
            return {
                ...label,
                labelFinality: 'REVISED_INVALID',
            };
        }
        return label;
    }
}
//# sourceMappingURL=labelforge-v2.js.map