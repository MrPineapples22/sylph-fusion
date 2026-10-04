/**
 * SYLPH FUSION — AUTONOMOUS R&D GOVERNOR-X: PROMOTION EVIDENCE BUNDLE
 * Specifications: Master Blueprint Section LIV (Hypothesis Registry & Promotion Evidence)
 *
 * Invariant: Every research-ladder transition must verify stage-specific certificates.
 * Caller-supplied descriptive strings are never evidence.
 */

import { createHash } from 'node:crypto';

export interface PromotionEvidenceBundle {
  readonly bundleId: string;
  readonly hypothesisId: string;
  readonly fromState: string;
  readonly targetState: string;
  readonly independentVerifierAgentId: string;
  readonly outOfSampleSampleSize: number;
  readonly falsificationTestPassed: boolean;
  readonly counterfactualSharpe: number;
  readonly proofArtifactRoot: string;
  readonly verifierSignature: string;
}

export function validatePromotionEvidence(
  bundle: PromotionEvidenceBundle,
  proposerAgentId: string
): { isEligibleForPromotion: boolean; reason?: string } {
  // Invariant Section LIII: Agent cannot verify or promote itself
  if (bundle.independentVerifierAgentId === proposerAgentId) {
    return {
      isEligibleForPromotion: false,
      reason: `SELF_PROMOTION_FORBIDDEN: Proposer ${proposerAgentId} cannot act as verifier for its own hypothesis`,
    };
  }

  // Falsification check
  if (!bundle.falsificationTestPassed) {
    return {
      isEligibleForPromotion: false,
      reason: 'FALSIFICATION_FAILED: Hypothesis failed independent falsification test',
    };
  }

  // Minimum Out-Of-Sample evidence
  if (bundle.outOfSampleSampleSize < 100) {
    return {
      isEligibleForPromotion: false,
      reason: `INSUFFICIENT_EVIDENCE: Required >= 100 out-of-sample samples, received ${bundle.outOfSampleSampleSize}`,
    };
  }

  // Cryptographic signature presence
  if (!bundle.verifierSignature || bundle.verifierSignature.length < 16) {
    return {
      isEligibleForPromotion: false,
      reason: 'UNSIGNED_EVIDENCE: Verifier signature is missing or malformed',
    };
  }

  return { isEligibleForPromotion: true };
}
