/**
 * PHASE 40 & 41 — SEALVIEW & PROOFVOICE
 *
 * Implements:
 * - Sealed UI decision envelope (UI renders backend truth without recomputing)
 * - Mechanically derived authoritative explanations (ExplanationCertificate)
 * - Strict 3-way separation:
 *   1. AUTHORITATIVE EXPLANATION (proof-derived only)
 *   2. ANALYTICAL CONTEXT (market/liquidity)
 *   3. AI COMMENTARY (non-authoritative)
 * - Exact "WHY VETO", "WHY NOT VETO", and "WHAT WOULD INVALIDATE THIS PROOF"
 */

import { HardVetoProof, MintIdentity, sha256Hex } from './types.js';

export interface AuthoritativeExplanationClaim {
  readonly claimId: string;
  readonly sentence: string;
  readonly mappedRuleId: string;
  readonly mappedEvidenceId: string;
  readonly slot: bigint;
}

export interface ExplanationCertificate {
  readonly certificateId: string;
  readonly proofHash: string;
  readonly subject: MintIdentity;
  readonly whyVeto: readonly AuthoritativeExplanationClaim[];
  readonly whatWouldInvalidateThisProof: readonly string[];
  readonly issuedAtSlot: bigint;
  readonly certHash: string;
}

export class ProofVoiceEngine {
  /**
   * Mechanically generates authoritative explanations directly from a HardVetoProof.
   * If a sentence cannot be grounded in an exact evidence ID and rule ID, it is omitted.
   */
  public static generateExplanation(
    proof: HardVetoProof,
    ruleHumanName: string = proof.ruleId
  ): ExplanationCertificate {
    const claims: AuthoritativeExplanationClaim[] = [];

    // Derive exact claims from minimal witness roots
    for (const evId of proof.minimalWitnessIds) {
      claims.push({
        claimId: `claim_${proof.proofId}_${evId}`,
        sentence: `Token structural violation proven by rule '${ruleHumanName}' on canonical bank slot ${proof.bank.slot}.`,
        mappedRuleId: proof.ruleId,
        mappedEvidenceId: evId,
        slot: proof.bank.slot,
      });
    }

    const invalidators: string[] = [
      `Canonical reorg or orphaning of bank ${proof.bank.blockhash}`,
      `Verified newer on-chain mutation at slot > ${proof.bank.slot} demonstrating revocation`,
      `Protocol epoch upgrade invalidating decoder hash for rule '${proof.ruleId}'`,
      `Active defeater surfacing from independent auditor attestation`,
    ];

    const certificateId = `exp_${proof.proofId}`;
    const unsigned = {
      certificateId,
      proofHash: proof.proofHash,
      subject: proof.subject,
      whyVeto: claims,
      whatWouldInvalidateThisProof: invalidators,
      issuedAtSlot: proof.bank.slot,
    };

    return Object.freeze({
      ...unsigned,
      certHash: sha256Hex(unsigned),
    });
  }

  /**
   * Generates a "WHY NOT VETO" explanation when safety evaluates to PASS or UNKNOWN.
   */
  public static generateWhyNotVeto(params: {
    subject: MintIdentity;
    safetyState: 'PASS' | 'UNKNOWN' | 'CONFLICTED';
    reason: string;
  }): {
    readonly subject: MintIdentity;
    readonly safetyState: 'PASS' | 'UNKNOWN' | 'CONFLICTED';
    readonly authoritativeReason: string;
    readonly disclaimer: string;
  } {
    let disclaimer = 'Safety is proven across all registered hard rules.';
    if (params.safetyState === 'UNKNOWN') {
      disclaimer = 'Token has no proven violation, but safety is UNKNOWN due to incomplete coverage or pending evidence.';
    } else if (params.safetyState === 'CONFLICTED') {
      disclaimer = 'Token has no proven violation, but safety is CONFLICTED due to provider or decoder disagreement.';
    }

    return {
      subject: params.subject,
      safetyState: params.safetyState,
      authoritativeReason: params.reason,
      disclaimer,
    };
  }
}
