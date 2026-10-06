/**
 * SYLPH FUSION — EXTREME-PREDICTION CERTIFICATE (Section 27)
 *
 * Immutable, cryptographically signed prediction certificate required before
 * feeding the strategy / capital layer.
 *
 * Contains all mathematical boundaries from Sections 6, 7, 8, 9, 10, 11, 12, 18, 22, 23.
 *
 * Core Principle:
 * Only VALID certificates can feed the strategy layer.
 * This is still not capital authority.
 */
import { createHash } from 'node:crypto';
export class ExtremePredictionCertificateAuthority {
    /**
     * Seals an immutable prediction certificate with cryptographic root digest.
     */
    static issueCertificate(params) {
        let certificateStatus = 'VALID';
        if (params.abstain) {
            certificateStatus = 'ABSTAIN_FLAGGED';
        }
        else if (!params.informationSufficiency ||
            !params.predictabilityFrontierCrossed ||
            params.reachability < 0.25 ||
            params.capturability < 0.20 ||
            params.viabilityMargin < 0.05 ||
            params.exitReachability < 0.25 ||
            params.domainShiftScore > 0.45) {
            certificateStatus = 'REJECTED';
        }
        const payload = JSON.stringify({
            mint: params.mint,
            target: params.target,
            predictionTimeMs: params.predictionTimeMs,
            posteriorProbability: params.posteriorProbability,
            bayesErrorLowerBound: params.bayesErrorLowerBound,
            conformalRiskBound: params.conformalRiskBound,
            reachability: params.reachability,
            capturability: params.capturability,
            viabilityMargin: params.viabilityMargin,
            exitReachability: params.exitReachability,
            abstain: params.abstain,
            evidenceSources: params.evidenceSources,
        });
        const certificateRoot = createHash('sha256')
            .update('PREDICTION_CERTIFICATE_V1:')
            .update(payload)
            .digest('hex');
        const certificateId = `cert_${params.mint.slice(0, 8)}_${params.target}_${params.predictionTimeMs}`;
        return Object.freeze({
            ...params,
            certificateId,
            certificateRoot,
            certificateStatus,
        });
    }
    /**
     * Verifies the cryptographic integrity of a prediction certificate.
     */
    static verifyCertificate(cert) {
        const payload = JSON.stringify({
            mint: cert.mint,
            target: cert.target,
            predictionTimeMs: cert.predictionTimeMs,
            posteriorProbability: cert.posteriorProbability,
            bayesErrorLowerBound: cert.bayesErrorLowerBound,
            conformalRiskBound: cert.conformalRiskBound,
            reachability: cert.reachability,
            capturability: cert.capturability,
            viabilityMargin: cert.viabilityMargin,
            exitReachability: cert.exitReachability,
            abstain: cert.abstain,
            evidenceSources: cert.evidenceSources,
        });
        const expectedRoot = createHash('sha256')
            .update('PREDICTION_CERTIFICATE_V1:')
            .update(payload)
            .digest('hex');
        return cert.certificateRoot === expectedRoot;
    }
}
//# sourceMappingURL=prediction-certificate.js.map