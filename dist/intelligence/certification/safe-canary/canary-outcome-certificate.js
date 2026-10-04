/**
 * SYLPH FUSION — SAFE-CANARY-X: CANARY OUTCOME CERTIFICATE
 * Specifications: Master Blueprint Section XXIV (Canary Outcome Certificate)
 */
import { createHash } from 'node:crypto';
export function certifyCanaryOutcome(params) {
    const certifiedAtMs = Date.now();
    const isHypothesisSupported = params.causalTreatmentEffectBps > 0 && params.isReconciled;
    const unsigned = {
        experimentId: params.experimentId,
        level: params.canaryLevel,
        policyId: params.policyArtifactId,
        pnl: params.realizedPnLLamports.toString(),
        effectBps: params.causalTreatmentEffectBps,
        isReconciled: params.isReconciled,
        certifiedAtMs,
    };
    const certificateHash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
    const certificateId = `coc_${certificateHash.slice(0, 16)}`;
    return {
        certificateId,
        experimentId: params.experimentId,
        canaryLevel: params.canaryLevel,
        policyArtifactId: params.policyArtifactId,
        sampleSize: params.sampleSize,
        realizedPnLLamports: params.realizedPnLLamports,
        causalTreatmentEffectBps: params.causalTreatmentEffectBps,
        isHypothesisSupported,
        isReconciled: params.isReconciled,
        certificateHash,
        certifiedAtMs,
    };
}
//# sourceMappingURL=canary-outcome-certificate.js.map