/**
 * SYLPH FUSION — RUNTIME DIVERGENCE & SHADOW PARITY CERTIFICATE
 * Specifications: Master Blueprint Section 4 (One Runtime — Step 4.1 Shadow Integration)
 *
 * Epistemic Invariants:
 * 1. Old runtime (src/fusion.ts) remains authoritative during transition.
 * 2. UnifiedPipelineUnit runs shadow-only on every real candidate.
 * 3. Every divergence between old and new decision, calculated edge, safety result, or exit
 *    emits an immutable, canonically hashed RuntimeDivergenceCertificate.
 */

import { hashCanonical } from './canonical-hashing.js';

export interface DecisionVector {
  readonly pass: boolean;
  readonly edgeBps: number;
  readonly safetyPassed: boolean;
  readonly exitReason?: string;
}

export interface RuntimeDivergenceCertificate {
  readonly certificateId: string;
  readonly mint: string;
  readonly candidateGenerationId: string;
  readonly evaluatedAt: string;
  readonly oldDecision: DecisionVector;
  readonly newDecision: DecisionVector;
  readonly hasDivergence: boolean;
  readonly divergenceReasons: readonly string[];
  readonly certificateHash: string;
}

export class RuntimeDivergenceAuditor {
  private readonly certificates: RuntimeDivergenceCertificate[] = [];

  /**
   * Compares the authoritative legacy runtime decision against the UnifiedPipelineUnit shadow decision.
   * If any component diverges, creates and archives a RuntimeDivergenceCertificate.
   */
  public evaluateDivergence(params: {
    mint: string;
    candidateGenerationId: string;
    oldDecision: DecisionVector;
    newDecision: DecisionVector;
    evaluatedAt?: string;
  }): RuntimeDivergenceCertificate {
    const { mint, candidateGenerationId, oldDecision, newDecision } = params;
    const evaluatedAt = params.evaluatedAt ?? new Date().toISOString();
    const divergenceReasons: string[] = [];

    if (oldDecision.pass !== newDecision.pass) {
      divergenceReasons.push(
        `DECISION_DISAGREEMENT: Old runtime passed=${oldDecision.pass}, New pipeline passed=${newDecision.pass}`
      );
    }

    if (Math.abs(oldDecision.edgeBps - newDecision.edgeBps) > 5) {
      divergenceReasons.push(
        `EDGE_CALCULATION_DRIFT: Old edge=${oldDecision.edgeBps}bps, New edge=${newDecision.edgeBps}bps (delta > 5bps)`
      );
    }

    if (oldDecision.safetyPassed !== newDecision.safetyPassed) {
      divergenceReasons.push(
        `SAFETY_GATE_DISAGREEMENT: Old safety=${oldDecision.safetyPassed}, New safety=${newDecision.safetyPassed}`
      );
    }

    if (oldDecision.exitReason !== newDecision.exitReason) {
      divergenceReasons.push(
        `EXIT_POLICY_DISAGREEMENT: Old exit=${oldDecision.exitReason ?? 'NONE'}, New exit=${newDecision.exitReason ?? 'NONE'}`
      );
    }

    const hasDivergence = divergenceReasons.length > 0;
    const certificateId = `div_cert_${mint}_${Date.now()}`;

    const preimage = {
      certificateId,
      mint,
      candidateGenerationId,
      evaluatedAt,
      oldDecision,
      newDecision,
      hasDivergence,
      divergenceReasons,
    };

    const certificateHash = hashCanonical(preimage);

    const certificate: RuntimeDivergenceCertificate = Object.freeze({
      certificateId,
      mint,
      candidateGenerationId,
      evaluatedAt,
      oldDecision: Object.freeze({ ...oldDecision }),
      newDecision: Object.freeze({ ...newDecision }),
      hasDivergence,
      divergenceReasons: Object.freeze([...divergenceReasons]),
      certificateHash,
    });

    if (hasDivergence) {
      this.certificates.push(certificate);
    }

    return certificate;
  }

  public getDivergenceCount(): number {
    return this.certificates.length;
  }

  public getAllDivergences(): readonly RuntimeDivergenceCertificate[] {
    return Object.freeze([...this.certificates]);
  }

  public getByMint(mint: string): readonly RuntimeDivergenceCertificate[] {
    return Object.freeze(this.certificates.filter((c) => c.mint === mint));
  }
}
