/**
 * SYLPH FUSION — ALPHA REALITY-X: ALPHA REALITY CERTIFICATE
 * Specifications: Master Blueprint Section XIII (Alpha Reality Certificate)
 *
 * Invariant: Only certified incremental signal value may progress to capital allocation.
 */
import { createHash } from 'node:crypto';
export function certifyAlphaReality(params) {
    const issuedAtMs = Date.now();
    let certificateState = 'PROVEN_TRUE';
    if (params.sampleSize < 30 || params.tradedSampleSize < 5) {
        certificateState = 'INSUFFICIENT_EVIDENCE';
    }
    else if (params.orthogonalization.isCollinearWithExistingSignals ||
        params.netRealizedReturnBps < params.costHurdleBps ||
        !params.walkForwardVerified) {
        certificateState = 'PROVEN_FALSE';
    }
    const unsigned = {
        strategyId: params.strategyId,
        startSlot: params.startSlot.toString(),
        endSlot: params.endSlot.toString(),
        sampleSize: params.sampleSize,
        tradedSampleSize: params.tradedSampleSize,
        netIC: params.orthogonalization.incrementalInformationCoefficient,
        residualAlphaBps: params.orthogonalization.residualAlphaBps,
        certificateState,
        issuedAtMs,
    };
    const certificateHash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
    const certificateId = `arc_${certificateHash.slice(0, 16)}`;
    return {
        certificateId,
        strategyId: params.strategyId,
        evaluationPeriodSlots: { start: params.startSlot, end: params.endSlot },
        sampleSize: params.sampleSize,
        tradedSampleSize: params.tradedSampleSize,
        netInformationCoefficient: params.orthogonalization.incrementalInformationCoefficient,
        incrementalAlphaBps: params.orthogonalization.residualAlphaBps,
        netSharpeHurdlePassed: params.netRealizedReturnBps >= params.costHurdleBps,
        collinearityCheckPassed: !params.orthogonalization.isCollinearWithExistingSignals,
        walkForwardVerified: params.walkForwardVerified,
        certificateState,
        certificateHash,
        issuedAtMs,
    };
}
//# sourceMappingURL=alpha-reality-certificate.js.map