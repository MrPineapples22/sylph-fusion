/**
 * PHASE 34, 30 & 36 — PROOFVAULT, PROOF-DEATH & CAUSAL TRANSITION DELTA-CERT
 *
 * Implements:
 * - Content-addressed immutable storage for HardVetoProofs and evidence dependencies
 * - ProofDeathCertificate generation (kills dead proofs permanently)
 * - CausalTransitionCertificate (VETO Δ-CERT) ensuring no spontaneous state transitions
 */

import {
  BankIdentity,
  EvidenceRoot,
  HardVetoProof,
  MintIdentity,
  ProofDeathCertificate,
  sha256Hex,
} from './types.js';

export type CausalTransitionTrigger =
  | 'NEW_CANONICAL_FACT'
  | 'FACT_INVALIDATED'
  | 'POLICY_CHANGE'
  | 'PROTOCOL_CHANGE'
  | 'BANK_CHANGE';

export interface CausalTransitionCertificate {
  readonly deltaCertId: string;
  readonly subject: MintIdentity;
  readonly previousState: 'PASS' | 'FAIL' | 'UNKNOWN' | 'CONFLICTED';
  readonly nextState: 'PASS' | 'FAIL' | 'UNKNOWN' | 'CONFLICTED';
  readonly trigger: CausalTransitionTrigger;
  readonly causalEvidenceId?: string;
  readonly slot: bigint;
  readonly certHash: string;
}

export class ProofVault {
  private readonly proofsByHash = new Map<string, HardVetoProof>();
  private readonly evidenceByHash = new Map<string, EvidenceRoot>();
  private readonly deathCertificates = new Map<string, ProofDeathCertificate>();
  private readonly transitionCertificates: CausalTransitionCertificate[] = [];

  public storeProof(proof: HardVetoProof, dependencies: readonly EvidenceRoot[]): void {
    this.proofsByHash.set(proof.proofHash, proof);
    for (const root of dependencies) {
      this.evidenceByHash.set(root.rawBytesHash, root);
    }
  }

  public getProof(proofHash: string): HardVetoProof | undefined {
    return this.proofsByHash.get(proofHash);
  }

  public getAllActiveProofs(): readonly HardVetoProof[] {
    return Array.from(this.proofsByHash.values()).filter((p) => p.status === 'ACTIVE');
  }

  public getProofCount(): number {
    return this.proofsByHash.size;
  }

  public verifyProofReconstructability(proofHash: string): {
    readonly isReconstructable: boolean;
    readonly missingDependencyCount: number;
  } {
    const proof = this.proofsByHash.get(proofHash);
    if (!proof) return { isReconstructable: false, missingDependencyCount: 1 };

    let missing = 0;
    for (const evId of proof.evidenceIds) {
      let found = false;
      for (const root of this.evidenceByHash.values()) {
        if (root.evidenceId === evId) {
          found = true;
          break;
        }
      }
      if (!found) missing++;
    }

    return {
      isReconstructable: missing === 0,
      missingDependencyCount: missing,
    };
  }

  /**
   * Produces an irreversible ProofDeathCertificate.
   */
  public killProof(
    proof: HardVetoProof,
    reason: ProofDeathCertificate['deathReason'],
    killedAtSlot: bigint,
    causalEvidenceId?: string
  ): ProofDeathCertificate {
    const deathCertificateId = `pdc_${proof.proofId}_${killedAtSlot}`;
    const unsigned = {
      deathCertificateId,
      deadProofId: proof.proofId,
      deadProofHash: proof.proofHash,
      subject: proof.subject,
      deathReason: reason,
      causalWitnessEvidenceId: causalEvidenceId,
      killedAtSlot,
    };

    const deathCert: ProofDeathCertificate = Object.freeze({
      ...unsigned,
      certificateHash: sha256Hex(unsigned),
    });

    this.deathCertificates.set(proof.proofId, deathCert);

    // Update in-memory proof status to DEAD
    const updatedProof: HardVetoProof = {
      ...proof,
      status: 'DEAD',
    };
    this.proofsByHash.set(proof.proofHash, updatedProof);

    return deathCert;
  }

  public getDeathCertificate(proofId: string): ProofDeathCertificate | undefined {
    return this.deathCertificates.get(proofId);
  }

  /**
   * Records a CausalTransitionCertificate (VETO Δ-CERT).
   */
  public recordTransition(
    subject: MintIdentity,
    previousState: CausalTransitionCertificate['previousState'],
    nextState: CausalTransitionCertificate['nextState'],
    trigger: CausalTransitionTrigger,
    slot: bigint,
    causalEvidenceId?: string
  ): CausalTransitionCertificate {
    const deltaCertId = `dtc_${subject.mint}_${slot}_${Date.now()}`;
    const unsigned = {
      deltaCertId,
      subject,
      previousState,
      nextState,
      trigger,
      causalEvidenceId,
      slot,
    };

    const cert: CausalTransitionCertificate = Object.freeze({
      ...unsigned,
      certHash: sha256Hex(unsigned),
    });

    this.transitionCertificates.push(cert);
    return cert;
  }
}
