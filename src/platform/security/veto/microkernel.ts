/**
 * PHASE 23 — TOKEN SAFETY MICROKERNEL
 *
 * Isolated, minimal verification boundary for Token Safety.
 * Does not import, understand, or process:
 * - HSI, alpha, momentum, wallet score, portfolio exposure, Kelly, or AI models.
 *
 * Owns the formal evaluation of HardVetoProof candidates.
 */

import { randomUUID } from 'node:crypto';
import { DefeaterZeroEngine } from './defeater-zero.js';
import { EvidenceGenomeDAG } from './evidence-genome.js';
import { HardRuleRegistry } from './hard-rule-registry.js';
import {
  BankIdentity,
  CertifiedHardRule,
  EvidenceRoot,
  HardVetoProof,
  MintIdentity,
  sha256Hex,
} from './types.js';
import { UnitLock } from './unitlock.js';

export type MicrokernelEvaluationOutcome =
  | { readonly tokenSafety: 'FAIL'; readonly proof: HardVetoProof; readonly reason: string }
  | { readonly tokenSafety: 'PASS'; readonly reason: string }
  | { readonly tokenSafety: 'UNKNOWN'; readonly reason: string }
  | { readonly tokenSafety: 'CONFLICTED'; readonly reason: string };

export class TokenSafetyMicrokernel {
  private readonly defeaterEngine = new DefeaterZeroEngine();

  constructor(
    private readonly registry: HardRuleRegistry,
    private readonly dag: EvidenceGenomeDAG = new EvidenceGenomeDAG()
  ) {}

