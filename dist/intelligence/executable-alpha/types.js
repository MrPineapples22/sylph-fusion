/**
 * SYLPH FUSION — EXECUTABLE ALPHA & EXTREME RUNNER TYPES
 * Specifications: Sections I, IV, V, VI, VII, VIII, X, XI, XV, XVII, XIX, XXI, XXIII, XXXI, XLI, XLII, XLIII
 *
 * Invariant: HistoricalPeak != PredictiveEdge != ExecutableOpportunity != RealizedProfit
 * Target: ExpectedExecutableNetEdge
 */
import { createHash } from 'node:crypto';
export function computeCertificateDigest(cert) {
    const payload = [
        cert.certificateId,
        cert.mint,
        cert.poolAddress,
        cert.stateRoot,
        cert.evidenceRoot,
        cert.observationQualityRoot,
        cert.informationCertificateRoot,
        cert.distributionCertificateRoot,
        cert.authenticityRoot,
        cert.runnerProbability.toFixed(4),
        cert.failureProbability.toFixed(4),
        cert.decision,
        cert.expectedNetEdgeUsd.toFixed(4),
        cert.blockers.join(','),
    ].join('::');
    return createHash('sha256').update(payload).digest('hex');
}
//# sourceMappingURL=types.js.map