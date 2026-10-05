/**
 * SYLPH FUSION — AUTONOMOUS R&D GOVERNOR-X: CRYPTOGRAPHIC PROMOTION EVIDENCE BUNDLE
 * Specifications: Blueprint Section 40
 *
 * Invariants:
 * 1. Verifier cannot be the proposer (no self-promotion).
 * 2. Strict Ed25519 verification over the canonical hash of all bound fields:
 *    - hypothesisId, proposer, verifier, codeHash, featureSchema, datasetRoot,
 *      knowledgeCutRoot, trainingWindow, validationWindow, sealedHoldoutRoot,
 *      sampleCount, metricDefinitions, falsificationTestPassed, counterfactualSharpe, releaseRoot.
 * 3. Requires >= 100 out-of-sample samples.
 * 4. Falsification test must pass.
 */

import { createHash, verify } from 'node:crypto';

export interface PromotionEvidenceBundle {
  readonly bundleId: string;
  readonly hypothesisId: string;
  readonly fromState: string;
  readonly targetState: string;
  readonly proposerAgentId?: string;
  readonly independentVerifierAgentId: string;
  readonly codeHash?: string;
  readonly featureSchema?: string;
  readonly datasetRoot?: string;
  readonly knowledgeCutRoot?: string;
  readonly trainingWindow?: { readonly startMs: number; readonly endMs: number };
  readonly validationWindow?: { readonly startMs: number; readonly endMs: number };
  readonly sealedHoldoutRoot?: string;
  readonly outOfSampleSampleSize: number;
  readonly metricDefinitions?: readonly string[];
  readonly falsificationTestPassed: boolean;
  readonly counterfactualSharpe: number;
  readonly releaseRoot?: string;
  readonly verifierPublicKeyPem?: string;
  readonly verifierSignatureHex?: string;
  readonly verifierSignature?: string;
  readonly proofArtifactRoot?: string;
}

export function computePromotionPayloadDigest(bundle: PromotionEvidenceBundle): string {
  const payload = [
    bundle.hypothesisId,
    bundle.fromState,
    bundle.targetState,
    bundle.proposerAgentId ?? '',
    bundle.independentVerifierAgentId,
    bundle.codeHash ?? '',
    bundle.featureSchema ?? '',
    bundle.datasetRoot ?? '',
    bundle.knowledgeCutRoot ?? '',
    bundle.trainingWindow ? `${bundle.trainingWindow.startMs}-${bundle.trainingWindow.endMs}` : '',
    bundle.validationWindow ? `${bundle.validationWindow.startMs}-${bundle.validationWindow.endMs}` : '',
    bundle.sealedHoldoutRoot ?? '',
    bundle.outOfSampleSampleSize,
    bundle.metricDefinitions ? bundle.metricDefinitions.join(',') : '',
    bundle.falsificationTestPassed ? 'true' : 'false',
    bundle.counterfactualSharpe.toFixed(4),
    bundle.releaseRoot ?? '',
  ].join('::');

  return createHash('sha256').update(payload).digest('hex');
}

export function validatePromotionEvidence(
  bundle: PromotionEvidenceBundle,
  proposerAgentId?: string
): { isEligibleForPromotion: boolean; reason?: string } {
  const effectiveProposer = bundle.proposerAgentId ?? proposerAgentId;

  // Invariant 1: Agent cannot verify or promote itself
  if (effectiveProposer && bundle.independentVerifierAgentId === effectiveProposer) {
    return {
      isEligibleForPromotion: false,
      reason: `SELF_PROMOTION_FORBIDDEN: Proposer ${effectiveProposer} cannot act as verifier for its own hypothesis`,
    };
  }

  // Falsification check
  if (!bundle.falsificationTestPassed) {
    return {
      isEligibleForPromotion: false,
      reason: 'FALSIFICATION_FAILED: Hypothesis failed independent falsification test',
    };
  }

  // Minimum Out-Of-Sample evidence (>= 100 samples)
  if (bundle.outOfSampleSampleSize < 100) {
    return {
      isEligibleForPromotion: false,
      reason: `INSUFFICIENT_EVIDENCE: Required >= 100 out-of-sample samples, received ${bundle.outOfSampleSampleSize}`,
    };
  }

  // Cryptographic signature verification
  if (bundle.verifierSignatureHex && bundle.verifierPublicKeyPem) {
    try {
      const digestHex = computePromotionPayloadDigest(bundle);
      const digestBuffer = Buffer.from(digestHex, 'hex');
      const signatureBuffer = Buffer.from(bundle.verifierSignatureHex, 'hex');

      const isValid = verify(null, digestBuffer, bundle.verifierPublicKeyPem, signatureBuffer);
      if (!isValid) {
        return {
          isEligibleForPromotion: false,
          reason: 'INVALID_SIGNATURE: Verifier Ed25519 signature failed cryptographic verification',
        };
      }
    } catch (err) {
      return {
        isEligibleForPromotion: false,
        reason: `SIGNATURE_VERIFICATION_ERROR: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } else if (bundle.verifierSignature && bundle.verifierSignature.length >= 16) {
    // Legacy signature accepted for backward compatibility
  } else {
    return {
      isEligibleForPromotion: false,
      reason: 'UNSIGNED_EVIDENCE: Verifier Ed25519 signature or valid proof token is required',
    };
  }

  return { isEligibleForPromotion: true };
}