  public evaluateRule(
    subject: MintIdentity,
    ruleId: string,
    evidenceRoots: readonly EvidenceRoot[],
    newerEvidenceRoots: readonly EvidenceRoot[] = [],
    currentProtocolEpoch: bigint = 1n
  ): MicrokernelEvaluationOutcome {
    // 1. Verify Rule Exists in Active Signed Registry
    const rule = this.registry.active(ruleId);
    if (!rule) {
      return { tokenSafety: 'UNKNOWN', reason: `Rule ${ruleId} is absent from active signed registry` };
    }

    // 2. Verify Subject Applicability
    if (rule.applicability.subjectKind !== subject.kind) {
      return { tokenSafety: 'UNKNOWN', reason: 'Rule is not applicable to subject kind' };
    }
    if (rule.applicability.clusterGenesisHash && rule.applicability.clusterGenesisHash !== subject.clusterGenesisHash) {
      return { tokenSafety: 'UNKNOWN', reason: 'Rule cluster constraint does not match subject cluster' };
    }

    // 3. Filter Supporting Evidence for Rule Target Fact
    const supporting = evidenceRoots.filter((r) => r.fact === rule.evaluatorIr.targetFact);
    if (supporting.length === 0) {
      return { tokenSafety: 'UNKNOWN', reason: `Missing required root evidence for fact: ${rule.evaluatorIr.targetFact}` };
    }

    // 4. Verify Evidence Belongs to Exact Subject (SUBJECTLOCK)
    for (const root of supporting) {
      if (
        root.subject.kind !== subject.kind ||
        (root.subject as MintIdentity).mint !== subject.mint ||
        root.subject.clusterGenesisHash !== subject.clusterGenesisHash
      ) {
        return { tokenSafety: 'CONFLICTED', reason: 'Cross-mint evidence detected in proof evaluation' };
      }
    }

    // 5. Verify Canonical Bank (BANKLOCK)
    for (const root of supporting) {
      if (root.bank.clusterGenesisHash !== subject.clusterGenesisHash || root.bank.canonicality !== 'CANONICAL') {
        return { tokenSafety: 'UNKNOWN', reason: 'Evidence is not grounded in a canonical bank for this cluster' };
      }
    }

    // 6. Verify Raw-Byte Decoder Provenance
    for (const root of supporting) {
      if (!root.rawBytesHash || !root.decoderId || !root.decoderHash || !root.schemaHash) {
        return { tokenSafety: 'UNKNOWN', reason: 'Evidence lacks raw-byte decoder or schema provenance' };
      }
    }

    // 7. Verify Decoder Agreement & Decoded State Integrity
    for (const root of supporting) {
      if (root.state.kind === 'CONFLICTED') {
        return { tokenSafety: 'CONFLICTED', reason: 'Decoders in conflict for target fact' };
      }
      if (root.state.kind === 'UNKNOWN' || root.state.kind === 'UNSUPPORTED') {
        return { tokenSafety: 'UNKNOWN', reason: `Authority fact is incomplete or unsupported: ${root.state.kind}` };
      }
    }

    // Add roots to DAG for cycle & witness checking
    for (const root of supporting) {
      this.dag.addRoot(root);
    }

    // 8. Verify Acyclic Provenance (ACYCLOPS)
    const acyclopsCheck = this.dag.verifyAcyclic(supporting.map((r) => r.evidenceId));
    if (!acyclopsCheck.isAcyclic) {
      return { tokenSafety: 'CONFLICTED', reason: `Circular provenance detected: ${acyclopsCheck.cyclePath?.join(' -> ')}` };
    }

    // 9. Evaluate Rule Operator
    let violationProven = false;
    let violatingRoots: EvidenceRoot[] = [];

    switch (rule.evaluatorIr.op) {
      case 'AUTHORITY_EQUALS_PRESENT': {
        violatingRoots = supporting.filter((r) => r.state.kind === 'PRESENT');
        violationProven = violatingRoots.length > 0;
        break;
      }
      case 'EXACT_BPS_GREATER_THAN': {
        const threshold = rule.evaluatorIr.thresholdBps ?? 500n;
        violatingRoots = supporting.filter((r) => r.numericValue !== undefined && r.numericValue > threshold);
        violationProven = violatingRoots.length > 0;
        break;
      }
      case 'LOWER_BOUND_BPS_GREATER_THAN': {
        const threshold = rule.evaluatorIr.thresholdBps ?? 8000n;
        violatingRoots = supporting.filter(
          (r) => r.intervalBound !== undefined && UnitLock.isLowerBoundBreachProven(r.intervalBound, threshold)
        );
        violationProven = violatingRoots.length > 0;
        break;
      }
      default:
        return { tokenSafety: 'UNKNOWN', reason: `Unsupported rule operator: ${rule.evaluatorIr.op}` };
    }

    if (!violationProven) {
      return { tokenSafety: 'PASS', reason: 'No structural violation proven for evaluated rule' };
    }

    // 10. Extract Minimal Witness (VETO-WITNESS)
    const witnessExtract = this.dag.extractMinimalWitness(
      subject,
      violatingRoots.map((r) => r.evidenceId),
      (subset) => subset.length > 0
    );

    // 11. Defeater Closure Verification (DEFEATER-ZERO)
    const primaryBank = violatingRoots[0].bank;
    const defeaterCert = this.defeaterEngine.searchDefeaters({
      subject,
      rule,
      bank: primaryBank,
      evidenceRoots: violatingRoots,
      newerEvidenceRoots,
      currentProtocolEpoch,
      requiredProtocolEpoch: 1n,
    });

    if (defeaterCert.status !== 'CLOSED') {
      return {
        tokenSafety: 'UNKNOWN',
        reason: `Defeater surfaced: ${defeaterCert.activeDefeaterFound ?? 'closure not achieved'}`,
      };
    }

    // 12. Construct Immutable HardVetoProof
    const proofId = `hvp_${randomUUID()}`;
    const unsignedProof = {
      proofId,
      ruleId: rule.ruleId,
      subject,
      evidenceIds: violatingRoots.map((r) => r.evidenceId).sort(),
      minimalWitnessIds: witnessExtract.minimalWitnessIds,
      bank: primaryBank,
      defeaterCertificateHash: defeaterCert.certificateHash,
      microkernelVerificationHash: sha256Hex({ proofId, ruleId: rule.ruleId, subject, bank: primaryBank }),
      issuedAtSlot: primaryBank.slot,
      status: 'ACTIVE' as const,
    };

    const proof: HardVetoProof = Object.freeze({
      ...unsignedProof,
      proofHash: sha256Hex(unsignedProof),
    });

    return {
      tokenSafety: 'FAIL',
      proof,
      reason: `Hard structural violation proven: ${rule.ruleId}`,
    };
  }
}
